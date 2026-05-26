'use strict';

const { createRedouCodexAppServerClient, createClientError } = require('./redouCodexAppServerClient.cjs');
const {
  buildInitializeRequest,
  buildThreadStartRequest,
  buildThreadResumeRequest,
  buildThreadForkRequest,
  buildThreadArchiveRequest,
  buildThreadUnarchiveRequest,
  buildThreadSetNameRequest,
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
const { createAutomationFromTool } = require('../../services/local-service/automationService.cjs');

const DYNAMIC_TOOL_CALL_REQUEST = 'item/tool/call';

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

  function isAutomationToolRequest(request = {}) {
    const params = request.params || {};
    return request.method === DYNAMIC_TOOL_CALL_REQUEST
      && params.namespace === 'automation'
      && params.tool === 'create';
  }

  function dynamicToolResponseText(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (_error) {
      return String(value);
    }
  }

  async function handleAutomationToolRequest(request = {}) {
    const params = request.params || {};
    const context = contextFor(request, {
      threadId: params.threadId || null,
      turnId: params.turnId || null,
    });
    const toolContext = {
      taskId: context.taskId || null,
      conversationId: context.taskId || null,
      projectId: context.projectId || null,
      threadId: params.threadId || context.threadId || null,
      turnId: params.turnId || context.turnId || null,
      callId: params.callId || null,
      sourceMessageId: params.callId || null,
      sourceUserMessageId: context.sourceUserMessageId || null,
      sourceAssistantMessageId: params.callId || null,
      sourceModel: context.sourceModel || null,
    };
    const result = await createAutomationFromTool(params.arguments || {}, toolContext, dependencies);
    const automation = result.automation || {};
    await sinkEvents({
      taskId: toolContext.taskId,
      projectId: toolContext.projectId,
      runtime: REDOU_CODEX_RUNTIME_ID,
      type: 'automation_tool_call',
      level: 'info',
      title: 'Automation created',
      message: automation.title || automation.name || 'Automation created',
      payload: {
        automationId: automation.id,
        title: automation.title || automation.name || null,
        source: 'model_tool_call',
        turnId: toolContext.turnId,
        callId: toolContext.callId,
      },
      metadata: {
        automationId: automation.id || null,
        turnId: toolContext.turnId,
        threadId: toolContext.threadId,
        callId: toolContext.callId,
      },
    });
    return {
      contentItems: [{
        type: 'inputText',
        text: dynamicToolResponseText({
          ok: true,
          automationId: automation.id,
          title: automation.title || automation.name,
          nextRunAt: automation.nextRunAt || null,
          conversationId: automation.conversationId || null,
        }),
      }],
      success: true,
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
      if (isAutomationToolRequest(request)) {
        handleAutomationToolRequest(request)
          .then((response) => {
            client.respondToServerRequest(request.id, response);
          })
          .catch((error) => {
            client.respondToServerRequest(request.id, {
              contentItems: [{
                type: 'inputText',
                text: dynamicToolResponseText({
                  ok: false,
                  error: {
                    code: error && error.code ? error.code : 'AUTOMATION_TOOL_ERROR',
                    message: error && error.message ? error.message : String(error),
                  },
                }),
              }],
              success: false,
            });
            sinkEvents({
              taskId: contextFor(request).taskId || null,
              projectId: contextFor(request).projectId || null,
              runtime: REDOU_CODEX_RUNTIME_ID,
              type: 'runtime_error',
              level: 'error',
              title: 'Automation tool failed',
              message: error && error.message ? error.message : String(error),
              payload: { request },
            }).catch(() => {});
          });
        return;
      }
      pendingServerRequests.set(request.id, request);
      const events = mapRedouCodexNotificationToAgentEvents(request, contextFor(request));
      sinkEvents(events).catch(() => {});
    });
  }

  function pendingServerRequestEntry(id) {
    if (pendingServerRequests.has(id)) return { id, request: pendingServerRequests.get(id) };
    if (typeof id === 'string' && /^-?\d+$/.test(id) && pendingServerRequests.has(Number(id))) {
      const numericId = Number(id);
      return { id: numericId, request: pendingServerRequests.get(numericId) };
    }
    const stringId = String(id);
    if (pendingServerRequests.has(stringId)) return { id: stringId, request: pendingServerRequests.get(stringId) };
    return null;
  }

  async function ensureInitialized(input = {}) {
    registerClientSubscriptions();
    if (client.isInitialized && client.isInitialized()) return initializeResult;
    const init = buildInitializeRequest({
      clientInfo: input.clientInfo || (input.settings && input.settings.clientInfo),
      experimentalApi: input.experimentalApi ?? input.settings?.experimentalApi ?? true,
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
      sourceModel: input.model || null,
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
      sourceUserMessageId: input.userMessageId || null,
      sourceModel: input.model || null,
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
    threadContexts.set(threadId, { taskId: task.id, projectId: task.projectId, threadId, sourceModel: input.model || null });
    await sessionStore.saveTaskSession(task.id, {
      redouCodexThreadId: threadId,
      redouCodexActiveTurnId: redouCodexActiveTurnIdFrom(task),
      status: 'resumed',
      metadata: { thread: response.thread || null },
    });
    return { id: `${REDOU_CODEX_RUNTIME_ID}:${task.id}`, runtime: REDOU_CODEX_RUNTIME_ID, taskId: task.id, threadId, status: 'resumed', thread: response.thread || null };
  }

  async function forkRedouCodexThread(input = {}) {
    activeEventSink = input.eventSink || activeEventSink;
    const task = input.task || {};
    const threadId = input.threadId || redouCodexThreadIdFrom(task) || redouCodexThreadIdFrom(input);
    if (!threadId) throw new Error('redouCodexThreadId is required to fork a redou-codex thread');
    await ensureAvailable(input);
    await ensureInitialized(input);
    assertModelConfigForInput(input);
    await emitModelCompatibility(input, task);
    const request = buildThreadForkRequest({ ...input, task, threadId });
    const response = await client.request(request.method, request.params);
    const nextThreadId = extractThreadId(response);
    if (!nextThreadId) throw new Error('redou-codex did not return a forked thread id');
    threadContexts.set(nextThreadId, {
      taskId: input.targetTaskId || null,
      projectId: input.projectId || task.projectId || null,
      threadId: nextThreadId,
    });
    return {
      id: `${REDOU_CODEX_RUNTIME_ID}:${nextThreadId}`,
      runtime: REDOU_CODEX_RUNTIME_ID,
      sourceThreadId: threadId,
      threadId: nextThreadId,
      status: 'forked',
      cwd: response.cwd || request.params.cwd || null,
      thread: response.thread || null,
      response,
    };
  }

  async function archiveRedouCodexThread(input = {}) {
    const task = input.task || {};
    const threadId = input.threadId || redouCodexThreadIdFrom(task) || redouCodexThreadIdFrom(input);
    if (!threadId) throw new Error('redouCodexThreadId is required to archive a redou-codex thread');
    await ensureAvailable(input);
    await ensureInitialized(input);
    const request = buildThreadArchiveRequest({ ...input, task, threadId });
    const response = await client.request(request.method, request.params);
    return { runtime: REDOU_CODEX_RUNTIME_ID, threadId, archived: true, response };
  }

  async function unarchiveRedouCodexThread(input = {}) {
    const task = input.task || {};
    const threadId = input.threadId || redouCodexThreadIdFrom(task) || redouCodexThreadIdFrom(input);
    if (!threadId) throw new Error('redouCodexThreadId is required to unarchive a redou-codex thread');
    await ensureAvailable(input);
    await ensureInitialized(input);
    const request = buildThreadUnarchiveRequest({ ...input, task, threadId });
    const response = await client.request(request.method, request.params);
    if (task.id) {
      await sessionStore.saveTaskSession(task.id, {
        redouCodexThreadId: threadId,
        redouCodexActiveTurnId: redouCodexActiveTurnIdFrom(task),
        status: 'unarchived',
        metadata: { thread: response.thread || null },
      });
    }
    return { runtime: REDOU_CODEX_RUNTIME_ID, threadId, archived: false, thread: response.thread || null, response };
  }

  async function setRedouCodexThreadName(input = {}) {
    const task = input.task || {};
    const threadId = input.threadId || redouCodexThreadIdFrom(task) || redouCodexThreadIdFrom(input);
    const name = String(input.name || input.title || '').trim();
    if (!threadId) throw new Error('redouCodexThreadId is required to rename a redou-codex thread');
    if (!name) throw new Error('Thread name is required');
    await ensureAvailable(input);
    await ensureInitialized(input);
    const request = buildThreadSetNameRequest({ ...input, task, threadId, name });
    const response = await client.request(request.method, request.params);
    return { runtime: REDOU_CODEX_RUNTIME_ID, threadId, name, response };
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
    const requestId = input.requestId ?? input.id;
    const pendingEntry = pendingServerRequestEntry(requestId);
    const request = pendingEntry ? pendingEntry.request : input.request;
    if (!pendingEntry) {
      const error = new Error('Approval request is no longer active. Please retry the task so Redou can ask for approval again.');
      error.code = 'APPROVAL_REQUEST_NOT_ACTIVE';
      error.details = { requestId, taskId: input.taskId || null };
      throw error;
    }
    const mapped = mapRedouPermissionToRedouCodexApproval(input.decision || input, request);
    const response = buildApprovalResponseRequest({
      requestId: pendingEntry.id,
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
    forkThread: forkRedouCodexThread,
    forkRedouCodexThread,
    archiveThread: archiveRedouCodexThread,
    archiveRedouCodexThread,
    unarchiveThread: unarchiveRedouCodexThread,
    unarchiveRedouCodexThread,
    setThreadName: setRedouCodexThreadName,
    setRedouCodexThreadName,
    steerTask: steerRedouCodexTask,
    steerRedouCodexTask,
    interruptTask: interruptRedouCodexTask,
    interruptRedouCodexTask,
    respondApproval,
    getPendingServerRequest(id) {
      const pendingEntry = pendingServerRequestEntry(id);
      return pendingEntry ? pendingEntry.request : null;
    },
    async dispose() {
      if (client && typeof client.dispose === 'function') {
        await client.dispose();
      }
    },
  };
}

module.exports = { createRedouCodexLifecycle };
