'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { ensureDir, safeJoin, taskDataRoot } = require('../../platform/filesystem/paths.cjs');
const { appendJsonl, readJsonl } = require('../../platform/filesystem/jsonlFile.cjs');

function createEventStore(options = {}) {
  const dataRoot = path.resolve(options.dataRoot || '.redou');
  const storageRoot = options.storageRoot || safeJoin(dataRoot, 'tasks');
  const globalPath = safeJoin(dataRoot, 'events.jsonl');
  const memory = options.memory || new Map();

  function eventPath(taskId) {
    return taskId ? safeJoin(taskDataRoot(dataRoot, taskId), 'events.jsonl') : globalPath;
  }

  async function readAllTaskEvents() {
    await ensureDir(storageRoot);
    const names = await fs.readdir(storageRoot).catch(() => []);
    const events = [];
    for (const name of names) {
      const full = path.join(storageRoot, name);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;
      events.push(...await readJsonl(path.join(full, 'events.jsonl')));
    }
    events.push(...await readJsonl(globalPath));
    return events;
  }

  return {
    storageRoot,
    async list(filter = {}) {
      if (filter.taskId) {
        const events = await readJsonl(eventPath(filter.taskId));
        memory.set(filter.taskId, events);
        return events.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
      }
      const events = await readAllTaskEvents();
      return events.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
    },
    async get(id) {
      for (const events of memory.values()) {
        const found = events.find((event) => event.id === id);
        if (found) return found;
      }
      return (await readAllTaskEvents()).find((event) => event.id === id) || null;
    },
    async save(entity) {
      const event = {
        ...entity,
        id: entity.id || `event:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        timestamp: entity.timestamp || new Date().toISOString(),
      };
      const taskId = event.taskId || null;
      const events = memory.get(taskId) || [];
      events.push(event);
      memory.set(taskId, events);
      await appendJsonl(eventPath(taskId), event);
      return event;
    },
    async remove(id) {
      for (const [taskId, events] of memory.entries()) {
        memory.set(taskId, events.filter((event) => event.id !== id));
      }
    },
  };
}

module.exports = {
  createEventStore,
};
