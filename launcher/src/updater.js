/**
 * Actualizaciones automaticas y obligatorias del lanzador (y del mod Nova que va dentro).
 * Al abrir (y cada media hora) busca una version nueva donde se publican (package.json -> build.publish) y la descarga sola.
 * Mientras hay una actualizacion pendiente no se puede jugar; al terminar de bajar se instala y el lanzador se reinicia solo.
 * Si Minecraft esta abierto, se instala apenas se cierre. Sin lugar de publicacion configurado (o sin internet) no hace nada.
 */
function setup(app, emit, isGameRunning) {
  const none = { install: () => false, blocking: () => false, afterGame: () => {} };
  if (!app.isPackaged) return none;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return none; }
  let pending = false, ready = false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  const installNow = () => {
    if (!ready || isGameRunning()) return false; // nunca en medio de una partida
    emit('update', { state: 'installing' });
    setTimeout(() => autoUpdater.quitAndInstall(true, true), 2500); // deja ver el aviso un momento
    return true;
  };
  autoUpdater.on('update-available', (i) => { pending = true; emit('update', { state: 'downloading', version: i.version, percent: 0 }); });
  autoUpdater.on('download-progress', (p) => emit('update', { state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (i) => { ready = true; emit('update', { state: 'ready', version: i.version }); installNow(); });
  autoUpdater.on('error', (e) => {
    if (!ready) pending = false; // si falla la descarga no se bloquea el juego para siempre
    emit('log', '[Nova] No se pudo buscar actualizaciones: ' + (e && e.message ? e.message.split('\n')[0] : e));
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 3000);
  setInterval(check, 30 * 60 * 1000);
  return {
    install: installNow,
    blocking: () => pending,       // hay actualizacion pendiente: no se puede jugar
    afterGame: () => installNow(), // se cerro Minecraft: si ya bajo, se instala
  };
}

module.exports = { setup };
