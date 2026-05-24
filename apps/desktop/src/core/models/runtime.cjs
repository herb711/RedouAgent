'use strict';

// Basic runtime field definition. Keep this file limited to defaults and normalization.
const RUNTIME_FIELDS = Object.freeze(['id', 'name', 'kind', 'enabled', 'available', 'isDefault', 'capabilities', 'config', 'status', 'lastError']);

function nowIso() {
  return new Date().toISOString();
}

function createDefaultRuntime(overrides = {}) {
  const base = {
    id: null,
    name: '',
    kind: 'custom',
    enabled: true,
    available: false,
    isDefault: false,
    capabilities: {},
    config: {},
    status: 'unknown',
    lastError: null,
  };
  return normalizeRuntime({ ...base, ...overrides });
}

function normalizeRuntime(input = {}) {
  const normalized = {};
  for (const field of RUNTIME_FIELDS) {
    normalized[field] = input[field];
  }
  return normalized;
}

module.exports = {
  RUNTIME_FIELDS,
  createDefaultRuntime,
  normalizeRuntime,
};
