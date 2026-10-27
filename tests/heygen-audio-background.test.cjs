const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(){let listener,calls=0;vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../heygen-audio-background.js'),'utf8'),{chrome:{runtime:{onMessage:{addListener:f=>{if(!listener)listener=f}}}},URL,AbortSignal,Uint8Array,btoa,fetch:async()=>{calls++;return {ok:true,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}}});return {send:(sender,url)=>new Promise(resolve=>listener({cmd:'hgInlineFetch',url},sender,resolve)),calls:()=>calls};}
test('accepts HeyGen tab and audio CDN',async()=>{const s=setup();const r=await s.send({url:'https://app.heygen.com/create-v4/x',tab:{id:1}},'https://resource2.heygen.ai/a.wav');assert.equal(r.base64,'AQID');});
test('rejects other senders and lookalike CDN domains',async()=>{const s=setup();for(const [sender,url] of [[{url:'https://evil.test',tab:{id:1}},'https://resource2.heygen.ai/a'],[{url:'https://app.heygen.com/x',tab:{id:1}},'https://heygen.ai.evil.test/a']])assert.equal((await s.send(sender,url)).ok,false);assert.equal(s.calls(),0);});
test('download requires browser confirmation and propagates failure',async()=>{
 for(const fail of [false,true]) {
  let listener;
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../heygen-audio-background.js'),'utf8'),{chrome:{runtime:{onMessage:{addListener:f=>{if(!listener)listener=f}}},downloads:{download:async()=>{if(fail)throw Error('Download rejected');return 42}}},URL});
  const result=await new Promise(resolve=>listener({cmd:'hgInlineDownload',url:'blob:https://app.heygen.com/test'},{url:'https://app.heygen.com/create-v4/test',tab:{id:1}},resolve));
  assert.equal(result.ok,!fail);if(!fail)assert.equal(result.downloadId,42);
 }
});
test('assembly opens an active extension tab as required by the in-app browser',async()=>{
 const listeners=[],jobs={};let opened;
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../heygen-audio-background.js'),'utf8'),{
  URL,crypto:{randomUUID:()=> 'test-123'},chrome:{runtime:{onMessage:{addListener:f=>listeners.push(f)},getURL:p=>'chrome-extension://test/'+p},storage:{local:{set:async obj=>Object.assign(jobs,obj),remove:async key=>delete jobs[key]}},tabs:{create:async options=>{if(!options.active)throw Error('Owl extension-created tabs must be active.');opened=options;}}}
 });
 const result=await new Promise(resolve=>listeners[1]({cmd:'hgAudioStart',items:[{src:'https://resource2.heygen.ai/a.wav',dur:3}]},{url:'https://app.heygen.com/create-v4/test',tab:{id:7}},resolve));
 assert.equal(result.ok,true);assert.equal(opened.active,true);assert.equal(jobs[result.key].owner,7);assert.equal(jobs[result.key].seconds,3);
});
