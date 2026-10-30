const fs = require('fs');
const path = require('path');
const net = require('./net');

const META = 'https://meta.fabricmc.net/v2';

function installedProfiles(root, mc) {
  const dir = path.join(root, 'versions');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((id) => id.startsWith('fabric-loader-') && id.endsWith('-' + mc)
    && fs.existsSync(path.join(dir, id, id + '.json')));
}

/** Instala el perfil de Fabric Loader para la version y devuelve su id (p. ej. fabric-loader-0.16.10-1.21.4). */
async function ensureFabric(root, mc) {
  let loaders;
  try {
    loaders = await net.getJson(`${META}/versions/loader/${mc}`);
  } catch (e) {
    const local = installedProfiles(root, mc); // sin internet: usa el que ya este instalado
    if (local.length) return local.sort().pop();
    throw e;
  }
  const pick = loaders.find((l) => l.loader && l.loader.stable) || loaders[0];
  if (!pick) throw new Error(`Fabric todavia no soporta Minecraft ${mc}`);
  const id = `fabric-loader-${pick.loader.version}-${mc}`;
  const file = path.join(root, 'versions', id, id + '.json');
  if (!fs.existsSync(file)) {
    const profile = await net.getJson(`${META}/versions/loader/${mc}/${pick.loader.version}/profile/json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(profile, null, 2));
  }
  return id;
}

module.exports = { ensureFabric, installedProfiles };
