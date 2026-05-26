const assert = require('node:assert/strict');
const test = require('node:test');

const { buildRuntimeSnapshot } = require('../src/orchestrator/runtimeSnapshotBuilder.cjs');

test('runtime errors are visible in the thread snapshot and logs', () => {
  const snapshot = buildRuntimeSnapshot([
    {
      id: 'event:user-1',
      type: 'user_message',
      level: 'info',
      timestamp: '2026-05-24T05:55:35.525Z',
      message: 'hello',
      payload: { userInput: 'hello', status: 'consumed' },
      metadata: {
        deliveryMode: 'new_turn',
        contextItems: [{ path: '/tmp/notes.txt', name: 'notes.txt', kind: 'file' }],
      },
    },
    {
      id: 'event:error-1',
      type: 'runtime_error',
      level: 'error',
      timestamp: '2026-05-24T05:55:35.606Z',
      title: 'Runtime unavailable',
      message: 'redou-codex app-server failed to start.',
      payload: { reason: { code: 'REDOU_CODEX_START_FAILED' } },
    },
  ]);

  assert.deepEqual(snapshot.messages.map((message) => ({
    role: message.role,
    body: message.body,
    status: message.status || null,
  })), [
    { role: 'user', body: 'hello', status: 'consumed' },
    { role: 'system', body: 'redou-codex app-server failed to start.', status: 'error' },
  ]);
  assert.deepEqual(snapshot.messages[0].contextItems, [{ path: '/tmp/notes.txt', name: 'notes.txt', kind: 'file' }]);
  assert.equal(snapshot.logs[0].level, 'error');
  assert.equal(snapshot.runtimeStatus.lastError.message, 'redou-codex app-server failed to start.');
});

test('runtime snapshot preserves zero-valued approval request ids and clears resolved approvals', () => {
  const pending = buildRuntimeSnapshot([
    {
      id: 'event:approval',
      taskId: 'task-1',
      type: 'approval_required',
      timestamp: '2026-05-24T05:55:35.525Z',
      title: 'Approval required',
      message: 'Allow MCP tool?',
      payload: { requestId: 0, kind: 'mcp_elicitation' },
      metadata: { requestId: 0 },
    },
  ]);

  assert.equal(pending.approvalRequests.length, 1);
  assert.equal(pending.approvalRequests[0].id, '0');
  assert.equal(pending.approvalRequests[0].taskId, 'task-1');
  assert.equal(pending.approvalRequests[0].status, 'pending');
  assert.equal(pending.runtimeStatus.turnStatus, 'waiting_approval');

  const resolved = buildRuntimeSnapshot([
    {
      id: 'event:approval',
      type: 'approval_required',
      timestamp: '2026-05-24T05:55:35.525Z',
      title: 'Approval required',
      message: 'Allow MCP tool?',
      payload: { requestId: 0, kind: 'mcp_elicitation' },
      metadata: { requestId: 0 },
    },
    {
      id: 'event:resolved',
      type: 'approval_resolved',
      timestamp: '2026-05-24T05:55:36.525Z',
      payload: { requestId: 0 },
      metadata: { requestId: 0 },
    },
  ]);

  assert.deepEqual(resolved.approvalRequests, []);
});

test('runtime snapshot backfills legacy raw MCP elicitation logs as expired approvals', () => {
  const snapshot = buildRuntimeSnapshot([
    {
      id: 'event:raw-approval',
      type: 'raw_log',
      timestamp: '2026-05-24T05:55:35.525Z',
      title: 'mcpServer/elicitation/request',
      message: '',
      payload: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        serverName: 'MiniMax',
        mode: 'form',
        message: 'Allow MCP tool?',
      },
      metadata: {
        redouCodexMethod: 'mcpServer/elicitation/request',
        raw: JSON.stringify({
          id: 0,
          method: 'mcpServer/elicitation/request',
          params: {
            threadId: 'thread-1',
            turnId: 'turn-1',
            serverName: 'MiniMax',
            mode: 'form',
            message: 'Allow MCP tool?',
          },
        }),
      },
    },
  ]);

  assert.equal(snapshot.approvalRequests.length, 1);
  assert.equal(snapshot.approvalRequests[0].id, '0');
  assert.equal(snapshot.approvalRequests[0].status, 'expired');
  assert.equal(snapshot.approvalRequests[0].description, 'Allow MCP tool?');
  assert.equal(snapshot.runtimeStatus.turnStatus, 'unknown');
});

