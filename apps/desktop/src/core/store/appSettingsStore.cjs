'use strict';

const path = require('node:path');
const { readJsonFile, writeJsonFile } = require('../../platform/filesystem/jsonFile.cjs');
const { safeJoin } = require('../../platform/filesystem/paths.cjs');

const DEFAULT_APP_SETTINGS = Object.freeze({
  general: {
    language: 'zh-CN',
    startupView: 'thread',
    autoUpdate: true,
  },
  appearance: {
    theme: 'light',
    density: 'comfortable',
    inspectorSide: 'right',
  },
  desktop: {
    notifications: true,
    preventSleep: false,
    screenshotComments: true,
    popoutBehavior: 'window',
  },
  browser: {
    enabled: true,
    homeUrl: 'https://github.com/herb711/RedouAgent',
    allowPopouts: true,
  },
  media: {
    voiceInput: true,
    imageInput: true,
    imageGeneration: true,
  },
  connections: {
    artifactPreview: true,
    inAppBrowser: true,
    screenshotCapture: true,
  },
});

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function deepMerge(base, patch) {
  if (!isPlainObject(patch)) return base;
  const output = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    output[key] = isPlainObject(value) && isPlainObject(output[key])
      ? deepMerge(output[key], value)
      : value;
  }
  return output;
}

function createAppSettingsStore(options = {}) {
  const dataRoot = path.resolve(options.dataRoot || '.redou');
  const filePath = options.filePath || safeJoin(dataRoot, 'settings', 'app.json');
  const defaults = options.defaults || DEFAULT_APP_SETTINGS;

  async function readSnapshot() {
    return deepMerge(defaults, await readJsonFile(filePath, {}));
  }

  return {
    filePath,
    defaults,
    async get() {
      return readSnapshot();
    },
    async update(patch = {}) {
      const snapshot = deepMerge(await readSnapshot(), patch);
      await writeJsonFile(filePath, snapshot);
      return snapshot;
    },
    async reset() {
      await writeJsonFile(filePath, defaults);
      return defaults;
    },
  };
}

module.exports = {
  DEFAULT_APP_SETTINGS,
  createAppSettingsStore,
  deepMerge,
};
