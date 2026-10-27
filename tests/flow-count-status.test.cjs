const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
const start = source.indexOf('function paintFlow(st)');
const code = source.slice(start, source.indexOf('function pollFlow()', start));

test('confirmed complete count uses requested text with actual total; missing and uncounted states remain distinct', () => {
  const statuses = [];
  const ctx = vm.createContext({
    perRows: [], flowTab: { id: 42 }, savedIdx: 1, counted: null,
    heygenShown() {}, syncHidden() {}, bar() {},
    progress: () => ({ done: 100, all: 100, text: '100 из 100' }),
    setStatus: (el, text, cls) => statuses.push({ text, cls }),
  });
  for (const name of ['flowLogEl', 'flowStatusEl', 'flowStopBtn', 'flowStartBtn', 'flowResumeBtn',
    'flowPerEl', 'flowVeoEl', 'flowClearBtn', 'flowTextEl', 'flowSpinEl', 'flowCountBtn']) ctx[name] = { value: 'storyboard' };
  vm.runInContext(code, ctx);
  for (const total of [100, 25, 2]) {
    ctx.counted = { made: total, total, missing: [] };
    ctx.paintFlow({ running: false, log: [] });
    assert.deepEqual(statuses.at(-1), { text: `✅ Все ${total} кадров найдены!`, cls: 'good' });
    assert.equal(ctx.flowResumeBtn.hidden, true);
  }
  ctx.counted = { made: 97, total: 100, missing: ['1.00sec', '2.00sec', '3.00sec'] };
  ctx.paintFlow({ running: false, log: [] });
  assert.deepEqual(statuses.at(-1), { text: '⏸ Отправлено кадров 97 из 100', cls: 'bad' });
  ctx.counted = null;
  ctx.paintFlow({ running: false, total: 1, idx: 1, iDone: 100, iAll: 100, log: [] });
  assert.deepEqual(statuses.at(-1), { text: '✅ Отправлено кадров 100 из 100', cls: 'good' });
});
