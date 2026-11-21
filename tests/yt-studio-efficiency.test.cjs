const {test}=require('node:test');
const assert=require('node:assert/strict');
const {score,context,exploreUrl,explain}=require('../yt-studio-efficiency.js');
const {exploreVideos}=require('../yt-studio-summary.js');
const {cleanVideos,validate}=require('../yt-studio-summary-worker.js');
const channel='UCDY_f7aDjp-E7ao-dyK4_Tg';
const shown={closest:()=>null,getClientRects:()=>[{}]};
const node=textContent=>({textContent,...shown});
test('score is the mean of capped benchmark points and ignores views',()=>{
  assert.equal(score({views:100,ctr:10,avp:60,avd:480,likes:6,shares:1.5}).value,100);
  assert.equal(explain(score({views:100,ctr:6,avd:200})),'CTR: 6% → 90\nДлина одного просмотра: 3:20 → 33');
  assert.equal(score({views:100,ctr:1.5,avp:20,avd:60,likes:1,shares:0.1}).value,0);
  assert.equal(score({views:100,ctr:4,avp:40,avd:270,likes:3.5,shares:0.8}).value,50);
  assert.equal(score({views:1e6,ctr:4,avp:40,avd:270,likes:3.5,shares:0.8}).value,50);
  assert.equal(score({views:100,ctr:30,avp:0}).value,50);
  assert.equal(score({views:100,ctr:4.5,avp:60}).parts[0].points,60);
  assert.equal(score({views:100,ctr:6}),null);
  assert.equal(score({views:99,ctr:6,avp:40}),null);
});
test('the lifetime report rows become per-video values keyed by the thumbnail id',()=>{
  const url=exploreUrl(channel);
  const row=(title,id,cells)=>({querySelector:s=>s==='img'?(id?{getAttribute:()=>`https://i.ytimg.com/vi/${id}/mqdefault.jpg`}:null):node(title),querySelectorAll:()=>cells.map(node)});
  const doc={querySelector:()=>({...shown,querySelectorAll:()=>[
    row('Итого',null,['213 035','5,5 %','22,4 %','3:51','1 884','3 223']),
    row('A','WA8pO04HUwA',['147 533','5,3 %','23,8 %','3:20','1 212','2 233']),
    row('B','svFNQL7-4zo',['0','—','—','1:02:05','0','0']),
  ]})};
  const v=exploreVideos(doc,url);
  assert.deepEqual(Object.keys(v),['WA8pO04HUwA','svFNQL7-4zo']);
  assert.equal(v.WA8pO04HUwA.ctr,5.3);assert.equal(v.WA8pO04HUwA.avp,23.8);
  assert.ok(Math.abs(v.WA8pO04HUwA.likes-1212/147533*100)<1e-9);
  assert.equal(v['svFNQL7-4zo'].likes,undefined);
  assert.equal(v.WA8pO04HUwA.avd,200);assert.equal(v['svFNQL7-4zo'].avd,3725);
});
test('the efficiency context is valid only from its own channel Content page',()=>{
  const doc={querySelector:()=>({getAttribute:()=>`/channel/${channel}`})};
  const page=`https://studio.youtube.com/channel/${channel}/videos/upload`;
  const ctx=context(page,doc);
  assert.equal(new URL(ctx.videosUrl).searchParams.get('time_period'),'lifetime');
  assert(validate(ctx,page));
  assert(!validate(ctx,`https://studio.youtube.com/channel/UCzaJgy7sFJZdXTSj1Xq1XXw/videos/upload`));
  assert(!validate({...ctx,videosUrl:'https://example.com/x'},page));
  assert.equal(context(`https://studio.youtube.com/channel/${channel}/analytics/hub_content`,doc),null);
  assert.equal(context(page,{querySelector:()=>({getAttribute:()=>'/channel/UCzaJgy7sFJZdXTSj1Xq1XXw'})}),null);
  const clean=cleanVideos({'WA8pO04HUwA':{views:5,ctr:4,avp:NaN,avd:1.5},'bad':{views:1},'svFNQL7-4zo':{views:-1}});
  assert.deepEqual(clean,{'WA8pO04HUwA':{views:5,ctr:4}});
});
