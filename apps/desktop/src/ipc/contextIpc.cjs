'use strict';

const path = require('node:path');
const { assembleContextPackage } = require('../orchestrator/contextAssembler.cjs');

const CHANNELS = Object.freeze([
  'redou:context:preview',
  'redou:context:select',
]);

function ok(data, warnings = []) {
  return { ok: true, data, error: null, warnings };
}

function fail(error) {
  return { ok: false, data: null, error: { code: error.code || 'IPC_ERROR', message: error.message || String(error), details: error.details || null }, warnings: [] };
}

function fileName(filePath) {
  return path.basename(String(filePath || ''));
}

function isImagePath(filePath) {
  return /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(String(filePath || ''));
}

function selectionOptions(input = {}) {
  const kind = input.kind === 'directory' || input.kind === 'image' ? input.kind : 'file';
  if (kind === 'directory') {
    return {
      kind,
      properties: ['openDirectory', 'multiSelections'],
      filters: [],
    };
  }
  return {
    kind,
    properties: ['openFile', 'multiSelections'],
    filters: kind === 'image'
      ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'] }]
      : [{ name: 'All files', extensions: ['*'] }],
  };
}

function normalizeSelection(filePaths = [], kind = 'file') {
  return filePaths.map((filePath) => {
    const normalizedKind = kind === 'directory'
      ? 'directory'
      : isImagePath(filePath)
        ? 'image'
        : 'file';
    return {
      path: filePath,
      name: fileName(filePath),
      kind: normalizedKind,
    };
  });
}

async function selectContextItems(input = {}, dependencies = {}) {
  const picker = dependencies.dialog;
  if (!picker || typeof picker.showOpenDialog !== 'function') {
    const error = new Error('Electron dialog API is not available.');
    error.code = 'DIALOG_UNAVAILABLE';
    throw error;
  }
  const options = selectionOptions(input);
  const result = await picker.showOpenDialog({
    title: input.title || 'Add context',
    properties: options.properties,
    filters: options.filters,
  });
  if (result.canceled) {
    return {
      canceled: true,
      items: [],
    };
  }
  return {
    canceled: false,
    items: normalizeSelection(result.filePaths || [], options.kind),
  };
}

function registerContextIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  ipcMain.handle('redou:context:preview', async (_event, payload = {}) => {
    try {
      return ok(await assembleContextPackage(payload, dependencies));
    } catch (error) {
      return fail(error);
    }
  });
  ipcMain.handle('redou:context:select', async (_event, payload = {}) => {
    try {
      return ok(await selectContextItems(payload, dependencies));
    } catch (error) {
      return fail(error);
    }
  });
  return CHANNELS;
}

module.exports = {
  CHANNELS,
  normalizeSelection,
  registerContextIpc,
  selectContextItems,
  selectionOptions,
};
