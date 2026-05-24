'use strict';

const { REDOU_CODEX_RUNTIME_ID } = require('../../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');

// Basic project field definition. Keep this file limited to defaults and normalization.
const PROJECT_FIELDS = Object.freeze(['id', 'name', 'rootPath', 'createdAt', 'updatedAt', 'defaultRuntime', 'projectRulesPath', 'taskRulesPolicy', 'contextPolicy', 'metadata']);

function nowIso() {
  return new Date().toISOString();
}

function createDefaultProject(overrides = {}) {
  const base = {
    id: null,
    name: '',
    rootPath: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    defaultRuntime: REDOU_CODEX_RUNTIME_ID,
    projectRulesPath: null,
    taskRulesPolicy: 'inherit',
    contextPolicy: {},
    metadata: {},
  };
  return normalizeProject({ ...base, ...overrides });
}

function normalizeProject(input = {}) {
  const normalized = {};
  for (const field of PROJECT_FIELDS) {
    normalized[field] = input[field];
  }
  return normalized;
}

module.exports = {
  PROJECT_FIELDS,
  createDefaultProject,
  normalizeProject,
};
