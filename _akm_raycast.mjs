import WebSocket from 'ws';
const CDP_PORT = 9333;
async function newTab() { return (await fetch(`http://localhost:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' })).json(); }
function connect(wsUrl) { return new Promise((resolve) => { const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 }); ws.on('open', () => resolve(ws)); }); }
let msgId = 0;
function send(ws, method, params = {}) {
  return new Promise((resolve) => {
    const id = ++msgId;
    const handler = (data) => { const msg = JSON.parse(data); if (msg.id === id) { ws.off('message', handler); resolve(msg.result); } };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const tab = await newTab();
  const ws = await connect(tab.webSocketDebuggerUrl);
  await send(ws, 'Page.enable');
  await send(ws, 'Runtime.enable');
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false });
  const uname = '_akmray_' + Date.now().toString().slice(-6);
  await fetch('http://localhost:3001/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: uname, password: 'test1234' }) }).then((r) => r.json());
  await send(ws, 'Page.navigate', { url: 'http://localhost:3001/' });
  await sleep(1000);
  await send(ws, 'Runtime.evaluate', { expression: `localStorage.setItem('ruins_auth', JSON.stringify({username:${JSON.stringify(uname)}}));` });
  await send(ws, 'Page.navigate', { url: 'http://localhost:3001/' });
  await sleep(3500);
  await send(ws, 'Runtime.evaluate', { expression: `document.getElementById('playBtn')?.click();` });
  await sleep(300);
  await send(ws, 'Runtime.evaluate', { expression: `document.getElementById('tabCreateBtn')?.click();` });
  await sleep(300);
  const roomName = 'akmray_' + Date.now().toString().slice(-5);
  await send(ws, 'Runtime.evaluate', { expression: `document.getElementById('roomNameInput').value = ${JSON.stringify(roomName)};` });
  await send(ws, 'Runtime.evaluate', { expression: `document.getElementById('createBtn')?.click();` });
  await sleep(2000);
  await send(ws, 'Runtime.evaluate', { expression: `document.getElementById('lockHint')?.click();` });
  await sleep(2500);
  await send(ws, 'Runtime.evaluate', { expression: `(async()=>{window.__W=await import('/js/weapons.js');window.__VM=await import('/js/viewmodel.js');window.__ST=await import('/js/state.js');return 'ok';})()`, awaitPromise: true });
  for (const [idx, label] of [[0, 'AKM'], [1, 'Shotgun'], [2, 'Glock']]) {
    await send(ws, 'Runtime.evaluate', { expression: `window.__W.setWeapon(${idx});` });
    await sleep(300);
    await send(ws, 'Runtime.evaluate', { expression: `window.__W.startAim();` });
    await sleep(3500);
    const result = await send(ws, 'Runtime.evaluate', { expression: `JSON.stringify(window.__raycastCheck())` });
    console.log(label, ':', result.result?.value || result.exceptionDetails?.text);
    await send(ws, 'Runtime.evaluate', { expression: `window.__W.stopAim();` });
    await sleep(300);
  }

  await send(ws, 'Target.closeTarget', { targetId: tab.id });
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