test('runtime snapshot does not keep stale legacy MCP approvals running', () => {
  const snapshot = buildRuntimeSnapshot([
    {
      id: 'event:turn-started',
      type: 'turn_update',
      timestamp: '2026-05-26T03:28:20.431Z',
      message: 'inProgress',
      payload: { turn: { id: 'turn-1', status: 'inProgress' } },
      metadata: { redouCodexMethod: 'turn/started', turnId: 'turn-1' },
    },
    {
      id: 'event:mcp-started',
      type: 'item_update',
      timestamp: '2026-05-26T03:28:55.190Z',
      message: 'mcpToolCall',
      payload: {
        lifecycle: 'started',
        item: { id: 'call-1', type: 'mcpToolCall', server: 'MiniMax', tool: 'understand_image', status: 'inProgress' },
      },
      metadata: { turnId: 'turn-1', itemId: 'call-1', itemKind: 'mcpToolCall' },
    },
    {
      id: 'event:thread-waiting',
      type: 'thread_update',
      timestamp: '2026-05-26T03:28:55.191Z',
      message: { type: 'active', activeFlags: ['waitingOnApproval'] },
      payload: { status: { type: 'active', activeFlags: ['waitingOnApproval'] }, threadId: 'thread-1' },
      metadata: { redouCodexMethod: 'thread/status/changed', threadId: 'thread-1' },
    },
    {
      id: 'event:raw-approval',
      type: 'raw_log',
      timestamp: '2026-05-26T03:28:55.191Z',
      title: 'mcpServer/elicitation/request',
      message: 'Allow the MiniMax MCP server to run tool "understand_image"?',
      payload: { threadId: 'thread-1', turnId: 'turn-1', serverName: 'MiniMax', message: 'Allow MCP tool?' },
      metadata: {
        redouCodexMethod: 'mcpServer/elicitation/request',
        threadId: 'thread-1',
        turnId: 'turn-1',
        raw: JSON.stringify({
          id: 0,
          method: 'mcpServer/elicitation/request',
          params: { threadId: 'thread-1', turnId: 'turn-1', serverName: 'MiniMax', message: 'Allow MCP tool?' },
        }),
      },
    },
  ]);

  assert.equal(snapshot.approvalRequests.length, 1);
  assert.equal(snapshot.approvalRequests[0].status, 'expired');
  assert.equal(snapshot.runtimeStatus.turnStatus, 'interrupted');
  assert.equal(snapshot.runtimeStatus.stopReason.code, 'approval_request_expired');
  assert.deepEqual(snapshot.progressSteps, [
    { id: 'call-1', label: 'mcpToolCall', status: 'cancelled' },
  ]);
  assert.equal(snapshot.runtimeStatus.activeItem.status, 'cancelled');
});

test('assistant lifecycle placeholders do not create empty Redou messages', () => {
  const snapshot = buildRuntimeSnapshot([
    {
      id: 'event:user-1',
      type: 'user_message',
      level: 'info',
      timestamp: '2026-05-24T11:41:14.995Z',
      message: '你好',
      payload: { userInput: '你好', status: 'consumed' },
      metadata: { deliveryMode: 'new_turn' },
    },
    {
      id: 'event:item-agent-started',
      type: 'item_update',
      timestamp: '2026-05-24T11:41:15.100Z',
      message: 'agentMessage',
      payload: {
        lifecycle: 'started',
        item: { id: 'msg-1', type: 'agentMessage' },
      },
      metadata: { itemId: 'msg-1', itemKind: 'agentMessage', turnId: 'turn-1' },
    },
    {
      id: 'event:empty-message',
      type: 'message_completed',
      timestamp: '2026-05-24T11:41:15.101Z',
      message: '',
      payload: { item: { id: 'msg-1', type: 'agentMessage', text: '' } },
      metadata: { itemId: 'msg-1', turnId: 'turn-1' },
    },
    {
      id: 'event:full-message',
      type: 'message_completed',
      timestamp: '2026-05-24T11:41:15.500Z',
      message: '你好，我在。',
      payload: { item: { id: 'msg-1', type: 'agentMessage', text: '你好，我在。' } },
      metadata: { itemId: 'msg-1', turnId: 'turn-1' },
    },
  ]);

  assert.deepEqual(snapshot.messages.map((message) => ({
    role: message.role,
    body: message.body,
  })), [
    { role: 'user', body: '你好' },
    { role: 'assistant', body: '你好，我在。' },
  ]);
  assert.deepEqual(snapshot.progressSteps, []);
  assert.deepEqual(snapshot.todoProjectionEntries, []);
});

