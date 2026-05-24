'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createDefaultProject } = require('../core/models/project.cjs');

const CHANNELS = Object.freeze([
  'redou:projects:list',
  'redou:projects:get',
  'redou:projects:create',
  'redou:projects:create-blank',
  'redou:projects:select-folder',
  'redou:projects:update',
  'redou:projects:remove',
  'redou:projects:open-folder',
]);

function ok(data, warnings = []) {
  return { ok: true, data, error: null, warnings };
}

function fail(error) {
  return { ok: false, data: null, error: { code: error.code || 'IPC_ERROR', message: error.message || String(error), details: error.details || null }, warnings: [] };
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

function cleanProjectName(value, fallback = '空白项目') {
  const name = String(value || '').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/\s+/g, ' ');
  return name || fallback;
}

function projectNameFromRoot(rootPath) {
  return path.basename(path.resolve(rootPath)) || path.resolve(rootPath);
}

async function findProjectByRoot(projectStore, rootPath) {
  const normalizedRoot = path.resolve(rootPath);
  const projects = await projectStore.list();
  return projects.find((project) => project.rootPath && path.resolve(project.rootPath) === normalizedRoot) || null;
}

async function createUniqueWorkspace(root, baseName) {
  await fs.mkdir(root, { recursive: true });
  const safeBase = cleanProjectName(baseName).replace(/[. ]+$/g, '') || 'blank-project';
  for (let index = 0; index < 100; index += 1) {
    const folderName = index === 0 ? safeBase : `${safeBase} ${index + 1}`;
    const candidate = path.join(root, folderName);
    try {
      await fs.mkdir(candidate);
      return candidate;
    } catch (error) {
      if (error && error.code === 'EEXIST') continue;
      throw error;
    }
  }
  throw new Error('Unable to create a unique blank project folder.');
}

async function createBlankProject(payload, dependencies) {
  const projectStore = dependencies.projectStore;
  const name = cleanProjectName(payload.name);
  const workspaceRoot = path.join(dependencies.dataRoot || process.cwd(), 'workspaces');
  const rootPath = await createUniqueWorkspace(workspaceRoot, name);
  return projectStore.save(createDefaultProject({ name, rootPath }));
}

async function createProjectFromSelectedFolder(dependencies) {
  const projectStore = dependencies.projectStore;
  const picker = dependencies.dialog;
  if (!picker || typeof picker.showOpenDialog !== 'function') {
    const error = new Error('Folder picker is not available.');
    error.code = 'FOLDER_PICKER_UNAVAILABLE';
    throw error;
  }

  const result = await picker.showOpenDialog({
    title: '选择项目文件夹',
    properties: ['openDirectory', 'createDirectory'],
  });
  const rootPath = result && !result.canceled && result.filePaths && result.filePaths[0]
    ? path.resolve(result.filePaths[0])
    : null;
  if (!rootPath) return null;

  const existing = await findProjectByRoot(projectStore, rootPath);
  if (existing) return existing;
  return projectStore.save(createDefaultProject({ name: projectNameFromRoot(rootPath), rootPath }));
}

async function updateProject(payload, dependencies) {
  const projectStore = dependencies.projectStore;
  const id = payload.id || payload.projectId;
  if (!id) throw new Error('project id is required');
  const existing = await projectStore.get(id);
  if (!existing) throw new Error(`Project not found: ${id}`);
  return projectStore.save({
    ...existing,
    ...payload,
    id,
    metadata: {
      ...(existing.metadata || {}),
      ...(payload.metadata || {}),
    },
  });
}

async function removeProject(payload, dependencies) {
  const projectStore = dependencies.projectStore;
  const id = payload.id || payload.projectId;
  if (!id) throw new Error('project id is required');
  await projectStore.remove(id);
  return { id, removed: true };
}

async function openProjectFolder(payload, dependencies) {
  const projectStore = dependencies.projectStore;
  const hostShell = dependencies.shell;
  const id = payload.id || payload.projectId;
  if (!id) throw new Error('project id is required');
  const project = await projectStore.get(id);
  if (!project) throw new Error(`Project not found: ${id}`);
  if (!project.rootPath) throw new Error('Project has no workspace folder.');
  const rootPath = path.resolve(project.rootPath);
  await fs.access(rootPath);
  if (!hostShell || typeof hostShell.openPath !== 'function') {
    const error = new Error('Host shell is not available.');
    error.code = 'SHELL_UNAVAILABLE';
    throw error;
  }
  const result = await hostShell.openPath(rootPath);
  if (result) throw new Error(result);
  return { id, path: rootPath };
}

function registerProjectIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  const projectStore = dependencies.projectStore;
  handle(ipcMain, 'redou:projects:list', async () => projectStore.list());
  handle(ipcMain, 'redou:projects:get', async (payload) => projectStore.get(payload.id || payload.projectId));
  handle(ipcMain, 'redou:projects:create', async (payload) => projectStore.save(createDefaultProject(payload)));
  handle(ipcMain, 'redou:projects:create-blank', async (payload) => createBlankProject(payload, dependencies));
  handle(ipcMain, 'redou:projects:select-folder', async () => createProjectFromSelectedFolder(dependencies));
  handle(ipcMain, 'redou:projects:update', async (payload) => updateProject(payload, dependencies));
  handle(ipcMain, 'redou:projects:remove', async (payload) => removeProject(payload, dependencies));
  handle(ipcMain, 'redou:projects:open-folder', async (payload) => openProjectFolder(payload, dependencies));
  return CHANNELS;
}

module.exports = { CHANNELS, registerProjectIpc };
