import { MAPS, MAP_BOUNDS, DEFAULT_MAP } from '/shared/gameData.js';
import { state } from './state.js';
import { sendMsg } from './net.js';
import { cancelGrenadeAim } from './weapons.js';

// ---------- DOM ----------
const authScreen = document.getElementById('authScreen');
const authUserInput = document.getElementById('authUserInput');
const authPassInput = document.getElementById('authPassInput');
const authError = document.getElementById('authError');
const authLoginBtn = document.getElementById('authLoginBtn');
const authRegisterBtn = document.getElementById('authRegisterBtn');
const accountLabel = document.getElementById('accountLabel');
const logoutBtn = document.getElementById('logoutBtn');
export const menuScreen = document.getElementById('menuScreen');
export const nameInput = document.getElementById('nameInput');
const roomNameInput = document.getElementById('roomNameInput');
const createBtn = document.getElementById('createBtn');
const refreshBtn = document.getElementById('refreshBtn');
const tabJoinBtn = document.getElementById('tabJoinBtn');
const tabCreateBtn = document.getElementById('tabCreateBtn');
const joinPanel = document.getElementById('joinPanel');
const createPanel = document.getElementById('createPanel');
const roomListEl = document.getElementById('roomList');
export const gameContainer = document.getElementById('gameContainer');
export const hud = document.getElementById('hud');
export const lockHint = document.getElementById('lockHint');
const killFeed = document.getElementById('killFeed');
export const roomTag = document.getElementById('roomTag');
const scoreboard = document.getElementById('scoreboard');
const scoreboardBody = document.getElementById('scoreboardBody');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');
const mapSelect = document.getElementById('mapSelect');
const matchDurationInput = document.getElementById('matchDurationInput');
const memeModeToggle = document.getElementById('memeModeToggle');
export const matchTimer = document.getElementById('matchTimer');
export const matchEndScreen = document.getElementById('matchEndScreen');
export const matchEndBody = document.getElementById('matchEndBody');
const matchEndQuitBtn = document.getElementById('matchEndQuitBtn');
const controlsBtn = document.getElementById('controlsBtn');
const controlsModal = document.getElementById('controlsModal');
const closeControlsBtn = document.getElementById('closeControlsBtn');
let controlsOpenedFromPause = false;
controlsBtn.addEventListener('click', () => { controlsModal.hidden = false; });
closeControlsBtn.addEventListener('click', () => {
  controlsModal.hidden = true;
  if (controlsOpenedFromPause) { pauseMenu.hidden = false; controlsOpenedFromPause = false; }
});

// ---------- Auth: simple username/password, checked against server/users.json ----------
// Not meant to be bulletproof security — this is a LAN party game, not a bank — but a real
// username/password IS checked against the server on login/register (so you can't just claim
// someone else's name without their password). Once verified, the browser remembers it
// (`ruins_auth` in localStorage) so a reload — including the "Quit to Menu" flow, which is a
// full `location.reload()` — goes straight back to the join/create tab instead of asking for
// the password again every time.
function getAuth() {
  try { return JSON.parse(localStorage.getItem('ruins_auth') || 'null'); } catch { return null; }
}
function setAuth(username) { localStorage.setItem('ruins_auth', JSON.stringify({ username })); }
function clearAuth() { localStorage.removeItem('ruins_auth'); }

function showMenu(username) {
  authScreen.hidden = true;
  menuScreen.hidden = false;
  accountLabel.textContent = `Signed in as ${username}`;
  if (!nameInput.value) nameInput.value = username;
}
function showAuth() {
  menuScreen.hidden = true;
  authScreen.hidden = false;
  authPassInput.value = '';
  authError.textContent = '';
  authUserInput.focus();
}

