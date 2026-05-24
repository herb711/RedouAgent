'use strict';

const path = require('node:path');
const { app, ipcMain, dialog, shell } = require('electron');
const { createMainWindow, registerAppLifecycle } = require('./platform/electron/index.cjs');
const { getRedouDataRoot } = require('./platform/filesystem/index.cjs');
const { createProjectStore } = require('./core/store/projectStore.cjs');
const { createTaskStore } = require('./core/store/taskStore.cjs');
const { createMessageStore } = require('./core/store/messageStore.cjs');
const { createEventStore } = require('./core/store/eventStore.cjs');
const { createRuntimeSessionStore } = require('./core/store/runtimeSessionStore.cjs');
const { createModelConfigStore } = require('./core/store/modelConfigStore.cjs');
const { createResponsesChatProxyManager } = require('./core/models/responsesChatProxy.cjs');
const { createRuntimeRegistry } = require('./runtimes/common/runtimeRegistry.cjs');
const { createRedouCodexRuntimeAdapter } = require('./runtimes/redou-codex/redouCodexRuntimeAdapter.cjs');
const { createRedouCodexSessionStore } = require('./runtimes/redou-codex/redouCodexSessionStore.cjs');
const {
  REDOU_CODEX_RUNTIME_ID,
  defaultRedouCodexHome,
  readRedouModelConfig,
} = require('./runtimes/redou-codex/redouCodexRuntimeConfig.cjs');
const { createEventSink } = require('./orchestrator/eventSink.cjs');
const { createContextAssembler } = require('./orchestrator/contextAssembler.cjs');
const { buildRuntimeSnapshot } = require('./orchestrator/runtimeSnapshotBuilder.cjs');
const { registerAllIpc } = require('./ipc/index.cjs');

function createDependencies() {
  const desktopRoot = path.resolve(__dirname, '..');
  const workspaceRoot = path.resolve(__dirname, '../../..');
  const dataRoot = getRedouDataRoot({ workspaceRoot });
  const defaultProject = {
    id: 'default-workspace',
    name: 'RedouAgent',
    rootPath: workspaceRoot,
    defaultRuntime: REDOU_CODEX_RUNTIME_ID,
  };

  const projectStore = createProjectStore({ dataRoot, defaultProject });
  const taskStore = createTaskStore({ dataRoot });
  const messageStore = createMessageStore({ dataRoot });
  const eventStore = createEventStore({ dataRoot });
  const runtimeSessionStore = createRuntimeSessionStore({ dataRoot });
  const redouCodexHome = defaultRedouCodexHome({ workspaceRoot });
  const responsesChatProxy = createResponsesChatProxyManager();
  const modelConfigStore = createModelConfigStore({ dataRoot, redouCodexHome, responsesChatProxy });
  const eventSink = createEventSink({ eventStore });
  const contextAssembler = createContextAssembler({ projectStore, taskStore, messageStore });
  const runtimeSnapshotBuilder = { build: buildRuntimeSnapshot };
  const redouCodexLogPath = path.join(dataRoot, 'logs', 'redou-codex-app-server.jsonl');
  const redouModelConfig = readRedouModelConfig(process.env);
  const redouCodexOptions = {
    workspaceRoot,
    redouCodexHome,
    allowCargoFallback: !app.isPackaged && process.env.NODE_ENV !== 'production',
    modelConfig: redouModelConfig,
    logPath: redouCodexLogPath,
  };
  const settings = {
    defaultRuntime: REDOU_CODEX_RUNTIME_ID,
    redouCodex: redouCodexOptions,
  };

  const redouCodexSessionStore = createRedouCodexSessionStore({ taskStore, runtimeSessionStore });
  const redouCodexAdapter = createRedouCodexRuntimeAdapter({
    clientOptions: settings.redouCodex,
    modelConfig: redouModelConfig,
    sessionStore: redouCodexSessionStore,
    taskStore,
    runtimeSessionStore,
    modelConfigStore,
    responsesChatProxy,
    eventSink,
  });
  const runtimeRegistry = createRuntimeRegistry({
    settings,
    dependencies: { redouCodexAdapter },
  });

  return {
    desktopRoot,
    workspaceRoot,
    dataRoot,
    dialog,
    shell,
    settings,
    projectStore,
    taskStore,
    messageStore,
    eventStore,
    runtimeSessionStore,
    modelConfigStore,
    eventSink,
    contextAssembler,
    runtimeSnapshotBuilder,
    runtimeRegistry,
    responsesChatProxy,
    redouCodexAdapter,
  };
}

const dependencies = createDependencies();
registerAllIpc({ ...dependencies, ipcMain });

registerAppLifecycle(app, {
  disposables: [dependencies.redouCodexAdapter, dependencies.responsesChatProxy],
  createWindow: () => createMainWindow({
    renderer: {
      rendererRoot: path.join(dependencies.desktopRoot, 'renderer'),
      devServerUrl: process.env.REDOU_RENDERER_URL,
      devServerFallback: process.env.NODE_ENV !== 'production',
    },
    openDevTools: process.env.NODE_ENV === 'development',
  }),
});
