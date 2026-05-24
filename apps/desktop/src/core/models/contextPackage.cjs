'use strict';

// Basic contextPackage field definition. Keep this file limited to defaults and normalization.
const CONTEXTPACKAGE_FIELDS = Object.freeze(['projectId', 'taskId', 'workspaceRoot', 'userInput', 'projectRules', 'taskRules', 'recentMessages', 'selectedFiles', 'attachments', 'environment', 'metadata']);

function nowIso() {
  return new Date().toISOString();
}

function createDefaultContextPackage(overrides = {}) {
  const base = {
    projectId: null,
    taskId: null,
    workspaceRoot: null,
    userInput: '',
    projectRules: [],
    taskRules: [],
    recentMessages: [],
    selectedFiles: [],
    attachments: [],
    environment: {},
    metadata: {},
  };
  return normalizeContextPackage({ ...base, ...overrides });
}

function normalizeContextPackage(input = {}) {
  const normalized = {};
  for (const field of CONTEXTPACKAGE_FIELDS) {
    normalized[field] = input[field];
  }
  return normalized;
}

module.exports = {
  CONTEXTPACKAGE_FIELDS,
  createDefaultContextPackage,
  normalizeContextPackage,
};
