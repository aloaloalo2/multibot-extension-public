(async()=>{
 const key=new URLSearchParams(location.search).get('job');
 if(!/^hg-audio-[a-z0-9-]+$/.test(key||'')) return;
 const stateEl=document.getElementById('status'), link=document.getElementById('save');
 const stored=await chrome.storage.local.get(key), job=stored[key];
 if(!job||job.state!=='queued') return;
 let ctx, blobUrl;
 async function status(state,text,extra={}) {
  Object.assign(job,{state,text,...extra});stateEl.textContent=text;
  await chrome.storage.local.set({[key]:job});
 }
 try {
  ctx=new AudioContext();const buffers=[];
  for(let i=0;i<job.items.length;i++){
   await status('working',`Получаю аудио ${i+1}/${job.items.length}`);
   const url=new URL(job.items[i].src);
   if(url.protocol!=='https:'||!/(^|\.)(heygen\.ai|heygen\.com|amazonaws\.com)$/.test(url.hostname)) throw Error('Неверный источник аудио');
   const res=await fetch(url.href,{credentials:'omit',signal:AbortSignal.timeout(30000)});
   if(!res.ok) throw Error(`Фрагмент ${i+1}: HTTP ${res.status}`);
   buffers.push(await ctx.decodeAudioData(await res.arrayBuffer()));
  }
  const seconds=buffers.reduce((n,b)=>n+b.duration,0);
  if(Math.abs(seconds-job.seconds)>1) throw Error('Длительность аудио изменилась');
  await status('working','Собираю WAV');
  const merged=await MultiBotHeyGenAudio.mergeBuffers(buffers);
  blobUrl=URL.createObjectURL(MultiBotHeyGenAudio.encodeWav(merged));
  link.href=blobUrl;link.download=job.filename;link.hidden=false;
  await status('working','Скачиваю WAV');
  const id=await chrome.downloads.download({url:blobUrl,filename:job.filename,saveAs:false});
  if(!Number.isInteger(id)) throw Error('Браузер не подтвердил скачивание');
  // Keep this document and its blob alive until the browser has finished reading it.
  const inspect=async()=>{
   const [item]=await chrome.downloads.search({id});
   if(item?.state==='complete'){
    chrome.downloads.onChanged.removeListener(changed);
    await status('complete',`Скачано ${MultiBotHeyGenAudio.fmtDur(seconds)}`,{downloadId:id,path:item.filename});
    URL.revokeObjectURL(blobUrl);link.hidden=true;
    const tab=await chrome.tabs.getCurrent();if(tab)await chrome.tabs.remove(tab.id);
   }else if(item?.state==='interrupted'){
    chrome.downloads.onChanged.removeListener(changed);
    await status('error',`Скачивание прервано: ${item.error||'неизвестная ошибка'}`);
   }
  };
  const changed=delta=>{if(delta.id===id)inspect().catch(e=>status('error',e.message));};
  chrome.downloads.onChanged.addListener(changed);await inspect();
 }catch(e){await status('error',String(e.message||e));}
 finally{if(ctx)await ctx.close();}
})();
