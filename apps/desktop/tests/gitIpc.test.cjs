const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CHANNELS,
  buildPatchForHunk,
  extractPatchHunks,
  mergeDiffFiles,
  parseGitNumstat,
  parseGitStatus,
  splitPatchByFile,
} = require('../src/ipc/gitIpc.cjs');

test('git ipc registers file actions and delivery actions', () => {
  assert.deepEqual(CHANNELS, [
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
});

test('parseGitStatus reads branch metadata and porcelain files', () => {
  const status = parseGitStatus([
    '## feature/redou...origin/feature/redou [ahead 2, behind 1]',
    ' M apps/desktop/src/ipc/gitIpc.cjs',
    'A  apps/desktop/tests/gitIpc.test.cjs',
    '?? docs/new-plan.md',
  ].join('\n'));

  assert.equal(status.branch, 'feature/redou');
  assert.equal(status.upstream, 'origin/feature/redou');
  assert.equal(status.ahead, 2);
  assert.equal(status.behind, 1);
  assert.equal(status.isClean, false);
  assert.equal(status.changedFileCount, 3);
  assert.equal(status.stagedFileCount, 1);
  assert.equal(status.unstagedFileCount, 2);
  assert.deepEqual(status.files.map((file) => ({
    path: file.path,
    status: file.status,
    staged: file.staged,
    unstaged: file.unstaged,
    untracked: file.untracked,
  })), [
    {
      path: 'apps/desktop/src/ipc/gitIpc.cjs',
      status: 'modified',
      staged: false,
      unstaged: true,
      untracked: false,
    },
    {
      path: 'apps/desktop/tests/gitIpc.test.cjs',
      status: 'added',
      staged: true,
      unstaged: false,
      untracked: false,
    },
    {
      path: 'docs/new-plan.md',
      status: 'untracked',
      staged: false,
      unstaged: false,
      untracked: true,
    },
  ]);
});

test('parseGitNumstat and mergeDiffFiles preserve counts', () => {
  const numstat = parseGitNumstat([
    '10\t2\tapps/desktop/src/ipc/gitIpc.cjs',
    '-\t-\tassets/logo.png',
  ].join('\n'));
  const files = mergeDiffFiles([
    { path: 'apps/desktop/src/ipc/gitIpc.cjs', status: 'modified', staged: false, unstaged: true, untracked: false },
    { path: 'docs/new-plan.md', status: 'untracked', staged: false, unstaged: false, untracked: true },
  ], numstat);

  assert.deepEqual(numstat, [
    { path: 'apps/desktop/src/ipc/gitIpc.cjs', insertions: 10, deletions: 2, binary: false },
    { path: 'assets/logo.png', insertions: 0, deletions: 0, binary: true },
  ]);
  assert.deepEqual(files.map((file) => ({
    path: file.path,
    status: file.status,
    insertions: file.insertions,
    deletions: file.deletions,
    binary: Boolean(file.binary),
  })), [
    {
      path: 'apps/desktop/src/ipc/gitIpc.cjs',
      status: 'modified',
      insertions: 10,
      deletions: 2,
      binary: false,
    },
    {
      path: 'docs/new-plan.md',
      status: 'untracked',
      insertions: 0,
      deletions: 0,
      binary: false,
    },
    {
      path: 'assets/logo.png',
      status: 'modified',
      insertions: 0,
      deletions: 0,
      binary: true,
    },
  ]);
});

test('splitPatchByFile maps unified diff chunks by repository path', () => {
  const patchByFile = splitPatchByFile([
    'diff --git a/apps/a.ts b/apps/a.ts',
    'index 1111111..2222222 100644',
    '--- a/apps/a.ts',
    '+++ b/apps/a.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    'diff --git a/docs/plan.md b/docs/plan.md',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/docs/plan.md',
    '@@ -0,0 +1 @@',
    '+hello',
  ].join('\n'));

  assert.equal(patchByFile.size, 2);
  assert.match(patchByFile.get('apps/a.ts'), /\+new/);
  assert.match(patchByFile.get('docs/plan.md'), /new file mode/);
});

test('extractPatchHunks builds a single-hunk patch with file prelude', () => {
  const filePatch = [
    'diff --git a/apps/a.ts b/apps/a.ts',
    'index 1111111..2222222 100644',
    '--- a/apps/a.ts',
    '+++ b/apps/a.ts',
    '@@ -1,2 +1,2 @@',
    ' old',
    '-first',
    '+second',
    '@@ -10 +10 @@',
    '-tail',
    '+tail next',
  ].join('\n');

  const hunks = extractPatchHunks(filePatch);
  assert.equal(hunks.length, 2);
  assert.match(hunks[0].patch, /^diff --git a\/apps\/a\.ts b\/apps\/a\.ts/);
  assert.match(hunks[0].patch, /\+second/);
  assert.doesNotMatch(hunks[0].patch, /tail next/);
  assert.match(buildPatchForHunk(filePatch, 1), /tail next/);
});
