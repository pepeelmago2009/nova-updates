const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'NovaClient-Launcher/1.0 (github.com/nova-client)';

/** fetch con un error entendible si no hay conexion ("fetch failed" no dice nada). */
// Si hay un proxy configurado (HTTPS_PROXY), se usa; si no, conexion directa. Las pruebas cambian global.fetch.
let proxied;
function doFetch(url, opts) {
  if (global.fetch && global.fetch.isMock) return global.fetch(url, opts);
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !proxied) {
    const { fetch: uFetch, EnvHttpProxyAgent } = require('undici');
    const agent = new EnvHttpProxyAgent();
    proxied = (u, o) => uFetch(u, { ...o, dispatcher: agent });
  }
  return proxied ? proxied(url, opts) : fetch(url, opts);
}

async function get(url, headers) {
  try {
    return await doFetch(url, { headers: { 'User-Agent': UA, ...headers }, redirect: 'follow' });
  } catch (e) {
    throw new Error(`Sin conexion con ${new URL(url).host} (revisa tu internet o antivirus)`);
  }
}

async function getJson(url) {
  const res = await get(url, { Accept: 'application/json' });
  if (!res.ok) throw new Error(`HTTP ${res.status} en ${url}`);
  return res.json();
}

function hashFile(file, algo) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(file).on('error', reject).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex')));
  });
}

/**
 * Descarga a un archivo temporal y lo mueve al final (nunca deja archivos a medias).
 * @param {{sha1?: string, sha256?: string, onProgress?: (done:number, total:number) => void}} opts
 */
async function download(url, dest, opts = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await get(url, {});
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  let done = 0;
  try {
    for await (const chunk of res.body) {
      done += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      if (opts.onProgress) opts.onProgress(done, total);
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (e) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  for (const algo of ['sha1', 'sha256']) {
    if (!opts[algo]) continue;
    const got = await hashFile(tmp, algo);
    if (got !== opts[algo].toLowerCase()) {
      fs.rmSync(tmp, { force: true });
      throw new Error(`Archivo corrupto (${algo}) al descargar ${path.basename(dest)}`);
    }
  }
  fs.renameSync(tmp, dest);
  return dest;
}

module.exports = { getJson, download, hashFile, UA, doFetch };
