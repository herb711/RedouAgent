'use strict';

const path = require('node:path');

const CHANNELS = Object.freeze([
  'redou:desktop:settings:get',
  'redou:desktop:settings:update',
  'redou:desktop:notify',
  'redou:desktop:prevent-sleep',
  'redou:desktop:popout',
  'redou:desktop:open-external',
]);

function ok(data, warnings = []) {
  return { ok: true, data, error: null, warnings };
}

function fail(error) {
  return {
    ok: false,
    data: null,
    error: {
      code: error && error.code ? error.code : 'IPC_ERROR',
      message: error && error.message ? error.message : String(error),
      details: error && error.details ? error.details : null,
    },
    warnings: [],
  };
}

function handle(ipcMain, channel, handler) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return ok(await handler(payload || {}, event));
    } catch (error) {
      return fail(error);
    }
  });
}

function normalizeUrl(value, fallback = 'https://github.com/herb711/RedouAgent') {
  const text = String(value || '').trim();
  if (!text) return fallback;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) return text;
  return `https://${text}`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function createPopoutHtml(payload = {}) {
  const title = escapeHtml(payload.title || 'Redou pop-out');
  const body = escapeHtml(payload.body || payload.content || '');
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body { margin: 0; font: 14px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; color: #202124; background: #fbfbfa; }
      header { padding: 14px 18px; border-bottom: 1px solid #dfddd8; background: #fff; }
      h1 { margin: 0; font-size: 16px; }
      main { padding: 18px; }
      pre { margin: 0; white-space: pre-wrap; word-break: break-word; }
    </style>
  </head>
  <body>
    <header><h1>${title}</h1></header>
    <main><pre>${body}</pre></main>
  </body>
</html>`;
}

function desktopState(dependencies = {}) {
  if (!dependencies.__desktopIpcState) {
    dependencies.__desktopIpcState = { powerSaveBlockerId: null };
  }
  return dependencies.__desktopIpcState;
}

async function getSettings(dependencies = {}) {
  if (!dependencies.appSettingsStore || typeof dependencies.appSettingsStore.get !== 'function') {
    return null;
  }
  return dependencies.appSettingsStore.get();
}

async function updateSettings(payload, dependencies = {}) {
  if (!dependencies.appSettingsStore || typeof dependencies.appSettingsStore.update !== 'function') {
    throw new Error('App settings store is not available.');
  }
  const patch = payload.patch || payload;
  const next = await dependencies.appSettingsStore.update(patch);
  if (patch.desktop && Object.prototype.hasOwnProperty.call(patch.desktop, 'preventSleep')) {
    await setPreventSleep({ enabled: Boolean(patch.desktop.preventSleep), persist: false }, dependencies);
  }
  return next;
}

async function setPreventSleep(payload, dependencies = {}) {
  const powerSaveBlocker = dependencies.powerSaveBlocker;
  if (!powerSaveBlocker || typeof powerSaveBlocker.start !== 'function') {
    const error = new Error('Power save blocker is not available.');
    error.code = 'POWER_SAVE_BLOCKER_UNAVAILABLE';
    throw error;
  }
  const state = desktopState(dependencies);
  const enabled = Boolean(payload.enabled);
  if (enabled && state.powerSaveBlockerId === null) {
    state.powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
  } else if (!enabled && state.powerSaveBlockerId !== null) {
    if (typeof powerSaveBlocker.isStarted !== 'function' || powerSaveBlocker.isStarted(state.powerSaveBlockerId)) {
      powerSaveBlocker.stop(state.powerSaveBlockerId);
    }
    state.powerSaveBlockerId = null;
  }
  if (payload.persist !== false && dependencies.appSettingsStore) {
    await dependencies.appSettingsStore.update({ desktop: { preventSleep: enabled } });
  }
  return { enabled, blockerId: state.powerSaveBlockerId };
}

async function notifyDesktop(payload, dependencies = {}) {
  const settings = await getSettings(dependencies);
  if (settings && settings.desktop && settings.desktop.notifications === false) {
    return { delivered: false, reason: 'disabled' };
  }
  const Notification = dependencies.Notification;
  if (!Notification || (typeof Notification.isSupported === 'function' && !Notification.isSupported())) {
    const error = new Error('Desktop notifications are not supported.');
    error.code = 'NOTIFICATIONS_UNSUPPORTED';
    throw error;
  }
  const notification = new Notification({
    title: String(payload.title || 'Redou Agent'),
    body: String(payload.body || payload.message || ''),
    silent: Boolean(payload.silent),
  });
  notification.show();
  return { delivered: true };
}

async function openExternal(payload, dependencies = {}) {
  const hostShell = dependencies.shell;
  if (!hostShell || typeof hostShell.openExternal !== 'function') {
    throw new Error('Host shell is not available.');
  }
  const url = normalizeUrl(payload.url);
  await hostShell.openExternal(url);
  return { opened: true, url };
}

async function popout(payload, dependencies = {}) {
  const BrowserWindow = dependencies.BrowserWindow;
  if (!BrowserWindow) {
    const error = new Error('BrowserWindow is not available.');
    error.code = 'BROWSER_WINDOW_UNAVAILABLE';
    throw error;
  }
  const title = String(payload.title || 'Redou pop-out');
  const window = new BrowserWindow({
    width: Number(payload.width || 980),
    height: Number(payload.height || 720),
    minWidth: 640,
    minHeight: 420,
    title,
    backgroundColor: '#fbfbfa',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (payload.url) {
    await window.loadURL(normalizeUrl(payload.url));
  } else if (payload.filePath) {
    await window.loadFile(path.resolve(payload.filePath));
  } else {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(createPopoutHtml(payload))}`);
  }
  return { opened: true, title };
}

function registerDesktopIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  handle(ipcMain, 'redou:desktop:settings:get', async () => getSettings(dependencies));
  handle(ipcMain, 'redou:desktop:settings:update', async (payload) => updateSettings(payload, dependencies));
  handle(ipcMain, 'redou:desktop:notify', async (payload) => notifyDesktop(payload, dependencies));
  handle(ipcMain, 'redou:desktop:prevent-sleep', async (payload) => setPreventSleep(payload, dependencies));
  handle(ipcMain, 'redou:desktop:popout', async (payload) => popout(payload, dependencies));
  handle(ipcMain, 'redou:desktop:open-external', async (payload) => openExternal(payload, dependencies));
  return CHANNELS;
}

module.exports = {
  CHANNELS,
  normalizeUrl,
  registerDesktopIpc,
  setPreventSleep,
};
