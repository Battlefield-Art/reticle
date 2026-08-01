'use strict';
/**
 * Preload. Exposes the app's IPC surface as `window.api` — the ordinary contextIsolation pattern.
 *
 * The Reticle line below is the ONLY change an Electron app makes, and it has to be here rather than
 * in the renderer: `contextBridge.exposeInMainWorld` hands the renderer a deeply frozen,
 * non-configurable object, so nothing running in the page can instrument `window.api`. The shim
 * wraps `ipcRenderer.invoke` while it is still an ordinary function, which covers every channel this
 * file goes on to expose. It must come BEFORE the app captures its own reference to ipcRenderer.
 *
 * Dev-only: a shipping app gates this require behind its own dev check.
 */
require('@reticlehq/browser/electron-preload');

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadTodos: () => ipcRenderer.invoke('todos:load'),
  addTodo: (title) => ipcRenderer.invoke('todos:add', title),
  archiveTodo: (id) => ipcRenderer.invoke('todos:archive', id),
});
