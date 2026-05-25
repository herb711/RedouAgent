const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeUrl, setPreventSleep } = require('../src/ipc/desktopIpc.cjs');

test('desktop URL normalization keeps explicit schemes and adds https otherwise', () => {
  assert.equal(normalizeUrl('http://127.0.0.1:5173'), 'http://127.0.0.1:5173');
  assert.equal(normalizeUrl('github.com/herb711/RedouAgent'), 'https://github.com/herb711/RedouAgent');
});

test('prevent sleep toggles the host power save blocker and persists setting', async () => {
  const updates = [];
  const stopped = [];
  const dependencies = {
    powerSaveBlocker: {
      start(kind) {
        assert.equal(kind, 'prevent-display-sleep');
        return 42;
      },
      isStarted(id) {
        return id === 42;
      },
      stop(id) {
        stopped.push(id);
      },
    },
    appSettingsStore: {
      async update(patch) {
        updates.push(patch);
        return patch;
      },
    },
  };

  assert.deepEqual(await setPreventSleep({ enabled: true }, dependencies), { enabled: true, blockerId: 42 });
  assert.deepEqual(await setPreventSleep({ enabled: false }, dependencies), { enabled: false, blockerId: null });
  assert.deepEqual(stopped, [42]);
  assert.deepEqual(updates, [
    { desktop: { preventSleep: true } },
    { desktop: { preventSleep: false } },
  ]);
});
