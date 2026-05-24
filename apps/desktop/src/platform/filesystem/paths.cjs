'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

function resolveWorkspaceRoot(options = {}) {
  return path.resolve(options.workspaceRoot || options.projectRoot || process.cwd());
}

function getRedouDataRoot(options = {}) {
  return path.resolve(options.dataRoot || path.join(resolveWorkspaceRoot(options), '.redou'));
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  return dirPath;
}

function safeJoin(root, ...segments) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes root: ${target}`);
  }
  return target;
}

function taskDataRoot(dataRoot, taskId) {
  if (!taskId) throw new Error('taskId is required');
  return safeJoin(dataRoot, 'tasks', encodeURIComponent(taskId));
}

module.exports = {
  resolveWorkspaceRoot,
  getRedouDataRoot,
  ensureDir,
  safeJoin,
  taskDataRoot,
};