test('assistant messages expose real processed duration from turn timing', () => {
  const snapshot = buildRuntimeSnapshot([
    {
      id: 'event:turn-started',
      type: 'turn_update',
      timestamp: '2026-05-24T12:00:00.000Z',
      message: 'running',
      payload: { turn: { id: 'turn-duration', status: 'running' } },
      metadata: { redouCodexMethod: 'turn/started', turnId: 'turn-duration' },
    },
    {
      id: 'event:answer',
      type: 'message_completed',
      timestamp: '2026-05-24T12:00:38.000Z',
      message: 'Done.',
      payload: { item: { id: 'msg-duration', type: 'agentMessage', text: 'Done.' } },
      metadata: { itemId: 'msg-duration', turnId: 'turn-duration' },
    },
  ]);

  assert.equal(snapshot.messages.length, 1);
  assert.equal(snapshot.messages[0].processedDurationMs, 38000);
  assert.equal(snapshot.messages[0].processedStatus, 'completed');
});

test('progress projection ignores chat lifecycle items and dedupes real work items', () => {
  const snapshot = buildRuntimeSnapshot([
    {
      id: 'event:turn-started',
      type: 'turn_update',
      timestamp: '2026-05-24T11:42:00.000Z',
      message: 'running',
      payload: { turn: { id: 'turn-2', status: 'running' } },
      metadata: { turnId: 'turn-2', redouCodexMethod: 'turn/started' },
    },
    {
      id: 'event:user-item',
      type: 'item_update',
      timestamp: '2026-05-24T11:42:01.000Z',
      message: 'userMessage',
      payload: { lifecycle: 'completed', item: { id: 'user-item', type: 'userMessage' } },
      metadata: { turnId: 'turn-2', itemId: 'user-item', itemKind: 'userMessage' },
    },
    {
      id: 'event:cmd-started',
      type: 'item_update',
      timestamp: '2026-05-24T11:42:02.000Z',
      message: 'commandExecution',
      payload: { lifecycle: 'started', item: { id: 'cmd-1', type: 'commandExecution', command: 'npm test' } },
      metadata: { turnId: 'turn-2', itemId: 'cmd-1', itemKind: 'commandExecution' },
    },
    {
      id: 'event:cmd-completed',
      type: 'item_update',
      timestamp: '2026-05-24T11:42:03.000Z',
      message: 'commandExecution',
      payload: { lifecycle: 'completed', item: { id: 'cmd-1', type: 'commandExecution', command: 'npm test' } },
      metadata: { turnId: 'turn-2', itemId: 'cmd-1', itemKind: 'commandExecution' },
    },
  ]);

  assert.deepEqual(snapshot.progressSteps, [
    { id: 'cmd-1', label: 'npm test', status: 'completed' },
  ]);
  assert.deepEqual(snapshot.todoProjectionEntries, []);
});

test('completed turns close progress items that never emitted item completed', () => {
  const snapshot = buildRuntimeSnapshot([
    {
      id: 'event:turn-started',
      type: 'turn_update',
      timestamp: '2026-05-24T11:42:00.000Z',
      message: 'running',
      payload: { turn: { id: 'turn-image', status: 'running' } },
      metadata: { redouCodexMethod: 'turn/started', turnId: 'turn-image' },
    },
    {
      id: 'event:image-started',
      type: 'item_update',
      timestamp: '2026-05-24T11:42:01.000Z',
      message: 'imageView',
      payload: { lifecycle: 'started', item: { id: 'image-1', type: 'imageView' } },
      metadata: { turnId: 'turn-image', itemId: 'image-1', itemKind: 'imageView' },
    },
    {
      id: 'event:turn-completed',
      type: 'turn_update',
      timestamp: '2026-05-24T11:42:02.000Z',
      message: 'completed',
      payload: { turn: { id: 'turn-image', status: 'completed' } },
      metadata: { redouCodexMethod: 'turn/completed', turnId: 'turn-image' },
    },
  ]);

  assert.equal(snapshot.runtimeStatus.turnStatus, 'completed');
  assert.deepEqual(snapshot.progressSteps, [
    { id: 'image-1', label: 'imageView', status: 'completed' },
  ]);
  assert.equal(snapshot.runtimeStatus.activeItem.status, 'completed');
});

