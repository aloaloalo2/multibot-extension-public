const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../heygen-audio-inline.js'),'utf8');
function setup(failDownload=false){
 const nodes=[], calls=[]; let clock=0, tick;
 function element(tag){const e={tag,style:{cssText:''},children:[],events:{},isConnected:false,innerText:'',setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]},append(...xs){this.children.push(...xs);xs.forEach(x=>x.isConnected=true)},insertBefore(x,y){this.children.splice(this.children.indexOf(y),0,x)},addEventListener(k,f){this.events[k]=f},remove(){this.isConnected=false},getBoundingClientRect(){return {left:600,right:100,top:4}}};nodes.push(e);return e;}
 const audio={src:'https://resource2.heygen.ai/test.wav',duration:3};
 const player={innerText:'0:00 / 0:03'};
 const use={getAttribute(){return '#play'},closest(){return {parentElement:player}}};
 const ctx={document:{createElement:element,getElementById(id){return id==='orby-nav-button'?{getBoundingClientRect(){return {left:600}}}:null},querySelector(){return {getBoundingClientRect(){return {right:100,top:4}}}},querySelectorAll(sel){return sel==='audio'?[audio]:sel==='button svg use'?[use]:[]},body:element('body'),addEventListener(){}},window:{addEventListener(){}},location:{pathname:'/create-v4/test'},innerWidth:800,setInterval(f){tick=f},setTimeout(f){f()},Date:class extends Date{static now(){return clock}},URL:{createObjectURL(){return 'blob:https://app.heygen.com/test'},revokeObjectURL(){}},atob(){return 'a'},Uint8Array,AudioContext:class{async decodeAudioData(){return {duration:3}}async close(){}},MultiBotHeyGenAudio:{summarize(){return {items:[{src:audio.src,dur:3}],seconds:3,unknown:0}},fmtDur(){return '0:03'},async mergeBuffers(){return {duration:3}},encodeWav(){return {}}},chrome:{runtime:{async sendMessage(m){calls.push(m);return failDownload?{ok:false,error:'fetch failed'}:{ok:true,base64:'YQ=='}}}}};
 vm.runInNewContext(source,ctx);clock=3000;tick();
 return {calls,nodes,button:nodes.find(n=>n['aria-label']==='Скачать аудио'),link:nodes.find(n=>n.tag==='a'),status:nodes.find(n=>n.role==='status')};
}
test('full audio is prepared before a click and exposed as a direct download link',async()=>{
 const x=setup();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(x.calls.map(c=>c.cmd),['hgInlineFetch']);
 assert.equal(x.link.style.display,'inline-flex');assert.ok(x.link.href.startsWith('blob:'));
 assert.match(x.link.download,/^heygen_audio_.*wav$/);assert.match(x.status.textContent,/0:03/);
});
test('a failed fragment does not expose an incomplete download',async()=>{
 const x=setup(true);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(x.link.href,undefined);assert.match(x.status.title,/fetch failed/);
});
