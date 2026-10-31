const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
test('entire actual worker boots without Meet modules or network', async () => {
  const listeners = [];
  const area = state => ({
    get: async keys => keys == null ? structuredClone(state) : Object.fromEntries((typeof keys === 'string' ? [keys] : keys).map(key => [key, structuredClone(state[key])])),
    set: async values => Object.assign(state, structuredClone(values)),
    remove: async keys => { for (const key of typeof keys === 'string' ? [keys] : keys) delete state[key]; },
  });
  const event = { addListener: fn => listeners.push(fn) };
  const chrome = {
    storage: { local: area({}), session: area({}), onChanged: event },
    runtime: { onMessage: event },
    debugger: { onDetach: event, attach: async () => {}, detach: async () => {}, sendCommand: async () => {} },
    tabs: { onRemoved: event, onUpdated: event, onActivated: event, get: (id, cb) => cb({ id }), query: async () => [] },
    alarms: { onAlarm: event, create: async () => {}, clear: async () => {}, getAll: async () => [], get: async () => null },
    action: {},
  };
  const imported = [];
  const ctx = vm.createContext({ chrome, URL, console, setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {},
    fetch: () => { throw Error('unexpected network during boot'); },
  });
  ctx.importScripts = (...files) => files.forEach(file => {
    imported.push(file);
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'flow.js'), 'utf8'), ctx, { filename: 'flow.js' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(imported, ['heygen-audio-background.js', 'yt-studio-summary-worker.js']);
  assert.equal(typeof ctx.toTabGetQuiet, 'function');
  for (const name of ['toStartScan', 'toStartMeetCaptionWatch', 'toStartClassroomRetry', 'toNotifyTelegram']) {
    assert.equal(typeof ctx[name], 'undefined', name);
  }
  assert.ok(listeners.length > 0);
});