async function submitAuth(kind) {
  const username = (authUserInput.value || '').trim();
  const password = authPassInput.value || '';
  authError.textContent = '';
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    authError.textContent = 'Username must be 3-20 letters, numbers, or underscores.';
    return;
  }
  if (password.length < 4) {
    authError.textContent = 'Password must be at least 4 characters.';
    return;
  }
  const btn = kind === 'login' ? authLoginBtn : authRegisterBtn;
  btn.disabled = true;
  try {
    const res = await fetch(`/api/${kind}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      authError.textContent = data.error || 'Something went wrong.';
      return;
    }
    setAuth(username);
    showMenu(username);
  } catch (err) {
    authError.textContent = 'Could not reach the server.';
  } finally {
    btn.disabled = false;
  }
}
authLoginBtn.addEventListener('click', () => submitAuth('login'));
authRegisterBtn.addEventListener('click', () => submitAuth('register'));
authPassInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAuth('login'); });
authUserInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') authPassInput.focus(); });
logoutBtn.addEventListener('click', () => { clearAuth(); showAuth(); });

const savedAuth = getAuth();
if (savedAuth && savedAuth.username) showMenu(savedAuth.username);
else showAuth();

// Every button in the UI gets 2 small blood-stain decals, picked randomly per button so no two
// look the same — random source image per decal (both provided splatter photos get used, not
// just one), random size/rotation/flip, 2 DIFFERENT corners (sampled without replacement, so
// the pair doesn't land on top of each other) for denser coverage than a single decal gave.
// Real <img> elements showing the WHOLE splatter photo (scaled/rotated), not a background-
// image crop into one region of it — the crop approach rendered as a visible hard-edged
// rectangle in testing instead of the organic splatter shape (same issue as the match-end
// screen's stains, see index.html), so this avoids that whole class of bug rather than trying
// to fix the crop math blind, without a real browser here to verify it in.
// Runs once at load over every <button> that exists in the static HTML — buttons created later
// (there aren't any, all of this game's controls are static markup, just shown/hidden) would
// miss out, but nothing in this UI works that way.
function decorateButtonsWithBlood() {
  const images = ['/images/blood_splat1.png', '/images/blood_splat2.png'];
  const corners = [
    { top: '-8px', left: '-8px' }, { top: '-8px', right: '-8px' },
    { bottom: '-8px', left: '-8px' }, { bottom: '-8px', right: '-8px' },
  ];
  document.querySelectorAll('button').forEach((btn) => {
    if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
    const shuffled = [...corners].sort(() => Math.random() - 0.5);
    for (let i = 0; i < 2; i++) {
      const decal = document.createElement('img');
      decal.className = 'btnBloodDecal';
      decal.alt = '';
      decal.src = images[Math.floor(Math.random() * images.length)];
      const size = 16 + Math.random() * 14; // 16-30px — small enough to stay out of the label's way
      decal.style.width = `${size}px`;
      const rot = Math.floor(Math.random() * 360);
      const flip = Math.random() < 0.5 ? -1 : 1;
      decal.style.transform = `rotate(${rot}deg) scaleX(${flip})`;
      Object.assign(decal.style, shuffled[i]);
      btn.appendChild(decal);
    }
  });
}
decorateButtonsWithBlood();

// Menu room list: refresh on demand, and keep it live while browsing.
refreshBtn.addEventListener('click', () => sendMsg({ type: 'listRooms' }));
setInterval(() => { if (!menuScreen.hidden) sendMsg({ type: 'listRooms' }); }, 3000);

function setTab(tab) {
  const join = tab === 'join';
  tabJoinBtn.classList.toggle('active', join);
  tabCreateBtn.classList.toggle('active', !join);
  joinPanel.hidden = !join;
  createPanel.hidden = join;
  if (join) sendMsg({ type: 'listRooms' });
}
tabJoinBtn.addEventListener('click', () => setTab('join'));
tabCreateBtn.addEventListener('click', () => setTab('create'));

export function currentName() {
  const n = (nameInput.value || 'Player').trim().slice(0, 16) || 'Player';
  localStorage.setItem('ruins_name', n);
  return n;
}

// The time input now has `step="1"` (index.html) so its native picker shows a seconds field
// too — once a `<input type=time>` allows sub-minute precision, its `.value` format switches
// from "HH:MM" to "HH:MM:SS" on its own (that's the browser's behavior, not something set
// here). Parses either shape and returns total SECONDS (not minutes — minute-only granularity
// is exactly the limitation this was asked to fix), seconds group optional so an old/blank
// "HH:MM" value (or a browser that still reports one at :00 seconds) still parses correctly.
function parseDurationSec(hms) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hms || '');
  if (!m) return 0;
  const hh = parseInt(m[1], 10), mm = parseInt(m[2], 10), ss = m[3] ? parseInt(m[3], 10) : 0;
  return Math.max(0, hh * 3600 + mm * 60 + ss);
}

// Defaults ON — the toggle only needs to be touched to turn memes OFF, not to opt in.
let memeModeOn = true;
memeModeToggle.addEventListener('click', () => {
  memeModeOn = !memeModeOn;
  memeModeToggle.textContent = memeModeOn ? 'ON' : 'OFF';
  memeModeToggle.classList.toggle('on', memeModeOn);
  memeModeToggle.classList.toggle('off', !memeModeOn);
});

createBtn.addEventListener('click', () => {
  sendMsg({ type: 'hello', name: currentName() });
  const rn = (roomNameInput.value || 'Ruins Match').trim().slice(0, 24) || 'Ruins Match';
  const durationSec = parseDurationSec(matchDurationInput.value);
  sendMsg({ type: 'createRoom', roomName: rn, map: mapSelect.value || DEFAULT_MAP, durationSec, memeMode: memeModeOn });
});

matchEndQuitBtn.addEventListener('click', () => { location.reload(); });

nameInput.addEventListener('change', () => sendMsg({ type: 'hello', name: currentName() }));

export function renderRoomList(rooms) {
  roomListEl.innerHTML = '';
  if (!rooms.length) {
    roomListEl.innerHTML = '<div class="empty-hint">No open rooms yet — create one, or wait for a host.</div>';
    return;
  }
  for (const r of rooms) {
    const row = document.createElement('div');
    row.className = 'roomRow';
    const mapName = MAPS[r.map]?.name || 'City';
    row.innerHTML = `<span>${escapeHtml(r.name)} <span class="count">· ${mapName}</span></span><span class="count">${r.count}/${r.max}</span>`;
    row.addEventListener('click', () => {
      sendMsg({ type: 'hello', name: currentName() });
      sendMsg({ type: 'joinRoom', roomId: r.id });
    });
    roomListEl.appendChild(row);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function pushKillFeed(text) {
  const div = document.createElement('div');
  div.textContent = text;
  killFeed.prepend(div);
  setTimeout(() => div.remove(), 4500);
  while (killFeed.children.length > 5) killFeed.lastChild.remove();
}

export function renderBoardInto(tbody, list) {
  tbody.innerHTML = list
    .map((p, i) => `<tr><td>${i + 1}</td><td class="name">${escapeHtml(p.name)}${p.id === state.localId ? ' (you)' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`)
    .join('');
}
export function renderLeaderboard(list) {
  renderBoardInto(scoreboardBody, list);
}
export function hideScoreboard() { scoreboard.hidden = true; }
export function showScoreboard() { scoreboard.hidden = false; }

// ---------- Pointer lock + pause menu ----------
export const pauseMenu = document.getElementById('pauseMenu');
const resumeBtn = document.getElementById('resumeBtn');
const pauseControlsBtn = document.getElementById('pauseControlsBtn');
const quitBtn = document.getElementById('quitBtn');
let everLocked = false; // first-ever lock shows the plain "click to enter" hint; after that,
                         // losing the lock (Esc, alt-tab) shows the full pause menu instead

// Exported so the bootstrap can request the very first lock (there's no button-click available
// to trigger it at that point) the same way lockHint/resumeBtn already do internally here.
export function requestLock() { state.renderer.domElement.requestPointerLock(); }
lockHint.addEventListener('click', requestLock);
resumeBtn.addEventListener('click', requestLock);
pauseControlsBtn.addEventListener('click', () => { pauseMenu.hidden = true; controlsOpenedFromPause = true; controlsModal.hidden = false; });
quitBtn.addEventListener('click', () => { location.reload(); });

document.addEventListener('pointerlockchange', () => {
  state.pointerLocked = document.pointerLockElement === state.renderer?.domElement;
  if (state.pointerLocked) {
    everLocked = true;
    lockHint.hidden = true;
    pauseMenu.hidden = true;
  } else if (!hud.hidden && !state.matchOver) { // not pre-join menu, not after the match has ended
    if (everLocked) pauseMenu.hidden = false;
    else lockHint.hidden = false;
  }
  // losing focus/lock mid-hold (alt-tab, etc.) can eat the keyup — don't leave the trajectory
  // preview stuck on screen or a throw silently queued for whenever G is next released
  if (!state.pointerLocked) cancelGrenadeAim();
});

// ---------- Minimap: top-down obstacle layout + a triangle for the player ----------
const MINIMAP_SIZE = 150;
// The map is no longer a square (MAP_BOUNDS.maxZ doubles the depth vs the width) — scale
// uniformly by the larger dimension so buildings don't come out stretched, and center the
// (now off-origin) world bounds in the square canvas rather than assuming it's centered at 0.
const MINIMAP_MAP_W = MAP_BOUNDS.maxX - MAP_BOUNDS.minX;
const MINIMAP_MAP_D = MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ;
const MINIMAP_SCALE = Math.min(MINIMAP_SIZE / MINIMAP_MAP_W, MINIMAP_SIZE / MINIMAP_MAP_D) * 0.95;
const MINIMAP_CENTER_X = (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) / 2;
const MINIMAP_CENTER_Z = (MAP_BOUNDS.minZ + MAP_BOUNDS.maxZ) / 2;
function toMinimap(x, z) {
  return [MINIMAP_SIZE / 2 + (x - MINIMAP_CENTER_X) * MINIMAP_SCALE, MINIMAP_SIZE / 2 + (z - MINIMAP_CENTER_Z) * MINIMAP_SCALE];
}
export function drawMinimap() {
  const ctx = minimapCtx;
  ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
  ctx.fillStyle = 'rgba(140,124,102,0.55)';
  for (const o of state.ACTIVE_WALLS) {
    const [cx, cy] = toMinimap(o.x, o.z);
    ctx.fillRect(cx - (o.w * MINIMAP_SCALE) / 2, cy - (o.d * MINIMAP_SCALE) / 2, o.w * MINIMAP_SCALE, o.d * MINIMAP_SCALE);
  }
  ctx.fillStyle = 'rgba(200,190,150,0.7)'; // upper-floor platforms drawn brighter, distinct from walls
  for (const p of state.ACTIVE_PLATFORMS) {
    const [cx, cy] = toMinimap(p.x, p.z);
    ctx.fillRect(cx - (p.w * MINIMAP_SCALE) / 2, cy - (p.d * MINIMAP_SCALE) / 2, p.w * MINIMAP_SCALE, p.d * MINIMAP_SCALE);
  }
  // Same forward-vector convention as updateMovement's WASD-to-world mapping: at yaw=0,
  // "forward" is world (0,-1) — the triangle itself points this way, so a separate ray line
  // was redundant (and looked odd) on top of it.
  const [px, py] = toMinimap(state.playerX, state.playerZ);
  const fx = -Math.sin(state.yaw), fz = -Math.cos(state.yaw);
  const perpX = -fz, perpZ = fx;
  const size = 6;
  const tipX = px + fx * size * 1.6, tipY = py + fz * size * 1.6;
  const backX = px - fx * size * 0.6, backY = py - fz * size * 0.6;
  ctx.fillStyle = '#ffe066';
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(backX + perpX * size * 0.8, backY + perpZ * size * 0.8);
  ctx.lineTo(backX - perpX * size * 0.8, backY - perpZ * size * 0.8);
  ctx.closePath();
  ctx.fill();
}

export function updateMatchTimerDisplay() {
  if (state.matchEndsAt && !state.matchOver) {
    const remaining = Math.max(0, state.matchEndsAt - Date.now());
    const mm = Math.floor(remaining / 60000);
    const ss = Math.floor((remaining % 60000) / 1000);
    matchTimer.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
  }
}
