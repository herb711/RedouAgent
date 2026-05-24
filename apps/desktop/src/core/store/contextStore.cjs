'use strict';

// Future persistence root: .redou/context
// This store manages only context entities. Do not connect old local-service code here.
function createContextStore(options = {}) {
  const storageRoot = options.storageRoot || '.redou/context';
  return {
    storageRoot,
    async list() {
      throw new Error('contextStore.list is not implemented in Phase 1');
    },
    async get(id) {
      void id;
      throw new Error('contextStore.get is not implemented in Phase 1');
    },
    async save(entity) {
      void entity;
      throw new Error('contextStore.save is not implemented in Phase 1');
    },
    async remove(id) {
      void id;
      throw new Error('contextStore.remove is not implemented in Phase 1');
    },
  };
}

module.exports = {
  createContextStore,
};
