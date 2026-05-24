'use strict';

function createRuntimeCapabilities(overrides = {}) {
  return {
    supportsThread: false,
    supportsTurn: false,
    supportsPlan: false,
    supportsDiff: false,
    supportsApproval: false,
    supportsCommandExecution: false,
    supportsFileChange: false,
    supportsSteering: false,
    supportsInterrupt: false,
    supportsResume: false,
    ...overrides,
  };
}

module.exports = { createRuntimeCapabilities };
