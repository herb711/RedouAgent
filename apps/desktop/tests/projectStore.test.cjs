const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createProjectStore } = require('../src/core/store/projectStore.cjs');

test('project store lists projects by saved sort order first', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redou-project-store-'));
  const store = createProjectStore({ dataRoot: root });

  await store.save({ id: 'beta', name: 'Beta', rootPath: root, metadata: { sortOrder: 2 } });
  await store.save({ id: 'alpha', name: 'Alpha', rootPath: root, metadata: { sortOrder: 1 } });
  await store.save({ id: 'aardvark', name: 'Aardvark', rootPath: root, metadata: {} });

  const projects = await store.list();

  assert.deepEqual(projects.map((project) => project.id), ['alpha', 'beta', 'aardvark']);
});
