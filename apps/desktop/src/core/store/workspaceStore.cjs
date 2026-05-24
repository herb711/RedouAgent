'use strict';

// Future persistence root: .redou/workspaces
// This store manages only workspace entities. Do not connect old local-service code here.
function createWorkspaceStore(options = {}) {
  const storageRoot = options.storageRoot || '.redou/workspaces';
  return {
    storageRoot,
    async list() {
      throw new Error('workspaceStore.list is not implemented in Phase 1');
    },
    async get(id) {
      void id;
      throw new Error('workspaceStore.get is not implemented in Phase 1');
    },
    async save(entity) {
      void entity;
      throw new Error('workspaceStore.save is not implemented in Phase 1');
    },
    async remove(id) {
      void id;
      throw new Error('workspaceStore.remove is not implemented in Phase 1');
    },
  };
}

module.exports = {
  createWorkspaceStore,
};
