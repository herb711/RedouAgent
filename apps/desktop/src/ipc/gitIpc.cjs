'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');

const CHANNELS = Object.freeze([
  'redou:git:status',
  'redou:git:diff',
  'redou:git:stage',
  'redou:git:unstage',
  'redou:git:revert',
  'redou:git:stage-hunk',
  'redou:git:revert-hunk',
  'redou:git:commit',
  'redou:git:push',
  'redou:git:create-pr',
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

function runGit(args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, {
      cwd,
      windowsHide: true,
      maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const result = {
        code: error && typeof error.code === 'number' ? error.code : 0,
        stdout: stdout || '',
        stderr: stderr || '',
      };
      if (error && !options.allowFailure) {
        const wrapped = new Error((stderr || error.message || 'Git command failed.').trim());
        wrapped.code = 'GIT_COMMAND_FAILED';
        wrapped.details = { args, cwd, exitCode: result.code, stderr };
        reject(wrapped);
        return;
      }
      resolve(result);
    });
    if (options.input !== undefined) {
      child.stdin.end(options.input);
    }
  });
}

function runCommand(command, args, cwd, options = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      cwd,
      windowsHide: true,
      maxBuffer: options.maxBuffer || 20 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const result = {
        code: error && typeof error.code === 'number' ? error.code : 0,
        stdout: stdout || '',
        stderr: stderr || '',
      };
      if (error && !options.allowFailure) {
        const wrapped = new Error((stderr || error.message || `${command} command failed.`).trim());
        wrapped.code = error.code === 'ENOENT' ? 'COMMAND_NOT_FOUND' : 'COMMAND_FAILED';
        wrapped.details = { command, args, cwd, exitCode: result.code, stderr };
        reject(wrapped);
        return;
      }
      resolve(result);
    });
    if (options.input !== undefined) {
      child.stdin.end(options.input);
    }
  });
}

async function resolveProjectRoot(payload = {}, dependencies = {}) {
  const explicit = payload.cwd || payload.rootPath || payload.projectPath;
  if (explicit) return path.resolve(String(explicit));

  const projectStore = dependencies.projectStore;
  const taskStore = dependencies.taskStore;
  const projectId = payload.projectId || payload.id;
  if (projectId && projectStore && typeof projectStore.get === 'function') {
    const project = await projectStore.get(String(projectId));
    if (project && project.rootPath) return path.resolve(project.rootPath);
  }

  if (payload.taskId && taskStore && typeof taskStore.get === 'function') {
    const task = await taskStore.get(String(payload.taskId));
    if (task && task.projectId && projectStore && typeof projectStore.get === 'function') {
      const project = await projectStore.get(task.projectId);
      if (project && project.rootPath) return path.resolve(project.rootPath);
    }
  }

  if (projectStore && typeof projectStore.list === 'function') {
    const projects = await projectStore.list();
    const project = projects.find((item) => item && item.rootPath);
    if (project && project.rootPath) return path.resolve(project.rootPath);
  }

  return path.resolve(dependencies.workspaceRoot || process.cwd());
}

function parseBranchLine(line = '') {
  if (!line.startsWith('## ')) return {};
  const value = line.slice(3).trim();
  const bracketIndex = value.indexOf('[');
  const refText = bracketIndex === -1 ? value : value.slice(0, bracketIndex).trim();
  const statusText = bracketIndex === -1 ? '' : value.slice(bracketIndex + 1, value.lastIndexOf(']'));
  const [branchPart, upstreamPart] = refText.split('...');
  const ahead = Number((statusText.match(/\bahead\s+(\d+)/) || [])[1] || 0);
  const behind = Number((statusText.match(/\bbehind\s+(\d+)/) || [])[1] || 0);
  return {
    branch: branchPart || null,
    upstream: upstreamPart || null,
    ahead,
    behind,
  };
}

function classifyStatus(indexStatus, worktreeStatus) {
  if (indexStatus === '?' && worktreeStatus === '?') return 'untracked';
  if (indexStatus === '!' && worktreeStatus === '!') return 'ignored';
  if (indexStatus === 'U' || worktreeStatus === 'U' || (indexStatus === 'A' && worktreeStatus === 'A') || (indexStatus === 'D' && worktreeStatus === 'D')) return 'conflicted';
  if (indexStatus === 'R' || worktreeStatus === 'R') return 'renamed';
  if (indexStatus === 'D' || worktreeStatus === 'D') return 'deleted';
  if (indexStatus === 'A' || worktreeStatus === 'A') return 'added';
  if (indexStatus !== ' ' && worktreeStatus !== ' ') return 'mixed';
  if (indexStatus !== ' ') return 'staged';
  if (worktreeStatus !== ' ') return 'modified';
  return 'changed';
}

