'use strict';

// Future persistence root: .redou/artifacts
// This store manages only artifact entities. Do not connect old local-service code here.
function createArtifactStore(options = {}) {
  const storageRoot = options.storageRoot || '.redou/artifacts';
  return {
    storageRoot,
    async list() {
      throw new Error('artifactStore.list is not implemented in Phase 1');
    },
    async get(id) {
      void id;
      throw new Error('artifactStore.get is not implemented in Phase 1');
    },
    async save(entity) {
      void entity;
      throw new Error('artifactStore.save is not implemented in Phase 1');
    },
    async remove(id) {
      void id;
      throw new Error('artifactStore.remove is not implemented in Phase 1');
    },
  };
}

module.exports = {
  createArtifactStore,
};
