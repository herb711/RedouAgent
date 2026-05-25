'use strict';

function redouCodexPermissionStateFromSnapshot(snapshot = {}) {
  const approvals = Array.isArray(snapshot.pendingApprovals) ? snapshot.pendingApprovals : [];
  if (approvals.length) {
    return {
      status: 'waiting_approval',
      needsAttention: true,
      pendingApprovalCount: approvals.length,
    };
  }
  return {
    status: 'clear',
    needsAttention: false,
    pendingApprovalCount: 0,
  };
}

module.exports = {
  redouCodexPermissionStateFromSnapshot,
};
