'use strict';

// Basic rulePack field definition. Keep this file limited to defaults and normalization.
const RULEPACK_FIELDS = Object.freeze(['projectRules', 'taskRules', 'systemRules', 'developerRules', 'userRules', 'sourceFiles', 'updatedAt']);

function nowIso() {
  return new Date().toISOString();
}

function createDefaultRulePack(overrides = {}) {
  const base = {
    projectRules: [],
    taskRules: [],
    systemRules: [],
    developerRules: [],
    userRules: [],
    sourceFiles: [],
    updatedAt: nowIso(),
  };
  return normalizeRulePack({ ...base, ...overrides });
}

function normalizeRulePack(input = {}) {
  const normalized = {};
  for (const field of RULEPACK_FIELDS) {
    normalized[field] = input[field];
  }
  return normalized;
}

module.exports = {
  RULEPACK_FIELDS,
  createDefaultRulePack,
  normalizeRulePack,
};
