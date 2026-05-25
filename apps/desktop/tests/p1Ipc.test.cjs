const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { normalizeAutomation, createAutomation, updateAutomation, runAutomation, isAutomationDue } = require('../src/ipc/automationIpc.cjs');
const { normalizeServer, installMcpServer, testMcpServer } = require('../src/ipc/mcpIpc.cjs');
const { parseFrontmatter } = require('../src/ipc/skillsIpc.cjs');
const { parseWorktreeList, sanitizeBranchName } = require('../src/ipc/worktreeIpc.cjs');
const { shellInvocation } = require('../src/ipc/terminalIpc.cjs');

test('worktree parser reads porcelain output', () => {
  const worktrees = parseWorktreeList([
    'worktree D:/repo',
    'HEAD 1111111111111111111111111111111111111111',
    'branch refs/heads/main',
    '',
    'worktree D:/repo-feature',
    'HEAD 2222222222222222222222222222222222222222',
    'branch refs/heads/codex/feature',
  ].join('\n'));

  assert.deepEqual(worktrees.map((item) => ({ path: item.path, branch: item.branch })), [
    { path: 'D:/repo', branch: 'main' },
    { path: 'D:/repo-feature', branch: 'codex/feature' },
  ]);
  assert.equal(sanitizeBranchName('codex/my branch!'), 'codex/my-branch');
});

test('automation store creates, updates, and records run tasks', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-automation-'));
  const savedTasks = [];
  const dependencies = {
    dataRoot,
    taskStore: {
      save: async (task) => {
        const saved = { ...task, id: `task-${savedTasks.length + 1}` };
        savedTasks.push(saved);
        return saved;
      },
    },
  };

  const created = await createAutomation({ name: 'Morning', prompt: 'Check status', schedule: 'daily 09:00' }, dependencies);
  assert.equal(created.automation.status, 'ACTIVE');
  const paused = await updateAutomation({ id: created.automation.id, status: 'PAUSED' }, dependencies);
  assert.equal(paused.automation.status, 'PAUSED');
  const run = await runAutomation({ id: created.automation.id, projectId: 'default-workspace' }, dependencies);
  assert.equal(run.task.id, 'task-1');
  assert.equal(run.automation.lastTaskId, 'task-1');
  assert.equal(isAutomationDue({ ...run.automation, status: 'ACTIVE', schedule: 'daily 09:00', lastRunAt: null }, new Date('2026-05-25T09:01:00')), true);
  assert.equal(isAutomationDue({ ...run.automation, status: 'ACTIVE', schedule: 'every 30 minutes', lastRunAt: '2026-05-25T08:00:00' }, new Date('2026-05-25T08:31:00')), true);
});

test('mcp server normalization and command test are deterministic', async () => {
  assert.deepEqual(normalizeServer({ name: 'fs', command: 'node', args: '--version' }).args, ['--version']);
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-mcp-'));
  const command = process.platform === 'win32' ? 'cmd.exe' : 'sh';
  const installed = await installMcpServer({ name: 'shell', command }, { dataRoot });
  assert.equal(installed.server.name, 'shell');
  const tested = await testMcpServer({ name: 'shell' }, { dataRoot });
  assert.equal(tested.lastTest.ok, true);
});

test('skills frontmatter and terminal shell invocation stay simple', () => {
  assert.deepEqual(parseFrontmatter('---\nname: demo\ndescription: Hello\n---\nBody'), {
    name: 'demo',
    description: 'Hello',
  });
  assert.ok(shellInvocation('echo hi').args.includes('echo hi'));
  assert.equal(normalizeAutomation({ prompt: 'x', status: 'paused' }).status, 'PAUSED');
});
