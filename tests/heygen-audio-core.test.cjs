const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../heygen-audio-core.js');
test('time never displays seconds 60',()=>{assert.equal(core.fmtDur(119.99),'1:59');assert.equal(core.fmtDur(Infinity),'0:00');});
test('unknown fragments are not counted as loaded and repeated sources retain speech order',()=>{
 const r=core.summarize([{src:'https://x/a',dur:3},{src:'https://x/b',dur:NaN},{src:'https://x/a',dur:3},{src:'blob:x',dur:50}]);
 assert.equal(r.seconds,6);assert.equal(r.unknown,1);assert.equal(r.items.length,3);
});
test('WAV header and interleaved stereo samples',async()=>{
 const blob=core.encodeWav({numberOfChannels:2,length:2,sampleRate:48000,getChannelData:c=>c?[0.5,-0.5]:[1,-1]});
 const bytes=await blob.arrayBuffer(),v=new DataView(bytes);
 assert.equal(bytes.byteLength,52);assert.equal(v.getUint16(22,true),2);assert.equal(v.getUint32(24,true),48000);
 assert.equal(v.getInt16(44,true),32767);assert.equal(v.getInt16(46,true),16383);assert.equal(v.getInt16(48,true),-32768);
});
