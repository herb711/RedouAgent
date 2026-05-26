const assert = require('node:assert/strict');
const test = require('node:test');

const { archiveTask, registerTaskIpc, restoreTask } = require('../src/ipc/taskIpc.cjs');

function createTaskStore(seed = []) {
  const tasks = new Map(seed.map((task) => [task.id, { ...task }]));
  return {
    async list(filter = {}) {
      return Array.from(tasks.values()).filter((task) => !filter.projectId || task.projectId === filter.projectId);
    },
    async get(id) {
      return tasks.get(id) || null;
    },
    async save(task) {
      const next = { ...(tasks.get(task.id) || {}), ...task };
      tasks.set(next.id, next);
      return next;
    },
    async remove(id) {
      tasks.delete(id);
    },
  };
}

test('archived task listing only returns archived conversations', async () => {
  const taskStore = createTaskStore([
    { id: 'active', projectId: 'project-1', title: 'Active', metadata: {} },
    { id: 'archived', projectId: 'project-1', title: 'Archived', metadata: { archived: true } },
  ]);
  const handlers = new Map();
  registerTaskIpc({ handle: (channel, handler) => handlers.set(channel, handler) }, { taskStore });

  const result = await handlers.get('redou:tasks:list')({}, { includeArchived: true, archivedOnly: true });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.map((task) => task.id), ['archived']);
});

test('restoreTask clears archived metadata without losing other flags', async () => {
  const taskStore = createTaskStore([
    { id: 'task-1', title: 'Archived', metadata: { archived: true, archivedAt: '2026-05-25T10:20:00.000Z', pinned: true } },
  ]);

  await archiveTask({ id: 'task-1' }, { taskStore });
  const restored = await restoreTask({ id: 'task-1' }, { taskStore });

  assert.equal(restored.metadata.archived, false);
  assert.equal(restored.metadata.archivedAt, null);
  assert.equal(restored.metadata.pinned, true);
});

test('restoreTask unarchives the runtime thread when available', async () => {
  const calls = [];
  const taskStore = createTaskStore([
    {
      id: 'task-1',
      title: 'Archived',
      redouCodexThreadId: 'thread-1',
      metadata: { archived: true, archivedAt: '2026-05-25T10:20:00.000Z' },
    },
  ]);

  const restored = await restoreTask({ id: 'task-1' }, {
    taskStore,
    redouCodexAdapter: {
      async unarchiveThread(input) {
        calls.push(input);
        return { threadId: input.threadId, archived: false };
      },
    },
  });

  assert.equal(restored.metadata.archived, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].threadId, 'thread-1');
});
