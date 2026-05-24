'use strict';

const path = require('node:path');
const { BrowserWindow, nativeTheme } = require('electron');
const { loadRenderer } = require('./rendererLoader.cjs');

function createMainWindow(options = {}) {
  nativeTheme.themeSource = 'light';
  const preload = options.preloadPath || path.join(__dirname, 'preloadBridge.cjs');
  const window = new BrowserWindow({
    width: options.width || 1680,
    height: options.height || 950,
    minWidth: 980,
    minHeight: 720,
    backgroundColor: '#f7f7f5',
    title: 'Redou Workbench',
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  loadRenderer(window, options.renderer || {}).catch((error) => {
    window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<pre>${error.message}</pre>`)}`);
  });

  if (options.openDevTools || process.env.REDOU_OPEN_DEVTOOLS === '1') {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  return window;
}

module.exports = { createMainWindow };
