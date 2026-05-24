'use strict';

const path = require('node:path');
const { safeJoin, taskDataRoot } = require('../../platform/filesystem/paths.cjs');
const { readJsonFile, writeJsonFile } = require('../../platform/filesystem/jsonFile.cjs');

function taskIdFromSessionId(id) {
  if (!id) return null;
  return String(id).startsWith('codex:') ? String(id).slice('codex:'.length) : id;
}

function createRuntimeSessionStore(options = {}) {
  const dataRoot = path.resolve(options.dataRoot || '.redou');
  const storageRoot = options.storageRoot || safeJoin(dataRoot, 'tasks');
  const memory = options.memory || new Map();

  function sessionPath(idOrTaskId) {
    const taskId = taskIdFromSessionId(idOrTaskId);
    return safeJoin(taskDataRoot(dataRoot, taskId), 'runtime-session.json');
  }

  return {
    storageRoot,
    async list(filter = {}) {
      if (!filter.taskId) return Array.from(memory.values());
      const session = await this.get(`codex:${filter.taskId}`);
      return session ? [session] : [];
    },
    async get(id) {
      if (memory.has(id)) return memory.get(id);
      const session = await readJsonFile(sessionPath(id), null);
      if (session && session.id) memory.set(session.id, session);
      return session;
    },
    async save(entity) {
      const now = new Date().toISOString();
      const id = entity.id || `codex:${entity.taskId}`;
      const existing = await readJsonFile(sessionPath(entity.taskId || id), {});
      const session = {
        ...existing,
        ...entity,
        id,
        taskId: entity.taskId || existing.taskId || taskIdFromSessionId(id),
        updatedAt: now,
        createdAt: entity.createdAt || existing.createdAt || now,
      };
      memory.set(id, session);
      await writeJsonFile(sessionPath(session.taskId), session);
      return session;
    },
    async remove(id) {
      memory.delete(id);
      await writeJsonFile(sessionPath(id), {});
    },
  };
}

module.exports = {
  createRuntimeSessionStore,
};
