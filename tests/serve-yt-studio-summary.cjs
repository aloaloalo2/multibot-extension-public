// Disposable visual fixture. No channel data, requests to Google or extension storage.
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Локальная проверка таблицы Multi Bot</title><style>
body{margin:0;background:#1f1f1f;color:#f1f1f1;font:14px Arial,sans-serif}aside{position:fixed;inset:0 auto 0 0;width:185px;padding:24px;box-sizing:border-box;background:#282828}main{margin-left:185px;padding:24px}h1{font-size:24px;font-weight:500}h2{font-size:18px}a{color:#9ecbff}#page-title-container{display:flex;align-items:center;gap:20px}.advanced-analytics-container{margin-left:auto}yta-time-picker{display:block;margin:25px 0}yta-top-performing-entities{display:block;border:1px solid #444;padding:20px;border-radius:10px}.row{display:flex;gap:50px;margin:16px 0}.fixture{background:#51441e;padding:12px 20px;margin-bottom:20px;color:#ffe69b}.nav{display:flex;gap:25px;margin:20px 0}
</style><aside><a id="home-button" href="/channel/UC87K7-Uo17LpO5v3VWaO9iw">Тестовый канал</a><p>Аналитика</p></aside><main>
<div class="fixture">ЛОКАЛЬНЫЙ ТЕСТ. Демонстрационные данные для проверки верстки.<div id="fixture-events" data-manual-reports="0">Отчётов по нажатию: 0</div></div>
<div id="page-title-container"><h1>Аналитика по каналу</h1><div class="advanced-analytics-container"><a href="/channel/UC87K7-Uo17LpO5v3VWaO9iw/analytics/tab-overview/period-default/explore?time_period=4_weeks&dimension=VIDEO&t_metrics=EXTERNAL_VIEWS">Расширенный режим</a></div></div>
<div class="nav">Обзор <span>Контент</span> Аудитория</div><yta-time-picker><div class="label-text">27 сент. - 24 окт. 2026 г.</div><span>Последние 28 дней</span></yta-time-picker>
<yta-top-performing-entities><h2>Самый популярный контент за период</h2><div class="header metric"><span class="header-text">Средняя продолжительность просмотра</span></div><div class="row">Ролик 1 <div class="metric-cell"><span class="percentage">(20%)</span></div></div><div class="row">Ролик 2 <div class="metric-cell"><span class="percentage">(30,4%)</span></div></div></yta-top-performing-entities>
</main><script>
const listeners=[];let reports=0;let record={loading:false,metrics:Object.fromEntries(['ctr','duration','retention'].map((key,i)=>[key,{value:[4.1,25.2,66.25][i],count:4,at:Date.now(),source:'Локальная демонстрационная выборка'}]))};
window.chrome={storage:{onChanged:{addListener:f=>listeners.push(f),removeListener:()=>{}}},runtime:{sendMessage:async message=>{
  if(message.type==='mbStudioSummaryProbe')return {ok:true};
  if(['mbStudioSummaryRefreshLikes','mbStudioSummaryRefreshShares'].includes(message.type)){
    const metric=message.type==='mbStudioSummaryRefreshShares'?'shares':'likes';
    const counter=document.querySelector('#fixture-events');counter.dataset.manualReports=String(++reports);counter.textContent='Отчётов по нажатию: '+reports;
    record={...record,loading:true};
    setTimeout(()=>{
      record={...record,loading:false,metrics:{...record.metrics,[metric]:{value:metric==='shares'?1.35:2.5,count:4,at:Date.now(),source:'Локальная демонстрационная выборка'}}};
      listeners.forEach(f=>f({[message.context.key]:{newValue:structuredClone(record)}},'local'));
    },1200);
  }
  return {ok:true,record:structuredClone(record)};
}}};
</script><script src="/summary.js"></script></html>`;
http.createServer((req,res)=>{
  if(req.url==='/summary.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(__dirname,'../yt-studio-summary.js')));}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);
}).listen(6061,'127.0.0.1',()=>console.log('http://127.0.0.1:6061/channel/UC87K7-Uo17LpO5v3VWaO9iw/analytics/tab-overview/period-default'));
