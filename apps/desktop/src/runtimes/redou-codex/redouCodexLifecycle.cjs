'use strict';

const { createRedouCodexAppServerClient, createClientError } = require('./redouCodexAppServerClient.cjs');
const {
  buildInitializeRequest,
  buildThreadStartRequest,
  buildThreadResumeRequest,
  buildTurnStartRequest,
  buildTurnSteerRequest,
  buildTurnInterruptRequest,
  buildApprovalResponseRequest,
} = require('./redouCodexProtocol.cjs');
const { mapRedouCodexNotificationToAgentEvents } = require('./redouCodexEventMapper.cjs');
const { mapRedouPermissionToRedouCodexApproval } = require('./redouCodexPermissionMapper.cjs');
const {
  createRedouCodexSessionStore,
  redouCodexActiveTurnIdFrom,
  redouCodexThreadIdFrom,
} = require('./redouCodexSessionStore.cjs');
const { checkRedouCodexAvailability } = require('./redouCodexAvailability.cjs');
const {
  REDOU_CODEX_RUNTIME_ID,
  buildRedouCodexClientOptions,
} = require('./redouCodexRuntimeConfig.cjs');
const { assertRedouModelConfig, readRedouModelConfig } = require('./redouCodexModelConfig.cjs');

function extractThreadId(response) {
  return response && response.thread ? response.thread.id : null;
}

function extractTurnId(response) {
  return response && response.turn ? response.turn.id : null;
}

function contextKey(params = {}) {
  return params.threadId || params.conversationId || (params.thread && params.thread.id) || null;
}

