/* Fetch in the extension context so CDN CORS does not break the page panel. */
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!['hgInlineFetch','hgInlineDownload'].includes(message?.cmd)) return;
  (async () => {
    try {
      const origin = new URL(sender.url || '').origin;
      if (origin !== 'https://app.heygen.com' || !sender.tab) throw Error('Нет доступа');
      if (message.cmd === 'hgInlineDownload') {
        if (!String(message.url).startsWith('blob:https://app.heygen.com/')) throw Error('Неверный адрес WAV');
        const id=await chrome.downloads.download({url:message.url,saveAs:false,filename:`heygen_audio_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.wav`});
        if (!Number.isInteger(id)) throw Error('Браузер не подтвердил скачивание');
        reply({ok:true,downloadId:id}); return;
      }
      const url = new URL(message.url);
      if (url.protocol !== 'https:' || !/(^|\.)(heygen\.ai|heygen\.com|amazonaws\.com)$/.test(url.hostname)) throw Error('Неизвестный источник аудио');
      const res = await fetch(url.href, {credentials:'omit', signal:AbortSignal.timeout(25000)});
      if (!res.ok) throw Error(`Аудиофайл: HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > 24 * 1024 * 1024) throw Error('Аудиофрагмент слишком большой');
      let binary = '';
      for(let i=0;i<bytes.length;i+=32768) binary += String.fromCharCode(...bytes.subarray(i,i+32768));
      reply({ok:true, base64:btoa(binary)});
    } catch(e) { reply({ok:false,error:String(e.message || e)}); }
  })();
  return true;
});

// Assemble in an extension document, so the download owns an extension-origin blob.
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(!['hgAudioStart','hgAudioStatus'].includes(message?.cmd))return;
 (async()=>{
  try{
   if(new URL(sender.url||'').origin!=='https://app.heygen.com'||!sender.tab)throw Error('Нет доступа');
   if(message.cmd==='hgAudioStatus'){
    if(!/^hg-audio-[a-z0-9-]+$/.test(message.key||''))throw Error('Неверное задание');
    const data=await chrome.storage.local.get(message.key),job=data[message.key];
    if(!job||job.owner!==sender.tab.id)throw Error('Нет задания');
    reply({ok:true,state:job.state,text:job.text,path:job.path});return;
   }
   if(!Array.isArray(message.items)||!message.items.length||message.items.length>200)throw Error('Нет аудиофрагментов');
   let seconds=0;
   const items=message.items.map(a=>{
    const u=new URL(a.src);
    if(u.protocol!=='https:'||!/(^|\.)(heygen\.ai|heygen\.com|amazonaws\.com)$/.test(u.hostname)||!Number.isFinite(a.dur)||a.dur<=0)throw Error('Неверный аудиофрагмент');
    seconds+=a.dur;return {src:u.href,dur:a.dur};
   });
   if(seconds>14400)throw Error('Слишком длинная запись');
   const key=`hg-audio-${crypto.randomUUID()}`;
   const filename=`heygen_audio_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}.wav`;
   await chrome.storage.local.set({[key]:{owner:sender.tab.id,items,seconds,filename,state:'queued',text:'Подготавливаю аудио'}});
   try{await chrome.tabs.create({url:chrome.runtime.getURL(`heygen-audio-download.html?job=${key}`),active:true});}
   catch(e){await chrome.storage.local.remove(key);throw e;}
   reply({ok:true,key});
  }catch(e){reply({ok:false,error:String(e.message||e)});}
 })();return true;
});