test('command updates preserve command output for the terminal panel', () => {
  const snapshot = buildRuntimeSnapshot([
    {
      id: 'event:cmd-output',
      type: 'command_update',
      timestamp: '2026-05-24T11:42:04.000Z',
      message: 'tests passed',
      payload: {
        delta: 'tests passed',
        item: { id: 'cmd-1', type: 'commandExecution', command: 'npm test', status: 'running' },
      },
      metadata: { turnId: 'turn-2', itemId: 'cmd-1', itemKind: 'commandExecution' },
    },
  ]);

  assert.equal(snapshot.logs.length, 1);
  assert.equal(snapshot.logs[0].kind, 'command');
  assert.equal(snapshot.logs[0].command, 'npm test');
  assert.equal(snapshot.logs[0].output, 'tests passed');
  assert.equal(snapshot.logs[0].lifecycle, 'running');
});

test('automation-dispatched turns are marked on both user and assistant messages', () => {
  const automation = {
    id: 'automation-1',
    runId: 'run-1',
    title: 'Morning status',
    scheduleType: 'daily',
    triggeredAt: '2026-05-26T01:00:00.000Z',
    createdBy: 'model',
  };
  const snapshot = buildRuntimeSnapshot([
    {
      id: 'event:auto-user',
      type: 'user_message',
      timestamp: '2026-05-26T01:00:00.000Z',
      message: '[Automation: Morning status]\n\nCheck status',
      payload: { id: 'automation-message:run-1', userInput: 'Check status', status: 'consumed' },
      metadata: { deliveryMode: 'automation', automation },
    },
    {
      id: 'event:auto-dispatched',
      type: 'automation_run_dispatched',
      timestamp: '2026-05-26T01:00:01.000Z',
      message: 'Morning status',
      payload: { turnId: 'turn-auto-1' },
      metadata: { turnId: 'turn-auto-1', automation },
    },
    {
      id: 'event:auto-answer',
      type: 'message_completed',
      timestamp: '2026-05-26T01:00:02.000Z',
      message: 'Status is green.',
      payload: { item: { id: 'msg-auto-1', type: 'agentMessage', text: 'Status is green.' } },
      metadata: { itemId: 'msg-auto-1', turnId: 'turn-auto-1' },
    },
  ]);

  assert.equal(snapshot.messages[0].source, 'automation');
  assert.equal(snapshot.messages[0].automation.title, 'Morning status');
  assert.equal(snapshot.messages[1].role, 'assistant');
  assert.equal(snapshot.messages[1].source, 'automation');
  assert.equal(snapshot.messages[1].automation.id, 'automation-1');
  assert.equal(snapshot.logs.some((log) => log.id === 'event:auto-dispatched'), true);
});

test('command updates are folded into expandable thread summaries', () => {
  const snapshot = buildRuntimeSnapshot([
    {
      id: 'event:assistant-intro',
      type: 'message_completed',
      timestamp: '2026-05-24T11:42:01.000Z',
      message: 'I will inspect the project.',
      payload: { item: { id: 'msg-1', type: 'agentMessage', text: 'I will inspect the project.' } },
      metadata: { itemId: 'msg-1', turnId: 'turn-2' },
    },
    {
      id: 'event:cmd-started',
      type: 'command_update',
      timestamp: '2026-05-24T11:42:02.000Z',
      message: 'rg --files',
      payload: {
        lifecycle: 'started',
        item: { id: 'cmd-1', type: 'commandExecution', command: 'rg --files', status: 'running' },
      },
      metadata: { turnId: 'turn-2', itemId: 'cmd-1', itemKind: 'commandExecution' },
    },
    {
      id: 'event:cmd-output',
      type: 'command_update',
      timestamp: '2026-05-24T11:42:03.000Z',
      message: 'apps/desktop/src/main.cjs',
      payload: {
        delta: 'apps/desktop/src/main.cjs\n',
        item: { id: 'cmd-1', type: 'commandExecution', command: 'rg --files', status: 'running' },
      },
      metadata: { turnId: 'turn-2', itemId: 'cmd-1', itemKind: 'commandExecution' },
    },
    {
      id: 'event:cmd-completed',
      type: 'command_update',
      timestamp: '2026-05-24T11:42:04.000Z',
      message: 'rg --files',
      payload: {
        lifecycle: 'completed',
        item: { id: 'cmd-1', type: 'commandExecution', command: 'rg --files', status: 'completed' },
      },
      metadata: { turnId: 'turn-2', itemId: 'cmd-1', itemKind: 'commandExecution' },
    },
    {
      id: 'event:cmd-2',
      type: 'command_update',
      timestamp: '2026-05-24T11:42:05.000Z',
      message: 'git status --short',
      payload: {
        lifecycle: 'completed',
        item: { id: 'cmd-2', type: 'commandExecution', command: 'git status --short', status: 'completed' },
      },
      metadata: { turnId: 'turn-2', itemId: 'cmd-2', itemKind: 'commandExecution' },
    },
    {
      id: 'event:assistant-result',
      type: 'message_completed',
      timestamp: '2026-05-24T11:42:06.000Z',
      message: 'Found the renderer entry points.',
      payload: { item: { id: 'msg-2', type: 'agentMessage', text: 'Found the renderer entry points.' } },
      metadata: { itemId: 'msg-2', turnId: 'turn-2' },
    },
  ]);

  assert.equal(snapshot.messages.length, 3);
  assert.equal(snapshot.messages[1].kind, 'command_summary');
  assert.equal(snapshot.messages[1].commandSummary.count, 2);
  assert.deepEqual(snapshot.messages[1].commandSummary.commands.map((command) => command.command), [
    'rg --files',
    'git status --short',
  ]);
  assert.equal(snapshot.messages[1].commandSummary.commands[0].output, 'apps/desktop/src/main.cjs\n');
  assert.equal(snapshot.messages[1].commandSummary.commands[0].lifecycle, 'completed');
});

