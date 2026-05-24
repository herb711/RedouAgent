'use strict';

async function buildEnvironmentContext(input = {}) {
  // TODO: collect platform, project, shell, and workspace environment facts.
  return input.environment || {};
}

module.exports = { buildEnvironmentContext };
