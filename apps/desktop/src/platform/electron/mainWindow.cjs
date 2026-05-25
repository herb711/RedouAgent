'use strict';

const path = require('node:path');
const { BrowserWindow, nativeTheme } = require('electron');
const { loadRenderer } = require('./rendererLoader.cjs');

function resolveWindowIcon(options = {}) {
  if (options.iconPath) return options.iconPath;
  const iconFile = process.platform === 'win32' ? 'redou-agent.ico' : 'redou-agent.png';
  return path.resolve(__dirname, '../../../assets/icons', iconFile);
}

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
    icon: resolveWindowIcon(options),
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
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

module.exports = { createMainWindow, resolveWindowIcon };
