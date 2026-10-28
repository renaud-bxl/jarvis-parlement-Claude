const { contextBridge, ipcRenderer } = require('electron');

// Seuls ces événements du processus principal peuvent être écoutés par l'interface.
const CHANNELS = new Set(['progress', 'brain-updated', 'veille-done', 'navigate', 'mail-alert', 'mail-alerts', 'mail-open', 'update-available', 'update-progress', 'update-error']);

contextBridge.exposeInMainWorld('jarvis', {
  call: async (method, args) => {
    if (typeof method !== 'string') throw new Error('Méthode invalide.');
    const r = await ipcRenderer.invoke('api', method, args);
    if (r && r.__error) throw new Error(r.__error);
    return r;
  },
  on: (channel, cb) => {
    if (!CHANNELS.has(channel) || typeof cb !== 'function') return () => {};
    const h = (_e, data) => cb(data);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
});
