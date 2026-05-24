'use strict';

const { REDOU_CODEX_RUNTIME_ID } = require('../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');

function defaultContextPackage(task = {}, input = {}) {
  return {
    userInput: input.userInput || task.userInput || task.title || '',
    projectRules: input.projectRules || [],
    taskRules: input.taskRules || [],
    recentMessages: input.recentMessages || [],
    selectedFiles: input.selectedFiles || [],
    attachments: input.attachments || [],
    environment: input.environment || {},
    metadata: input.metadata || {},
  };
}

async function assembleContext(input, dependencies) {
  if (input.contextPackage) return input.contextPackage;
  const assembler = dependencies.contextAssembler;
  if (assembler && typeof assembler.assemble === 'function') return assembler.assemble(input);
  if (typeof assembler === 'function') return assembler(input);
  return defaultContextPackage(input.task || {}, input);
}

async function getTask(input, dependencies) {
  if (input.task) return input.task;
  if (input.taskId && dependencies.taskStore && typeof dependencies.taskStore.get === 'function') {
    return dependencies.taskStore.get(input.taskId);
  }
  return null;
}

async function getProject(task, input, dependencies) {
  if (input.project) return input.project;
  const projectId = input.projectId || (task && task.projectId);
  if (projectId && dependencies.projectStore && typeof dependencies.projectStore.get === 'function') {
    return dependencies.projectStore.get(projectId);
  }
  if (dependencies.projectStore && typeof dependencies.projectStore.list === 'function') {
    const projects = await dependencies.projectStore.list();
    return projects[0] || null;
  }
  return null;
}

async function emitRuntimeError(task, input, dependencies, error, details = {}) {
  const sink = dependencies.eventSink || dependencies.ingestRuntimeEvent;
  const event = {
    taskId: task && task.id ? task.id : input.taskId || null,
    projectId: task && task.projectId ? task.projectId : input.projectId || null,
    runtime: (task && task.runtime) || REDOU_CODEX_RUNTIME_ID,
    type: 'runtime_error',
    level: 'error',
    timestamp: new Date().toISOString(),
    title: 'Runtime unavailable',
    message: error && error.message ? error.message : String(error),
    payload: details,
    metadata: { raw: JSON.stringify(details).slice(0, 8192) },
  };
  if (sink && typeof sink.ingestRuntimeEvent === 'function') return sink.ingestRuntimeEvent(event);
  if (sink && typeof sink.ingest === 'function') return sink.ingest(event);
  if (typeof sink === 'function') return sink(event);
  return event;
}

async function emitRuntimeLog(task, input, dependencies, message, payload = {}) {
  const sink = dependencies.eventSink || dependencies.ingestRuntimeEvent;
  const event = {
    taskId: task && task.id ? task.id : input.taskId || null,
    projectId: task && task.projectId ? task.projectId : input.projectId || null,
    runtime: (task && task.runtime) || REDOU_CODEX_RUNTIME_ID,
    type: 'raw_log',
    level: 'info',
    timestamp: new Date().toISOString(),
    title: 'Runtime',
    message,
    payload,
    metadata: { raw: JSON.stringify(payload).slice(0, 8192) },
  };
  if (sink && typeof sink.ingestRuntimeEvent === 'function') return sink.ingestRuntimeEvent(event);
  if (sink && typeof sink.ingest === 'function') return sink.ingest(event);
  if (typeof sink === 'function') return sink(event);
  return event;
}

async function saveTaskStatus(task, dependencies, status, extra = {}) {
  if (!task || !task.id || !dependencies.taskStore || typeof dependencies.taskStore.save !== 'function') return task;
  return dependencies.taskStore.save({
    ...task,
    ...extra,
    status,
    metadata: {
      ...(task.metadata || {}),
      ...(extra.metadata || {}),
    },
  });
}

async function resolveRuntimeForTask(task, input, dependencies) {
  const registry = dependencies.runtimeRegistry;
  if (!registry || typeof registry.resolveRuntime !== 'function') {
    throw new Error('runtimeRegistry is required');
  }
  const resolved = await registry.resolveRuntime(task, input.project || {}, dependencies.settings || {});
  if (!resolved || !resolved.runtime) {
    const reason = resolved && resolved.reason ? resolved.reason : 'Runtime is unavailable';
    const error = new Error(typeof reason === 'string' ? reason : reason.message || 'Runtime is unavailable');
    error.code = reason && reason.code ? reason.code : 'RUNTIME_UNAVAILABLE';
    error.details = resolved;
    throw error;
  }
  return resolved;
}

