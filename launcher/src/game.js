const fs = require('fs');
const path = require('path');
const { ensureJava, javaFor } = require('./java');
const { ensureFabric, installedProfiles } = require('./fabric');
const { syncMods, MANAGED } = require('./mods');
const { ensureMinecraft } = require('./minecraft');
const { preferDedicatedGpu, raisePriority } = require('./boost');
const perfconfig = require('./perfconfig');

/**
 * Recolector de basura G1 ajustado para juegos (opciones de Aikar): pausas cortas y parejas = FPS estables,
 * sin tirones al entrar o salir de un mundo. La memoria se reserva toda al abrir (Xms = Xmx): agrandarla despues da tirones.
 */
const JVM_ARGS = [
  '-XX:+UnlockExperimentalVMOptions', '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=40',
  '-XX:+DisableExplicitGC', '-XX:+AlwaysPreTouch', '-XX:G1NewSizePercent=30', '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=8M', '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=4',
  '-XX:InitiatingHeapOccupancyPercent=15', '-XX:G1MixedGCLiveThresholdPercent=90', '-XX:G1RSetUpdatingPauseTimePercent=5',
  '-XX:SurvivorRatio=32', '-XX:+PerfDisableSharedMem', '-XX:MaxTenuringThreshold=1', '-XX:+UseStringDeduplication',
];

/** En Windows, que java.exe no abra una ventana de consola negra (MCLC no pasa windowsHide). */
let patched = false;
function hideConsoleWindows() {
  if (patched || process.platform !== 'win32') return;
  patched = true;
  const cp = require('child_process');
  const { spawn, exec } = cp;
  cp.spawn = (cmd, args, opts) => spawn(cmd, args, { ...(opts || {}), windowsHide: true });
  cp.exec = (cmd, opts, cb) => (typeof opts === 'function' ? exec(cmd, { windowsHide: true }, opts) : exec(cmd, { ...(opts || {}), windowsHide: true }, cb));
}

/**
 * Prepara todo y abre Minecraft con Fabric. emit(channel, data) avisa a la interfaz:
 *   status {key, args}  -> texto del paso actual (se traduce en la interfaz)
 *   progress {value}    -> 0..1, o -1 para barra indeterminada
 *   log string          -> salida del juego
 * Devuelve una promesa que se resuelve con { code, nova } cuando se cierra el juego (nova = si se cargo el mod).
 * skipNova: abre esta vez sin Nova (lo usa el boton "Jugar sin Nova" si el juego se cerro con error).
 */
async function play({ root, resourcesDir, settings, mc, skipNova = false }, emit) {
  const instanceDir = path.join(root, 'instances', mc);
  fs.mkdirSync(instanceDir, { recursive: true });

  emit('status', { key: 'java' });
  const javaPath = await ensureJava(root, (d, t) => emit('progress', { value: t ? d / t : -1 }), javaFor(mc));

  emit('status', { key: 'fabric' });
  emit('progress', { value: -1 });
  const fabricId = await ensureFabric(root, mc);

  const modOpts = { ...settings, nova: settings.nova && !skipNova };
  const mods = await syncMods(instanceDir, mc, modOpts, resourcesDir, (slug) => emit('status', { key: 'mod', args: [slug] }));
  if (modOpts.nova && !mods.nova) emit('status', { key: 'noNova', args: [mc], sticky: true });
  installPacks(instanceDir, resourcesDir);
  if (settings.perf) { const tuned = perfconfig.tune(instanceDir); if (tuned.length) emit('log', `[Nova] Mods de FPS ajustados: ${tuned.join(', ')}`); }

  emit('status', { key: 'minecraft' });
  await ensureMinecraft(root, fabricId, mc, (done, total) => {
    emit('progress', { value: total ? done / total : 1 });
    if (total) emit('status', { key: 'downloadMb', args: [(done / 1048576).toFixed(0), (total / 1048576).toFixed(0)] });
  });

  emit('status', { key: 'checking' });
  hideConsoleWindows();
  preferDedicatedGpu(javaPath);
  const { Client, Authenticator } = require('minecraft-launcher-core');
  const launcher = new Client();
  launcher.on('progress', (e) => { if (e && e.total) emit('progress', { value: e.task / e.total }); });
  launcher.on('debug', (line) => emit('log', String(line)));
  launcher.on('data', (line) => {
    const s = String(line);
    emit('log', s);
    if (/Sound engine started|Backend library: LWJGL|Setting user:/.test(s)) emit('status', { key: 'running' });
  });

  return new Promise((resolve, reject) => {
    launcher.on('close', (code) => resolve({ code, nova: mods.nova }));
    launcher.launch({
      root,
      javaPath,
      version: { number: mc, type: 'release', custom: fabricId },
      memory: { max: `${settings.ramGB}G`, min: `${settings.ramGB}G` }, // toda de una vez: sin tirones al crecer
      customArgs: JVM_ARGS,
      authorization: settings.auth || Authenticator.getAuth(settings.username),
      window: settings.fullscreen ? { fullscreen: true } : { width: 1280, height: 720 },
      overrides: { gameDirectory: instanceDir, detached: false },
    }).then((proc) => {
      if (!proc) reject(new Error('Minecraft no se pudo iniciar (mira el registro)'));
      else { emit('status', { key: 'starting' }); emit('progress', { value: 1 }); raisePriority(proc.pid); }
    }).catch(reject);
  });
}

/** Copia el paquete de texturas "Nova FPS" a resourcepacks/ (Nova lo prende solo en ahorro Extra). */
function installPacks(instanceDir, resourcesDir) {
  const src = path.join(resourcesDir, '..', 'packs');
  if (!fs.existsSync(src)) return;
  const dst = path.join(instanceDir, 'resourcepacks');
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src).filter((n) => n.endsWith('.zip'))) {
    const a = path.join(src, f), b = path.join(dst, f);
    try { if (!fs.existsSync(b) || fs.statSync(b).size !== fs.statSync(a).size) fs.copyFileSync(a, b); } catch { /* el juego abre igual */ }
  }
}

/** Borra lo descargado de esta version para que se vuelva a bajar limpio (no toca mundos ni ajustes). */
function repair(root, mc) {
  const versions = path.join(root, 'versions');
  for (const id of installedProfiles(root, mc)) fs.rmSync(path.join(versions, id), { recursive: true, force: true });
  fs.rmSync(path.join(versions, mc), { recursive: true, force: true });
  fs.rmSync(path.join(root, 'assets', 'indexes'), { recursive: true, force: true });
  const mods = path.join(root, 'instances', mc, 'mods');
  try {
    for (const p of JSON.parse(fs.readFileSync(path.join(mods, MANAGED), 'utf8'))) fs.rmSync(path.join(mods, p.filename), { force: true });
    fs.rmSync(path.join(mods, MANAGED), { force: true });
  } catch { /* nada que reparar */ }
}

module.exports = { play, repair };
