const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const net = require('./net');

// Java (Temurin JRE) propio del lanzador: el usuario no tiene que instalar nada.
// Minecraft 1.21.x usa Java 21; desde 26.1 pide Java 25.
const MAJOR = 21;

/** Java que necesita esta version de Minecraft. */
function javaFor(mc) { return /^2\d\./.test(String(mc)) ? 25 : 21; }

function platform() {
  const os = { win32: 'windows', darwin: 'mac', linux: 'linux' }[process.platform];
  const arch = { x64: 'x64', arm64: 'aarch64' }[process.arch];
  if (!os || !arch) throw new Error(`Sistema no soportado: ${process.platform}/${process.arch}`);
  return { os, arch };
}

function javaBinary(home) {
  // java.exe (no javaw): MCLC lee la version por stderr; la ventana de consola se oculta en game.js
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const mac = path.join(home, 'Contents', 'Home', 'bin', exe);
  return fs.existsSync(mac) ? mac : path.join(home, 'bin', exe);
}

async function ensureJava(root, onProgress = () => {}, major = MAJOR) {
  const home = path.join(root, 'runtime', `java-${major}`);
  const bin = javaBinary(home);
  if (fs.existsSync(bin)) return bin;

  const { os, arch } = platform();
  const api = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jre&os=${os}&vendor=eclipse`;
  const assets = await net.getJson(api);
  const pkg = assets && assets[0] && assets[0].binary && assets[0].binary.package;
  if (!pkg) throw new Error(`No se encontro Java ${major} para tu sistema`);

  const archive = path.join(root, 'runtime', pkg.name);
  await net.download(pkg.link, archive, { sha256: pkg.checksum, onProgress: (d, t) => onProgress(d, t) });

  const tmp = path.join(root, 'runtime', 'extract');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  if (pkg.name.endsWith('.zip')) {
    const AdmZip = require('adm-zip');
    new AdmZip(archive).extractAllTo(tmp, true);
  } else {
    execFileSync('tar', ['-xzf', archive, '-C', tmp]);
  }
  const inner = fs.readdirSync(tmp).map((n) => path.join(tmp, n)).find((p) => fs.statSync(p).isDirectory());
  if (!inner) throw new Error('El archivo de Java esta vacio');
  fs.rmSync(home, { recursive: true, force: true });
  fs.renameSync(inner, home);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(archive, { force: true });
  if (process.platform !== 'win32') fs.chmodSync(javaBinary(home), 0o755);
  return javaBinary(home);
}

module.exports = { ensureJava, javaFor, platform, javaBinary };
