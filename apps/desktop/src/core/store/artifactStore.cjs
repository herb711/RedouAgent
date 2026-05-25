'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createDefaultArtifact } = require('../models/artifact.cjs');
const { ensureDir, safeJoin } = require('../../platform/filesystem/paths.cjs');
const { readJsonFile, writeJsonFile } = require('../../platform/filesystem/jsonFile.cjs');

function createArtifactStore(options = {}) {
  const dataRoot = path.resolve(options.dataRoot || '.redou');
  const storageRoot = options.storageRoot || safeJoin(dataRoot, 'artifacts');
  const memory = options.memory || new Map();

  function entityPath(id) {
    if (!id) throw new Error('artifact id is required');
    return safeJoin(storageRoot, `${encodeURIComponent(id)}.json`);
  }

  async function readPersisted() {
    await ensureDir(storageRoot);
    const names = await fs.readdir(storageRoot).catch(() => []);
    const artifacts = [];
    for (const name of names.filter((entry) => entry.endsWith('.json'))) {
      const artifact = await readJsonFile(path.join(storageRoot, name), null);
      if (artifact && artifact.id) {
        const normalized = createDefaultArtifact(artifact);
        memory.set(normalized.id, normalized);
        artifacts.push(normalized);
      }
    }
    return artifacts;
  }

  return {
    storageRoot,
    async list(filter = {}) {
      await readPersisted();
      return Array.from(memory.values())
        .filter((artifact) => !filter.taskId || artifact.taskId === filter.taskId)
        .filter((artifact) => !filter.projectId || artifact.projectId === filter.projectId)
        .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    },
    async get(id) {
      if (memory.has(id)) return memory.get(id);
      const artifact = await readJsonFile(entityPath(id), null);
      if (!artifact) return null;
      const normalized = createDefaultArtifact(artifact);
      memory.set(id, normalized);
      return normalized;
    },
    async save(entity = {}) {
      const now = new Date().toISOString();
      const id = entity.id || `artifact:${Date.now()}:${Math.random().toString(36).slice(2)}`;
      const existing = memory.get(id) || await readJsonFile(entityPath(id), {});
      const artifact = createDefaultArtifact({
        ...existing,
        ...entity,
        id,
        name: entity.name || existing.name || path.basename(entity.path || '') || 'Untitled artifact',
        type: entity.type || existing.type || 'file',
        status: entity.status || existing.status || 'ready',
        createdAt: entity.createdAt || existing.createdAt || now,
        updatedAt: now,
        metadata: {
          ...(existing.metadata || {}),
          ...(entity.metadata || {}),
        },
      });
      memory.set(id, artifact);
      await writeJsonFile(entityPath(id), artifact);
      return artifact;
    },
    async remove(id) {
      memory.delete(id);
      await fs.rm(entityPath(id), { force: true });
    },
  };
}

module.exports = {
  createArtifactStore,
};