function parseStatusFile(line) {
  const indexStatus = line[0] || ' ';
  const worktreeStatus = line[1] || ' ';
  const rawPath = line.slice(3);
  const renameParts = rawPath.split(' -> ');
  const filePath = renameParts.length > 1 ? renameParts[renameParts.length - 1] : rawPath;
  return {
    path: filePath,
    originalPath: renameParts.length > 1 ? renameParts[0] : null,
    indexStatus,
    worktreeStatus,
    status: classifyStatus(indexStatus, worktreeStatus),
    staged: indexStatus !== ' ' && indexStatus !== '?' && indexStatus !== '!',
    unstaged: worktreeStatus !== ' ' && worktreeStatus !== '?' && worktreeStatus !== '!',
    untracked: indexStatus === '?' && worktreeStatus === '?',
  };
}

function parseGitStatus(text = '') {
  const lines = String(text || '').split(/\r?\n/).filter(Boolean);
  const branchInfo = parseBranchLine(lines.find((line) => line.startsWith('## ')) || '');
  const files = lines.filter((line) => !line.startsWith('## ')).map(parseStatusFile);
  return {
    ...branchInfo,
    files,
    isClean: files.length === 0,
    changedFileCount: files.length,
    stagedFileCount: files.filter((file) => file.staged).length,
    unstagedFileCount: files.filter((file) => file.unstaged || file.untracked).length,
    raw: text,
  };
}

function parseGitNumstat(text = '') {
  return String(text || '').split(/\r?\n/).filter(Boolean).map((line) => {
    const [insertions, deletions, filePath] = line.split('\t');
    return {
      path: filePath || '',
      insertions: insertions === '-' ? 0 : Number(insertions || 0),
      deletions: deletions === '-' ? 0 : Number(deletions || 0),
      binary: insertions === '-' || deletions === '-',
    };
  }).filter((file) => file.path);
}

function mergeDiffFiles(statusFiles = [], numstatFiles = []) {
  const byPath = new Map();
  for (const file of statusFiles) {
    byPath.set(file.path, {
      id: file.path,
      path: file.path,
      originalPath: file.originalPath,
      status: file.status,
      indexStatus: file.indexStatus,
      worktreeStatus: file.worktreeStatus,
      insertions: 0,
      deletions: 0,
      staged: file.staged,
      unstaged: file.unstaged,
      untracked: file.untracked,
    });
  }
  for (const file of numstatFiles) {
    byPath.set(file.path, {
      ...(byPath.get(file.path) || { id: file.path, path: file.path, status: 'modified' }),
      insertions: file.insertions,
      deletions: file.deletions,
      binary: file.binary,
    });
  }
  return Array.from(byPath.values());
}

function normalizeDiffPath(value = '') {
  if (!value) return '';
  if (value === '/dev/null') return value;
  if ((value.startsWith('a/') || value.startsWith('b/')) && value.length > 2) return value.slice(2);
  return value.replace(/^"|"$/g, '');
}

function splitPatchByFile(patch = '') {
  const result = new Map();
  let current = null;
  for (const line of String(patch || '').split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      if (current) result.set(current.path, current.lines.join('\n'));
      const parts = line.trim().split(/\s+/);
      const pathFromB = normalizeDiffPath(parts[3] || '');
      const pathFromA = normalizeDiffPath(parts[2] || '');
      current = {
        path: pathFromB && pathFromB !== '/dev/null' ? pathFromB : pathFromA,
        lines: [line],
      };
      continue;
    }
    if (current) current.lines.push(line);
  }
  if (current) result.set(current.path, current.lines.join('\n'));
  return result;
}

function extractPatchHunks(filePatch = '') {
  const lines = String(filePatch || '').split(/\r?\n/);
  const prelude = [];
  const hunks = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current) hunks.push(current);
      current = { header: line, lines: [line] };
      continue;
    }
    if (current) {
      current.lines.push(line);
    } else {
      prelude.push(line);
    }
  }
  if (current) hunks.push(current);
  return hunks.map((hunk, index) => ({
    index,
    header: hunk.header,
    patch: [...prelude, ...hunk.lines].join('\n'),
  }));
}

function buildPatchForHunk(filePatch = '', hunkIndex = 0) {
  const hunks = extractPatchHunks(filePatch);
  const index = Number(hunkIndex || 0);
  const hunk = hunks[index];
  if (!hunk) {
    const error = new Error(`Patch hunk not found: ${index}`);
    error.code = 'GIT_HUNK_NOT_FOUND';
    throw error;
  }
  return hunk.patch;
}

