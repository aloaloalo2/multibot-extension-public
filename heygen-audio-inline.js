(() => {
  if (document.getElementById('multibot-heygen-audio')) return;
  const core = globalThis.MultiBotHeyGenAudio;
  const panel = document.createElement('div');
  panel.id = 'multibot-heygen-audio';
  panel.setAttribute('role','region');
  panel.setAttribute('aria-label','Multibot: аудио HeyGen');
  panel.style.cssText = 'display:none;box-sizing:border-box;align-items:center;gap:6px;height:40px;min-height:40px;padding:0 8px;margin:0;color:#a9b4c3;font:11px/1 system-ui;max-width:300px;position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:1000;';
  const label = document.createElement('div');
  label.setAttribute('role','status');
  label.setAttribute('aria-live','polite');
  label.style.cssText='white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0';
  const controls = document.createElement('div');
  controls.style.cssText='display:flex;gap:6px;flex-shrink:0';
  function button(text) {
    const b=document.createElement('button'); b.type='button'; b.textContent=text;
    b.setAttribute('aria-label',text); b.title=text;
    b.style.cssText='font:14px/1 system-ui;color:#a9b4c3;background:transparent;border:0;border-radius:6px;width:32px;height:40px;flex-shrink:0;padding:0;cursor:pointer';
    controls.append(b); return b;
  }
  const download=button('Скачать аудио');
  download.style.width='52px';
  download.style.background='rgba(128,145,165,.12)';
  download.style.fontSize='20px';
  const refresh=button('Обновить');
  download.textContent='↓'; refresh.textContent='↻';
  const savedLink=document.createElement('a');
  savedLink.textContent='↓'; savedLink.title='Сохранить готовый WAV';
  savedLink.setAttribute('aria-label','Сохранить готовый WAV');
  savedLink.style.cssText=download.style.cssText+'text-decoration:none;display:none;align-items:center;justify-content:center';
  controls.insertBefore(savedLink,download);
  panel.append(label,controls);
  let prepared=null, lastError='';
  function clearPrepared() {
    if(prepared) URL.revokeObjectURL(prepared.url);
    prepared=null; savedLink.removeAttribute('href'); savedLink.style.display='none'; download.style.display='';
  }
  window.addEventListener('pagehide',clearPrepared);

  let busy=false, lastSignature='', stableSince=0, currentPath=location.pathname;
  let snapshot={items:[],seconds:0,unknown:0};
  function findPlayer() {
    // Prefer HeyGen's actual playback icon, with a labelled fallback.
    const use=[...document.querySelectorAll('button svg use')].find(e=>/^#(play-s|pause-s|pause|play)$/.test(e.getAttribute('href')||''));
    const play=use?.closest('button') || [...document.querySelectorAll('button')].find(b=>/^(play|pause|воспроизвести|пауза)$/i.test(b.getAttribute('aria-label')||''));
    for(let e=play?.parentElement, i=0;e&&i<6;e=e.parentElement,i++) {
      if (/\d+:\d{2}\s*\/\s*\d+:\d{2}/.test(e.innerText||'')) return e;
    }
    return null;
  }
  function scan() {
    if (busy) return;
    if(currentPath!==location.pathname) {clearPrepared();lastError='';currentPath=location.pathname;lastSignature='';stableSince=0;}
    const player=findPlayer();
    if(!/\/create[^/]*\//.test(location.pathname)||!player) {panel.remove();return;}
    if(!panel.isConnected) document.body.append(panel);
    const nav=document.querySelector('button[aria-label="Toggle navigation"]');
    const orby=document.getElementById('orby-nav-button');
    const left=nav?nav.getBoundingClientRect().right+10:12;
    const right=orby?orby.getBoundingClientRect().left-10:innerWidth-12;
    const space=Math.max(0,right-left);
    panel.style.left=`${(left+right)/2}px`;
    panel.style.maxWidth=`${Math.min(300,space)}px`;
    panel.style.top=`${nav?Math.max(4,nav.getBoundingClientRect().top):10}px`;
    if(space<190) {panel.style.display='none';return;}
    panel.style.display='flex';
    snapshot=core.summarize([...document.querySelectorAll('audio')].map(a=>({src:a.currentSrc||a.src,dur:a.duration})));
    const sig=JSON.stringify(snapshot.items);
    if(sig!==lastSignature){clearPrepared();lastError='';lastSignature=sig;stableSince=Date.now();}
    const m=player.innerText.match(/\d+:\d{2}\s*\/\s*(\d+):(\d{2})/);
    const target=m?Number(m[1])*60+Number(m[2]):0;
    const aligned=target>0 && Math.abs(snapshot.seconds-target)<1;
    const ready=snapshot.items.length>0 && snapshot.unknown===0 && aligned && Date.now()-stableSince>=2000;
    const text=prepared?(prepared.downloadId?`Скачивание ${core.fmtDur(prepared.seconds)}`:prepared.downloadError?'Нажмите ↓ для сохранения':`WAV ${core.fmtDur(prepared.seconds)} готов`):lastError?'Ошибка аудио':`Аудио ${core.fmtDur(snapshot.seconds)}${target?' / '+core.fmtDur(target):''}${ready?' ✓':' …'}`;
    label.title=prepared?.downloadError || lastError || (ready?'Все найденные фрагменты соответствуют длительности таймлайна':snapshot.items.length?'Ожидается полная озвучка. Нажмите Play ближе к концу.':'Аудио пока не найдено. Нажмите Play.');
    if(label.textContent!==text) label.textContent=text;
    download.disabled=!ready;
    if(ready&&!prepared&&!lastError&&!busy) assemble();
    download.style.opacity=ready?'1':'.35';
  }
  refresh.addEventListener('click',()=>{lastError='';scan();});
  async function assemble(){
    if(busy||prepared)return;
    busy=true;download.disabled=true;refresh.disabled=true;
    const items=snapshot.items.map(a=>({...a})), sourcePath=location.pathname;
    let ctx;
    try{
      ctx=new AudioContext();const buffers=[];
      for(let i=0;i<items.length;i++){
        label.textContent=`Готовлю WAV ${i+1}/${items.length}`;
        const response=await chrome.runtime.sendMessage({cmd:'hgInlineFetch',url:items[i].src});
        if(!response?.ok)throw Error(response?.error||'Не удалось получить аудио');
        const bytes=Uint8Array.from(atob(response.base64),c=>c.charCodeAt(0));
        buffers.push(await ctx.decodeAudioData(bytes.buffer));
      }
      const current=core.summarize([...document.querySelectorAll('audio')].map(a=>({src:a.currentSrc||a.src,dur:a.duration})));
      if(location.pathname!==sourcePath||JSON.stringify(current.items)!==JSON.stringify(items))throw Error('Аудио изменилось. Нажмите обновить.');
      const seconds=buffers.reduce((n,b)=>n+b.duration,0);
      if(Math.abs(seconds-snapshot.seconds)>1)throw Error('Длительность аудио изменилась');
      label.textContent='Собираю WAV';
      const merged=await core.mergeBuffers(buffers);
      const url=URL.createObjectURL(core.encodeWav(merged));
      prepared={url,seconds:merged.duration};savedLink.href=url;
      savedLink.download=`heygen_audio_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.wav`;
      savedLink.style.display='inline-flex';download.style.display='none';
      savedLink.title='Скачать готовое аудио';
    }catch(e){lastError=String(e.message||e);}
    finally{if(ctx)await ctx.close();busy=false;refresh.disabled=false;scan();}
  }
  download.addEventListener('click',()=>{if(!download.disabled)assemble();});
  // Metadata arrival and SPA layout changes are also covered by the periodic scan.
  document.addEventListener('loadedmetadata',scan,true);
  document.addEventListener('durationchange',scan,true);
  setInterval(scan,1000);
  scan();
})();
