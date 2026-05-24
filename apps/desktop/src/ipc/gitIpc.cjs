'use strict';

const CHANNELS = Object.freeze([
  'redou:git:status',
  'redou:git:diff'
]);

function registerGitIpc(ipcMain, dependencies = {}) {
  void dependencies;
  // TODO Phase 2: register handlers for CHANNELS and delegate to focused services/orchestrators.
  if (!ipcMain) return CHANNELS;
  return CHANNELS;
}

module.exports = { CHANNELS, registerGitIpc };