function patchReferencedPaths(patch = '') {
  const paths = new Set();
  for (const line of String(patch || '').split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      const parts = line.trim().split(/\s+/);
      for (const part of [parts[2], parts[3]]) {
        const normalized = normalizeDiffPath(part || '');
        if (normalized && normalized !== '/dev/null') paths.add(normalized);
      }
    } else if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      const normalized = normalizeDiffPath(line.slice(4).trim().split(/\t/)[0] || '');
      if (normalized && normalized !== '/dev/null') paths.add(normalized);
    }
  }
  return Array.from(paths);
}

function assertPatchTargetsFile(patch, filePath) {
  const normalizedFile = filePath.replace(/\\/g, '/');
  const paths = patchReferencedPaths(patch);
  const escaped = paths.filter((entry) => entry !== normalizedFile);
  if (escaped.length) {
    const error = new Error(`Patch targets a different file: ${escaped.join(', ')}`);
    error.code = 'GIT_PATCH_PATH_MISMATCH';
    error.details = { expected: normalizedFile, paths };
    throw error;
  }
}

function isProbablyBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  return sample.includes(0);
}

function buildSyntheticUntrackedPatch(filePath, text) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalizedText.endsWith('\n')
    ? normalizedText.slice(0, -1).split('\n')
    : normalizedText.split('\n');
  const contentLines = normalizedText.length ? lines : [];
  const hunkLength = contentLines.length;
  return {
    patch: [
      `diff --git a/${normalizedPath} b/${normalizedPath}`,
      'new file mode 100644',
      'index 0000000..0000000',
      '--- /dev/null',
      `+++ b/${normalizedPath}`,
      `@@ -0,0 +1,${hunkLength} @@`,
      ...contentLines.map((line) => `+${line}`),
    ].join('\n'),
    insertions: contentLines.length,
    deletions: 0,
    binary: false,
  };
}

async function buildUntrackedPatch(rootPath, filePath) {
  const absolutePath = path.resolve(rootPath, filePath);
  const root = path.resolve(rootPath);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    return { path: filePath, patch: '', insertions: 0, deletions: 0, binary: false };
  }
  const stats = await fs.stat(absolutePath).catch(() => null);
  if (!stats || !stats.isFile()) {
    return { path: filePath, patch: '', insertions: 0, deletions: 0, binary: false };
  }
  const buffer = await fs.readFile(absolutePath);
  if (isProbablyBinary(buffer)) {
    return { path: filePath, patch: '', insertions: 0, deletions: 0, binary: true };
  }
  return {
    path: filePath,
    ...buildSyntheticUntrackedPatch(filePath, buffer.toString('utf8')),
  };
}

async function buildGitStatus(payload, dependencies) {
  const cwd = await resolveProjectRoot(payload, dependencies);
  await fs.access(cwd);
  const root = await runGit(['rev-parse', '--show-toplevel'], cwd, { allowFailure: true });
  if (root.code !== 0) {
    return {
      cwd,
      rootPath: null,
      isRepository: false,
      isClean: true,
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
      changedFileCount: 0,
      stagedFileCount: 0,
      unstagedFileCount: 0,
      error: (root.stderr || '').trim(),
    };
  }
  const status = await runGit(['status', '--short', '--branch'], cwd);
  return {
    cwd,
    rootPath: root.stdout.trim(),
    isRepository: true,
    ...parseGitStatus(status.stdout),
  };
}

async function buildGitDiff(payload, dependencies) {
  const status = await buildGitStatus(payload, dependencies);
  if (!status.isRepository) {
    return {
      ...status,
      patch: '',
      stat: '',
      files: [],
      insertions: 0,
      deletions: 0,
    };
  }
  const diffTarget = payload.staged ? '--cached' : 'HEAD';
  const [patch, stat, numstat] = await Promise.all([
    runGit(['diff', '--no-ext-diff', '--patch', diffTarget, '--'], status.rootPath, { allowFailure: true }),
    runGit(['diff', '--stat', diffTarget, '--'], status.rootPath, { allowFailure: true }),
    runGit(['diff', '--numstat', diffTarget, '--'], status.rootPath, { allowFailure: true }),
  ]);
  const patchByPath = splitPatchByFile(patch.stdout);
  const numstatFiles = parseGitNumstat(numstat.stdout);
  if (!payload.staged) {
    const untrackedPatches = await Promise.all(status.files
      .filter((file) => file.untracked)
      .map((file) => buildUntrackedPatch(status.rootPath, file.path)));
    for (const file of untrackedPatches) {
      if (file.patch) patchByPath.set(file.path, file.patch);
      numstatFiles.push({
        path: file.path,
        insertions: file.insertions,
        deletions: file.deletions,
        binary: file.binary,
      });
    }
  }
  const files = mergeDiffFiles(status.files, numstatFiles).map((file) => ({
    ...file,
    patch: patchByPath.get(file.path) || '',
  }));
  return {
    ...status,
    patch: patch.stdout || '',
    stat: stat.stdout || '',
    files,
    insertions: files.reduce((sum, file) => sum + Number(file.insertions || 0), 0),
    deletions: files.reduce((sum, file) => sum + Number(file.deletions || 0), 0),
  };
}

