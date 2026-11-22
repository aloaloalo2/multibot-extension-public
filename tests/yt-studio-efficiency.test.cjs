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
test('the Insights channel score is the mean of the scores of videos released in the period',()=>{
  const now=Date.parse('2026-11-22');
  const v=(ctr,date)=>({days:2,views:1000,impr:20000,ctr,avd:300,subs:5,date});
  const rec={early:{a:v(10,'2026-11-20'),b:v(2,'2026-11-18'),old:v(5,'2026-09-01')}};
  const r=channelScore(rec,7,now);
  const s=eff.scores(rec.early);
  assert.equal(r.value,Math.round((s.a.value+s.b.value)/2));assert.match(r.explain,/2 роликам/);
  assert.equal(channelScore(rec,90,now).explain.match(/(\d+) роликам/)[1],'3');
  assert.equal(channelScore({early:{}},7,now),null);assert.equal(channelScore(null,7,now),null);
});
