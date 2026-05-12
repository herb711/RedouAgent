const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("redouDesktop", {
  pickDirectory: () => ipcRenderer.invoke("redou:pick-directory"),
});