function assertSafeGitPath(rootPath, filePath) {
  if (!filePath || typeof filePath !== 'string') {
    const error = new Error('file path is required');
    error.code = 'GIT_PATH_REQUIRED';
    throw error;
  }
  const root = path.resolve(rootPath);
  const resolved = path.resolve(root, filePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    const error = new Error(`Refusing to operate outside repository: ${filePath}`);
    error.code = 'GIT_PATH_OUTSIDE_REPO';
    throw error;
  }
  if (resolved === path.join(root, '.git') || resolved.includes(`${path.sep}.git${path.sep}`)) {
    const error = new Error(`Refusing to operate on Git internals: ${filePath}`);
    error.code = 'GIT_INTERNAL_PATH';
    throw error;
  }
  return filePath.replace(/\\/g, '/');
}

async function runGitFileAction(payload, dependencies, action) {
  const status = await buildGitStatus(payload, dependencies);
  if (!status.isRepository) {
    const error = new Error('Current project is not a Git repository.');
    error.code = 'NOT_A_GIT_REPOSITORY';
    throw error;
  }
  const filePath = assertSafeGitPath(status.rootPath, payload.path || payload.filePath);
  if (action === 'stage') await runGit(['add', '--', filePath], status.rootPath);
  else if (action === 'unstage') await runGit(['restore', '--staged', '--', filePath], status.rootPath);
  else if (action === 'revert') {
    const file = status.files.find((item) => item.path === filePath);
    if (file && file.untracked) {
      if (!payload.allowUntrackedDelete) {
        const error = new Error('Refusing to delete an untracked file without explicit confirmation.');
        error.code = 'UNTRACKED_DELETE_REQUIRES_CONFIRMATION';
        throw error;
      }
      await fs.rm(path.resolve(status.rootPath, filePath), { force: true, recursive: false });
    } else {
      await runGit(['restore', '--staged', '--worktree', '--', filePath], status.rootPath);
    }
  } else {
    throw new Error(`Unknown Git action: ${action}`);
  }
  return buildGitDiff(payload, dependencies);
}

async function resolvePatchForFileAction(payload, dependencies, filePath) {
  if (payload.patch) {
    const patch = String(payload.patch || '');
    assertPatchTargetsFile(patch, filePath);
    return patch;
  }
  const diff = await buildGitDiff({ ...payload, staged: Boolean(payload.staged) }, dependencies);
  const file = diff.files.find((item) => item.path === filePath);
  if (!file || !file.patch) {
    const error = new Error(`No patch available for ${filePath}`);
    error.code = 'GIT_PATCH_NOT_AVAILABLE';
    throw error;
  }
  const patch = buildPatchForHunk(file.patch, payload.hunkIndex);
  assertPatchTargetsFile(patch, filePath);
  return patch;
}

async function runGitPatchAction(payload, dependencies, action) {
  const status = await buildGitStatus(payload, dependencies);
  if (!status.isRepository) {
    const error = new Error('Current project is not a Git repository.');
    error.code = 'NOT_A_GIT_REPOSITORY';
    throw error;
  }
  const filePath = assertSafeGitPath(status.rootPath, payload.path || payload.filePath);
  const patch = await resolvePatchForFileAction(payload, dependencies, filePath);
  const args = action === 'stage-hunk'
    ? ['apply', '--cached', '--whitespace=nowarn']
    : ['apply', '--reverse', '--whitespace=nowarn'];
  if (action === 'revert-hunk' && payload.staged) {
    args.splice(1, 0, '--cached');
  }
  await runGit(args, status.rootPath, { input: patch });
  return buildGitDiff(payload, dependencies);
}

