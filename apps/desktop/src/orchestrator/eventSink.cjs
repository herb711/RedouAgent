'use strict';

const { EventEmitter } = require('node:events');

function normalizeAgentEvent(event = {}) {
  return {
    id: event.id || `event:${Date.now()}:${Math.random().toString(36).slice(2)}`,
    taskId: event.taskId || null,
    projectId: event.projectId || null,
    runtime: event.runtime || 'unknown',
    type: event.type || 'raw_log',
    level: event.level || 'info',
    timestamp: event.timestamp || new Date().toISOString(),
    title: event.title || event.type || 'Runtime event',
    message: event.message || '',
    payload: event.payload === undefined ? null : event.payload,
    metadata: event.metadata || {},
  };
}

function createEventSink(dependencies = {}) {
  const emitter = dependencies.emitter || new EventEmitter();
  const eventStore = dependencies.eventStore || null;
  const broadcast = dependencies.broadcast || dependencies.broadcastRuntimeEvent;

  async function ingest(event) {
    const normalized = normalizeAgentEvent(event);
    const saved = eventStore && typeof eventStore.save === 'function'
      ? await eventStore.save(normalized)
      : normalized;

    emitter.emit('event', saved);
    if (typeof broadcast === 'function') {
      await broadcast(saved);
    }
    return saved;
  }

  return {
    ingest,
    ingestRuntimeEvent: ingest,
    subscribe(handler) {
      emitter.on('event', handler);
      return () => emitter.off('event', handler);
    },
  };
}

async function ingestRuntimeEvent(event, dependencies = {}) {
  const sink = dependencies.eventSink || createEventSink(dependencies);
  return sink.ingestRuntimeEvent(event);
}

module.exports = { createEventSink, ingestRuntimeEvent, normalizeAgentEvent };