function createRedouCodexLifecycle(dependencies = {}) {
  const clientOptions = buildRedouCodexClientOptions(dependencies.clientOptions || dependencies.redouCodex || {});
  const client = dependencies.client || createRedouCodexAppServerClient(clientOptions);
  const sessionStore = dependencies.sessionStore || createRedouCodexSessionStore(dependencies);
  const availabilityChecker = dependencies.checkAvailability || checkRedouCodexAvailability;
  const threadContexts = new Map();
  const pendingServerRequests = new Map();
  let subscriptionsReady = false;
  let initializeResult = null;
  let activeEventSink = dependencies.eventSink || dependencies.ingestRuntimeEvent || null;

  async function sinkEvents(events) {
    const sink = activeEventSink || dependencies.eventSink || dependencies.ingestRuntimeEvent;
    if (!sink) return events;
    const list = Array.isArray(events) ? events : [events];
    const saved = [];
    for (const event of list) {
      if (typeof sink === 'function') saved.push(await sink(event));
      else if (typeof sink.ingest === 'function') saved.push(await sink.ingest(event));
      else if (typeof sink.ingestRuntimeEvent === 'function') saved.push(await sink.ingestRuntimeEvent(event));
    }
    return saved;
  }

  function contextFor(notification, fallback = {}) {
    const params = notification.params || {};
    const key = contextKey(params);
    return {
      ...(key && threadContexts.get(key) ? threadContexts.get(key) : {}),
      ...fallback,
      threadId: key || fallback.threadId || null,
      turnId: params.turnId || (params.turn && params.turn.id) || fallback.turnId || null,
    };
  }

  function registerClientSubscriptions() {
    if (subscriptionsReady) return;
    subscriptionsReady = true;

    client.onNotification((notification) => {
      const events = mapRedouCodexNotificationToAgentEvents(notification, contextFor(notification));
      sinkEvents(events).catch(() => {});
    });

    client.onServerRequest((request) => {
      pendingServerRequests.set(request.id, request);
      const events = mapRedouCodexNotificationToAgentEvents(request, contextFor(request));
      sinkEvents(events).catch(() => {});
    });
  }

  async function ensureInitialized(input = {}) {
    registerClientSubscriptions();
    if (client.isInitialized && client.isInitialized()) return initializeResult;
    const init = buildInitializeRequest({
      clientInfo: input.clientInfo || (input.settings && input.settings.clientInfo),
      experimentalApi: Boolean(input.experimentalApi || (input.settings && input.settings.experimentalApi)),
      optOutNotificationMethods: input.optOutNotificationMethods,
    });
    initializeResult = await client.initialize(init.params);
    return initializeResult;
  }

  async function ensureAvailable(input = {}) {
    if (input.availability && input.availability.available) return input.availability;
    if (dependencies.skipAvailabilityCheck) return { available: true, status: 'skipped' };
    const availability = await availabilityChecker(clientOptions);
    if (!availability || !availability.available) {
      throw createClientError('redou-codex runtime is unavailable.', {
        code: 'REDOU_CODEX_UNAVAILABLE',
        availability,
      });
    }
    return availability;
  }

  function hasThreadModelSelection(input = {}) {
    return Boolean(input.model && input.modelProvider);
  }

  function assertModelConfigForInput(input = {}) {
    if (hasThreadModelSelection(input)) return;
    assertRedouModelConfig(dependencies.modelConfig || clientOptions.modelConfig || readRedouModelConfig(clientOptions.env));
  }

  async function emitModelCompatibility(input = {}, task = {}) {
    const capability = input.modelCapability || input.modelConfig?.modelCapability || null;
    if (!capability || !capability.degraded) return null;
    return sinkEvents({
      taskId: task.id || input.taskId || null,
      projectId: task.projectId || input.projectId || null,
      runtime: REDOU_CODEX_RUNTIME_ID,
      type: 'model_degraded',
      level: 'warn',
      timestamp: new Date().toISOString(),
      title: 'Model compatibility degraded',
      message: capability.warnings && capability.warnings.length
        ? capability.warnings[0]
        : 'Selected model is running with conservative redou-codex compatibility defaults.',
      payload: {
        degraded: true,
        capability,
      },
      metadata: {
        model: capability.model || input.model || null,
        modelProvider: input.modelProvider || capability.providerId || null,
      },
    });
  }

  async function startOrResumeThread(input, task) {
    const threadId = redouCodexThreadIdFrom(task) || redouCodexThreadIdFrom(input);
    const request = threadId
      ? buildThreadResumeRequest({ ...input, task, threadId })
      : buildThreadStartRequest({ ...input, task });
    const response = await client.request(request.method, request.params);
    const nextThreadId = extractThreadId(response) || threadId;
    threadContexts.set(nextThreadId, {
      taskId: task.id,
      projectId: task.projectId,
      threadId: nextThreadId,
    });
    await sessionStore.saveTaskSession(task.id, {
      redouCodexThreadId: nextThreadId,
      redouCodexActiveTurnId: redouCodexActiveTurnIdFrom(task),
      metadata: { thread: response.thread || null },
    });
    task.redouCodexThreadId = nextThreadId;
    return { response, threadId: nextThreadId, resumed: Boolean(threadId) };
  }

  async function startRedouCodexTask(input = {}) {
    activeEventSink = input.eventSink || activeEventSink;
    const task = input.task || {};
    if (!task.id) throw new Error('task.id is required to start a redou-codex task');
    const availability = await ensureAvailable(input);
    await ensureInitialized(input);
    assertModelConfigForInput(input);
    await emitModelCompatibility(input, task);

    const thread = await startOrResumeThread(input, task);
    const turnRequest = buildTurnStartRequest({ ...input, task, threadId: thread.threadId });
    const turnResponse = await client.request(turnRequest.method, turnRequest.params);
    const turnId = extractTurnId(turnResponse);
    threadContexts.set(thread.threadId, {
      taskId: task.id,
      projectId: task.projectId,
      threadId: thread.threadId,
      turnId,
    });
    await sessionStore.saveTaskSession(task.id, {
      redouCodexThreadId: thread.threadId,
      redouCodexActiveTurnId: turnId,
      status: 'running',
      metadata: { thread: thread.response.thread || null, turn: turnResponse.turn || null },
    });

    return {
      id: `${REDOU_CODEX_RUNTIME_ID}:${task.id}`,
      runtime: REDOU_CODEX_RUNTIME_ID,
      taskId: task.id,
      threadId: thread.threadId,
      activeTurnId: turnId,
      status: 'running',
      availability,
      thread: thread.response.thread || null,
      turn: turnResponse.turn || null,
      resumed: thread.resumed,
    };
  }

  async function resumeRedouCodexTask(input = {}) {
    activeEventSink = input.eventSink || activeEventSink;
    const task = input.task || {};
    const threadId = redouCodexThreadIdFrom(task) || input.threadId || redouCodexThreadIdFrom(input);
    if (!task.id || !threadId) throw new Error('task.id and redouCodexThreadId are required to resume a redou-codex task');
    await ensureAvailable(input);
    await ensureInitialized(input);
    assertModelConfigForInput(input);
    await emitModelCompatibility(input, task);
    const request = buildThreadResumeRequest({ ...input, task, threadId });
    const response = await client.request(request.method, request.params);
    threadContexts.set(threadId, { taskId: task.id, projectId: task.projectId, threadId });
    await sessionStore.saveTaskSession(task.id, {
      redouCodexThreadId: threadId,
      redouCodexActiveTurnId: redouCodexActiveTurnIdFrom(task),
      status: 'resumed',
      metadata: { thread: response.thread || null },
    });
    return { id: `${REDOU_CODEX_RUNTIME_ID}:${task.id}`, runtime: REDOU_CODEX_RUNTIME_ID, taskId: task.id, threadId, status: 'resumed', thread: response.thread || null };
  }

  async function steerRedouCodexTask(input = {}) {
    activeEventSink = input.eventSink || activeEventSink;
    const task = input.task || {};
    await ensureInitialized(input);
    const request = buildTurnSteerRequest(input);
    const response = await client.request(request.method, request.params);
    return { runtime: REDOU_CODEX_RUNTIME_ID, taskId: task.id || null, threadId: request.params.threadId, activeTurnId: response.turnId || request.params.expectedTurnId };
  }

  async function interruptRedouCodexTask(input = {}) {
    activeEventSink = input.eventSink || activeEventSink;
    const task = input.task || {};
    await ensureInitialized(input);
    const request = buildTurnInterruptRequest(input);
    const response = await client.request(request.method, request.params);
    if (task.id) {
      await sessionStore.saveTaskSession(task.id, {
        redouCodexThreadId: request.params.threadId,
        redouCodexActiveTurnId: request.params.turnId,
        status: 'interrupted',
      });
    }
    return { runtime: REDOU_CODEX_RUNTIME_ID, taskId: task.id || null, threadId: request.params.threadId, activeTurnId: request.params.turnId, response };
  }

  async function respondApproval(input = {}) {
    const request = input.request || pendingServerRequests.get(input.requestId || input.id) || {};
    const mapped = mapRedouPermissionToRedouCodexApproval(input.decision || input, request);
    const response = buildApprovalResponseRequest({
      requestId: input.requestId || input.id,
      result: mapped.result,
    });
    client.respondToServerRequest(response.requestId, response.result);
    pendingServerRequests.delete(response.requestId);
    return { ok: true, warnings: mapped.warnings || [], requestId: response.requestId };
  }

  return {
    startTask: startRedouCodexTask,
    startRedouCodexTask,
    resumeTask: resumeRedouCodexTask,
    resumeRedouCodexTask,
    steerTask: steerRedouCodexTask,
    steerRedouCodexTask,
    interruptTask: interruptRedouCodexTask,
    interruptRedouCodexTask,
    respondApproval,
    getPendingServerRequest(id) {
      return pendingServerRequests.get(id) || null;
    },
    async dispose() {
      if (client && typeof client.dispose === 'function') {
        await client.dispose();
      }
    },
  };
}

module.exports = { createRedouCodexLifecycle };
