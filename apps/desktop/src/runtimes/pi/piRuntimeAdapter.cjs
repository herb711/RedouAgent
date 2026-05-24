'use strict';

const { createRuntimeCapabilities } = require('../common/runtimeCapabilities.cjs');

function createPiRuntimeAdapter() {
  return {
    getId() { return 'pi'; },
    getCapabilities() { return createRuntimeCapabilities({}); },
    async startTask(input) { void input; throw new Error('Pi runtime is scaffold-only in Phase 1'); },
    async resumeTask(input) { void input; throw new Error('Pi runtime is scaffold-only in Phase 1'); },
    async steerTask(input) { void input; throw new Error('Pi runtime is scaffold-only in Phase 1'); },
    async interruptTask(input) { void input; throw new Error('Pi runtime is scaffold-only in Phase 1'); },
    async dispose() {},
  };
}

module.exports = { createPiRuntimeAdapter };
