const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('Flow select uses exactly 2,5,8,10,12 and migrates removed choices', () => {
  const html = read('popup.html');
  const options = html.match(/<select id="flowPer">([\s\S]*?)<\/select>/)[1];
  assert.deepEqual(Array.from(options.matchAll(/<option[^>]*>(\d+)<\/option>/g), m => m[1]), ['2', '5', '8', '10', '12']);
  assert.match(options, /<option selected>5<\/option>/);
  const popup = read('popup.js');
  const ctx = vm.createContext({});
  const start = popup.indexOf('function normalizeFlowPer(');
  vm.runInContext(popup.slice(start, popup.indexOf('const flowPerEl', start)), ctx);
  const initStart = popup.indexOf('// список фиксированный');
  const init = popup.slice(initStart, popup.indexOf('if (saved.flowVeo)', initStart));
  for (const value of [1, '1', 2, '4', 5, '5', '6', '8', '10', '12', undefined, 'bad']) {
    const writes = [];
    ctx.saved = { flowPer: value };
    ctx.flowPerEl = { value: '' };
    ctx.chrome = { storage: { local: { set: values => writes.push(values) } } };
    vm.runInContext(init, ctx);
    const expected = value === 1 || value === '1' ? '2' : [2, 5, 8, 10, 12].includes(Number(value)) ? String(value) : '5';
    assert.equal(ctx.flowPerEl.value, expected);
    if (String(value) !== expected) assert.equal(writes.at(-1).flowPer, expected);
    else assert.equal(writes.length, 0);
  }
});

test('actual Flow splitting clamps one and invalid sizes, preserves frame order and video grouping', () => {
  const source = read('flow.js');
  const start = source.indexOf('function normalizeFlowBatchSize(');
  const code = source.slice(start, source.indexOf('// ── основной цикл', start));
  const ctx = vm.createContext({ lastSplit: null });
  vm.runInContext(code, ctx);
  const text = Array.from({ length: 5 }, (_, i) => `${i + 1}.00sec\nПромт: frame ${i + 1}`).join('\n');
  for (const value of [1, '1', 1.5, 2]) {
    const chunks = Array.from(ctx.split(text, value, 'skip'));
    assert.deepEqual(chunks.map(c => (c.match(/^\d+\.\d+sec/gm) || []).length), [2, 2, 1]);
    assert.equal(chunks.join('\n'), text);
  }
  for (const value of [0, -1, undefined, NaN, Infinity, 'bad']) {
    assert.equal(ctx.normalizeFlowBatchSize(value), 5);
    assert.equal(ctx.split(text, value, 'skip').length, 1);
  }
  for (const value of [2, 5, 8, 10, 12]) assert.equal(ctx.normalizeFlowBatchSize(value), value);
  for (const value of [4, 6, '4', '6']) assert.equal(ctx.normalizeFlowBatchSize(value), 5);
  const manyFrames = Array.from({ length: 25 }, (_, i) => `${i + 1}.00sec\nПромт: frame ${i + 1}`).join('\n');
  for (const value of [2, 5, 8, 10, 12]) {
    const chunks = Array.from(ctx.split(manyFrames, value, 'skip'));
    assert.equal(chunks.join('\n'), manyFrames);
    assert.equal((chunks[0].match(/^\d+\.\d+sec/gm) || []).length, value);
    assert.equal(chunks.length, Math.ceil(25 / value));
  }
  const videos = '\n6.00sec\nПромт: [VEO] first\n7.00sec\nПромт: [VEO] second';
  assert.equal(ctx.split(text + videos, 1, 'pause').length, 4);
  assert.equal(ctx.split(text + videos, 1, 'skip').length, 3);
});
