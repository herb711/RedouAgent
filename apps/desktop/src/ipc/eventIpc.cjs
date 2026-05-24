'use strict';

const { buildRuntimeSnapshot } = require('../orchestrator/runtimeSnapshotBuilder.cjs');

const CHANNELS = Object.freeze([
  'redou:events:list',
  'redou:events:subscribe',
  'redou:events:snapshot',
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

function registerEventIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  const eventStore = dependencies.eventStore;
  const eventSink = dependencies.eventSink;

  ipcMain.handle('redou:events:list', async (_event, payload = {}) => {
    try {
      return ok(await eventStore.list(payload));
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('redou:events:snapshot', async (_event, payload = {}) => {
    try {
      const events = await eventStore.list(payload);
      const builder = dependencies.runtimeSnapshotBuilder;
      const snapshot = builder && typeof builder.build === 'function'
        ? builder.build(events)
        : buildRuntimeSnapshot(events);
      return ok(snapshot);
    } catch (error) {
      return fail(error);
    }
  });

  ipcMain.handle('redou:events:subscribe', async (event, payload = {}) => {
    try {
      if (!eventSink || typeof eventSink.subscribe !== 'function') {
        return ok({ subscribed: false, reason: 'eventSink subscription is not available' });
      }
      const unsubscribe = eventSink.subscribe((runtimeEvent) => {
        if (payload.taskId && runtimeEvent.taskId !== payload.taskId) return;
        event.sender.send('redou:events:push', { ok: true, data: runtimeEvent, error: null, warnings: [] });
      });
      event.sender.once('destroyed', unsubscribe);
      return ok({ subscribed: true, pushChannel: 'redou:events:push' });
    } catch (error) {
      return fail(error);
    }
  });

  return CHANNELS;
}

module.exports = { CHANNELS, registerEventIpc };
