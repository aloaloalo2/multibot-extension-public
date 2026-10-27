const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {percentage,count,average,likesMetric,contentMetrics,context}=require('../yt-studio-summary.js');
const {cleanMetrics,validate}=require('../yt-studio-summary-worker.js');
const channel='UC87K7-Uo17LpO5v3VWaO9iw';
const url=`https://studio.youtube.com/channel/${channel}/analytics/tab-content/period-default/explore?dimension=VIDEO&t_metrics=EXTERNAL_VIEWS&t_metrics=RATINGS_LIKES`;
const shown={closest:()=>null,getClientRects:()=>[{}]};
const node=textContent=>({textContent,...shown});
function report(rows){
  return {querySelector:s=>s==='#debug-explore-table'?{...shown,querySelectorAll:()=>rows.map(([title,views,likes])=>({
    querySelector:()=>node(title),querySelectorAll:()=>[node(views),node(likes)]
  }))}:null};
}
test('likes are percentages of views, averaged per video; totals and zero-view videos are excluded',()=>{
  const result=likesMetric(report([['Итого','1010','110'],['A','1000','100'],['B','10','10'],['C','0','0'],['D','20','—']]),url);
  assert.equal(result.value,55);assert.equal(result.count,2);
  assert.equal(likesMetric(report([['A','100','0']]),url).value,0);
  assert.equal(likesMetric(report([['A','0','10']]),url),null);
  assert.equal(likesMetric(report([['A','100','100']]),url.replace('RATINGS_LIKES','POST_LIKES')),null);
});
test('exact count parsing preserves zero, rejects rounded counts and unknown values',()=>{
  assert.equal(count('5\u00a0385'),5385);assert.equal(count('0'),0);
  for(const value of ['—','','1,2 тыс.','1.2K','12%','-3'])assert.equal(count(value),null);
  assert.equal(percentage('(25,2 %)'),25.2);assert.equal(percentage('4:03'),null);
  assert.equal(average([null,NaN,0,40]).value,20);
});
test('CTR is read only from its key metric; retention includes both intro groups',()=>{
  const ctr={...shown,querySelector:s=>node(s==='#metric-label'?'CTR для значков видео':'4,1 %')};
  const retention={...shown,querySelector:()=>node('Зрители, которые продолжают смотреть на отметке 0:30'),
    querySelectorAll:()=>[73,70,62,60].map(x=>({...shown,querySelector:()=>node(x+'%')}))};
  const doc={querySelectorAll:s=>s==='yta-key-metric-block'?[ctr]:[retention]};
  const values=contentMetrics(doc);assert.equal(values.ctr.value,4.1);assert.equal(values.retention.value,66.25);
  assert.match(values.retention.source,/365/);
});
function page(id=channel,range='27 сент. - 24 окт. 2026 г.'){
  return {querySelector:s=>s==='#home-button'?{getAttribute:()=>`/channel/${id}`}:
    {getAttribute:()=>`/channel/${id}/analytics/tab-content/period-default/explore?time_period=4_weeks&dimension=VIDEO&t_metrics=EXTERNAL_VIEWS`},
    querySelectorAll:s=>s==='yta-time-picker'?[{...shown,querySelector:()=>node(range)}]:s==='h1'?[node('Аналитика по каналу')]:[]};
}
test('cache context is isolated by channel and date range, and rejects mismatched SPA headers',()=>{
  const content=`https://studio.youtube.com/channel/${channel}/analytics/tab-content/period-default`;
  const a=context(page(),content),b=context(page(),content.replace('tab-content','tab-overview'));
  assert.equal(a.key,b.key);assert.notEqual(a.key,context(page(channel,'Другой период'),content).key);
  const other='UCzaJgy7sFJZdXTSj1Xq1XXw';
  assert.notEqual(a.key,context(page(other),content.replace(channel,other)).key);
  assert.equal(context(page(other),content),null);
  assert.equal(context(page(),url),null);
  assert.deepEqual(new URL(a.likesUrl).searchParams.getAll('t_metrics'),['EXTERNAL_VIEWS','RATINGS_LIKES']);
  assert(validate(a,content));assert(!validate(a,content.replace(channel,other)));
  assert(!validate({...a,likesUrl:'https://example.com/steal'},content));
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
  const source=`https://studio.youtube.com/channel/${channel}/analytics/tab-content/period-default`,ctx=context(page(),source);
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
  await Promise.all([call({type:'mbStudioSummaryRefreshLikes',context:ctx}),call({type:'mbStudioSummaryRefreshLikes',context:ctx})]);
  await new Promise(setImmediate);assert.equal(created.length,1);assert.equal(created[0].active,false);
  assert.equal(created[0].url,ctx.likesUrl);
  const probe=await call({type:'mbStudioSummaryProbe'},701,ctx.likesUrl);
  assert.equal(probe.collector.mode,'likes');
  assert.deepEqual(attached.map(target=>target.tabId),[701]);
  assert.equal(commands[0].method,'Emulation.setFocusEmulationEnabled');
  assert.equal(commands[0].params.enabled,true);assert.equal(commands[0].target.tabId,701);
  await call({type:'mbStudioSummaryResult',nonce:'obsolete',range:ctx.range,metrics:{likes:{value:99,count:1}}},701,ctx.likesUrl);
  assert.equal(local[ctx.key].metrics.likes,undefined);
  await call({type:'mbStudioSummaryResult',nonce:probe.collector.nonce,range:'wrong period',metrics:{likes:{value:99,count:1}}},701,ctx.likesUrl);
  assert.equal(local[ctx.key].metrics.likes,undefined);
  await call({type:'mbStudioSummaryResult',nonce:probe.collector.nonce,range:ctx.range,metrics:{likes:{value:0,count:1},ctr:{value:99,count:1}}},701,ctx.likesUrl);
  assert.deepEqual(closed,[701]);assert.equal(updated.length,0);
  assert.deepEqual(detached.map(target=>target.tabId),[701]);assert.equal(commands.at(-1).params.enabled,false);
  assert.equal(local[ctx.key].metrics.likes.value,0);assert.equal(local[ctx.key].loading,false);
  assert.equal(local[ctx.key].metrics.ctr,undefined);
  await call({type:'mbStudioSummaryGet',context:ctx});assert.equal(created.length,1);
  await call({type:'mbStudioSummaryRefreshLikes',context:ctx});await new Promise(setImmediate);
  assert.equal(created.length,2);
  const second=await call({type:'mbStudioSummaryProbe'},702,ctx.likesUrl);
  await call({type:'mbStudioSummaryResult',nonce:second.collector.nonce,range:ctx.range,metrics:{likes:{value:2.5,count:2}}},702,ctx.likesUrl);
  assert.equal(local[ctx.key].metrics.likes.value,2.5);
  assert.equal((await call({type:'mbStudioSummaryGet',context:ctx},9,'https://example.com')).ok,false);
  assert.equal((await call({type:'mbStudioSummaryRefreshLikes',context:ctx},9,'https://example.com')).ok,false);
});
test('a background focus failure closes only the collector and waits for a new manual request',async()=>{
  const {call,ctx,created,closed,local,commands}=worker({}, {}, true);
  await call({type:'mbStudioSummaryRefreshLikes',context:ctx});
  await new Promise(setImmediate);await new Promise(setImmediate);
  assert.deepEqual(closed,[701]);assert.equal(local[ctx.key].loading,false);assert(local[ctx.key].error);
  assert.equal(commands.length,0);
  await call({type:'mbStudioSummaryGet',context:ctx});assert.equal(created.length,1);
});
test('a timed out manual refresh waits for a new click and does not refresh another channel',async()=>{
  const {call,ctx,created,closed,timers,local}=worker();
  await call({type:'mbStudioSummaryRefreshLikes',context:ctx});await new Promise(setImmediate);
  timers[0]();await new Promise(setImmediate);await new Promise(setImmediate);
  assert.deepEqual(closed,[701]);assert.equal(local[ctx.key].loading,false);assert(local[ctx.key].error);
  const other='UCzaJgy7sFJZdXTSj1Xq1XXw',source=`https://studio.youtube.com/channel/${other}/analytics/tab-overview/period-default`;
  const otherCtx=context(page(other),source);
  await call({type:'mbStudioSummaryGet',context:otherCtx},10,source);
  await call({type:'mbStudioSummaryGet',context:ctx});
  assert.equal(created.length,1);assert.equal(local[otherCtx.key].metrics.likes,undefined);
});
