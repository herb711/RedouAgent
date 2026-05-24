'use strict';

const { REDOU_CODEX_RUNTIME_ID } = require('../../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');

// Basic diffSnapshot field definition. Keep this file limited to defaults and normalization.
const DIFFSNAPSHOT_FIELDS = Object.freeze(['taskId', 'projectId', 'runtime', 'files', 'summary', 'rawDiff', 'updatedAt']);

function nowIso() {
  return new Date().toISOString();
}

function createDefaultDiffSnapshot(overrides = {}) {
  const base = {
    taskId: null,
    projectId: null,
    runtime: REDOU_CODEX_RUNTIME_ID,
    files: [],
    summary: '',
    rawDiff: '',
    updatedAt: nowIso(),
  };
  return normalizeDiffSnapshot({ ...base, ...overrides });
}

function normalizeDiffSnapshot(input = {}) {
  const normalized = {};
  for (const field of DIFFSNAPSHOT_FIELDS) {
    normalized[field] = input[field];
  }
  return normalized;
}

module.exports = {
  DIFFSNAPSHOT_FIELDS,
  createDefaultDiffSnapshot,
  normalizeDiffSnapshot,
};
