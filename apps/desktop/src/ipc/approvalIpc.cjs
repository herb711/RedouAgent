'use strict';

const { buildRuntimeSnapshot } = require('../orchestrator/runtimeSnapshotBuilder.cjs');
const { routeApprovalDecision } = require('../orchestrator/approvalRouter.cjs');

const CHANNELS = Object.freeze([
  'redou:approvals:list',
  'redou:approvals:respond',
]);

function ok(data, warnings = []) {
  return { ok: true, data, error: null, warnings };
}

function fail(error) {
  return {
    ok: false,
    data: null,
    error: {
      code: error && error.code ? error.code : 'IPC_ERROR',
      message: error && error.message ? error.message : String(error),
      details: error && error.details ? error.details : null,
    },
    warnings: [],
  };
}

function registerApprovalIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  const eventStore = dependencies.eventStore;

  ipcMain.handle('redou:approvals:list', async (_event, payload = {}) => {
    try {
      const events = await eventStore.list(payload);
      const builder = dependencies.runtimeSnapshotBuilder;
      const snapshot = builder && typeof builder.build === 'function'
        ? builder.build(events)
        : buildRuntimeSnapshot(events);
      return ok(snapshot.approvalRequests);
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('redou:approvals:respond', async (_event, payload = {}) => {
    try {
      const result = await routeApprovalDecision(payload, dependencies);
      return ok(result, result.warnings || []);
    } catch (error) {
      return fail(error);
    }
  });

  return CHANNELS;
}

module.exports = { CHANNELS, registerApprovalIpc };
