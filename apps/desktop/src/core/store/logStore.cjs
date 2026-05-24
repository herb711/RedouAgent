'use strict';

// Future persistence root: .redou/logs
// This store manages only log entities. Do not connect old local-service code here.
function createLogStore(options = {}) {
  const storageRoot = options.storageRoot || '.redou/logs';
  return {
    storageRoot,
    async list() {
      throw new Error('logStore.list is not implemented in Phase 1');
    },
    async get(id) {
      void id;
      throw new Error('logStore.get is not implemented in Phase 1');
    },
    async save(entity) {
      void entity;
      throw new Error('logStore.save is not implemented in Phase 1');
    },
    async remove(id) {
      void id;
      throw new Error('logStore.remove is not implemented in Phase 1');
    },
  };
}

module.exports = {
  createLogStore,
};
