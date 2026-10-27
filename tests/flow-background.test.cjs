const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../flow.js'), 'utf8');
const debuggerStart = source.indexOf('let flowDebuggerQueue');
const debuggerCode = source.slice(debuggerStart, source.indexOf('// ── функции, исполняемые', debuggerStart));
function setup() {
  const calls = []; let detached;
  const ctx = vm.createContext({ attachedTab: null,
    toTabGetQuiet: async id => ({ id, url: 'https://flow.google.com/project/test' }),
    sleep: async () => {},
    chrome: { debugger: {
      attach: async ({ tabId }) => calls.push(['attach', tabId]),
      sendCommand: async ({ tabId }, method, args) => calls.push([method, tabId, args.enabled]),
      detach: async ({ tabId }) => calls.push(['detach', tabId]),
      onDetach: { addListener: fn => { detached = fn; } },
    } },
  });
  vm.runInContext(debuggerCode, ctx);
  return { ctx, calls, detached: id => detached({ tabId: id }) };
}
test('Flow background focus is serialized, reasserted after navigation and disabled on detach', async () => {
  const t = setup();
  await Promise.all([t.ctx.attach(42), t.ctx.attach(42)]);
  assert.equal(t.calls.filter(c => c[0] === 'attach').length, 1);
  assert.equal(t.calls.filter(c => c[0] === 'Emulation.setFocusEmulationEnabled' && c[2]).length, 2);
  t.detached(42); await t.ctx.attach(42);
  assert.equal(t.calls.filter(c => c[0] === 'attach').length, 2);
  await t.ctx.attach(43);
  assert.deepEqual(t.calls.slice(-4), [['Emulation.setFocusEmulationEnabled', 42, false], ['detach', 42], ['attach', 43], ['Emulation.setFocusEmulationEnabled', 43, true]]);
  await t.ctx.detach();
  assert.deepEqual(t.calls.slice(-2), [['Emulation.setFocusEmulationEnabled', 43, false], ['detach', 43]]);
});
test('Flow background rejects foreign tabs, cleans up emulation failures and retries normally', async () => {
  const t = setup();
  for (const url of ['https://example.com/', 'https://flow.google.com.evil.test/', 'https://labs.google/other', 'http://flow.google.com/']) {
    t.ctx.toTabGetQuiet = async () => ({ url });
    await assert.rejects(t.ctx.attach(42)); assert.equal(t.calls.length, 0);
  }
  t.ctx.toTabGetQuiet = async () => ({ url: 'https://labs.google/fx/ru/tools/flow/project/test' });
  let fails = true;
  t.ctx.chrome.debugger.sendCommand = async (_, method, args) => { if (args.enabled && fails) throw Error('unsupported command'); };
  await assert.rejects(t.ctx.attach(42), /unsupported command/);
  assert.equal(t.ctx.attachedTab, null); assert.deepEqual(t.calls.at(-1), ['detach', 42]);
  fails = false; await t.ctx.attach(42); assert.equal(t.ctx.attachedTab, 42);
  await t.ctx.detach();
});
test('Flow new tabs and submission no longer activate browser tabs or windows', () => {
  const flow = source.slice(0, source.indexOf('// ── значок фильтра YouTube'));
  assert.doesNotMatch(flow, /active:\s*true|focused:\s*true/);
  assert.match(flow, /tabs\.create\(\{ url: "https:\/\/flow\.google\.com\/", active: false \}\)/);
  assert.match(flow, /job\.cancelled = true/);
});

test('cancelled Flow work cannot reacquire focus or send a late input event', async () => {
  const start = source.indexOf('async function run(fn)');
  const code = source.slice(start, source.indexOf('async function mouseClick', start));
  const ctx = vm.createContext({ job: { tabId: 42, cancelled: true },
    attach: async () => { throw Error('must not attach'); },
    chrome: { scripting: { executeScript: async () => { throw Error('must not run'); } },
      debugger: { sendCommand: async () => { throw Error('must not type'); } } },
  });
  vm.runInContext(code, ctx);
  await assert.rejects(ctx.run(() => {}), /зупинено/);
  await assert.rejects(ctx.cdp('Input.insertText', { text: 'late' }), /зупинено/);
});

