'use strict';

function createLogger(options = {}) {
  void options;
  return {
    info(message, metadata) { void message; void metadata; },
    warn(message, metadata) { void message; void metadata; },
    error(message, metadata) { void message; void metadata; },
  };
}

module.exports = { createLogger };
