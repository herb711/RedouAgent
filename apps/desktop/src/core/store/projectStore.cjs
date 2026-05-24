'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createDefaultProject } = require('../models/project.cjs');
const { ensureDir, safeJoin } = require('../../platform/filesystem/paths.cjs');
const { readJsonFile, writeJsonFile } = require('../../platform/filesystem/jsonFile.cjs');

function createProjectStore(options = {}) {
  const dataRoot = path.resolve(options.dataRoot || '.redou');
  const storageRoot = options.storageRoot || safeJoin(dataRoot, 'projects');
  const memory = options.memory || new Map();
  const defaultProject = options.defaultProject || null;

  function entityPath(id) {
    return safeJoin(storageRoot, `${encodeURIComponent(id)}.json`);
  }

  async function readPersisted() {
    await ensureDir(storageRoot);
    const names = await fs.readdir(storageRoot);
    const projects = [];
    for (const name of names.filter((entry) => entry.endsWith('.json'))) {
      const project = await readJsonFile(path.join(storageRoot, name), null);
      if (project && project.id) {
        memory.set(project.id, project);
        projects.push(project);
      }
    }
    return projects;
  }

  async function ensureDefaultProject() {
    if (!defaultProject) return null;
    const existing = await store.get(defaultProject.id);
    if (existing) return existing;
    return store.save(defaultProject);
  }

  const store = {
    storageRoot,
    async list() {
      const persisted = await readPersisted();
      if (!persisted.length && defaultProject) {
        return [await ensureDefaultProject()];
      }
      return Array.from(memory.values()).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    },
    async get(id) {
      if (!id && defaultProject) id = defaultProject.id;
      if (memory.has(id)) return memory.get(id);
      const project = await readJsonFile(entityPath(id), null);
      if (project) memory.set(id, project);
      return project;
    },
    async save(entity) {
      const now = new Date().toISOString();
      const id = entity.id || `project:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const existing = memory.get(id) || {};
      const project = createDefaultProject({
        ...existing,
        ...entity,
        id,
        name: entity.name || existing.name || path.basename(entity.rootPath || process.cwd()),
        rootPath: entity.rootPath || existing.rootPath || process.cwd(),
        createdAt: entity.createdAt || existing.createdAt || now,
        updatedAt: now,
      });
      memory.set(id, project);
      await writeJsonFile(entityPath(id), project);
      return project;
    },
    async remove(id) {
      memory.delete(id);
      await fs.rm(entityPath(id), { force: true });
    },
  };

  return store;
}

module.exports = { createProjectStore };