test('failed turns surface their model/provider error in the thread snapshot', () => {
  const snapshot = buildRuntimeSnapshot([
    {
      id: 'event:user-1',
      type: 'user_message',
      level: 'info',
      timestamp: '2026-05-24T11:43:57.448Z',
      message: '你是什么大模型？',
      payload: { userInput: '你是什么大模型？', status: 'consumed' },
      metadata: { deliveryMode: 'new_turn' },
    },
    {
      id: 'event:turn-failed',
      type: 'turn_update',
      level: 'info',
      timestamp: '2026-05-24T11:43:57.889Z',
      title: 'Turn update',
      message: 'failed',
      payload: {
        turn: {
          id: 'turn-failed',
          status: 'failed',
          error: {
            message: '{"type":"error","error":{"type":"bad_request_error","message":"invalid params, unknown model \'qwen/qwen3.6-27b-fp8\' (2013)"}}',
          },
        },
      },
      metadata: { redouCodexMethod: 'turn/completed', turnId: 'turn-failed' },
    },
  ]);

  assert.equal(snapshot.messages.at(-1).role, 'system');
  assert.equal(snapshot.messages.at(-1).status, 'error');
  assert.match(snapshot.messages.at(-1).body, /unknown model 'qwen\/qwen3\.6-27b-fp8'/);
  assert.equal(snapshot.logs.at(-1).level, 'error');
  assert.match(snapshot.runtimeStatus.lastError.message, /unknown model/);
});

test('failed turn messages remain visible after the next turn starts', () => {
  const snapshot = buildRuntimeSnapshot([
    {
      id: 'event:user-1',
      type: 'user_message',
      timestamp: '2026-05-24T12:02:20.000Z',
      message: 'first',
      payload: { userInput: 'first', status: 'consumed' },
      metadata: { deliveryMode: 'new_turn' },
    },
    {
      id: 'event:turn-1-failed',
      type: 'turn_update',
      timestamp: '2026-05-24T12:02:21.000Z',
      message: 'failed',
      payload: { turn: { id: 'turn-1', status: 'failed', error: { message: 'upstream unauthorized' } } },
      metadata: { redouCodexMethod: 'turn/completed', turnId: 'turn-1' },
    },
    {
      id: 'event:user-2',
      type: 'user_message',
      timestamp: '2026-05-24T12:02:22.000Z',
      message: 'second',
      payload: { userInput: 'second', status: 'consumed' },
      metadata: { deliveryMode: 'new_turn' },
    },
    {
      id: 'event:turn-2-running',
      type: 'turn_update',
      timestamp: '2026-05-24T12:02:23.000Z',
      message: 'running',
      payload: { turn: { id: 'turn-2', status: 'running' } },
      metadata: { redouCodexMethod: 'turn/started', turnId: 'turn-2' },
    },
  ]);

  assert.deepEqual(snapshot.messages.map((message) => ({
    role: message.role,
    body: message.body,
    status: message.status || null,
  })), [
    { role: 'user', body: 'first', status: 'consumed' },
    { role: 'system', body: 'Turn failed: upstream unauthorized', status: 'error' },
    { role: 'user', body: 'second', status: 'consumed' },
  ]);
  assert.equal(snapshot.runtimeStatus.turnStatus, 'running');
  assert.equal(snapshot.logs.at(-1).message, 'Turn failed: upstream unauthorized');
});

