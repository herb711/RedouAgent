'use strict';

function registerAppLifecycle(app, dependencies = {}) {
  const createWindow = dependencies.createWindow;
  let mainWindow = null;

  app.whenReady().then(() => {
    mainWindow = createWindow ? createWindow() : null;
    app.on('activate', () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        mainWindow = createWindow ? createWindow() : null;
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', async () => {
    const disposables = dependencies.disposables || [];
    for (const disposable of disposables) {
      if (disposable && typeof disposable.dispose === 'function') {
        await disposable.dispose().catch(() => {});
      }
    }
  });

  return {
    getMainWindow() {
      return mainWindow;
    },
  };
}

module.exports = { registerAppLifecycle };
