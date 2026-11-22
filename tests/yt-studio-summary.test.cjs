const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {percentage,count,average,exploreMetrics,contentMetrics,context}=require('../yt-studio-summary.js');
const {cleanMetrics,validate}=require('../yt-studio-summary-worker.js');
const channel='UC87K7-Uo17LpO5v3VWaO9iw';
const columns=['EXTERNAL_VIEWS','AVERAGE_WATCH_PERCENTAGE','RATINGS_LIKES','SHARINGS'];
const url=`https://studio.youtube.com/channel/${channel}/analytics/hub_content/explore?time_period=4_weeks&dimension=VIDEO&${columns.map(c=>'t_metrics='+c).join('&')}`;
const shown={closest:()=>null,getClientRects:()=>[{}]};
const node=textContent=>({textContent,...shown});
function report(rows){
  return {querySelector:s=>s==='#debug-explore-table'?{...shown,querySelectorAll:()=>rows.map(([title,...cells])=>({
    querySelector:()=>node(title),querySelectorAll:()=>cells.map(node)
  }))}:null};
}
test('explore averages percentage viewed, likes and shares per video; totals and zero-view videos are excluded',()=>{
  const m=exploreMetrics(report([['Итого','1010','21,4 %','110','30'],['A','1000','20 %','100','10'],['B','10','40,0 %','10','0'],['C','0','—','0','1'],['D','20','—','—','—']]),url);
  assert.equal(m.duration.value,30);assert.equal(m.duration.count,2);
  assert.equal(m.likes.value,55);assert.equal(m.likes.count,2);
  assert.equal(m.shares.value,0.5);
  assert.equal(exploreMetrics(report([['A','1','10 %','0','2']]),url).shares.value,200);
  assert.equal(exploreMetrics(report([['A','10','10 %','20','0']]),url).likes,undefined);
  assert.deepEqual(exploreMetrics(report([['A','10','10 %','1','1']]),url.replace('dimension=VIDEO','dimension=DAY')),{});
});
test('exact count parsing preserves zero, rejects rounded counts and unknown values',()=>{
  assert.equal(count('5 385'),5385);assert.equal(count('0'),0);
  for(const value of ['—','','1,2 тыс.','1.2K','12%','-3'])assert.equal(count(value),null);
  assert.equal(percentage('(25,2 %)'),25.2);assert.equal(percentage('4:03'),null);
  assert.equal(average([null,NaN,0,40]).value,20);
});
function el(props){return {...shown,querySelector:()=>null,querySelectorAll:()=>[],...props};}
test('Insights «Контент»: CTR from its simple metric, retention from the 0:30 intro list',()=>{
  const headline=node('CTR для значков видео');
  const box=el({querySelector:s=>s==='.ytBasicContentViewModelParagraphHeadline'?headline:null});
  const ctr=el({parentElement:box,querySelector:s=>s==='.ytcpSimpleMetricValue'?node('6,2 %'):null});
  const other=el({parentElement:el({querySelector:s=>s==='.ytBasicContentViewModelParagraphHeadline'?node('Показы значков видео'):null}),querySelector:()=>node('588,5 тыс.')});
  const item=t=>el({querySelector:()=>node(t)});
  const card=el({querySelectorAll:()=>['Зрители продолжают смотреть на отметке 0:30','78 %','78 %','75 %','69 %'].map(item)});
  const unrelated=el({querySelectorAll:()=>['Функции выбора контента','80,0 %'].map(item)});
  const doc={querySelectorAll:s=>s==='ytcp-simple-metric-view-model'?[other,ctr]:s==='yt-card-view-model'?[unrelated,card]:[]};
  const values=contentMetrics(doc);assert.equal(values.ctr.value,6.2);assert.equal(values.retention.value,75);
  assert.equal(values.retention.count,4);assert.match(values.retention.source,/365/);
});
function page(id=channel,chip='28 дней'){
  const chips=['7 дней','28 дней','90 дней','Ещё'].map(t=>({...node(t),querySelector:s=>s==='.ytChipShapeActive'&&t===chip?{}:null}));
  const row={},header={...shown,querySelector:s=>s==='.ytShelfHeaderLayoutTrailingActions button'?{}:s==='.ytShelfHeaderLayoutHeaderRow'?row:null};
  return {querySelector:s=>s==='#home-button'?{getAttribute:()=>`/channel/${id}`}:null,
    querySelectorAll:s=>s==='chip-bar-view-model'?[{...shown,querySelectorAll:()=>chips}]:s==='yt-shelf-header-layout'?[header]:[]};
}
test('cache context is isolated by channel and period, and rejects other pages and SPA headers of another channel',()=>{
  const content=`https://studio.youtube.com/channel/${channel}/analytics/hub_content`;
  const a=context(page(),content),b=context(page(),content.replace('hub_content','hub_overview'));
  assert.equal(a.key,b.key);assert.equal(a.period,'4_weeks');
  const week=context(page(channel,'7 дней'),content);assert.notEqual(a.key,week.key);assert.equal(week.period,'week');
  assert.equal(new URL(context(page(channel,'90 дней'),content).exploreUrl).searchParams.get('time_period'),'quarter');
  assert.equal(context(page(channel,'Ещё'),content),null);
  const other='UCzaJgy7sFJZdXTSj1Xq1XXw';
  assert.notEqual(a.key,context(page(other),content.replace(channel,other)).key);
  assert.equal(context(page(other),content),null);
  assert.equal(context(page(),url),null);
  assert.equal(context(page(),`https://studio.youtube.com/channel/${channel}/analytics/tab-overview/period-default`),null);
  assert.deepEqual(new URL(a.exploreUrl).searchParams.getAll('t_metrics'),['EXTERNAL_VIEWS','AVERAGE_WATCH_PERCENTAGE','AVERAGE_WATCH_TIME','RATINGS_LIKES','SHARINGS']);
  assert.equal(new URL(a.exploreUrl).searchParams.get('entity_id'),channel);
  assert(validate(a,content));assert(!validate(a,content.replace(channel,other)));
  assert(!validate({...a,exploreUrl:'https://example.com/steal'},content));
  assert(!validate({...a,period:'week'},content));
});
test('one refresh opens «Расширенный режим», then «Контент», in one background tab',async()=>{
  const {call,ctx,created,closed,updated,local,commands}=worker();
  await call({type:'mbStudioSummaryGet',context:ctx});
  assert.equal(created.length,0);
  await call({type:'mbStudioSummaryRefresh',context:ctx});
  await new Promise(setImmediate);
  assert.equal(created.length,1);assert.equal(created[0].url,ctx.exploreUrl);assert.equal(created[0].active,false);
  const probe=await call({type:'mbStudioSummaryProbe'},701,ctx.exploreUrl);
  assert.equal(probe.collector.mode,'explore');assert.equal(commands[0].params.enabled,true);
  await call({type:'mbStudioSummaryResult',nonce:probe.collector.nonce,range:ctx.range,metrics:{duration:{value:21,count:3},likes:{value:1,count:3},shares:{value:3.14,count:3},ctr:{value:99,count:1}}},701,ctx.exploreUrl);
  assert.equal(local[ctx.key].metrics.shares.value,3.14);assert.equal(local[ctx.key].metrics.duration.value,21);assert.equal(local[ctx.key].metrics.ctr,undefined);
  assert.deepEqual(updated.map(u=>u.url),[ctx.contentUrl]);
  const second=await call({type:'mbStudioSummaryProbe'},701,ctx.contentUrl);
  assert.equal(second.collector.mode,'content');
  await call({type:'mbStudioSummaryResult',nonce:second.collector.nonce,range:ctx.range,metrics:{ctr:{value:6.2,count:1},retention:{value:75,count:4},likes:{value:50,count:1}}},701,ctx.contentUrl);
  assert.equal(local[ctx.key].metrics.ctr.value,6.2);assert.equal(local[ctx.key].metrics.likes.value,1);
  assert.equal(local[ctx.key].loading,false);assert.deepEqual(closed,[701]);assert.equal(commands.at(-1).params.enabled,false);
});
test('storage accepts a measured zero and rejects unavailable values',()=>{
  const now=Date.now(), valid={value:0,count:1,source:'Studio'};
  assert.deepEqual(Object.keys(cleanMetrics({ctr:valid,likes:{value:NaN,count:2}},now)),['ctr']);
  assert.equal(cleanMetrics({likes:valid},now).likes.value,0);
});
function worker(initialLocal={},initialSession={},failAttach=false){
  const local=structuredClone(initialLocal),session=structuredClone(initialSession),listeners=[],created=[],closed=[],updated=[],timers=[],attached=[],detached=[],commands=[],tabs=new Map();
  const area=state=>({get:async key=>({[key]:structuredClone(state[key])}),set:async obj=>Object.assign(state,structuredClone(obj)),remove:async key=>delete state[key]});
  const chrome={storage:{local:area(local),session:area(session)},runtime:{onMessage:{addListener:f=>listeners.push(f)}},
    tabs:{create:async options=>{created.push(options);const tab={id:700+created.length,...options};tabs.set(tab.id,tab);return tab;},update:async(id,options)=>updated.push({id,...options}),
      remove:async id=>closed.push(id),get:async id=>tabs.get(id)||null,onRemoved:{addListener(){}}},
    debugger:{attach:async target=>{attached.push(target);if(failAttach)throw Error('Another debugger');},
      sendCommand:async(target,method,params)=>commands.push({target,method,params}),detach:async target=>detached.push(target),onDetach:{addListener(){}}}};
  const sandbox=vm.createContext({chrome,URL,Date,crypto:require('node:crypto').webcrypto,
    setTimeout:f=>{timers.push(f);return timers.length;},clearTimeout(){},console});
  vm.runInContext(fs.readFileSync(require.resolve('../yt-studio-summary-worker.js'),'utf8'),sandbox);
  const source=`https://studio.youtube.com/channel/${channel}/analytics/hub_content`,ctx=context(page(),source);
  const call=(message,id=9,sourceUrl=source)=>new Promise(resolve=>listeners[0](message,{tab:{id,url:sourceUrl}},resolve));
  return {local,session,created,closed,updated,timers,call,source,ctx,attached,detached,commands};
}
test('page visits, missing metrics and stale caches never open a report',async()=>{
  const {call,ctx,created,local}=worker();
  local[ctx.key]={channelId:channel,loading:true,metrics:{likes:{value:3,count:1,at:1}}};
  await Promise.all([call({type:'mbStudioSummaryGet',context:ctx}),call({type:'mbStudioSummaryGet',context:ctx})]);
  await call({type:'mbStudioSummaryGet',context:ctx,metrics:{ctr:{value:4,count:1}}});
  assert.equal(created.length,0);assert.equal(local[ctx.key].loading,false);
  assert.equal(local[ctx.key].metrics.ctr.value,4);assert.equal(local[ctx.key].metrics.likes.value,3);
});
test('only a manual refresh opens one likes report, deduplicates clicks and closes its own tab',async()=>{
  const {call,ctx,created,closed,updated,local,attached,detached,commands}=worker();
  await Promise.all([call({type:'mbStudioSummaryRefresh',context:ctx}),call({type:'mbStudioSummaryRefresh',context:ctx})]);
  await new Promise(setImmediate);assert.equal(created.length,1);assert.equal(created[0].active,false);
  assert.equal(created[0].url,ctx.exploreUrl);
  const probe=await call({type:'mbStudioSummaryProbe'},701,ctx.exploreUrl);
  assert.equal(probe.collector.mode,'explore');
  assert.deepEqual(attached.map(target=>target.tabId),[701]);
  assert.equal(commands[0].method,'Emulation.setFocusEmulationEnabled');
  assert.equal(commands[0].params.enabled,true);assert.equal(commands[0].target.tabId,701);
  await call({type:'mbStudioSummaryResult',nonce:'obsolete',range:ctx.range,metrics:{likes:{value:99,count:1}}},701,ctx.exploreUrl);
  assert.equal(local[ctx.key].metrics.likes,undefined);
  await call({type:'mbStudioSummaryResult',nonce:probe.collector.nonce,range:'wrong period',metrics:{likes:{value:99,count:1}}},701,ctx.exploreUrl);
  assert.equal(local[ctx.key].metrics.likes,undefined);
  await call({type:'mbStudioSummaryResult',nonce:probe.collector.nonce,range:ctx.range,metrics:{likes:{value:0,count:1},ctr:{value:99,count:1}}},701,ctx.exploreUrl);
  assert.deepEqual(closed,[]);assert.deepEqual(updated.map(u=>u.url),[ctx.contentUrl]);
  const content=await call({type:'mbStudioSummaryProbe'},701,ctx.contentUrl);
  await call({type:'mbStudioSummaryResult',nonce:content.collector.nonce,range:ctx.range,metrics:{}},701,ctx.contentUrl);
  assert.deepEqual(closed,[701]);
  assert.deepEqual(detached.map(target=>target.tabId),[701]);assert.equal(commands.at(-1).params.enabled,false);
  assert.equal(local[ctx.key].metrics.likes.value,0);assert.equal(local[ctx.key].loading,false);
  assert.equal(local[ctx.key].metrics.ctr,undefined);
  await call({type:'mbStudioSummaryGet',context:ctx});assert.equal(created.length,1);
  await call({type:'mbStudioSummaryRefresh',context:ctx});await new Promise(setImmediate);
  assert.equal(created.length,2);
  const second=await call({type:'mbStudioSummaryProbe'},702,ctx.exploreUrl);
  await call({type:'mbStudioSummaryResult',nonce:second.collector.nonce,range:ctx.range,metrics:{likes:{value:2.5,count:2}}},702,ctx.exploreUrl);
  const secondContent=await call({type:'mbStudioSummaryProbe'},702,ctx.contentUrl);
  await call({type:'mbStudioSummaryResult',nonce:secondContent.collector.nonce,range:ctx.range,metrics:{}},702,ctx.contentUrl);
  assert.equal(local[ctx.key].metrics.likes.value,2.5);
  assert.equal((await call({type:'mbStudioSummaryGet',context:ctx},9,'https://example.com')).ok,false);
  assert.equal((await call({type:'mbStudioSummaryRefresh',context:ctx},9,'https://example.com')).ok,false);
});
test('a background focus failure closes only the collector and waits for a new manual request',async()=>{
  const {call,ctx,created,closed,local,commands}=worker({}, {}, true);
  await call({type:'mbStudioSummaryRefresh',context:ctx});
  await new Promise(setImmediate);await new Promise(setImmediate);
  assert.deepEqual(closed,[701]);assert.equal(local[ctx.key].loading,false);assert(local[ctx.key].error);
  assert.equal(commands.length,0);
  await call({type:'mbStudioSummaryGet',context:ctx});assert.equal(created.length,1);
});
test('a timed out manual refresh waits for a new click and does not refresh another channel',async()=>{
  const {call,ctx,created,closed,timers,local}=worker();
  await call({type:'mbStudioSummaryRefresh',context:ctx});await new Promise(setImmediate);
  timers[0]();await new Promise(setImmediate);await new Promise(setImmediate);
  timers[1]();await new Promise(setImmediate);await new Promise(setImmediate);
  assert.deepEqual(closed,[701]);assert.equal(local[ctx.key].loading,false);assert(local[ctx.key].error);
  const other='UCzaJgy7sFJZdXTSj1Xq1XXw',source=`https://studio.youtube.com/channel/${other}/analytics/hub_overview`;
  const otherCtx=context(page(other),source);
  await call({type:'mbStudioSummaryGet',context:otherCtx},10,source);
  await call({type:'mbStudioSummaryGet',context:ctx});
  assert.equal(created.length,1);assert.equal(local[otherCtx.key].metrics.likes,undefined);
});
test('the Insights table scores the channel on the Content list scale from its own averages',()=>{
  const {channelScore,exploreMetrics:em}=require('../yt-studio-summary.js');
  const at=1,m=value=>({value,count:3,at});
  const r=channelScore({metrics:{ctr:m(4.5),duration:m(40),avd:m(270),likes:m(3.5),shares:m(0.8),retention:m(99)}});
  assert.equal(r.value,54);assert.match(r.explain,/^CTR: 4,5% → 60\n/);assert.doesNotMatch(r.explain,/Длина/);
  assert.equal(channelScore({metrics:{ctr:m(4.5)}}),null);assert.equal(channelScore(null),null);
  const cols=['EXTERNAL_VIEWS','AVERAGE_WATCH_TIME'],u=`https://studio.youtube.com/channel/${channel}/analytics/hub_content/explore?dimension=VIDEO&${cols.map(c=>'t_metrics='+c).join('&')}`;
  assert.equal(em(report([['A','10','3:00'],['B','10','1:05:00'],['C','0','9:00']]),u).avd.value,(180+3900)/2);
});