test('queued user messages update in place as they start', () => {
  const snapshot = buildRuntimeSnapshot([
    {
      id: 'event:queued-1:pending',
      type: 'user_message',
      timestamp: '2026-05-24T12:10:00.000Z',
      message: 'next thing',
      payload: { id: 'queued-1', userInput: 'next thing', status: 'pending', queuedTurnId: 'queued-1' },
      metadata: { deliveryMode: 'queue', queuedTurnId: 'queued-1', queueId: 'queued-1' },
    },
    {
      id: 'event:queue-started',
      type: 'queue_update',
      timestamp: '2026-05-24T12:10:01.000Z',
      message: 'Queued message started.',
      payload: { queueId: 'queued-1' },
      metadata: { queueId: 'queued-1', queueState: 'started' },
    },
    {
      id: 'event:queued-1:consumed',
      type: 'user_message',
      timestamp: '2026-05-24T12:10:02.000Z',
      message: 'next thing',
      payload: { id: 'queued-1', userInput: 'next thing', status: 'consumed', queuedTurnId: 'queued-1' },
      metadata: { deliveryMode: 'queue', queuedTurnId: 'queued-1', queueId: 'queued-1' },
    },
  ]);

  assert.deepEqual(snapshot.messages, [
    {
      id: 'queued-1',
      role: 'user',
      body: 'next thing',
      timestamp: '2026-05-24T12:10:02.000Z',
      deliveryMode: 'queue',
      status: 'consumed',
      queueId: 'queued-1',
      queueState: null,
      sourceEventId: 'event:queued-1:consumed',
      turnId: null,
    },
  ]);
});

test('deleted queued user messages are hidden from the thread', () => {
  const snapshot = buildRuntimeSnapshot([
    {
      id: 'event:queued-2:pending',
      type: 'user_message',
      timestamp: '2026-05-24T12:11:00.000Z',
      message: 'not anymore',
      payload: { id: 'queued-2', userInput: 'not anymore', status: 'pending', queuedTurnId: 'queued-2' },
      metadata: { deliveryMode: 'queue', queuedTurnId: 'queued-2', queueId: 'queued-2' },
    },
    {
      id: 'event:queue-deleted',
      type: 'queue_update',
      timestamp: '2026-05-24T12:11:01.000Z',
      message: 'Queued message deleted.',
      payload: { queueId: 'queued-2' },
      metadata: { queueId: 'queued-2', queueState: 'deleted' },
    },
  ]);

  assert.deepEqual(snapshot.messages, []);
  assert.equal(snapshot.logs.at(-1).message, 'Queued message deleted.');
});

test('runtime snapshot marks promised follow-up without tools as incomplete', () => {
  const snapshot = buildRuntimeSnapshot([
    {
      id: 'event:assistant-final',
      type: 'message_completed',
      timestamp: '2026-05-24T05:29:47.000Z',
      message: '服务器安装了 Synology Drive Client 8.0.3，正在同步。我来查看当前的同步配置。',
      payload: {
        item: {
          id: 'msg-1',
          type: 'agentMessage',
          text: '服务器安装了 Synology Drive Client 8.0.3，正在同步。我来查看当前的同步配置。',
        },
      },
      metadata: { itemId: 'msg-1', turnId: 'turn-1' },
    },
    {
      id: 'event:turn-completed',
      type: 'turn_update',
      timestamp: '2026-05-24T05:29:48.000Z',
      message: 'completed',
      payload: { turn: { id: 'turn-1', status: 'completed' } },
      metadata: { redouCodexMethod: 'turn/completed', turnId: 'turn-1' },
    },
  ]);

  assert.equal(snapshot.runtimeStatus.turnStatus, 'incomplete');
  assert.equal(snapshot.runtimeStatus.needsAttention, true);
  assert.equal(snapshot.runtimeStatus.stopReason.code, 'assistant_promised_followup_without_tool_call');
  assert.equal(snapshot.runtimeStatus.continuation.recommended, true);
});
