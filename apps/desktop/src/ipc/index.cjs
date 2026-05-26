'use strict';

const { registerProjectIpc } = require('./projectIpc.cjs');
const { registerTaskIpc } = require('./taskIpc.cjs');
const { registerRuntimeIpc } = require('./runtimeIpc.cjs');
const { registerApprovalIpc } = require('./approvalIpc.cjs');
const { registerEventIpc } = require('./eventIpc.cjs');
const { registerGitIpc } = require('./gitIpc.cjs');
const { registerLogIpc } = require('./logIpc.cjs');
const { registerArtifactIpc } = require('./artifactIpc.cjs');
const { registerContextIpc } = require('./contextIpc.cjs');
const { registerRuleIpc } = require('./ruleIpc.cjs');
const { registerModelConfigIpc } = require('./modelConfigIpc.cjs');
const { registerTerminalIpc } = require('./terminalIpc.cjs');
const { registerWorktreeIpc } = require('./worktreeIpc.cjs');
const { registerAutomationIpc } = require('./automationIpc.cjs');
const { registerSkillsIpc } = require('./skillsIpc.cjs');
const { registerMcpIpc } = require('./mcpIpc.cjs');
const { registerExtensionsIpc } = require('./extensionsIpc.cjs');
const { registerPluginsIpc } = require('./pluginsIpc.cjs');
const { registerDesktopIpc } = require('./desktopIpc.cjs');

function registerAllIpc(ipcOrDependencies, maybeDependencies = {}) {
  const ipcMain = ipcOrDependencies && typeof ipcOrDependencies.handle === 'function'
    ? ipcOrDependencies
    : ipcOrDependencies && ipcOrDependencies.ipcMain;
  const dependencies = ipcMain === ipcOrDependencies ? maybeDependencies : ipcOrDependencies || {};
  registerProjectIpc(ipcMain, dependencies);
  registerTaskIpc(ipcMain, dependencies);
  registerRuntimeIpc(ipcMain, dependencies);
  registerApprovalIpc(ipcMain, dependencies);
  registerEventIpc(ipcMain, dependencies);
  registerGitIpc(ipcMain, dependencies);
  registerLogIpc(ipcMain, dependencies);
  registerArtifactIpc(ipcMain, dependencies);
  registerContextIpc(ipcMain, dependencies);
  registerRuleIpc(ipcMain, dependencies);
  registerModelConfigIpc(ipcMain, dependencies);
  registerTerminalIpc(ipcMain, dependencies);
  registerWorktreeIpc(ipcMain, dependencies);
  registerAutomationIpc(ipcMain, dependencies);
  registerExtensionsIpc(ipcMain, dependencies);
  registerPluginsIpc(ipcMain, dependencies);
  registerSkillsIpc(ipcMain, dependencies);
  registerMcpIpc(ipcMain, dependencies);
  registerDesktopIpc(ipcMain, dependencies);
}

module.exports = { registerAllIpc };
