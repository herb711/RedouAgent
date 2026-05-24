'use strict';

const { REDOU_CODEX_RUNTIME_ID } = require('../../runtimes/redou-codex/redouCodexRuntimeConfig.cjs');

const fs = require('node:fs/promises');
const path = require('node:path');
const { createDefaultTask } = require('../models/task.cjs');
const { ensureDir, safeJoin, taskDataRoot } = require('../../platform/filesystem/paths.cjs');
const { readJsonFile, writeJsonFile } = require('../../platform/filesystem/jsonFile.cjs');

function createTaskStore(options = {}) {
  const dataRoot = path.resolve(options.dataRoot || '.redou');
  const storageRoot = options.storageRoot || safeJoin(dataRoot, 'tasks');
  const memory = options.memory || new Map();

  function taskRoot(id) {
    return taskDataRoot(dataRoot, id);
  }

  function taskPath(id) {
    return safeJoin(taskRoot(id), 'task.json');
  }

  async function readPersisted() {
    await ensureDir(storageRoot);
    const names = await fs.readdir(storageRoot);
    const tasks = [];
    for (const name of names) {
      const full = path.join(storageRoot, name);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat || !stat.isDirectory()) continue;
      const task = await readJsonFile(path.join(full, 'task.json'), null);
      if (task && task.id) {
        const normalized = createDefaultTask(task);
        memory.set(normalized.id, normalized);
        tasks.push(normalized);
      }
    }
    return tasks;
  }

  return {
    storageRoot,
    async list(filter = {}) {
      await readPersisted();
      return Array.from(memory.values())
        .filter((task) => !filter.projectId || task.projectId === filter.projectId)
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    },
    async get(id) {
      if (memory.has(id)) return memory.get(id);
      const task = await readJsonFile(taskPath(id), null);
      if (!task) return null;
      const normalized = createDefaultTask(task);
      memory.set(id, normalized);
      return normalized;
    },
    async save(entity) {
      const now = new Date().toISOString();
      const id = entity.id || `task:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const existing = memory.get(id) || await readJsonFile(taskPath(id), {});
      const task = createDefaultTask({
        ...existing,
        ...entity,
        id,
        title: entity.title || existing.title || entity.userInput || 'Untitled task',
        runtime: entity.runtime || existing.runtime || REDOU_CODEX_RUNTIME_ID,
        runtimeMode: entity.runtimeMode || existing.runtimeMode || 'thread',
        createdAt: entity.createdAt || existing.createdAt || now,
        updatedAt: now,
      });
      memory.set(id, task);
      await writeJsonFile(taskPath(id), task);
      return task;
    },
    async remove(id) {
      memory.delete(id);
      await fs.rm(taskRoot(id), { recursive: true, force: true });
    },
    taskRoot,
  };
}

module.exports = {
  createTaskStore,
};
