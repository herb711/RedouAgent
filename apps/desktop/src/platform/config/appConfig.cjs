'use strict';

function createDefaultAppConfig(overrides = {}) {
  return { appName: 'Redou Workbench', defaultRuntime: 'redou-codex', ...overrides };
}

module.exports = { createDefaultAppConfig };
