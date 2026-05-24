'use strict';

// Future persistence root: .redou/rules
// This store manages only rule entities. Do not connect old local-service code here.
function createRuleStore(options = {}) {
  const storageRoot = options.storageRoot || '.redou/rules';
  return {
    storageRoot,
    async list() {
      throw new Error('ruleStore.list is not implemented in Phase 1');
    },
    async get(id) {
      void id;
      throw new Error('ruleStore.get is not implemented in Phase 1');
    },
    async save(entity) {
      void entity;
      throw new Error('ruleStore.save is not implemented in Phase 1');
    },
    async remove(id) {
      void id;
      throw new Error('ruleStore.remove is not implemented in Phase 1');
    },
  };
}

module.exports = {
  createRuleStore,
};
