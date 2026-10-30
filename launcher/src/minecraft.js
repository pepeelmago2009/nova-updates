const fs = require('fs');
const path = require('path');
const net = require('./net');

// Descarga verificada de Minecraft (jar, librerias y assets) ANTES de que MCLC abra el juego.
// MCLC deja archivos vacios si una descarga falla y no revisa el hash de las librerias; aqui cada archivo
// se baja a un .part, se comprueba su sha1 y solo entonces se renombra, con reintentos y pocas conexiones a la vez.
const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const RESOURCES = 'https://resources.download.minecraft.net';
const CONCURRENCY = 8;
const RETRIES = 4;

function osName() {
  return { win32: 'windows', darwin: 'osx', linux: 'linux' }[process.platform];
}

/** Reglas de Mojang: si hay reglas, se permite solo si la ultima regla que coincide dice "allow". */
function allowed(rules) {
  if (!rules || !rules.length) return true;
  let ok = false;
  for (const r of rules) {
    let match = true;
    if (r.os && r.os.name && r.os.name !== osName()) match = false;
    if (r.os && r.os.arch === 'x86' && process.arch !== 'ia32') match = false;
    if (r.features) match = false;
    if (match) ok = r.action === 'allow';
  }
  return ok;
}

/** "grupo:artefacto:version[:clasificador]" -> ruta relativa dentro de libraries/ */
function mavenPath(name) {
  const [group, artifact, version, classifier] = name.split(':');
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.jar`;
  return [...group.split('.'), artifact, version, file].join('/');
}

/** Lista de archivos que necesita la version: { url, file, sha1?, size? }. */
function filesFor(root, customId, version, fabricProfile, assetIndex) {
  const files = [];
  const lib = (p) => path.join(root, 'libraries', ...p.split('/'));
  const client = version.downloads.client;
  files.push({ url: client.url, file: path.join(root, 'versions', customId, customId + '.jar'), sha1: client.sha1, size: client.size });
  for (const l of version.libraries) {
    const a = l.downloads && l.downloads.artifact;
    if (!a || !a.url || !allowed(l.rules)) continue;
    files.push({ url: a.url, file: lib(a.path), sha1: a.sha1, size: a.size });
  }
  for (const l of fabricProfile.libraries || []) {
    if (!l.name || !allowed(l.rules)) continue;
    const rel = mavenPath(l.name);
    const base = (l.url || 'https://maven.fabricmc.net/').replace(/\/?$/, '/');
    files.push({ url: base + rel, file: lib(rel), sha1: l.sha1, size: l.size });
  }
  for (const { hash, size } of Object.values(assetIndex.objects)) {
    files.push({ url: `${RESOURCES}/${hash.slice(0, 2)}/${hash}`, file: path.join(root, 'assets', 'objects', hash.slice(0, 2), hash), sha1: hash, size });
  }
  const seen = new Set(); // varios assets pueden tener el mismo hash: un solo archivo, una sola descarga
  return files.filter((f) => !seen.has(f.file) && seen.add(f.file));
}

/** Un archivo esta bien si existe y (si sabemos el tamaño) mide lo que debe. Rapido: no lee el contenido. */
function looksOk(f) {
  try {
    const st = fs.statSync(f.file);
    return st.size > 0 && (!f.size || st.size === f.size);
  } catch { return false; }
}

async function downloadWithRetry(f) {
  let last;
  for (let i = 0; i < RETRIES; i++) {
    try { return await net.download(f.url, f.file, { sha1: f.sha1 }); } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last;
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const item = items[i++]; await fn(item); }
  });
  await Promise.all(workers);
}

async function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** Version JSON de Mojang guardado donde MCLC lo busca: versions/<id fabric>/<mc>.json */
async function versionJson(root, customId, mc) {
  const file = path.join(root, 'versions', customId, mc + '.json');
  const cached = await readJson(file);
  if (cached && cached.downloads && cached.assetIndex) return cached;
  const manifest = await net.getJson(MANIFEST);
  const entry = manifest.versions.find((v) => v.id === mc);
  if (!entry) throw new Error(`Minecraft ${mc} no existe en los servidores de Mojang`);
  await net.download(entry.url, file, { sha1: entry.sha1 });
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Deja todo listo para que MCLC solo tenga que abrir el juego.
 * onProgress(doneBytes, totalBytes) mientras descarga lo que falte.
 */
async function ensureMinecraft(root, customId, mc, onProgress = () => {}) {
  const version = await versionJson(root, customId, mc);
  const fabricProfile = JSON.parse(fs.readFileSync(path.join(root, 'versions', customId, customId + '.json'), 'utf8'));
  // MCLC busca el indice de assets con el id de la version personalizada
  const indexFile = path.join(root, 'assets', 'indexes', customId + '.json');
  let assetIndex = await readJson(indexFile);
  if (!assetIndex || !assetIndex.objects) {
    await net.download(version.assetIndex.url, indexFile, { sha1: version.assetIndex.sha1 });
    assetIndex = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
  }

  const missing = filesFor(root, customId, version, fabricProfile, assetIndex).filter((f) => !looksOk(f));
  const total = missing.reduce((s, f) => s + (f.size || 0), 0);
  let done = 0;
  onProgress(0, total);
  const failed = [];
  await pool(missing, CONCURRENCY, async (f) => {
    try { await downloadWithRetry(f); } catch (e) { failed.push(f); }
    done += f.size || 0;
    onProgress(done, total);
  });
  if (failed.length) {
    throw new Error(`No se pudieron descargar ${failed.length} archivos de Minecraft (revisa tu internet y pulsa Jugar otra vez)`);
  }
  return { downloaded: missing.length, bytes: total };
}

module.exports = { ensureMinecraft, allowed, mavenPath, filesFor };
