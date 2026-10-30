const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * Rendimiento segun el equipo: lee RAM, nucleos y tarjeta grafica, y de ahi saca
 * - cuanta RAM darle a Minecraft (mas memoria no da mas FPS: solo le quita RAM a Windows y alarga las limpiezas),
 * - las opciones de Java para jugar (limpiezas cortas y seguidas en vez de pausas largas: FPS parejos),
 * - los graficos iniciales de options.txt (una sola vez por instancia; despues manda el jugador).
 */

let gpuCache;
/** Nombres de las tarjetas graficas (solo Windows; en otros sistemas, lista vacia). */
function gpuNames() {
  if (gpuCache) return gpuCache;
  gpuCache = [];
  if (process.platform !== 'win32') return gpuCache;
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command', '(Get-CimInstance Win32_VideoController).Name'],
      { encoding: 'utf8', timeout: 8000, windowsHide: true });
    gpuCache = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch { /* sin PowerShell: se decide solo por RAM y nucleos */ }
  return gpuCache;
}

/** 'dedicated' (NVIDIA, Radeon RX...), 'integrated' (Intel, Radeon Graphics...) o 'unknown'. */
function gpuKind(names) {
  const n = (names || []).join(' | ').toLowerCase();
  if (/nvidia|geforce|quadro|rtx|gtx|radeon (rx|pro|r[579])|\barc a\d/.test(n)) return 'dedicated';
  if (/intel|radeon\(tm\) graphics|radeon graphics|vega \d|uhd|iris/.test(n)) return 'integrated';
  return 'unknown';
}

function detect() {
  const names = gpuNames();
  return { ramGB: Math.round(os.totalmem() / 1024 ** 3), threads: os.cpus().length, gpu: names[0] || '', gpuKind: gpuKind(names) };
}

/** RAM recomendada para Minecraft con Nova y los mods de FPS. */
function recommendedRam(totalGB) {
  if (totalGB <= 4) return 2;
  if (totalGB <= 8) return 3;
  if (totalGB <= 16) return 4;
  return 6;
}

/** 'performance' (equipo justo), 'balanced' o 'quality' (sobra potencia). */
function profileFor(hw) {
  if (hw.gpuKind === 'integrated' || hw.ramGB <= 8 || hw.threads <= 4) return 'performance';
  if (hw.gpuKind === 'dedicated' && hw.ramGB >= 16 && hw.threads >= 8) return 'quality';
  return 'balanced';
}

/** Opciones de Java para jugar (no las de servidor): G1 con pausas cortas, y la RAM que sobra vuelve a Windows. */
function jvmArgs(ramGB) {
  const region = ramGB <= 4 ? 8 : ramGB <= 8 ? 16 : 32;
  return [
    '-XX:+UnlockExperimentalVMOptions', '-XX:+UseG1GC', '-XX:MaxGCPauseMillis=40', `-XX:G1HeapRegionSize=${region}M`,
    '-XX:G1NewSizePercent=20', '-XX:G1ReservePercent=20', '-XX:+ParallelRefProcEnabled', '-XX:+UseStringDeduplication',
    '-XX:+PerfDisableSharedMem', '-XX:+ExplicitGCInvokesConcurrent', '-XX:G1PeriodicGCInterval=10000',
    '-XX:MinHeapFreeRatio=10', '-XX:MaxHeapFreeRatio=30',
  ];
}

/** Memoria minima: la mitad (crece sola si hace falta); asi el juego no le quita toda la RAM a Windows al abrir. */
function minRam(ramGB) { return Math.max(1, Math.floor(ramGB / 2)); }

const PROFILES = {
  performance: { renderDistance: 8, simulationDistance: 6, maxFps: 260, enableVsync: false, mipmapLevels: 0, particles: 2,
    entityShadows: false, renderClouds: '"false"', biomeBlendRadius: 0, graphicsMode: 0, viewBobbing: false },
  balanced: { renderDistance: 10, simulationDistance: 8, maxFps: 260, enableVsync: false, mipmapLevels: 2, particles: 1,
    entityShadows: true, renderClouds: '"fast"', biomeBlendRadius: 1, graphicsMode: 0, viewBobbing: true },
  quality: { renderDistance: 14, simulationDistance: 10, maxFps: 260, enableVsync: false, mipmapLevels: 4, particles: 0,
    entityShadows: true, renderClouds: '"true"', biomeBlendRadius: 2, graphicsMode: 1, viewBobbing: true },
};

/**
 * Graficos iniciales segun el equipo, una sola vez por instancia (marca en .nova-video.json); con force, siempre
 * (boton de la pagina Rendimiento). Devuelve el perfil aplicado o null si no se toco.
 */
function applyVideo(instanceDir, profile, force = false) {
  const mark = path.join(instanceDir, '.nova-video.json');
  if ((!force && fs.existsSync(mark)) || !PROFILES[profile]) return null;
  fs.mkdirSync(instanceDir, { recursive: true });
  const file = path.join(instanceDir, 'options.txt');
  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const vals = PROFILES[profile];
  const out = lines.filter((l) => !(l.split(':')[0] in vals));
  for (const [k, v] of Object.entries(vals)) out.push(`${k}:${v}`);
  fs.writeFileSync(file, out.join('\n') + '\n');
  fs.writeFileSync(mark, JSON.stringify({ profile, at: Date.now() }));
  return profile;
}

/** Partidas guardadas por Nova (config/nova-fps.json de cada version), de la mas nueva a la mas vieja. */
function fpsSessions(root) {
  const out = [];
  const dir = path.join(root, 'instances');
  for (const v of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(dir, v, 'config', 'nova-fps.json'), 'utf8'));
      for (const s of Array.isArray(list) ? list : []) if (s && typeof s.avg === 'number') out.push({ ...s, mc: s.mc || v });
    } catch { /* esa version todavia no tiene partidas */ }
  }
  return out.sort((a, b) => (b.time || 0) - (a.time || 0));
}

module.exports = { fpsSessions, detect, gpuKind, recommendedRam, profileFor, jvmArgs, minRam, applyVideo, PROFILES };
