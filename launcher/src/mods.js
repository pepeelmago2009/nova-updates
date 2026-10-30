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

/** Compara versiones tipo 1.21.4 (numeros por partes). */
function cmpVer(a, b) {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0), pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

/** Cumple mc una condicion de fabric.mod.json ("~1.21.4", ">=1.21.1 <1.21.2", "1.21.x", ["1.21", "1.21.1"])? */
function mcMatches(cond, mc) {
  if (cond == null || cond === '*') return true;
  if (Array.isArray(cond)) return cond.some((c) => mcMatches(c, mc));
  return String(cond).split(/\s+/).filter(Boolean).every((part) => {
    const m = /^(>=|<=|>|<|=|~|\^)?(.+)$/.exec(part);
    const op = m[1] || '', v = m[2];
    if (/[xX*]/.test(v)) { const pre = v.replace(/[.]?[xX*].*$/, ''); return mc === pre || mc.startsWith(pre + '.'); }
    const c = cmpVer(mc, v);
    switch (op) {
      case '>=': return c >= 0; case '>': return c > 0; case '<=': return c <= 0; case '<': return c < 0;
      case '~': { const base = v.split('.'); const next = [base[0], String((parseInt(base[1], 10) || 0) + 1)].join('.'); return c >= 0 && cmpVer(mc, next) < 0; }
      case '^': { const next = String((parseInt(v.split('.')[0], 10) || 0) + 1); return c >= 0 && cmpVer(mc, next) < 0; }
      default: return c === 0;
    }
  });
}

/** Sirve este .jar de Fabric para esta version de Minecraft? (mira "depends.minecraft" de fabric.mod.json) */
function jarFitsMc(file, mc) {
  try {
    const AdmZip = require('adm-zip');
    const e = new AdmZip(file).getEntry('fabric.mod.json');
    if (!e) return true;
    const meta = JSON.parse(e.getData().toString('utf8').replace(/[\u0000-\u001f]+/g, ' '));
    return mcMatches(meta.depends && meta.depends.minecraft, mc);
  } catch { return true; } // si no se puede leer, se deja (como antes)
}

/** id, version y "breaks" de un .jar de Fabric (null si no se puede leer). */
function jarMeta(file) {
  try {
    const AdmZip = require('adm-zip');
    const e = new AdmZip(file).getEntry('fabric.mod.json');
    if (!e) return null;
    return JSON.parse(e.getData().toString('utf8').replace(/[\u0000-\u001f]+/g, ' '));
  } catch { return null; }
}

/**
 * Quita los mods que declaran que chocan con otro instalado (p. ej. MoreCulling 1.0.10 rompe con Sodium 0.6.13).
 * Devuelve los slugs quitados. Asi el juego siempre abre aunque Modrinth de una combinacion mala.
 */
function dropConflicts(dir, keep) {
  const metas = keep.map((k) => ({ k, m: jarMeta(path.join(dir, k.filename)) }));
  const present = new Map();
  for (const { m } of metas) if (m && m.id) present.set(m.id, String(m.version || '0').replace(/\+.*$/, ''));
  const dropped = [];
  for (const { k, m } of metas) {
    if (!m || !m.breaks || k.slug === 'nova' || k.slug === 'fabric-api') continue;
    const clash = Object.entries(m.breaks).some(([id, range]) => present.has(id) && id !== m.id && mcMatches(range, present.get(id)));
    if (clash) { dropped.push(k.slug); fs.rmSync(path.join(dir, k.filename), { force: true }); }
  }
  return dropped;
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
      // Modrinth a veces marca un mod para varias versiones aunque solo funcione en una (p. ej. Sodium de 1.21.1 en 1.21)
      if (!jarFitsMc(dest, mc)) { fs.rmSync(dest, { force: true }); missing.push(r.key); continue; }
      keep.push({ slug: r.key, projectId: r.projectId, filename: file.filename });
    }
  }

  const nova = opts.nova ? bundledNova(resourcesDir, mc) : null;
  if (nova) {
    fs.copyFileSync(nova, path.join(dir, 'nova-client.jar'));
    keep.push({ slug: 'nova', filename: 'nova-client.jar' });
  }

  for (const slug of dropConflicts(dir, keep)) { // mods que chocan entre si: se quita el que avisa del choque
    keep.splice(keep.findIndex((k) => k.slug === slug), 1);
    missing.push(slug);
  }

  for (const p of previous) { // quita lo que puso antes y ya no toca (otra version, mod desactivado...)
    if (!keep.some((k) => k.filename === p.filename)) fs.rmSync(path.join(dir, p.filename), { force: true });
  }
  fs.writeFileSync(manifest, JSON.stringify(keep, null, 2));
  return { nova: !!nova, missing };
}

module.exports = { dropConflicts, mcMatches, jarFitsMc, syncMods, bundledNova, novaVersions, modrinthFile, latestVersion, resolveWithDeps, fileOf, readList, MANAGED, USER, MODRINTH };
