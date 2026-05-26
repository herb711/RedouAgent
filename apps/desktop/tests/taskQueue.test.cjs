const assert = require('node:assert/strict');
const test = require('node:test');

const {
  drainNextQueuedTurn,
  enqueueTaskTurn,
  isTerminalTurnEvent,
  updateQueuedTaskTurn,
} = require('../src/orchestrator/taskQueue.cjs');

function createHarness() {
  const tasks = new Map();
  const events = [];
  const messages = [];
  const starts = [];
  const steers = [];
  const task = {
    id: 'task-1',
    projectId: 'project-1',
    title: 'Active task',
    status: 'running',
    runtime: 'redou-codex',
    userInput: 'first request',
    metadata: {},
  };
  tasks.set(task.id, task);

  return {
    task,
    events,
    messages,
    starts,
    steers,
    dependencies: {
      taskStore: {
        async get(id) {
          return tasks.get(id) || null;
        },
        async save(next) {
          tasks.set(next.id, next);
          return next;
        },
      },
      messageStore: {
        async save(message) {
          messages.push(message);
          return message;
        },
      },
      eventSink: {
        async ingestRuntimeEvent(event) {
          events.push(event);
          return event;
        },
      },
      async startRuntimeRun(input) {
        starts.push(input);
        return { status: 'running', taskId: input.taskId };
      },
      async steerRuntimeRun(input) {
        steers.push(input);
        return { status: 'running', taskId: input.taskId };
      },
    },
  };
}

test('enqueueTaskTurn stores pending turns without starting the runtime', async () => {
  const harness = createHarness();

  const response = await enqueueTaskTurn({
    taskId: 'task-1',
    userInput: 'next request',
    modelSelection: { providerId: 'minimax', modelId: 'MiniMax-M2.7' },
    contextPackage: {
      metadata: {
        contextItems: [{ path: '/tmp/notes.txt', name: 'notes.txt', kind: 'file' }],
      },
    },
  }, harness.dependencies);

  assert.equal(response.queued, true);
  assert.equal(response.queueDepth, 1);
  assert.equal(harness.starts.length, 0);
  assert.equal(harness.messages[0].metadata.inputEnvelope.deliveryMode, 'queue');
  assert.deepEqual(harness.messages[0].metadata.contextItems, [{ path: '/tmp/notes.txt', name: 'notes.txt', kind: 'file' }]);
  assert.equal(harness.events.some((event) => event.type === 'user_message' && event.payload.status === 'pending'), true);
  assert.deepEqual(
    harness.events.find((event) => event.type === 'user_message').metadata.contextItems,
    [{ path: '/tmp/notes.txt', name: 'notes.txt', kind: 'file' }],
  );
  const queueUpdate = harness.events.find((event) => event.type === 'queue_update');
  assert.equal(queueUpdate.metadata.queueState, 'queued');
});

test('drainNextQueuedTurn starts the oldest queued turn after completion', async () => {
  const harness = createHarness();
  const queued = await enqueueTaskTurn({
    taskId: 'task-1',
    userInput: 'queued request',
    modelSelection: { providerId: 'minimax', modelId: 'MiniMax-M2.7' },
    reasoningEffort: 'high',
  }, harness.dependencies);

  const response = await drainNextQueuedTurn('task-1', harness.dependencies, { status: 'completed' });

  assert.equal(response.started, true);
  assert.equal(response.queueId, queued.queueId);
  assert.equal(harness.starts.length, 1);
  assert.equal(harness.starts[0].userInput, 'queued request');
  assert.equal(harness.starts[0].deliveryMode, 'queue');
  assert.deepEqual(harness.starts[0].modelSelection, { providerId: 'minimax', modelId: 'MiniMax-M2.7' });
  assert.equal(harness.starts[0].reasoningEffort, 'high');
  assert.equal(harness.messages.at(-1).metadata.inputEnvelope.deliveryMode, 'queue');
  assert.equal(harness.events.some((event) => event.type === 'user_message' && event.message === 'queued request'), true);
});

test('queued automation turns keep automation metadata until they run', async () => {
  const harness = createHarness();
  const automation = {
    id: 'automation-1',
    runId: 'run-1',
    title: 'Morning status',
    triggeredAt: '2026-05-26T01:00:00.000Z',
  };
  await enqueueTaskTurn({
    taskId: 'task-1',
    userInput: 'automation request',
    deliveryMode: 'automation',
    automation,
  }, harness.dependencies);

  const queuedTask = await harness.dependencies.taskStore.get('task-1');
  assert.deepEqual(queuedTask.metadata.queuedTurns[0].automation, automation);
  assert.deepEqual(harness.messages[0].metadata.automation, automation);

  await drainNextQueuedTurn('task-1', harness.dependencies, { status: 'completed' });

  assert.deepEqual(harness.starts[0].automation, automation);
  assert.equal(harness.messages.at(-1).metadata.inputEnvelope.deliveryMode, 'queue');
  assert.deepEqual(harness.messages.at(-1).metadata.automation, automation);
});

