'use strict';

// Basic logEntry field definition. Keep this file limited to defaults and normalization.
const LOGENTRY_FIELDS = Object.freeze(['id', 'taskId', 'projectId', 'runtime', 'level', 'source', 'message', 'timestamp', 'metadata']);

function nowIso() {
  return new Date().toISOString();
}

function createDefaultLogEntry(overrides = {}) {
  const base = {
    id: null,
    taskId: null,
    projectId: null,
    runtime: 'redou',
    level: 'info',
    source: 'workbench',
    message: '',
    timestamp: nowIso(),
    metadata: {},
  };
  return normalizeLogEntry({ ...base, ...overrides });
}

function normalizeLogEntry(input = {}) {
  const normalized = {};
  for (const field of LOGENTRY_FIELDS) {
    normalized[field] = input[field];
  }
  return normalized;
}

module.exports = {
  LOGENTRY_FIELDS,
  createDefaultLogEntry,
  normalizeLogEntry,
};
