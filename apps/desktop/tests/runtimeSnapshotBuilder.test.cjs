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
      metadata: { deliveryMode: 'new_turn' },
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
  assert.equal(snapshot.logs[0].level, 'error');
  assert.equal(snapshot.runtimeStatus.lastError.message, 'redou-codex app-server failed to start.');
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