test('queued turns can be converted into active-run guidance', async () => {
  const harness = createHarness();
  const queued = await enqueueTaskTurn({
    taskId: 'task-1',
    userInput: 'guide this run',
  }, harness.dependencies);

  const response = await updateQueuedTaskTurn({
    taskId: 'task-1',
    queueId: queued.queueId,
    action: 'guide',
  }, harness.dependencies);

  const task = await harness.dependencies.taskStore.get('task-1');
  assert.equal(response.guided, true);
  assert.equal(response.queueDepth, 0);
  assert.equal(harness.steers.length, 1);
  assert.equal(harness.steers[0].userInput, 'guide this run');
  assert.equal(task.metadata.queueDepth, 0);
  assert.equal(harness.events.some((event) => event.type === 'queue_update' && event.metadata.queueState === 'guided'), true);
  assert.equal(harness.events.some((event) => event.type === 'user_message' && event.metadata.deliveryMode === 'guide' && event.payload.status === 'completed'), true);
});

test('queued guidance starts a new turn when the active run is stale approval-blocked', async () => {
  const harness = createHarness();
  harness.task.redouCodexThreadId = 'thread-1';
  harness.task.redouCodexActiveTurnId = 'turn-1';
  const interrupts = [];
  harness.dependencies.eventStore = {
    async list() {
      return [
        {
          id: 'turn-started',
          type: 'turn_update',
          timestamp: '2026-05-26T03:28:20.431Z',
          message: 'inProgress',
          payload: { turn: { id: 'turn-1', status: 'inProgress' } },
          metadata: { redouCodexMethod: 'turn/started', turnId: 'turn-1' },
        },
        {
          id: 'thread-waiting',
          type: 'thread_update',
          timestamp: '2026-05-26T03:28:55.191Z',
          message: { type: 'active', activeFlags: ['waitingOnApproval'] },
          payload: { status: { type: 'active', activeFlags: ['waitingOnApproval'] }, threadId: 'thread-1' },
          metadata: { redouCodexMethod: 'thread/status/changed', threadId: 'thread-1' },
        },
        {
          id: 'raw-mcp-approval',
          type: 'raw_log',
          timestamp: '2026-05-26T03:28:55.191Z',
          title: 'mcpServer/elicitation/request',
          message: 'Allow MCP tool?',
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
      ];
    },
  };
  harness.dependencies.interruptRuntimeRun = async (input) => {
    interrupts.push(input);
    return { status: 'interrupted', taskId: input.taskId };
  };
  const queued = await enqueueTaskTurn({
    taskId: 'task-1',
    userInput: 'start after stale approval',
  }, harness.dependencies);

  const response = await updateQueuedTaskTurn({
    taskId: 'task-1',
    queueId: queued.queueId,
    action: 'guide',
  }, harness.dependencies);

  const task = await harness.dependencies.taskStore.get('task-1');
  assert.equal(response.started, true);
  assert.equal(response.queueDepth, 0);
  assert.equal(harness.steers.length, 0);
  assert.equal(harness.starts.length, 1);
  assert.equal(harness.starts[0].userInput, 'start after stale approval');
  assert.equal(harness.starts[0].deliveryMode, 'queue');
  assert.equal(interrupts.length, 1);
  assert.equal(interrupts[0].turnId, 'turn-1');
  assert.equal(task.metadata.queueDepth, 0);
  assert.equal(harness.events.some((event) => event.type === 'queue_update' && event.metadata.queueState === 'started'), true);
  assert.equal(harness.events.some((event) => event.type === 'user_message' && event.metadata.deliveryMode === 'queue' && event.payload.status === 'consumed'), true);
});

test('queued turns can be deleted before they start', async () => {
  const harness = createHarness();
  const queued = await enqueueTaskTurn({
    taskId: 'task-1',
    userInput: 'drop this run',
  }, harness.dependencies);

  const response = await updateQueuedTaskTurn({
    taskId: 'task-1',
    queueId: queued.queueId,
    action: 'delete',
  }, harness.dependencies);

  const task = await harness.dependencies.taskStore.get('task-1');
  assert.equal(response.deleted, true);
  assert.equal(response.queueDepth, 0);
  assert.equal(task.metadata.queueDepth, 0);
  assert.equal(harness.events.some((event) => event.type === 'queue_update' && event.metadata.queueState === 'deleted'), true);
  assert.equal(harness.events.some((event) => event.type === 'user_message' && event.payload.status === 'cancelled'), true);
});

test('isTerminalTurnEvent recognizes redou-codex turn completion events', () => {
  assert.equal(isTerminalTurnEvent({
    type: 'turn_update',
    metadata: { redouCodexMethod: 'turn/completed' },
    payload: { turn: { status: 'completed' } },
  }), true);

  assert.equal(isTerminalTurnEvent({
    type: 'turn_update',
    metadata: { redouCodexMethod: 'turn/started' },
    payload: { turn: { status: 'running' } },
  }), false);

  assert.equal(isTerminalTurnEvent({
    type: 'turn_update',
    metadata: { redouCodexMethod: 'turn/completed', redouCodexStopStatus: 'incomplete' },
    payload: { turn: { status: 'completed' } },
  }), false);
});
