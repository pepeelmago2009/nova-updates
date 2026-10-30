/**
 * Actualizaciones automaticas del lanzador (y del mod Nova que va dentro).
 * Al abrir, busca una version nueva donde se publican (package.json -> build.publish), la descarga sola
 * y avisa en la interfaz. Se instala al cerrar el lanzador o con el boton "Reiniciar y actualizar".
 * Sin lugar de publicacion configurado (o sin internet) no hace nada.
 */
function setup(app, emit, isGameRunning) {
  if (!app.isPackaged) return { install: () => false };
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch { return { install: () => false }; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  autoUpdater.on('update-available', (i) => emit('update', { state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => emit('update', { state: 'downloading', percent: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (i) => emit('update', { state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => emit('log', '[Nova] No se pudo buscar actualizaciones: ' + (e && e.message ? e.message.split('\n')[0] : e)));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 3000);
  setInterval(check, 30 * 60 * 1000); // y cada media hora
  return {
    install() {
      if (isGameRunning()) return false; // nunca en medio de una partida
      autoUpdater.quitAndInstall(true, true);
      return true;
    },
  };
}

module.exports = { setup };
