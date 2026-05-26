const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  normalizeAutomation,
  createAutomation,
  createAutomationFromTool,
  dynamicAutomationTools,
  updateAutomation,
  runAutomation,
  isAutomationDue,
  listAutomationRuns,
} = require('../src/ipc/automationIpc.cjs');
const { registerExtensionsIpc } = require('../src/ipc/extensionsIpc.cjs');
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
  const tasks = new Map();
  const runtimeStarts = [];
  const dependencies = {
    dataRoot,
    taskStore: {
      get: async (id) => tasks.get(id) || null,
      save: async (task) => {
        const saved = { ...task, id: `task-${savedTasks.length + 1}` };
        savedTasks.push(saved);
        tasks.set(saved.id, saved);
        return saved;
      },
    },
    startRuntimeRun: async (input) => {
      runtimeStarts.push(input);
      return { status: 'running', taskId: input.taskId, activeTurnId: 'turn-1' };
    },
  };

  const created = await createAutomation({
    name: 'Morning',
    prompt: 'Check status',
    schedule: 'daily 09:00',
    replyTarget: 'system_notification',
  }, dependencies);
  assert.equal(created.automation.status, 'ACTIVE');
  const paused = await updateAutomation({ id: created.automation.id, status: 'PAUSED' }, dependencies);
  assert.equal(paused.automation.status, 'PAUSED');
  const run = await runAutomation({ id: created.automation.id, projectId: 'default-workspace' }, dependencies);
  assert.equal(run.task.id, 'task-1');
  assert.equal(run.automation.lastTaskId, 'task-1');
  assert.equal(run.run.status, 'completed');
  assert.equal(run.run.turnId, 'turn-1');
  assert.equal(runtimeStarts[0].deliveryMode, 'automation');
  assert.match(runtimeStarts[0].userInput, /\[Automation: Morning\]/);
  const runs = await listAutomationRuns({ id: created.automation.id }, dependencies);
  assert.equal(runs.runs.some((item) => item.status === 'completed'), true);
  assert.equal(isAutomationDue({ title: 'Morning', prompt: 'Check status', enabled: true, status: 'ACTIVE', schedule: 'daily 09:00', nextRunAt: null, lastRunAt: null }, new Date('2026-05-25T09:01:00')), true);
  assert.equal(isAutomationDue({ title: 'Morning', prompt: 'Check status', enabled: true, status: 'ACTIVE', schedule: 'every 30 minutes', nextRunAt: null, lastRunAt: '2026-05-25T08:00:00' }, new Date('2026-05-25T08:31:00')), true);
});

test('automation tool visibility is settings gated and model-created tasks bind conversation context', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-automation-tool-'));
  const disabledDependencies = {
    dataRoot,
    appSettingsStore: {
      get: async () => ({ automation: { allowModelCreate: false, exposeToolToModel: true } }),
    },
  };

  assert.deepEqual(await dynamicAutomationTools(disabledDependencies), []);
  await assert.rejects(
    () => createAutomationFromTool({
      title: 'Check later',
      prompt: 'Check build status',
      scheduleType: 'once',
      startAt: '2026-05-27T01:00:00.000Z',
    }, { conversationId: 'task-1', projectId: 'project-1' }, disabledDependencies),
    (error) => error.code === 'AUTOMATION_TOOL_DISABLED',
  );

  const enabledDependencies = {
    dataRoot,
    appSettingsStore: {
      get: async () => ({ automation: { allowModelCreate: true, exposeToolToModel: true } }),
    },
  };
  const tools = await dynamicAutomationTools(enabledDependencies);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].namespace, 'automation');
  assert.equal(tools[0].name, 'create');

  const created = await createAutomationFromTool({
    title: 'Check later',
    prompt: 'Check build status',
    scheduleType: 'once',
    startAt: '2026-05-27T01:00:00.000Z',
    maxRetries: 2,
  }, {
    conversationId: 'task-1',
    projectId: 'project-1',
    sourceUserMessageId: 'user-1',
    sourceAssistantMessageId: 'assistant-1',
    sourceModel: 'redou-model',
  }, enabledDependencies);

  assert.equal(created.automation.createdBy, 'model');
  assert.equal(created.automation.createdFrom, 'tool_call');
  assert.equal(created.automation.conversationId, 'task-1');
  assert.equal(created.automation.projectId, 'project-1');
  assert.equal(created.automation.sourceUserMessageId, 'user-1');
  assert.equal(created.automation.sourceAssistantMessageId, 'assistant-1');
  assert.equal(created.automation.sourceModel, 'redou-model');
  assert.equal(created.automation.replyTarget, 'bound_conversation');
  assert.equal(created.automation.exposeResultInConversation, true);
  assert.equal(created.automation.maxRetries, 2);
});

test('mcp server normalization and command test are deterministic', async () => {
  assert.deepEqual(normalizeServer({ name: 'fs', command: 'node', args: '--version' }).args, ['--version']);
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-mcp-'));
  const serverPath = path.join(dataRoot, 'fake-mcp-server.cjs');
  fs.writeFileSync(serverPath, `
let buffer = '';
function send(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
}
function handle(message) {
  if (!message || !message.id) return;
  if (message.method === 'initialize') {
    send({ id: message.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'fake-mcp' }, capabilities: { tools: {} } } });
    return;
  }
  if (message.method === 'tools/list') {
    send({ id: message.id, result: { tools: [{ name: 'ping', description: 'Ping tool', inputSchema: { type: 'object' } }] } });
    return;
  }
  send({ id: message.id, error: { code: -32601, message: 'method not found' } });
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let index = buffer.indexOf('\\n');
  while (index !== -1) {
    const line = buffer.slice(0, index).trim();
    buffer = buffer.slice(index + 1);
    if (line) handle(JSON.parse(line));
    index = buffer.indexOf('\\n');
  }
});
`, 'utf8');
  const installed = await installMcpServer({ name: 'shell', command: process.execPath, args: [serverPath] }, { dataRoot });
  assert.equal(installed.server.name, 'shell');
  const tested = await testMcpServer({ name: 'shell' }, { dataRoot });
  assert.equal(tested.lastTest.ok, true);
  assert.equal(tested.lastTest.toolCount, 1);
});

test('skills frontmatter and terminal shell invocation stay simple', () => {
  assert.deepEqual(parseFrontmatter('---\nname: demo\ndescription: Hello\n---\nBody'), {
    name: 'demo',
    description: 'Hello',
  });
  assert.ok(shellInvocation('echo hi').args.includes('echo hi'));
  assert.equal(normalizeAutomation({ prompt: 'x', status: 'paused' }).status, 'PAUSED');
});

test('extensions IPC exposes MiniMax plugin channels through the existing extension module', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-minimax-ipc-'));
  const handlers = new Map();
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
  };

  const channels = registerExtensionsIpc(ipcMain, {
    workspaceRoot: dataRoot,
    dataRoot,
    redouCodexHome: path.join(dataRoot, 'redou-codex'),
  });

  assert.ok(channels.includes('minimax:getConfig'));
  assert.ok(channels.includes('minimax:saveConfig'));
  assert.ok(channels.includes('minimax:textToAudio'));
  const result = await handlers.get('minimax:getConfig')({}, {});
  assert.equal(result.ok, true);
  assert.equal(result.data.provider, 'minimax');
  assert.equal(result.data.driver, 'direct_http');
});
