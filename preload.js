const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (data) => ipcRenderer.invoke('data:save', data),
  exportData: (data) => ipcRenderer.invoke('data:export', data),
  notify: (title, body) => ipcRenderer.invoke('notify', { title, body }),
  onUpdate: (cb) => {
    ipcRenderer.on('update:event', (_e, payload) => cb(payload));
  },
  installUpdate: () => ipcRenderer.invoke('update:install'),
});
