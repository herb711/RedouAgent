'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createDefaultProject } = require('../core/models/project.cjs');
const { REDOU_CODEX_RUNTIME_ID } = require('../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');
const { buildGitStatus, resolveProjectRoot, runGit } = require('./gitIpc.cjs');

const CHANNELS = Object.freeze([
  'redou:worktrees:list',
  'redou:worktrees:create',
  'redou:worktrees:remove',
  'redou:worktrees:open',
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

function parseWorktreeList(text = '') {
  const entries = [];
  let current = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) {
      if (current) entries.push(current);
      current = null;
      continue;
    }
    const [key, ...rest] = line.split(' ');
    const value = rest.join(' ');
    if (key === 'worktree') current = { path: value, head: null, branch: null, detached: false, bare: false };
    else if (current && key === 'HEAD') current.head = value;
    else if (current && key === 'branch') current.branch = value.replace(/^refs\/heads\//, '');
    else if (current && key === 'detached') current.detached = true;
    else if (current && key === 'bare') current.bare = true;
  }
  if (current) entries.push(current);
  return entries.map((entry) => ({
    id: entry.path,
    path: entry.path,
    name: path.basename(entry.path),
    head: entry.head,
    branch: entry.branch,
    detached: entry.detached,
    bare: entry.bare,
  }));
}

function sanitizeBranchName(input) {
  const cleaned = String(input || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._/-]/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^-+|-+$/g, '');
  return cleaned || `codex/worktree-${Date.now()}`;
}

function defaultWorktreePath(rootPath, branchName) {
  const parent = path.dirname(rootPath);
  const repoName = path.basename(rootPath);
  const safeBranch = branchName.replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-');
  return path.join(parent, `${repoName}-${safeBranch}`);
}

async function resolveGitRoot(payload, dependencies) {
  const cwd = await resolveProjectRoot(payload, dependencies);
  const status = await buildGitStatus({ ...payload, cwd }, dependencies);
  if (!status.isRepository || !status.rootPath) {
    const error = new Error('Current project is not a Git repository.');
    error.code = 'NOT_A_GIT_REPOSITORY';
    throw error;
  }
  return status.rootPath;
}

async function listWorktrees(payload = {}, dependencies = {}) {
  const rootPath = await resolveGitRoot(payload, dependencies);
  const result = await runGit(['worktree', 'list', '--porcelain'], rootPath);
  return {
    rootPath,
    worktrees: parseWorktreeList(result.stdout),
  };
}

async function createWorktree(payload = {}, dependencies = {}) {
  const rootPath = await resolveGitRoot(payload, dependencies);
  const branchName = sanitizeBranchName(payload.branchName || payload.branch || '');
  const targetPath = path.resolve(payload.path || defaultWorktreePath(rootPath, branchName));
  if (targetPath === rootPath || targetPath.startsWith(path.join(rootPath, '.git'))) {
    const error = new Error('Refusing to create a worktree inside Git internals.');
    error.code = 'WORKTREE_PATH_UNSAFE';
    throw error;
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const args = payload.checkoutExisting
    ? ['worktree', 'add', targetPath, branchName]
    : ['worktree', 'add', '-b', branchName, targetPath, payload.base || 'HEAD'];
  await runGit(args, rootPath);

  let project = null;
  if (dependencies.projectStore && typeof dependencies.projectStore.save === 'function') {
    project = await dependencies.projectStore.save(createDefaultProject({
      name: path.basename(targetPath),
      rootPath: targetPath,
      defaultRuntime: REDOU_CODEX_RUNTIME_ID,
      metadata: {
        worktreeOf: rootPath,
        branchName,
      },
    }));
  }
  return {
    ...await listWorktrees({ ...payload, cwd: rootPath }, dependencies),
    created: {
      path: targetPath,
      branch: branchName,
      project,
    },
  };
}

async function removeWorktree(payload = {}, dependencies = {}) {
  const rootPath = await resolveGitRoot(payload, dependencies);
  if (!payload.path) {
    const error = new Error('Worktree path is required.');
    error.code = 'WORKTREE_PATH_REQUIRED';
    throw error;
  }
  const targetPath = path.resolve(String(payload.path));
  const listed = await listWorktrees({ ...payload, cwd: rootPath }, dependencies);
  const exists = listed.worktrees.some((worktree) => path.resolve(worktree.path) === targetPath);
  if (!exists) {
    const error = new Error('Refusing to remove a path that is not a registered Git worktree.');
    error.code = 'WORKTREE_NOT_REGISTERED';
    throw error;
  }
  if (targetPath === rootPath) {
    const error = new Error('The main repository worktree cannot be removed here.');
    error.code = 'WORKTREE_MAIN_REPO';
    throw error;
  }
  await runGit(['worktree', 'remove', payload.force ? '--force' : '', targetPath].filter(Boolean), rootPath);
  return listWorktrees({ ...payload, cwd: rootPath }, dependencies);
}

async function openWorktree(payload = {}, dependencies = {}) {
  const targetPath = path.resolve(String(payload.path || ''));
  await fs.access(targetPath);
  if (!dependencies.shell || typeof dependencies.shell.openPath !== 'function') {
    const error = new Error('Host shell is not available.');
    error.code = 'SHELL_UNAVAILABLE';
    throw error;
  }
  const result = await dependencies.shell.openPath(targetPath);
  if (result) throw new Error(result);
  return { path: targetPath };
}

function registerWorktreeIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  handle(ipcMain, 'redou:worktrees:list', async (payload) => listWorktrees(payload, dependencies));
  handle(ipcMain, 'redou:worktrees:create', async (payload) => createWorktree(payload, dependencies));
  handle(ipcMain, 'redou:worktrees:remove', async (payload) => removeWorktree(payload, dependencies));
  handle(ipcMain, 'redou:worktrees:open', async (payload) => openWorktree(payload, dependencies));
  return CHANNELS;
}

module.exports = {
  CHANNELS,
  createWorktree,
  defaultWorktreePath,
  listWorktrees,
  parseWorktreeList,
  registerWorktreeIpc,
  removeWorktree,
  sanitizeBranchName,
};
