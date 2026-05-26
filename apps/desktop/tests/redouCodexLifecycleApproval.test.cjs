const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createRedouCodexLifecycle } = require('../src/runtimes/redou-codex/index.cjs');
const { listAutomations } = require('../src/ipc/automationIpc.cjs');

test('redou-codex approval response rejects stale approval ids instead of silently writing them', async () => {
  const sent = [];
  const lifecycle = createRedouCodexLifecycle({
    client: {
      respondToServerRequest(id, result) {
        sent.push({ id, result });
      },
    },
  });

  await assert.rejects(
    () => lifecycle.respondApproval({ requestId: 0, taskId: 'task-1', decision: 'approve' }),
    (error) => {
      assert.equal(error.code, 'APPROVAL_REQUEST_NOT_ACTIVE');
      assert.deepEqual(error.details, { requestId: 0, taskId: 'task-1' });
      return true;
    },
  );
  assert.deepEqual(sent, []);
});

test('redou-codex dynamic automation tool call creates a conversation-bound automation', async () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-lifecycle-automation-'));
  const requests = [];
  const responses = [];
  const events = [];
  let initialized = false;
  let serverRequestHandler = null;
  const lifecycle = createRedouCodexLifecycle({
    dataRoot,
    skipAvailabilityCheck: true,
    appSettingsStore: {
      get: async () => ({ automation: { allowModelCreate: true, exposeToolToModel: true } }),
    },
    sessionStore: {
      saveTaskSession: async () => ({}),
    },
    eventSink: {
      ingestRuntimeEvent: async (event) => {
        events.push(event);
        return event;
      },
    },
    client: {
      isInitialized: () => initialized,
      initialize: async () => {
        initialized = true;
        return {};
      },
      onNotification() {},
      onServerRequest(handler) {
        serverRequestHandler = handler;
      },
      request: async (method, params) => {
        requests.push({ method, params });
        if (method === 'thread/start') return { thread: { id: 'thread-1' } };
        if (method === 'turn/start') return { turn: { id: 'turn-1' } };
        return {};
      },
      respondToServerRequest(id, result) {
        responses.push({ id, result });
      },
    },
  });

  await lifecycle.startTask({
    task: { id: 'task-1', projectId: 'project-1', title: 'Conversation', runtime: 'redou-codex' },
    userMessageId: 'user-1',
    userInput: 'Remind me tomorrow',
    model: 'redou-model',
    modelProvider: 'redou-provider',
  });

  serverRequestHandler({
    id: 42,
    method: 'item/tool/call',
    params: {
      namespace: 'automation',
      tool: 'create',
      threadId: 'thread-1',
      turnId: 'turn-1',
      callId: 'call-1',
      arguments: {
        title: 'Check build',
        prompt: 'Check build status',
        scheduleType: 'once',
        startAt: '2026-05-27T01:00:00.000Z',
      },
    },
  });
  for (let index = 0; index < 20 && responses.length === 0; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.equal(responses.length, 1);
  assert.equal(responses[0].id, 42);
  assert.equal(responses[0].result.success, true);
  assert.equal(events.some((event) => event.type === 'automation_tool_call'), true);
  const { automations } = await listAutomations({}, { dataRoot });
  assert.equal(automations.length, 1);
  assert.equal(automations[0].conversationId, 'task-1');
  assert.equal(automations[0].projectId, 'project-1');
  assert.equal(automations[0].sourceUserMessageId, 'user-1');
  assert.equal(automations[0].sourceAssistantMessageId, 'call-1');
  assert.equal(automations[0].sourceModel, 'redou-model');
  assert.equal(requests.some((request) => request.method === 'thread/start'), true);
});
