// Loopback-only fixture: actual Flow input helpers, trusted CDP input, no Google requests or credits.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const proofDir = fs.mkdtempSync('/tmp/multibot-flow-proof-');
const source = fs.readFileSync(path.join(__dirname, '../flow.js'), 'utf8');
const slice = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const debuggerCode = slice('let flowDebuggerQueue', '// ── функции, исполняемые');
const domCode = slice('function probe()', '// ── помощники');
const inputCode = slice('async function run(fn)', '// Сначала дожидаемся');
let serial = 0;
const queue = [], pending = new Map();
const script = `
let attachedTab=null,baseLen=0,job={tabId:42,running:true};
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),isEmpty=p=>!!p&&p.len<=baseLen+5;
const logs=[],say=text=>logs.push(text);
const toTabGetQuiet=async()=>({url:'https://flow.google.com/project/local-fixture'});
const onDetach=[];
const chrome={debugger:{attach:async()=>{},detach:async()=>{},onDetach:{addListener:fn=>onDetach.push(fn)},
sendCommand:async(target,method,params)=>{const r=await fetch('/command',{method:'POST',body:JSON.stringify({method,params})});const data=await r.json();if(data.error)throw Error(data.error);return data.result;}},
scripting:{executeScript:async({func})=>[{result:func()}]},
tabs:{update:()=>{throw Error('unexpected tab activation')}},windows:{update:()=>{throw Error('unexpected window focus')}}};
${debuggerCode}
${domCode}
${inputCode}
const editor=document.querySelector('[contenteditable]'),button=document.querySelector('button'),sent=[];
const update=()=>button.disabled=!editor.innerText.trim();
editor.addEventListener('input',update);
function submit(){if(button.disabled)return;sent.push(editor.innerText);editor.replaceChildren();button.textContent='stop';button.disabled=false;}
button.addEventListener('click',submit);
editor.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();submit();}});
window.startFlowTest=()=>{window.flowTestResult=null;(async()=>{
const before={focus:document.hasFocus(),visibility:document.visibilityState};
try{const entered=await putText('CANON test character\\n\\n1.00sec\\nПромт: first\\n2.00sec\\nПромт: second');const delivered=entered&&await send();window.flowTestResult={ok:delivered,sent,logs,before,virtual:{focus:document.hasFocus(),visibility:document.visibilityState}};}
catch(e){window.flowTestResult={ok:false,error:String(e),logs,before};}
finally{await detach();window.flowTestResult.released=true;document.querySelector('#result').textContent=JSON.stringify(window.flowTestResult,null,2);}
})();return true;};
`;
const server = http.createServer((req, res) => {
  const send = (type, body) => { res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(body); };
  if (req.url === '/queue') return send('application/json', JSON.stringify(queue.splice(0)));
  if (req.url === '/proof' && req.method === 'POST') {
    let body = ''; req.on('data', chunk => { body += chunk; if (body.length > 3000000) req.destroy(); });
    req.on('end', () => {
      const bytes = Buffer.from(body, 'base64');
      if (bytes[0] !== 0x89 || bytes[1] !== 0x50) { res.writeHead(400); res.end(); return; }
      const file = path.join(proofDir, 'flow-background-test.png');
      fs.writeFileSync(file, bytes); send('application/json', JSON.stringify({ path: file }));
    }); return;
  }
  if (req.method === 'POST') {
    let body = ''; req.on('data', chunk => { body += chunk; if (body.length > 100000) req.destroy(); });
    req.on('end', () => {
      const data = JSON.parse(body);
      if (req.url === '/command') { const id = ++serial; pending.set(id, result => send('application/json', JSON.stringify(result))); queue.push({ id, ...data }); }
      else if (req.url === '/resolve') { const reply = pending.get(data.id); pending.delete(data.id); reply?.(data); send('application/json', '{}'); }
      else { res.writeHead(404); res.end(); }
    }); return;
  }
  if (req.url === '/harness.js') return send('text/javascript', script);
  if (req.url === '/control') return send('text/html', '<h1>Active control tab</h1><p>Flow test stays in the other tab.</p>');
  send('text/html', '<!doctype html><meta charset="utf-8"><title>Flow background test</title><style>body{font:16px system-ui;background:#181818;color:#ddd;padding:24px}[contenteditable]{border:1px solid #555;min-height:100px;padding:16px}button{margin-top:12px}pre{white-space:pre-wrap}</style><h1>Isolated Flow input test</h1><div contenteditable="true"></div><button disabled>arrow_forward</button><pre id="result">Waiting</pre><script src="/harness.js"></script>');
});
server.listen(Number(process.argv[2]) || 0, '127.0.0.1', () => console.log('Flow background fixture: http://127.0.0.1:' + server.address().port));
