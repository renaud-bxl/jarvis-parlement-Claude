const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jarvis', {
  call: async (method, args) => {
    const r = await ipcRenderer.invoke('api', method, args);
    if (r && r.__error) throw new Error(r.__error);
    return r;
  },
  on: (channel, cb) => {
    const h = (_e, data) => cb(data);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
});
