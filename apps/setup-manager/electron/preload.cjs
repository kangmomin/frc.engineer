const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-status', (_event, data) => callback(data));
  },
  getUpdateStatus: () => ipcRenderer.invoke('get-update-status'),
  installUpdate: () => {
    ipcRenderer.send('install-update');
  },
  getSetting: (key) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key, value) => ipcRenderer.invoke('set-setting', key, value),
  getAllSettings: () => ipcRenderer.invoke('get-all-settings'),
  getOverlayHotkeys: () => ipcRenderer.invoke('get-overlay-hotkeys'),
  setOverlayHotkeys: (hotkeys) => ipcRenderer.invoke('set-overlay-hotkeys', hotkeys),
  getSenderStorageInfo: () => ipcRenderer.invoke('get-sender-storage-info'),
  selectDirectory: (defaultPath) => ipcRenderer.invoke('select-directory', defaultPath),
  restartSender: () => ipcRenderer.invoke('restart-sender'),
  getIntercomBridgeToken: () => ipcRenderer.invoke('get-intercom-bridge-token'),
});
