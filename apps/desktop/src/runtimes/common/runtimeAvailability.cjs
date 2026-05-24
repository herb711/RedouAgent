'use strict';

function createAvailabilityDescriptor(overrides = {}) {
  return { available: false, status: 'unknown', lastError: null, ...overrides };
}

module.exports = { createAvailabilityDescriptor };
