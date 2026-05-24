'use strict';

const path = require('node:path');
const { safeJoin, taskDataRoot } = require('../../platform/filesystem/paths.cjs');
const { appendJsonl, readJsonl } = require('../../platform/filesystem/jsonlFile.cjs');

function createMessageStore(options = {}) {
  const dataRoot = path.resolve(options.dataRoot || '.redou');
  const storageRoot = options.storageRoot || safeJoin(dataRoot, 'tasks');
  const memory = options.memory || new Map();

  function messagePath(taskId) {
    return safeJoin(taskDataRoot(dataRoot, taskId), 'messages.jsonl');
  }

  return {
    storageRoot,
    async list(filter = {}) {
      if (!filter.taskId) return Array.from(memory.values()).flat();
      const messages = await readJsonl(messagePath(filter.taskId));
      memory.set(filter.taskId, messages);
      return messages;
    },
    async get(id) {
      for (const messages of memory.values()) {
        const found = messages.find((message) => message.id === id);
        if (found) return found;
      }
      return null;
    },
    async save(entity) {
      const taskId = entity.taskId;
      if (!taskId) throw new Error('taskId is required to save a message');
      const message = {
        ...entity,
        id: entity.id || `message:${Date.now()}:${Math.random().toString(36).slice(2)}`,
        timestamp: entity.timestamp || new Date().toISOString(),
      };
      const messages = memory.get(taskId) || [];
      messages.push(message);
      memory.set(taskId, messages);
      await appendJsonl(messagePath(taskId), message);
      return message;
    },
    async remove(id) {
      for (const [taskId, messages] of memory.entries()) {
        memory.set(taskId, messages.filter((message) => message.id !== id));
      }
    },
  };
}

module.exports = {
  createMessageStore,
};
