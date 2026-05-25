'use strict';

function createInvokeApi(ipcRenderer, options = {}) {
  const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
  const webUtils = options.webUtils;
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
    git: {
      status: (input) => invoke('redou:git:status', input || {}),
      diff: (input) => invoke('redou:git:diff', input || {}),
      stage: (input) => invoke('redou:git:stage', input || {}),
      unstage: (input) => invoke('redou:git:unstage', input || {}),
      revert: (input) => invoke('redou:git:revert', input || {}),
      stageHunk: (input) => invoke('redou:git:stage-hunk', input || {}),
      revertHunk: (input) => invoke('redou:git:revert-hunk', input || {}),
      commit: (input) => invoke('redou:git:commit', input || {}),
      push: (input) => invoke('redou:git:push', input || {}),
      createPullRequest: (input) => invoke('redou:git:create-pr', input || {}),
    },
    terminal: {
      run: (input) => invoke('redou:terminal:run', input || {}),
    },
    worktrees: {
      list: (input) => invoke('redou:worktrees:list', input || {}),
      create: (input) => invoke('redou:worktrees:create', input || {}),
      remove: (input) => invoke('redou:worktrees:remove', input || {}),
      open: (input) => invoke('redou:worktrees:open', input || {}),
    },
    automations: {
      list: (input) => invoke('redou:automations:list', input || {}),
      create: (input) => invoke('redou:automations:create', input || {}),
      update: (input) => invoke('redou:automations:update', input || {}),
      delete: (input) => invoke('redou:automations:delete', input || {}),
      run: (input) => invoke('redou:automations:run', input || {}),
    },
    skills: {
      list: (input) => invoke('redou:skills:list', input || {}),
      rescan: (input) => invoke('redou:skills:rescan', input || {}),
      toggle: (input) => invoke('redou:skills:toggle', input || {}),
    },
    mcp: {
      list: (input) => invoke('redou:mcp:list', input || {}),
      install: (input) => invoke('redou:mcp:install', input || {}),
      remove: (input) => invoke('redou:mcp:remove', input || {}),
      test: (input) => invoke('redou:mcp:test', input || {}),
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
      select: (input) => invoke('redou:context:select', input || {}),
      pathForFile: (file) => {
        if (webUtils && typeof webUtils.getPathForFile === 'function') return webUtils.getPathForFile(file);
        return file && (file.path || file.name) || '';
      },
    },
    artifacts: {
      list: (input) => invoke('redou:artifacts:list', input || {}),
      get: (input) => invoke('redou:artifacts:get', input || {}),
      createText: (input) => invoke('redou:artifacts:create-text', input || {}),
      generateImage: (input) => invoke('redou:artifacts:generate-image', input || {}),
      captureScreenshot: (input) => invoke('redou:artifacts:capture-screenshot', input || {}),
      open: (input) => invoke('redou:artifacts:open', input || {}),
      reveal: (input) => invoke('redou:artifacts:reveal', input || {}),
    },
    desktop: {
      getSettings: () => invoke('redou:desktop:settings:get'),
      updateSettings: (input) => invoke('redou:desktop:settings:update', input || {}),
      notify: (input) => invoke('redou:desktop:notify', input || {}),
      setPreventSleep: (enabled) => invoke('redou:desktop:prevent-sleep', { enabled }),
      popout: (input) => invoke('redou:desktop:popout', input || {}),
      openExternal: (url) => invoke('redou:desktop:open-external', { url }),
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
  const redouApi = api.redouApi || createInvokeApi(ipcRenderer, { webUtils: api.webUtils });
  contextBridge.exposeInMainWorld('redouApi', redouApi);
  return redouApi;
}

try {
  if (typeof process !== 'undefined' && process.type === 'renderer') {
    const { contextBridge, ipcRenderer, webUtils } = require('electron');
    registerPreloadBridge(contextBridge, { ipcRenderer, webUtils });
  }
} catch {
  // Loading this module from tests/main should not require Electron preload globals.
}

module.exports = { registerPreloadBridge, createInvokeApi };
