'use strict';

function createInvokeApi(ipcRenderer) {
  const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
  return {
    runtimes: {
      list: () => invoke('redou:runtimes:list'),
      get: (id) => invoke('redou:runtimes:get', { id }),
      availability: (id) => invoke('redou:runtimes:availability', id ? { id } : {}),
      setDefault: (id) => invoke('redou:runtimes:set-default', { id }),
    },
    tasks: {
      list: (projectId) => invoke('redou:tasks:list', projectId ? { projectId } : {}),
      get: (taskId) => invoke('redou:tasks:get', { id: taskId, taskId }),
      create: (input) => invoke('redou:tasks:create', input || {}),
      update: (input) => invoke('redou:tasks:update', input || {}),
      archive: (taskId) => invoke('redou:tasks:archive', { id: taskId, taskId }),
      remove: (taskId) => invoke('redou:tasks:remove', { id: taskId, taskId }),
      start: (taskId, options = {}) => invoke('redou:tasks:start', { ...options, taskId }),
      queue: (taskId, input, options = {}) => invoke('redou:tasks:queue', { ...options, taskId, userInput: input }),
      updateQueue: (taskId, queueId, action) => invoke('redou:tasks:queue:update', { taskId, queueId, action }),
      steer: (taskId, input, options = {}) => invoke('redou:tasks:steer', { ...options, taskId, userInput: input }),
      interrupt: (taskId) => invoke('redou:tasks:interrupt', { taskId }),
    },
    events: {
      list: (taskId) => invoke('redou:events:list', taskId ? { taskId } : {}),
      snapshot: (taskId) => invoke('redou:events:snapshot', taskId ? { taskId } : {}),
      subscribe: (taskId, callback) => {
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('redou:events:push', listener);
        invoke('redou:events:subscribe', taskId ? { taskId } : {}).catch((error) => {
          callback({
            ok: false,
            data: null,
            error: { code: 'EVENT_SUBSCRIBE_FAILED', message: error && error.message ? error.message : String(error) },
            warnings: [],
          });
        });
        return () => ipcRenderer.removeListener('redou:events:push', listener);
      },
    },
    approvals: {
      list: (taskId) => invoke('redou:approvals:list', taskId ? { taskId } : {}),
      respond: (approvalId, decision) => invoke('redou:approvals:respond', { requestId: approvalId, decision }),
    },
    projects: {
      list: () => invoke('redou:projects:list'),
      get: (projectId) => invoke('redou:projects:get', { id: projectId, projectId }),
      create: (input) => invoke('redou:projects:create', input || {}),
      createBlank: (input) => invoke('redou:projects:create-blank', input || {}),
      selectFolder: () => invoke('redou:projects:select-folder'),
      update: (input) => invoke('redou:projects:update', input || {}),
      remove: (projectId) => invoke('redou:projects:remove', { id: projectId, projectId }),
      openFolder: (projectId) => invoke('redou:projects:open-folder', { id: projectId, projectId }),
    },
    rules: {
      get: (projectId, taskId) => invoke('redou:rules:get', { projectId, taskId }),
      update: (input) => invoke('redou:rules:update', input || {}),
    },
    context: {
      preview: (input) => invoke('redou:context:preview', input || {}),
    },
    modelConfigs: {
      list: () => invoke('redou:model-config:list'),
      probe: (input) => invoke('redou:model-config:probe', input || {}),
      saveProvider: (input) => invoke('redou:model-config:save-provider', input || {}),
      selectModel: (input) => invoke('redou:model-config:select-model', input || {}),
      removeProvider: (providerId) => invoke('redou:model-config:remove-provider', { providerId }),
    },
  };
}

function registerPreloadBridge(contextBridge, api = {}) {
  const ipcRenderer = api.ipcRenderer;
  if (!contextBridge || !ipcRenderer) return null;
  const redouApi = api.redouApi || createInvokeApi(ipcRenderer);
  contextBridge.exposeInMainWorld('redouApi', redouApi);
  return redouApi;
}

try {
  if (typeof process !== 'undefined' && process.type === 'renderer') {
    const { contextBridge, ipcRenderer } = require('electron');
    registerPreloadBridge(contextBridge, { ipcRenderer });
  }
} catch {
  // Loading this module from tests/main should not require Electron preload globals.
}

module.exports = { registerPreloadBridge, createInvokeApi };