async function resolveRuntimeModelOverrides(input, dependencies) {
  if (input.model && input.modelProvider) return {};
  const store = dependencies.modelConfigStore;
  if (!store || typeof store.resolveRuntimeModel !== 'function') return {};
  const selection = input.modelSelection || input.modelConfigSelection || null;
  const resolved = await store.resolveRuntimeModel(selection);
  if (!resolved) return {};
  return {
    model: resolved.model,
    modelProvider: resolved.modelProvider,
    config: {
      ...(resolved.config || {}),
      ...(input.config || {}),
    },
    modelConfig: resolved,
  };
}

async function invokeRuntime(method, input = {}, dependencies = {}) {
  const task = await getTask(input, dependencies);
  if (!task) throw new Error('Task is required');
  const project = await getProject(task, input, dependencies);
  const contextPackage = await assembleContext({ ...input, task, project }, dependencies);
  const runtimeModelOverrides = method === 'startTask' || method === 'resumeTask'
    ? await resolveRuntimeModelOverrides(input, dependencies)
    : {};
  const runtimeInput = {
    ...input,
    ...runtimeModelOverrides,
    config: {
      ...(runtimeModelOverrides.config || {}),
      ...(input.config || {}),
    },
  };
  let resolved;
  try {
    resolved = await resolveRuntimeForTask(task, { ...runtimeInput, project }, dependencies);
  } catch (error) {
    await emitRuntimeError(task, input, dependencies, error, error.details || {});
    await saveTaskStatus(task, dependencies, 'error', {
      metadata: { lastRuntimeError: { code: error.code || 'RUNTIME_UNAVAILABLE', message: error.message } },
    });
    return { runtime: task.runtime || REDOU_CODEX_RUNTIME_ID, taskId: task.id, status: 'unavailable', error: error.message, details: error.details || null };
  }
  const eventSink = dependencies.eventSink || dependencies.ingestRuntimeEvent;
  try {
    if (method === 'startTask') {
      await saveTaskStatus(task, dependencies, 'running');
      await emitRuntimeLog(task, input, dependencies, `Starting ${resolved.runtimeId} runtime.`, {
        runtimeId: resolved.runtimeId,
        projectId: project && project.id ? project.id : null,
      });
    }
    const result = await resolved.runtime[method]({
      ...runtimeInput,
      task,
      project,
      contextPackage,
      eventSink,
      availability: resolved.availability,
      settings: dependencies.settings || input.settings || {},
    });
    if (method === 'startTask') {
      await emitRuntimeLog(task, input, dependencies, `${resolved.runtimeId} runtime accepted task.`, {
        runtimeId: resolved.runtimeId,
        sessionId: result && result.id ? result.id : null,
        threadId: result && result.threadId ? result.threadId : null,
        activeTurnId: result && result.activeTurnId ? result.activeTurnId : null,
      });
    }
    return result;
  } catch (error) {
    await emitRuntimeError(task, input, dependencies, error, error.details || {});
    await saveTaskStatus(task, dependencies, 'error', {
      metadata: { lastRuntimeError: { code: error.code || 'RUNTIME_ERROR', message: error.message } },
    });
    return { runtime: task.runtime || REDOU_CODEX_RUNTIME_ID, taskId: task.id, status: 'error', error: error.message, details: error.details || null };
  }
}

async function startRuntimeRun(input = {}, dependencies = {}) {
  return invokeRuntime('startTask', input, dependencies);
}

async function resumeRuntimeRun(input = {}, dependencies = {}) {
  return invokeRuntime('resumeTask', input, dependencies);
}

async function steerRuntimeRun(input = {}, dependencies = {}) {
  return invokeRuntime('steerTask', input, dependencies);
}

async function interruptRuntimeRun(input = {}, dependencies = {}) {
  return invokeRuntime('interruptTask', input, dependencies);
}

module.exports = {
  startRuntimeRun,
  resumeRuntimeRun,
  steerRuntimeRun,
  interruptRuntimeRun,
};
