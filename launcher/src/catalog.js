const fs = require('fs');
const path = require('path');
const net = require('./net');
const FABRIC_API_ID = 'P7dR8mSH';
const { resolveWithDeps, fileOf, readList, MANAGED, USER, MODRINTH } = require('./mods');

// Seccion "Mods" del lanzador: buscar mods en Modrinth para la version elegida, instalarlos (con sus dependencias)
// en la carpeta de esa version, y ver o quitar los que hay.

function modsDir(instanceDir) {
  const dir = path.join(instanceDir, 'mods');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Busca mods de Fabric para esa version. sort: 'relevance' | 'downloads' | 'updated'. */
async function search(mc, query, offset = 0, sort = 'relevance') {
  const facets = JSON.stringify([['categories:fabric'], [`versions:${mc}`], ['project_type:mod']]);
  const q = `query=${encodeURIComponent(query || '')}&facets=${encodeURIComponent(facets)}&index=${query ? sort : 'downloads'}&limit=24&offset=${offset}`;
  const r = await net.getJson(`${MODRINTH}/search?${q}`);
  return {
    total: r.total_hits,
    hits: r.hits.map((h) => ({
      projectId: h.project_id, slug: h.slug, title: h.title, description: h.description,
      icon: h.icon_url || '', downloads: h.downloads, author: h.author, categories: (h.categories || []).filter((c) => c !== 'fabric').slice(0, 3),
    })),
  };
}

/** Lo que hay en la carpeta de mods: los del usuario, los del cliente y otros .jar puestos a mano. */
function listInstalled(instanceDir) {
  const dir = modsDir(instanceDir);
  const client = readList(path.join(dir, MANAGED)).filter((m) => fs.existsSync(path.join(dir, m.filename)));
  const user = readList(path.join(dir, USER)).filter((m) => fs.existsSync(path.join(dir, m.filename)));
  const known = new Set([...client, ...user].map((m) => m.filename));
  const other = fs.readdirSync(dir).filter((n) => n.endsWith('.jar') && !known.has(n)).map((filename) => ({ filename, title: filename }));
  return { user, client, other };
}

/** Ids de proyecto ya presentes (del cliente o del usuario): no se instalan dos veces. */
function presentIds(instanceDir) {
  const { user, client } = listInstalled(instanceDir);
  return new Set([...user, ...client].map((m) => m.projectId).filter(Boolean));
}

/**
 * Instala un mod y sus dependencias obligatorias. info = {title, icon} del resultado de busqueda.
 * Devuelve { installed: [titulos], already: boolean }.
 */
async function install(instanceDir, mc, projectId, info = {}, onStatus = () => {}) {
  const dir = modsDir(instanceDir);
  const present = presentIds(instanceDir);
  present.add(FABRIC_API_ID); // Fabric API la pone siempre el cliente al jugar
  if (present.has(projectId)) return { installed: [], already: true };
  const { list, missing } = await resolveWithDeps([projectId], mc, present, onStatus);
  if (!list.length) throw new Error(missing.length ? 'Este mod no tiene version para Minecraft ' + mc : 'Nada que instalar');
  const userFile = path.join(dir, USER);
  const users = readList(userFile);
  const installed = [];
  for (const r of list) {
    const f = fileOf(r.version);
    onStatus(f.filename);
    const dest = path.join(dir, f.filename);
    if (!fs.existsSync(dest)) await net.download(f.url, dest, { sha1: f.sha1 });
    let title = r.projectId === projectId ? info.title : null;
    let icon = r.projectId === projectId ? info.icon : null;
    if (!title) {
      try { const p = await net.getJson(`${MODRINTH}/project/${r.projectId}`); title = p.title; icon = p.icon_url; } catch { title = f.filename; }
    }
    users.push({ projectId: r.projectId, slug: r.key, title, icon: icon || '', filename: f.filename, dependency: r.projectId !== projectId });
    installed.push(title);
  }
  fs.writeFileSync(userFile, JSON.stringify(users, null, 2));
  return { installed, already: false };
}

/** Quita un mod del usuario (o un .jar puesto a mano). Los del cliente no se quitan desde aqui. */
function remove(instanceDir, filename) {
  const dir = modsDir(instanceDir);
  if (path.basename(filename) !== filename || !filename.endsWith('.jar')) throw new Error('Nombre no valido');
  if (readList(path.join(dir, MANAGED)).some((m) => m.filename === filename)) throw new Error('Ese mod es del cliente: se quita desde Ajustes');
  fs.rmSync(path.join(dir, filename), { force: true });
  const userFile = path.join(dir, USER);
  fs.writeFileSync(userFile, JSON.stringify(readList(userFile).filter((m) => m.filename !== filename), null, 2));
}

module.exports = { search, listInstalled, install, remove };
