const { contextBridge, ipcRenderer } = require('electron');

// Puente seguro entre la interfaz (renderer) y el proceso principal.
contextBridge.exposeInMainWorld('nova', {
  getState: () => ipcRenderer.invoke('state:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  play: (version, opts) => ipcRenderer.invoke('game:play', version, opts),
  repair: (version) => ipcRenderer.invoke('game:repair', version),
  openFolder: (which) => ipcRenderer.invoke('folder:open', which),
  accounts: {
    list: () => ipcRenderer.invoke('accounts:list'),
    select: (id) => ipcRenderer.invoke('accounts:select', id),
    remove: (id) => ipcRenderer.invoke('accounts:remove', id),
    addMicrosoft: () => ipcRenderer.invoke('accounts:addMicrosoft'),
  },
  mods: {
    search: (mc, query, offset, sort) => ipcRenderer.invoke('mods:search', mc, query, offset, sort),
    list: (mc) => ipcRenderer.invoke('mods:list', mc),
    install: (mc, projectId, info) => ipcRenderer.invoke('mods:install', mc, projectId, info),
    remove: (mc, filename) => ipcRenderer.invoke('mods:remove', mc, filename),
  },
  installUpdate: () => ipcRenderer.invoke('update:install'),
  hardware: () => ipcRenderer.invoke('perf:hardware'),
  applyProfile: (mc, profile) => ipcRenderer.invoke('perf:apply', mc, profile),
  fpsSessions: () => ipcRenderer.invoke('perf:fps'),
  pingServer: (address) => ipcRenderer.invoke('servers:ping', address),
  window: (action) => ipcRenderer.send('window', action),
  on: (channel, fn) => {
    const ok = ['progress', 'status', 'log', 'game-closed', 'error', 'mods-status', 'update', 'update-required'];
    if (ok.includes(channel)) ipcRenderer.on(channel, (_e, data) => fn(data));
  },
});
