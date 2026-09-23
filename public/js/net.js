// WebSocket connection + outbound message helpers. Deliberately imports ONLY state.js — never
// a feature module — so every feature module can import sendMsg/sendState from here with zero
// circular-import risk. The inbound message DISPATCH (the big handleMessage switch) is NOT
// here: it needs to call into nearly every other module, so it lives in the bootstrap
// (client.js), which is the one file allowed to import everything. connectWebSocket takes the
// dispatcher as a callback instead of importing it, which is what keeps this file's import
// graph terminating at state.js alone.
import { state } from './state.js';

let ws = null;
let handlers = null;
let attempt = 0;
let retryTimer = null;
let lastMsgAt = 0;
let leaving = false;

// Connects and KEEPS reconnecting: any drop (server restart, wifi blip, sleeping laptop) schedules
// another attempt with a growing delay, capped at 5s. `onOpen(wasRetry)` fires on every successful
// (re)connect; `onStatus('connected' | 'reconnecting', attempt)` drives the on-screen banner. What
// to DO after a reconnect (rejoin the match) is the bootstrap's business, not this file's.
export function connectWebSocket({ onOpen, onMessage, onStatus }) {
  handlers = { onOpen, onMessage, onStatus: onStatus || (() => {}) };
  openSocket();
  setInterval(watchdog, 2000);
}

function openSocket() {
  // Scheme MUST follow the page's own protocol, not a hardcoded 'ws://' — a page loaded over
  // https (any real TLS-terminated public deployment, behind a domain + reverse proxy) is not
  // allowed by the browser to open a plain insecure ws:// connection (mixed-content blocking);
  // it silently fails, which breaks everything downstream of the socket even if the page and the
  // login POSTs (plain relative fetch() calls, unaffected by this) loaded fine.
  const wsScheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const sock = new WebSocket(`${wsScheme}//${location.host}`);
  ws = sock;
  // Every listener ignores a socket that's no longer THE current one, so a late event from an
  // abandoned connection can never re-trigger a reconnect or double-deliver a message.
  sock.addEventListener('open', () => {
    if (sock !== ws) return;
    const wasRetry = attempt > 0;
    attempt = 0; lastMsgAt = Date.now();
    handlers.onStatus('connected');
    handlers.onOpen(wasRetry);
  });
  sock.addEventListener('message', (ev) => {
    if (sock !== ws) return;
    lastMsgAt = Date.now();
    handlers.onMessage(JSON.parse(ev.data));
  });
  sock.addEventListener('close', () => { if (sock === ws && !leaving) scheduleReconnect(); });
}

function scheduleReconnect() {
  attempt++;
  handlers.onStatus('reconnecting', attempt);
  clearTimeout(retryTimer);
  retryTimer = setTimeout(openSocket, Math.min(5000, 500 + attempt * 600));
}

// The server ticks state at 20Hz, so in a live match several seconds of total silence means the
// connection is dead even if the browser hasn't noticed (a half-open socket can sit "OPEN" for
// minutes). Don't wait for its close event — abandon it and reconnect now.
function watchdog() {
  if (!ws || leaving || ws.readyState !== WebSocket.OPEN || state.localId == null || state.matchOver) return;
  if (Date.now() - lastMsgAt < 6000) return;
  const dead = ws;
  ws = null;
  try { dead.close(); } catch { /* already gone */ }
  scheduleReconnect();
}

export function sendMsg(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

// Deliberate quit: tell the server to free the slot NOW (no 30s grace) and stop auto-reconnecting.
export function leaveConnection() {
  leaving = true;
  sendMsg({ type: 'leave' });
  clearSession();
}

// ---------- Session (which match am I in, and what was I carrying) ----------
// sessionStorage, not localStorage: it survives a refresh of THIS tab (the case we want to
// resume from) but not a fresh tab or a browser restart, where silently teleporting someone
// back into an old match would be surprising.
const SESSION_KEY = 'wreckveil_session', LOADOUT_KEY = 'wreckveil_loadout';
export function saveSession(obj) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(obj)); } catch { /* storage blocked */ } }
export function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } }
export function saveLoadout(obj) { try { sessionStorage.setItem(LOADOUT_KEY, JSON.stringify(obj)); } catch { /* storage blocked */ } }
export function loadLoadout() { try { return JSON.parse(sessionStorage.getItem(LOADOUT_KEY) || 'null'); } catch { return null; } }
export function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(LOADOUT_KEY); } catch { /* storage blocked */ }
}

let netTimer = 0;
// pos[1] is the player's standing SURFACE height (0 on plain ground, floorY on a building's
// upper platform) — not eye height/jump — so server-side hit detection (which builds each
// target's hit-cylinder up from pos[1]) is correct for players on an elevated floor too.
export function sendState(dt, currentWeapon) {
  netTimer += dt;
  if (netTimer < 0.066) return;
  netTimer = 0;
  sendMsg({
    type: 'state',
    pos: [state.playerX, state.currentGroundY, state.playerZ],
    rot: [state.yaw, state.pitch],
    weapon: currentWeapon,
    crouch: state.isCrouched,
    prone: state.isProne,
    moving: state.isMoving,
    sprint: state.isSprinting,
  });
}
