const fs = require('fs');
const path = require('path');
const net = require('./net');
const { FABRIC_API, PERFORMANCE_MODS } = require('./versions');

const MODRINTH = 'https://api.modrinth.com/v2';
const MANAGED = '.nova-managed.json'; // mods que puso el lanzador (los del usuario no se tocan)

/** Jar de Nova incluido en el instalador para esta version (resources/mods/nova-<mc>.jar), o null. */
function bundledNova(resourcesDir, mc) {
  const f = path.join(resourcesDir, `nova-${mc}.jar`);
  return fs.existsSync(f) ? f : null;
}

function novaVersions(resourcesDir) {
  if (!fs.existsSync(resourcesDir)) return [];
  return fs.readdirSync(resourcesDir).map((n) => /^nova-(.+)\.jar$/.exec(n)).filter(Boolean).map((m) => m[1]);
}

/** Ultima version de un proyecto (slug o id) para Fabric y esa version de Minecraft; prefiere las estables. */
async function latestVersion(idOrSlug, mc) {
  const q = `loaders=${encodeURIComponent('["fabric"]')}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`;
  const versions = await net.getJson(`${MODRINTH}/project/${encodeURIComponent(idOrSlug)}/version?${q}`);
  return versions.find((x) => x.version_type === 'release') || versions[0] || null;
}

function fileOf(v) {
  const f = v.files.find((x) => x.primary) || v.files[0];
  return { url: f.url, filename: f.filename, sha1: f.hashes && f.hashes.sha1 };
}

async function modrinthFile(slug, mc) {
  const v = await latestVersion(slug, mc);
  return v ? fileOf(v) : null;
}

/**
 * Resuelve una lista de proyectos con sus dependencias obligatorias (sin repetir proyectos).
 * skip: ids de proyecto que ya estan (por ejemplo los que instalo el usuario). Devuelve [{ key, projectId, version }].
 */
async function resolveWithDeps(roots, mc, skip = new Set(), onStatus = () => {}) {
  const out = [];
  const seen = new Set(skip);
  const queue = [...roots];
  const missing = [];
  while (queue.length) {
    const key = queue.shift();
    if (seen.has(key)) continue;
    onStatus(key);
    const v = await latestVersion(key, mc);
    if (!v) { missing.push(key); continue; }
    if (seen.has(v.project_id)) { seen.add(key); continue; }
    seen.add(key); seen.add(v.project_id);
    out.push({ key, projectId: v.project_id, version: v });
    for (const d of v.dependencies || []) {
      if (d.dependency_type === 'required' && d.project_id && !seen.has(d.project_id)) queue.push(d.project_id);
    }
  }
  return { list: out, missing };
}

/** Mods que instalo el usuario desde la seccion Mods del lanzador. */
const USER = '.nova-user.json';
function readList(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
}

/**
 * Deja en <instancia>/mods los mods del cliente: Fabric API, Nova (si hay jar para esta version) y los de
 * rendimiento si estan activados, con sus dependencias. No toca los mods del usuario ni repite uno que el ya tenga.
 * Devuelve { nova: boolean, missing: string[] }.
 */
async function syncMods(instanceDir, mc, opts, resourcesDir, onStatus = () => {}) {
  const dir = path.join(instanceDir, 'mods');
  fs.mkdirSync(dir, { recursive: true });
  const manifest = path.join(dir, MANAGED);
  const previous = readList(manifest);
  const userIds = new Set(readList(path.join(dir, USER)).filter((u) => fs.existsSync(path.join(dir, u.filename))).map((u) => u.projectId));

  const wanted = [FABRIC_API, ...(opts.perf ? PERFORMANCE_MODS : [])];
  const keep = [];
  let resolved;
  try {
    resolved = await resolveWithDeps(wanted, mc, userIds, onStatus);
  } catch (e) {
    // sin internet: se quedan los que ya estaban descargados
    const cached = previous.filter((p) => p.slug !== 'nova' && fs.existsSync(path.join(dir, p.filename)));
    if (!cached.length) throw e;
    resolved = null;
    keep.push(...cached);
  }
  const missing = resolved ? resolved.missing : [];
  if (resolved) {
    for (const r of resolved.list) {
      const file = fileOf(r.version);
      const dest = path.join(dir, file.filename);
      onStatus(r.key);
      if (!fs.existsSync(dest)) await net.download(file.url, dest, { sha1: file.sha1 });
      keep.push({ slug: r.key, projectId: r.projectId, filename: file.filename });
    }
  }

  const nova = opts.nova ? bundledNova(resourcesDir, mc) : null;
  if (nova) {
    fs.copyFileSync(nova, path.join(dir, 'nova-client.jar'));
    keep.push({ slug: 'nova', filename: 'nova-client.jar' });
  }

  for (const p of previous) { // quita lo que puso antes y ya no toca (otra version, mod desactivado...)
    if (!keep.some((k) => k.filename === p.filename)) fs.rmSync(path.join(dir, p.filename), { force: true });
  }
  fs.writeFileSync(manifest, JSON.stringify(keep, null, 2));
  return { nova: !!nova, missing };
}

module.exports = { syncMods, bundledNova, novaVersions, modrinthFile, latestVersion, resolveWithDeps, fileOf, readList, MANAGED, USER, MODRINTH };
