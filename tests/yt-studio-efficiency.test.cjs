const {test}=require('node:test');
const assert=require('node:assert/strict');
const eff=require('../yt-studio-efficiency.js');
const {cleanEarly,validate}=require('../yt-studio-summary-worker.js');
const {channelScore}=require('../yt-studio-summary.js');
const channel='UCDY_f7aDjp-E7ao-dyK4_Tg';
const node=textContent=>({textContent});
function doc(rows){
  return {querySelector:()=>({querySelectorAll:()=>rows.map(([d,...c])=>({querySelector:()=>node(d),querySelectorAll:()=>c.map(node)}))})};
}
test('the first two days of a video report become its early window, with the publication date',()=>{
  const rows=eff.readDays(doc([['Итого','472','4 140','1,4 %','3:39','0'],['2 нояб. 2026 г.','10','72','1,4 %','2:30','0'],['3 нояб. 2026 г.','15','928','0,8 %','3:00','1'],['4 нояб. 2026 г.','156','1 173','1,6 %','4:00','5']]));
  assert.equal(rows.length,3);
  const e=eff.early(rows);
  assert.equal(e.date,'2026-11-02');assert.equal(e.days,2);assert.equal(e.views,25);assert.equal(e.impr,1000);assert.equal(e.subs,1);
  assert.ok(Math.abs(e.ctr-(1.4*72+0.8*928)/1000)<1e-9);assert.equal(e.avd,(150*10+180*15)/25);
  assert.equal(eff.early(rows.slice(0,1)).days,1);assert.equal(eff.early([]),null);
  assert.equal(eff.parseDate('Nov 14, 2026'),'2026-11-14');assert.equal(eff.parseDate('5 лист. 2026 р.'),'2026-11-05');
});
test('the score ranks seconds watched per impression (70%) and subscribers per 1000 views (30%) inside the channel',()=>{
  const v=(ctr,avd,subs,views=1000,days=2)=>({days,views,impr:views/ctr*100,ctr,avd,subs,date:'2026-11-01'});
  const s=eff.scores({a:v(10,300,10),b:v(5,300,5),c:v(2,100,0),d:v(4,200,20),young:v(9,400,9,1000,1),few:v(9,400,9,10)});
  assert.equal(s.a.value,Math.round(.7*100+.3*(2/3*100)));
  assert.equal(s.c.value,0);
  assert.equal(s.d.parts[1].points,100);
  assert.ok(s.young.partial);assert.equal(s.young.compared,4);
  assert.equal(s.few,undefined);
  assert.equal(eff.explain(s.a),'Секунд просмотра на показ (48 ч): 30 → 100\nПодписок на 1000 просмотров (48 ч): 10 → 67');
  assert.match(eff.explain(s.young),/предварительная/);
});
test('views do not count: the same early quality scores the same whatever the reach',()=>{
  const v=(views)=>({days:2,views,impr:views*20,ctr:5,avd:300,subs:views/100});
  const s=eff.scores({a:v(100),b:v(100000)});
  assert.equal(s.a.value,s.b.value);
});
test('only videos without both early days are read again, at most 60',()=>{
  const ids=Array.from({length:70},(_,i)=>'v'+String(i).padStart(10,'0'));
  assert.equal(eff.missing(ids,{}).length,60);
  assert.deepEqual(eff.missing(['aaaaaaaaaaa','bbbbbbbbbbb','bad'],{aaaaaaaaaaa:{days:2},bbbbbbbbbbb:{days:1}}),['bbbbbbbbbbb']);
});
test('the efficiency request is valid only from its own channel Content page and keeps only listed videos',()=>{
  const page=`https://studio.youtube.com/channel/${channel}/videos/upload`;
  const ctx={...eff.context(page,{querySelector:()=>({getAttribute:()=>`/channel/${channel}`})}),ids:['WA8pO04HUwA']};
  assert(validate(ctx,page));
  assert(!validate(ctx,`https://studio.youtube.com/channel/UCzaJgy7sFJZdXTSj1Xq1XXw/videos/upload`));
  assert(!validate({...ctx,ids:['bad id']},page));
  assert(!validate({...ctx,earlyUrl:'https://example.com/x'},page));
  assert.equal(eff.context(`https://studio.youtube.com/channel/${channel}/analytics/hub_content`,{querySelector:()=>null}),null);
  const clean=cleanEarly({WA8pO04HUwA:{days:2,views:5,impr:50,ctr:4,avd:1.5,subs:0,date:'2026-11-01',evil:1},svFNQL7zzzz:{days:2,views:9}},['WA8pO04HUwA']);
  assert.deepEqual(clean,{WA8pO04HUwA:{days:2,date:'2026-11-01',views:5,impr:50,subs:0,ctr:4,avd:1.5}});
});
test('the whole-life part uses the first-48-hours formula; videos with few views are not scored',()=>{
  const v=(ctr,avd,subs)=>({views:1000,impr:20000,ctr,avd,subs});
  const s=eff.nowScores({a:v(10,300,10),b:v(5,300,5),c:v(2,100,0),d:v(4,200,20),quiet:{views:90,impr:1500,ctr:9,avd:900,subs:9}});
  const e=eff.scores(Object.fromEntries(Object.entries({a:v(10,300,10),b:v(5,300,5),c:v(2,100,0),d:v(4,200,20)}).map(([k,x])=>[k,{...x,days:2}])));
  for (const k of ['a','b','c','d']) assert.equal(s[k].value,e[k].value);
  assert.equal(s.quiet,undefined);
  assert.equal(eff.explainNow(s.a),'Секунд просмотра на показ (всё время): 30 → 100\nПодписок на 1000 просмотров (всё время): 10 → 67');
  const row=(id,c)=>({querySelector:x=>x==='img'?{getAttribute:()=>`https://i.ytimg.com/vi/${id}/mqdefault.jpg`}:null,querySelectorAll:()=>c.map(t=>({textContent:t}))});
  const w=eff.readWeek({querySelector:()=>({querySelectorAll:()=>[row('WA8pO04HUwA',['900','20 000','4,5 %','4:10','7']),{querySelector:()=>null,querySelectorAll:()=>[]}]})});
  assert.deepEqual(w,{WA8pO04HUwA:{views:900,impr:20000,ctr:4.5,avd:250,subs:7}});
});
test('a report of another channel (no access) stops the refresh with a clear instruction',async()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const local={},session={},listeners=[],closed=[],tabs=new Map();
  const area=state=>({get:async key=>({[key]:structuredClone(state[key])}),set:async obj=>Object.assign(state,structuredClone(obj)),remove:async key=>delete state[key]});
  const chrome={storage:{local:area(local),session:area(session)},runtime:{onMessage:{addListener:f=>listeners.push(f)}},
    tabs:{create:async o=>{const t={id:901,...o};tabs.set(901,t);return t;},update:async()=>{},remove:async id=>closed.push(id),get:async id=>tabs.get(id),onRemoved:{addListener(){}}},
    debugger:{attach:async()=>{},sendCommand:async()=>{},detach:async()=>{},onDetach:{addListener(){}}}};
  vm.runInContext(fs.readFileSync(require.resolve('../yt-studio-summary-worker.js'),'utf8'),vm.createContext({chrome,URL,Date,crypto:require('node:crypto').webcrypto,setTimeout:()=>1,clearTimeout(){},console}));
  const page=`https://studio.youtube.com/channel/${channel}/videos/upload`;
  const ctx={...eff.context(page,{querySelector:()=>({getAttribute:()=>`/channel/${channel}`})}),ids:['WA8pO04HUwA']};
  const call=(m,id=9,url=page)=>new Promise(r=>listeners[0](m,{tab:{id,url}},r));
  await call({type:'mbEfficiencyRefresh',context:ctx});await new Promise(setImmediate);
  const probe=await call({type:'mbStudioSummaryProbe'},901,eff.weekUrl(channel));
  await call({type:'mbStudioSummaryResult',nonce:probe.collector.nonce,range:'early',denied:true},901,eff.weekUrl(channel));
  const rec=local['mbEfficiency:'+channel];
  assert.equal(rec.loading,false);assert.match(rec.error,/Сменить аккаунт/);assert.deepEqual(closed,[901]);
});
test('the collector tab opens the channel under its own Google account (authuser from the page)',()=>{
  const {dayUrl,weekUrl,sameUrl}=require('../yt-studio-summary-worker.js');
  const page=`https://studio.youtube.com/channel/${channel}/videos/upload`;
  const docWith=n=>({querySelector:()=>({getAttribute:()=>`/channel/${channel}`}),querySelectorAll:s=>s==='script'?[{textContent:'x'},{textContent:`ytcfg.set({"SESSION_INDEX":"${n}","X":1})`}]:[]});
  const ctx=eff.context(page,docWith(1));
  assert.equal(ctx.authuser,1);
  assert.equal(new URL(weekUrl(channel,1)).searchParams.get('authuser'),'1');
  assert.equal(new URL(dayUrl(channel,'WA8pO04HUwA',0)).searchParams.get('authuser'),'0');
  assert.equal(new URL(dayUrl(channel,'WA8pO04HUwA')).searchParams.get('authuser'),null);
  assert(sameUrl(weekUrl(channel,1),weekUrl(channel)));assert(!sameUrl(weekUrl(channel,1),dayUrl(channel,'WA8pO04HUwA',1)));
  assert(validate({...ctx,ids:[]},page));assert(!validate({...ctx,ids:[],authuser:'1'},page));
  assert.equal(eff.context(page,{querySelector:()=>({getAttribute:()=>`/channel/${channel}`})}).authuser,undefined);
});
test('one refresh reads two channel reports: the whole life, then the last 4 days',async()=>{
  const fs=require('node:fs'),vm=require('node:vm');
  const local={},session={},listeners=[],created=[],updated=[],closed=[],tabs=new Map();
  const area=state=>({get:async key=>({[key]:structuredClone(state[key])}),set:async obj=>Object.assign(state,structuredClone(obj)),remove:async key=>delete state[key]});
  const chrome={storage:{local:area(local),session:area(session)},runtime:{onMessage:{addListener:f=>listeners.push(f)}},
    tabs:{create:async o=>{created.push(o);const t={id:801,...o};tabs.set(801,t);return t;},update:async(id,o)=>{updated.push(o);tabs.set(id,{id,...o});},remove:async id=>closed.push(id),get:async id=>tabs.get(id),onRemoved:{addListener(){}}},
    debugger:{attach:async()=>{},sendCommand:async()=>{},detach:async()=>{},onDetach:{addListener(){}}}};
  vm.runInContext(fs.readFileSync(require.resolve('../yt-studio-summary-worker.js'),'utf8'),vm.createContext({chrome,URL,Date,Intl,crypto:require('node:crypto').webcrypto,setTimeout:()=>1,clearTimeout(){},console}));
  const page=`https://studio.youtube.com/channel/${channel}/videos/upload`;
  const ctx={...eff.context(page,{querySelector:()=>({getAttribute:()=>`/channel/${channel}`})}),ids:[]};
  const call=(m,id=9,url=page)=>new Promise(r=>listeners[0](m,{tab:{id,url}},r));
  await call({type:'mbEfficiencyRefresh',context:ctx});await new Promise(setImmediate);
  assert.equal(created[0].url,eff.weekUrl(channel));
  let probe=await call({type:'mbStudioSummaryProbe'},801,created[0].url);
  assert.equal(probe.collector.mode,'now');
  await call({type:'mbStudioSummaryResult',nonce:probe.collector.nonce,range:'early',now:{WA8pO04HUwA:{views:900,impr:20000,ctr:4.5,avd:250,subs:3}}},801,created[0].url);
  assert.equal(new URL(updated[0].url).searchParams.get('time_period'),eff.recentRange());
  probe=await call({type:'mbStudioSummaryProbe'},801,updated[0].url);
  assert.equal(probe.collector.mode,'recent');
  await call({type:'mbStudioSummaryResult',nonce:probe.collector.nonce,range:'early',now:{'svFNQL7-4zo':{views:50,impr:900,ctr:4,avd:200,subs:1}}},801,updated[0].url);
  const rec=local['mbEfficiency:'+channel];
  assert.deepEqual(Object.keys(rec.now),['WA8pO04HUwA']);assert.deepEqual(Object.keys(rec.recent),['svFNQL7-4zo']);
  assert.equal(rec.loading,false);assert.deepEqual(closed,[801]);
});
test('«Сейчас» covers the last 4 California days before yesterday, as Studio counts its days',()=>{
  const r=eff.recentRange(Date.parse('2026-11-22T10:00:00Z')).split(',').map(Number);
  assert.deepEqual(r.map(x=>new Date(x).toISOString()),['2026-11-17T08:00:00.000Z','2026-11-21T08:00:00.000Z']);
  assert.deepEqual(eff.recentRange(Date.parse('2026-07-10T10:00:00Z')).split(',').map(x=>new Date(+x).toISOString()),['2026-07-05T07:00:00.000Z','2026-07-09T07:00:00.000Z']);
  const s=eff.nowScores({a:{views:25,impr:900,ctr:5,avd:200,subs:1},b:{views:25,impr:900,ctr:3,avd:100,subs:0},q:{views:10,impr:300,ctr:9,avd:900,subs:5}},eff.MIN_RECENT_VIEWS);
  assert.equal(s.a.value,100);assert.equal(s.q,undefined);
  assert.equal(eff.explainNow(s.a,'4 дня'),'Секунд просмотра на показ (4 дня): 10 → 100\nПодписок на 1000 просмотров (4 дня): 40 → 100');
});
