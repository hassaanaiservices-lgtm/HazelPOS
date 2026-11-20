const { contextBridge, ipcRenderer } = require('electron');
const call = (name, ...a) => ipcRenderer.invoke(name, ...a);
contextBridge.exposeInMainWorld('printerApp', {
  state: () => call('state'),
  pair: (code, server) => call('pair', code, server),
  useKey: (key, server) => call('use-key', key, server),
  find: () => call('find'),
  save: printers => call('save', printers),
  testPage: kind => call('test-page', kind),
  unpair: () => call('unpair'),
  setAutostart: on => call('autostart', on),
  onStatus: fn => ipcRenderer.on('status', (_e, s) => fn(s)),
});