async function runGitCommit(payload, dependencies) {
  const message = String(payload.message || '').trim();
  if (!message) {
    const error = new Error('Commit message is required.');
    error.code = 'GIT_COMMIT_MESSAGE_REQUIRED';
    throw error;
  }
  const status = await buildGitStatus(payload, dependencies);
  if (!status.isRepository) {
    const error = new Error('Current project is not a Git repository.');
    error.code = 'NOT_A_GIT_REPOSITORY';
    throw error;
  }
  if (!status.stagedFileCount) {
    const error = new Error('No staged changes to commit.');
    error.code = 'NO_STAGED_CHANGES';
    throw error;
  }
  const commit = await runGit(['commit', '-m', message], status.rootPath);
  const sha = await runGit(['rev-parse', '--short', 'HEAD'], status.rootPath, { allowFailure: true });
  return {
    ...await buildGitDiff(payload, dependencies),
    lastAction: {
      type: 'commit',
      message,
      sha: sha.stdout.trim() || null,
      stdout: commit.stdout,
      stderr: commit.stderr,
    },
  };
}

async function runGitPush(payload, dependencies) {
  const status = await buildGitStatus(payload, dependencies);
  if (!status.isRepository) {
    const error = new Error('Current project is not a Git repository.');
    error.code = 'NOT_A_GIT_REPOSITORY';
    throw error;
  }
  const push = await runGit(['push'], status.rootPath);
  return {
    ...await buildGitDiff(payload, dependencies),
    lastAction: {
      type: 'push',
      stdout: push.stdout,
      stderr: push.stderr,
    },
  };
}

async function runGitCreatePullRequest(payload, dependencies) {
  const status = await buildGitStatus(payload, dependencies);
  if (!status.isRepository) {
    const error = new Error('Current project is not a Git repository.');
    error.code = 'NOT_A_GIT_REPOSITORY';
    throw error;
  }
  const branch = String(payload.head || status.branch || '').trim();
  if (!branch || branch === 'HEAD') {
    const error = new Error('A named branch is required to create a pull request.');
    error.code = 'GIT_BRANCH_REQUIRED';
    throw error;
  }
  if (payload.pushFirst) {
    await runGit(['push', '-u', 'origin', branch], status.rootPath);
  }
  const title = String(payload.title || branch).trim();
  const body = String(payload.body || '').trim() || 'Created from Redou Agent desktop.';
  const args = ['pr', 'create', '--title', title, '--body', body];
  if (payload.base) args.push('--base', String(payload.base));
  if (branch) args.push('--head', branch);
  if (payload.draft) args.push('--draft');
  const created = await runCommand('gh', args, status.rootPath);
  const url = (created.stdout || '').split(/\r?\n/).find((line) => /^https?:\/\//.test(line.trim()))?.trim() || created.stdout.trim();
  return {
    ...await buildGitDiff(payload, dependencies),
    pullRequest: {
      url,
      title,
      branch,
      stdout: created.stdout,
      stderr: created.stderr,
    },
    lastAction: {
      type: 'create-pr',
      stdout: created.stdout,
      stderr: created.stderr,
    },
  };
}

function registerGitIpc(ipcMain, dependencies = {}) {
  if (!ipcMain) return CHANNELS;
  handle(ipcMain, 'redou:git:status', async (payload) => buildGitStatus(payload, dependencies));
  handle(ipcMain, 'redou:git:diff', async (payload) => buildGitDiff(payload, dependencies));
  handle(ipcMain, 'redou:git:stage', async (payload) => runGitFileAction(payload, dependencies, 'stage'));
  handle(ipcMain, 'redou:git:unstage', async (payload) => runGitFileAction(payload, dependencies, 'unstage'));
  handle(ipcMain, 'redou:git:revert', async (payload) => runGitFileAction(payload, dependencies, 'revert'));
  handle(ipcMain, 'redou:git:stage-hunk', async (payload) => runGitPatchAction(payload, dependencies, 'stage-hunk'));
  handle(ipcMain, 'redou:git:revert-hunk', async (payload) => runGitPatchAction(payload, dependencies, 'revert-hunk'));
  handle(ipcMain, 'redou:git:commit', async (payload) => runGitCommit(payload, dependencies));
  handle(ipcMain, 'redou:git:push', async (payload) => runGitPush(payload, dependencies));
  handle(ipcMain, 'redou:git:create-pr', async (payload) => runGitCreatePullRequest(payload, dependencies));
  return CHANNELS;
}

module.exports = {
  CHANNELS,
  buildGitDiff,
  buildGitStatus,
  buildPatchForHunk,
  extractPatchHunks,
  mergeDiffFiles,
  parseGitNumstat,
  parseGitStatus,
  registerGitIpc,
  resolveProjectRoot,
  runCommand,
  runGit,
  splitPatchByFile,
};
