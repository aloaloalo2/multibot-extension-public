const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePercentage, mean, isDurationHeader, isRetentionHeader, update } = require('../yt-studio-average.js');
test('localized percentages parse, missing values stay missing, rewatches above 100 are retained', () => {
  for (const [text, expected] of [['(28,9\u00a0%)', 28.9], ['(37.1 %)', 37.1], ['0%', 0], ['123,4%', 123.4], ['—', null], ['', null], ['4:15', null], ['foo 20%', null]]) assert.equal(parsePercentage(text), expected);
  assert.equal(mean([28.9, 15, 27.6, 15.1, 30, 25.6, 38.8, 37.1]), 27.2625);
  assert.equal(mean([null, NaN, undefined]), null);
  assert.equal(mean([0, null, 40]), 20);
});
function fixture(percentages) {
  let suffix;
  const label = { childNodes: [{ textContent: 'Средняя продолжительность просмотра' }],
    querySelector: () => suffix || null,
    append: e => { suffix = e; label.childNodes.push(e); },
  };
  const rows = percentages.map(text => ({ querySelectorAll: () => [{ querySelector: () => ({ textContent: text }) }] }));
  const header = { querySelector: () => label };
  const table = { querySelectorAll: selector => selector === '.header.metric' ? [header] : rows };
  const doc = {
    querySelectorAll: selector => selector === 'yta-top-performing-entities' ? [table] : selector === '[data-multibot-average-percentage]' && suffix ? [suffix] : [],
    createElement: () => ({ textContent: '', title: '', setAttribute() {}, remove() { label.childNodes = label.childNodes.filter(n => n !== this); suffix = null; } }),
  };
  return { doc, rows, label, suffix: () => suffix };
}
const overview = '/channel/test/analytics/tab-overview/period-default';
test('updates automatically and idempotently, without changing original label or counting absent data as zero', () => {
  const t = fixture(['(20%)', '(40%)', '—']); update(t.doc, overview);
  assert.equal(t.suffix().textContent, ' (30,0%)'); assert.match(t.suffix().title, /2 из 3/);
  const same = t.suffix(); update(t.doc, overview);
  assert.equal(t.suffix(), same); assert.equal(t.label.childNodes.length, 2);
  t.rows[0] = { querySelectorAll: () => [{ querySelector: () => ({ textContent: '(60%)' }) }] };
  update(t.doc, overview); assert.equal(t.suffix().textContent, ' (50,0%)');
  update(t.doc, '/video/test/analytics/tab-overview'); assert.equal(t.suffix(), null);
});
function retentionFixture(percentages){
  let suffix;
  const label={childNodes:[{textContent:'Зрители, которые продолжают смотреть на отметке 0:30'}],querySelector:()=>suffix||null,
    append:e=>{suffix=e;label.childNodes.push(e);}};
  const rows=percentages.map(text=>({hidden:false,closest(){return this.hidden?{}:null;},getClientRects:()=>[{}],querySelector:()=>({textContent:text})}));
  const card={querySelectorAll:selector=>selector==='.left-side .row'?rows:selector==='.rows-header-title-right'?[label]:[]};
  const doc={querySelectorAll:selector=>selector==='yta-audience-retention-highlights-channel-card-v2'?[card]:selector==='[data-multibot-retention-average]'&&suffix?[suffix]:[],
    createElement:()=>({textContent:'',title:'',setAttribute(){},remove(){label.childNodes=label.childNodes.filter(n=>n!==this);suffix=null;}})};
  return{doc,rows,label,suffix:()=>suffix};
}
test('0:30 uses the rendered row values from both introduction groups with equal video weights',()=>{
  const t=retentionFixture(['81%','68%','60%','59%']);update(t.doc,'/channel/any/analytics/tab-content/period-default');
  assert.equal(t.suffix().textContent,' (67,0%)');assert.match(t.suffix().title,/4 из 4/);
  const first=t.suffix();update(t.doc,'/channel/any/analytics/tab-content/period-default');
  assert.equal(t.suffix(),first);assert.equal(t.label.childNodes.length,2);
});
test('0:30 recalculates for every channel and data change, excluding hidden and unavailable rows',()=>{
  const a=retentionFixture(['72%','64%','64%','60%','59%','52%']);update(a.doc,'/channel/second/analytics/tab-content/period-default');
  assert.equal(a.suffix().textContent,' (61,8%)');
  a.rows[0].hidden=true;a.rows[1].querySelector=()=>({textContent:'—'});
  update(a.doc,'/channel/second/analytics/tab-content/period-default');assert.equal(a.suffix().textContent,' (58,8%)');
  a.rows.length=0;update(a.doc,'/channel/second/analytics/tab-content/period-default');assert.equal(a.suffix(),null);
});
test('0:30 clears on non-intro tabs, video analytics and advanced mode',()=>{
  for(const pathname of ['/video/x/analytics/tab-content','/channel/x/analytics/tab-content/period-default/explore','/channel/x/analytics/tab-overview']){
    const t=retentionFixture(['50%']);update(t.doc,'/channel/x/analytics/tab-content/period-default');
    assert.ok(t.suffix());update(t.doc,pathname);assert.equal(t.suffix(),null);
  }
  const t=retentionFixture(['50%']);update(t.doc,'/channel/x/analytics/tab-content/period-default');
  t.label.childNodes[0].textContent='Лучшие моменты';update(t.doc,'/channel/x/analytics/tab-content/period-default');assert.equal(t.suffix(),null);
  for(const label of ['Зрители, которые продолжают смотреть на отметке 0:30','Глядачі, які продовжують дивитися на позначці 0:30','Viewers still watching at 0:30'])assert.equal(isRetentionHeader(label),true);
});
test('new channel and period use only their own current rows; empty data removes stale results', () => {
  const a = fixture(['10%', '30%']), b = fixture(['80%']);
  update(a.doc, overview); update(b.doc, overview.replace('test', 'other'));
  assert.equal(a.suffix().textContent, ' (20,0%)'); assert.equal(b.suffix().textContent, ' (80,0%)');
  b.rows.length = 0; update(b.doc, overview); assert.equal(b.suffix(), null);
  for (const text of ['Средняя продолжительность просмотра', 'Середня тривалість перегляду', 'Average view duration']) assert.equal(isDurationHeader(text), true);
  assert.equal(isDurationHeader('Views'), false);
});
