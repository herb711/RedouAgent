'use strict';

const CHANNELS = Object.freeze([
  'redou:runtimes:list',
  'redou:runtimes:get',
  'redou:runtimes:availability',
  'redou:runtimes:set-default',
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

function handle(ipcMain, channel, handler) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return ok(await handler(payload || {}));
    } catch (error) {
      return fail(error);
    }
  });
}

function registerRuntimeIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  const registry = dependencies.runtimeRegistry;

  handle(ipcMain, 'redou:runtimes:list', async () => registry.listRuntimeDescriptors());
  handle(ipcMain, 'redou:runtimes:get', async (payload) => {
    const runtime = registry.getRuntime(payload.id);
    if (!runtime) return null;
    const availability = await registry.getRuntimeAvailability(payload.id);
    return {
      id: payload.id,
      capabilities: typeof runtime.getCapabilities === 'function' ? runtime.getCapabilities() : {},
      availability,
    };
  });
  handle(ipcMain, 'redou:runtimes:availability', async (payload) => {
    if (payload.id) return registry.getRuntimeAvailability(payload.id);
    const result = {};
    for (const runtime of registry.listRuntimes()) {
      const id = typeof runtime.getId === 'function' ? runtime.getId() : runtime.id;
      result[id] = await registry.getRuntimeAvailability(id);
    }
    return result;
  });
  handle(ipcMain, 'redou:runtimes:set-default', async (payload) => registry.setDefaultRuntime(payload.id));

  return CHANNELS;
}

module.exports = { CHANNELS, registerRuntimeIpc };
