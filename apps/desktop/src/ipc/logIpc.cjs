'use strict';

const CHANNELS = Object.freeze([
  'redou:logs:list'
]);

function registerLogIpc(ipcMain, dependencies = {}) {
  void dependencies;
  // TODO Phase 2: register handlers for CHANNELS and delegate to focused services/orchestrators.
  if (!ipcMain) return CHANNELS;
  return CHANNELS;
}

module.exports = { CHANNELS, registerLogIpc };
