'use strict';

function applyContextBudget(contextPackage, budget = {}) {
  // TODO: enforce token/byte budgets per rules, messages, files, and attachments.
  return {
    ...contextPackage,
    metadata: {
      ...(contextPackage.metadata || {}),
      budget,
    },
  };
}

module.exports = { applyContextBudget };
