'use strict';

const { createRuntimeCapabilities } = require('../common/runtimeCapabilities.cjs');

function createCustomRuntimeAdapter() {
  return {
    getId() { return 'custom'; },
    getCapabilities() { return createRuntimeCapabilities({}); },
    async startTask(input) { void input; throw new Error('Custom runtime is scaffold-only in Phase 1'); },
    async resumeTask(input) { void input; throw new Error('Custom runtime is scaffold-only in Phase 1'); },
    async steerTask(input) { void input; throw new Error('Custom runtime is scaffold-only in Phase 1'); },
    async interruptTask(input) { void input; throw new Error('Custom runtime is scaffold-only in Phase 1'); },
    async dispose() {},
  };
}

module.exports = { createCustomRuntimeAdapter };
