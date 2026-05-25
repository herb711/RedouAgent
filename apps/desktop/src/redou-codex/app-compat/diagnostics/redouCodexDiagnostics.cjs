'use strict';

const { buildRedouCodexStateSnapshot } = require('../state/redouCodexStateSnapshot.cjs');

function explainRedouCodexStopReason(events = []) {
  const state = buildRedouCodexStateSnapshot(events);
  return {
    status: state.status,
    needsAttention: state.needsAttention,
    degraded: state.degraded,
    stopReason: state.stopReason,
    continuation: state.continuation,
    pendingApprovalCount: state.pendingApprovals.length,
    incompleteTurn: state.incompleteTurn,
  };
}

module.exports = {
  explainRedouCodexStopReason,
};
