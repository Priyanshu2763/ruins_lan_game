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
  const uname = '_verifyalign_' + Date.now().toString().slice(-6);
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
  const roomName = 'verifyalign_' + Date.now().toString().slice(-5);
  await send(ws, 'Runtime.evaluate', { expression: `document.getElementById('roomNameInput').value = ${JSON.stringify(roomName)};` });
  await send(ws, 'Runtime.evaluate', { expression: `document.getElementById('createBtn')?.click();` });
  await sleep(2000);
  await send(ws, 'Runtime.evaluate', { expression: `document.getElementById('lockHint')?.click();` });
  await sleep(2500);
  await send(ws, 'Runtime.evaluate', { expression: `(async()=>{window.__W=await import('/js/weapons.js');window.__VM=await import('/js/viewmodel.js');window.__ST=await import('/js/state.js');return 'ok';})()`, awaitPromise: true });

  // Hip-fire crosshair check: confirm the actual fired ray direction equals camera forward,
  // and that the CSS crosshair element sits at exact pixel center (not just "should be").
  const hipCheck = await send(ws, 'Runtime.evaluate', {
    expression: `
      (() => {
        const el = document.getElementById('crosshair');
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width/2, cy = r.top + r.height/2;
        return JSON.stringify({ crosshairCenter: [cx, cy], screenCenter: [innerWidth/2, innerHeight/2] });
      })()
    `
  });
  console.log('HIP-FIRE crosshair position check:', hipCheck.result?.value);

  // Fire-direction check: does the actual bullet ray (computed the same way fire() computes it)
  // match camera-forward exactly, and does camera-forward project to exact NDC (0,0)?
  const fireDirCheck = await send(ws, 'Runtime.evaluate', {
    expression: `
      (async () => {
        const THREE = await import('three');
        const origin = new THREE.Vector3(); window.__ST.state.camera.getWorldPosition(origin);
        const dir = new THREE.Vector3(); window.__ST.state.camera.getWorldDirection(dir);
        // where does this ray project on screen? a point far along dir from origin, projected via camera
        const farPoint = origin.clone().addScaledVector(dir, 50);
        const ndc = farPoint.clone().project(window.__ST.state.camera);
        return JSON.stringify({ fireRayNDC: ndc.toArray() });
      })()
    `,
    awaitPromise: true,
  });
  console.log('Fire-ray screen alignment (should be ~[0,0,*]):', fireDirCheck.result?.value);

  for (const [idx, label] of [[0, 'AKM'], [1, 'Shotgun'], [2, 'Glock']]) {
    await send(ws, 'Runtime.evaluate', { expression: `window.__W.setWeapon(${idx});` });
    await sleep(300);
    await send(ws, 'Runtime.evaluate', { expression: `window.__W.startAim();` });
    await sleep(3000);

    // For AKM specifically (no ADS_RETICLE marker), find the geometric center of the gun's OWN
    // visible cross-section at the plane closest to the camera along its sight line — approximate
    // via the narrowest point of the gun mesh near its top (front sight post tip is the thinnest,
    // topmost protrusion). Simpler and more robust: sample the actual rendered pixels at exact
    // screen-center column and look for the sight's silhouette, cross-referenced with a real screenshot.
    const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
    (await import('fs')).writeFileSync(`/tmp/claude-1000/-home-chicmic-a-ruins/8a5c3707-5c7f-4f66-8cf0-9907f0d34174/scratchpad/verify_${idx}_${label}.png`, Buffer.from(shot.data, 'base64'));
    console.log(`saved ${label}`);
    await send(ws, 'Runtime.evaluate', { expression: `window.__W.stopAim();` });
    await sleep(300);
  }

  await send(ws, 'Target.closeTarget', { targetId: tab.id });
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
