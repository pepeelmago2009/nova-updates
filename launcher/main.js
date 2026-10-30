const { app, BrowserWindow, ipcMain, shell, safeStorage } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const settingsStore = require('./src/settings');
const { SUPPORTED, FABRIC_API, PERFORMANCE_MODS } = require('./src/versions');
const { novaVersions } = require('./src/mods');
const game = require('./src/game');
const catalog = require('./src/catalog');
const accounts = require('./src/accounts');
const updater = require('./src/updater');

const ROOT = path.join(app.getPath('appData'), '.novaclient'); // Minecraft, Java y mods del lanzador
const SETTINGS = path.join(ROOT, 'launcher-settings.json');
const RESOURCES = app.isPackaged ? path.join(process.resourcesPath, 'mods') : path.join(__dirname, 'resources', 'mods');
const MAX_RAM = Math.max(1, Math.floor(os.totalmem() / 1024 ** 3) - 1);

let win;
let accountStore;
let updates = { install: () => false };

/** Cuentas guardadas; los tokens se cifran con safeStorage (en Windows, protegidos por tu usuario). */
function store() {
  if (!accountStore) {
    const enc = safeStorage.isEncryptionAvailable();
    accountStore = new accounts.Store(path.join(ROOT, 'accounts.json'), {
      encrypt: (s) => (enc ? 'e:' + safeStorage.encryptString(String(s)).toString('base64') : 'p:' + Buffer.from(String(s)).toString('base64')),
      decrypt: (s) => (String(s).startsWith('e:') ? safeStorage.decryptString(Buffer.from(String(s).slice(2), 'base64')) : Buffer.from(String(s).slice(2), 'base64').toString()),
    });
  }
  return accountStore;
}

/** Abre la pagina oficial de Microsoft para iniciar sesion y devuelve el codigo (el lanzador nunca ve tu contrasena). */
function microsoftLoginWindow() {
  return new Promise((resolve, reject) => {
    const w = new BrowserWindow({
      width: 500, height: 660, parent: win, modal: true, autoHideMenuBar: true, title: 'Microsoft', backgroundColor: '#ffffff',
      webPreferences: { partition: 'mslogin-' + Date.now(), contextIsolation: true, nodeIntegration: false },
    });
    let done = false;
    const check = (url) => {
      if (done || !String(url).startsWith(accounts.REDIRECT)) return;
      done = true;
      const u = new URL(url);
      const code = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      setImmediate(() => { if (!w.isDestroyed()) w.close(); });
      if (code) resolve(code);
      else { const e = new Error(err || 'loginFailed'); e.key = err === 'access_denied' ? 'loginCancel' : 'loginFailed'; reject(e); }
    };
    w.webContents.on('will-redirect', (_e, url) => check(url));
    w.webContents.on('will-navigate', (_e, url) => check(url));
    w.webContents.on('did-navigate', (_e, url) => check(url));
    w.on('closed', () => { if (!done) { done = true; const e = new Error('loginCancel'); e.key = 'loginCancel'; reject(e); } });
    w.loadURL(accounts.authUrl());
  });
}

const accountError = (e) => ({ ok: false, error: (e && e.key) || 'loginFailed', detail: String(e && e.message ? e.message : e) });
let running = false;

function emit(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 680,
    minWidth: 900,
    minHeight: 560,
    frame: false,
    backgroundColor: '#07070c',
    title: 'Nova Client',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  updates = updater.setup(app, emit, () => running);
}

ipcMain.handle('state:get', () => ({
  settings: settingsStore.load(SETTINGS, MAX_RAM),
  versions: SUPPORTED,
  novaVersions: novaVersions(RESOURCES),
  maxRam: MAX_RAM,
  clientSlugs: { always: [FABRIC_API], perf: PERFORMANCE_MODS },
  running,
  appVersion: app.getVersion(),
  accounts: store().list(),
}));

ipcMain.handle('settings:save', (_e, s) => settingsStore.save(SETTINGS, s, MAX_RAM));

ipcMain.handle('game:play', async (_e, mc, opts = {}) => {
  if (running) return { ok: false, error: 'already-running' };
  const settings = settingsStore.load(SETTINGS, MAX_RAM);
  if (!SUPPORTED.includes(mc)) return { ok: false, error: 'bad-version' };
  running = true;
  try {
    emit('status', { key: 'login' });
    settings.auth = await accounts.authFor(store(), settings.username, (name) => require('minecraft-launcher-core').Authenticator.getAuth(name));
    const launched = game.play({ root: ROOT, resourcesDir: RESOURCES, settings, mc, skipNova: !!opts.skipNova }, (ch, data) => {
      emit(ch, data);
      if (ch === 'status' && data.key === 'running' && settings.closeOnLaunch && win) win.hide();
    });
    const { code, nova } = await launched;
    emit('game-closed', { code, nova });
    return { ok: true, code };
  } catch (e) {
    emit('error', { message: e && e.key ? 'acc_' + e.key : (e && e.message ? e.message : String(e)) });
    return { ok: false, error: String(e && e.message ? e.message : e) };
  } finally {
    running = false;
    if (win && !win.isVisible()) win.show();
  }
});

ipcMain.handle('update:install', () => updates.install());

// ---- cuentas de Minecraft
ipcMain.handle('accounts:list', () => store().list());
ipcMain.handle('accounts:select', (_e, id) => store().select(id));
ipcMain.handle('accounts:remove', (_e, id) => store().remove(id));
ipcMain.handle('accounts:addMicrosoft', async () => {
  try {
    const code = await microsoftLoginWindow();
    return { ok: true, list: await accounts.addFromCode(store(), code) };
  } catch (e) { return accountError(e); }
});

ipcMain.handle('game:repair', (_e, mc) => {
  if (running) return { ok: false, error: 'already-running' };
  game.repair(ROOT, mc);
  return { ok: true };
});

// ---- seccion Mods
const instanceOf = (mc) => path.join(ROOT, 'instances', SUPPORTED.includes(mc) ? mc : settingsStore.load(SETTINGS, MAX_RAM).version);
const safe = (fn) => async (...a) => { try { return { ok: true, ...(await fn(...a)) }; } catch (e) { return { ok: false, error: e.message || String(e) }; } };
ipcMain.handle('mods:search', safe((_e, mc, query, offset, sort) => catalog.search(mc, query, offset, sort)));
ipcMain.handle('mods:list', safe((_e, mc) => catalog.listInstalled(instanceOf(mc))));
ipcMain.handle('mods:install', safe((_e, mc, projectId, info) => {
  if (running) throw new Error('Cierra Minecraft antes de instalar mods');
  return catalog.install(instanceOf(mc), mc, projectId, info, (s) => emit('mods-status', s));
}));
ipcMain.handle('mods:remove', safe((_e, mc, filename) => {
  if (running) throw new Error('Cierra Minecraft antes de quitar mods');
  catalog.remove(instanceOf(mc), filename);
  return {};
}));

ipcMain.handle('folder:open', (_e, which) => {
  const s = settingsStore.load(SETTINGS, MAX_RAM);
  const dir = which === 'mods' ? path.join(ROOT, 'instances', s.version, 'mods')
    : which === 'videos' ? path.join(ROOT, 'instances', s.version, 'nova', 'videos')
    : ROOT;
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

ipcMain.on('window', (_e, action) => {
  if (!win) return;
  if (action === 'min') win.minimize();
  else if (action === 'close') win.close();
});

// Una sola ventana del lanzador: si lo abren otra vez, se enfoca la que ya esta.
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
