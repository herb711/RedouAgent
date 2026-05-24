'use strict';

function createProcessRegistry() {
  const processes = new Map();
  return { register(id, child) { processes.set(id, child); return child; }, get(id) { return processes.get(id) || null; }, dispose(id) { processes.delete(id); } };
}

module.exports = { createProcessRegistry };