test('failed automatic Flow preparation releases focus and clears running state', async () => {
  const start = source.indexOf('async function autoRun(j)');
  const code = source.slice(start, source.indexOf('async function pollJob()', start));
  const writes = [], logs = []; let releases = 0;
  const ctx = vm.createContext({ job: null, СВЕЖЕСТЬ: 120, ВЕРСИЯ: 'test', say: s => logs.push(s),
    detach: async () => { releases++; }, attach: async () => { throw Error('background unavailable'); },
    chrome: { storage: { local: { get: async () => ({}), set: async v => writes.push(v) } },
      tabs: { create: async options => { assert.equal(options.active, false); return { id: 42 }; } } },
  });
  vm.runInContext(code, ctx);
  await ctx.autoRun({ id: String(Math.round(Date.now() / 1000)), text: 'test' });
  assert.equal(ctx.job.running, false); assert.equal(releases, 1);
  assert.ok(writes.some(v => v.flowRunning === false));
  assert.ok(logs.some(s => s.includes('background unavailable')));
});

test('every resumed Flow job repeats canon once, retains it on failed send and respects video pauses', async () => {
  const splitStart = source.indexOf('// ── разбиение');
  const loopStart = source.indexOf('async function loop()');
  const loopCode = source.slice(loopStart, source.indexOf('// ── автозапуск', loopStart));
  const start = source.indexOf('if (msg.cmd === "flowStart")');
  const startCode = source.slice(start, source.indexOf('if (msg.cmd === "flowCount")', start));
  const canon = 'CANON: same character and style';
  const text = '*----\n' + canon + '\n*----\n' + Array.from({ length: 6 }, (_, i) => `${i + 1}.00sec\nПромт: frame ${i + 1}`).join('\n');
  const bodies = [], writes = [];
  const ctx = vm.createContext({ gen: 0, job: null, HEAD: 'HEAD',
    say() {}, keepAlive() {}, attach: async () => {}, detach: async () => {},
    chrome: { storage: { local: { set: async v => writes.push(v) } } },
    reply() {}, loop() {},
  });
  vm.runInContext(source.slice(splitStart, loopStart), ctx);
  // Use the real start branch, including persisted timecode resume position.
  ctx.msg = { cmd: 'flowStart', text, tabId: 42, per: 1, head: false, fromTc: '2.00sec', veo: 'skip' };
  await vm.runInContext('(async () => {' + startCode + '})()', ctx);
  assert.equal(ctx.job.per, 2); assert.equal(ctx.job.idx, 1); assert.equal(ctx.job.canonPending, true);
  const probe = () => {};
  Object.assign(ctx, { probe, run: async () => ({ media: 0, errs: 0 }), waitFree: async () => true,
    putText: async body => { bodies.push(body); return true; }, send: async () => true,
    waitDone: async () => ({}), sleep: async () => {},
  });
  vm.runInContext(loopCode, ctx);
  await ctx.loop();
  assert.equal(bodies.length, 2); assert.ok(bodies[0].includes(canon)); assert.ok(!bodies[1].includes(canon));
  assert.ok(bodies[0].includes('3.00sec')); assert.ok(!bodies[0].includes('1.00sec'));
  assert.equal(ctx.job.canonPending, false);
  for (const mode of ['failed-send', 'video-pause']) {
    ctx.job = { tabId: 42, chunks: ['3.00sec\nПромт: third', '4.00sec\nПромт: fourth'], idx: 0,
      head: false, running: true, canon, canonPending: true, isVid: [mode === 'video-pause', false], veoPause: true, log: [] };
    bodies.length = 0; ctx.send = async () => mode !== 'failed-send';
    await ctx.loop();
    assert.equal(bodies.length, 1); assert.ok(bodies[0].includes(canon));
    assert.equal(ctx.job.canonPending, mode === 'failed-send');
    assert.equal(ctx.job.idx, mode === 'failed-send' ? 0 : 1);
  }
});
