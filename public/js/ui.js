import { MAPS, MAP_BOUNDS, DEFAULT_MAP } from '/shared/gameData.js';
import { state } from './state.js';
import { sendMsg } from './net.js';
import { cancelGrenadeAim } from './weapons.js';
import { setMasterVolume } from './audio.js';

// ---------- DOM ----------
const authScreen = document.getElementById('authScreen');
const authUserInput = document.getElementById('authUserInput');
const authPassInput = document.getElementById('authPassInput');
const authError = document.getElementById('authError');
const authLoginBtn = document.getElementById('authLoginBtn');
const authRegisterBtn = document.getElementById('authRegisterBtn');
const dashboardScreen = document.getElementById('dashboardScreen');
const dashAccountLabel = document.getElementById('dashAccountLabel');
const dashLogoutBtn = document.getElementById('dashLogoutBtn');
const dashPlayBtn = document.getElementById('dashPlayBtn');
const dashControlsBtn = document.getElementById('dashControlsBtn');
const dashNavBtns = document.querySelectorAll('.dashNavBtn[data-pane]');
const dashPanes = document.querySelectorAll('.dashPane[data-pane]');
const closeMenuBtn = document.getElementById('closeMenuBtn');
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
const controlsModal = document.getElementById('controlsModal');
const closeControlsBtn = document.getElementById('closeControlsBtn');
let controlsOpenedFromPause = false;
dashControlsBtn.addEventListener('click', () => { controlsModal.hidden = false; });
closeControlsBtn.addEventListener('click', () => {
  controlsModal.hidden = true;
  if (controlsOpenedFromPause) { pauseMenu.hidden = false; controlsOpenedFromPause = false; }
});

// ---------- Auth: simple username/password, checked against the Postgres-backed /api/* routes
// (server/db.js) ----------
// Not meant to be bulletproof security — this is a LAN party game, not a bank — but a real
// username/password IS checked against the server on login/register (so you can't just claim
// someone else's name without their password). Once verified, the browser remembers it
// (`ruins_auth` in localStorage) so a reload — including the "Quit to Menu" flow, which is a
// full `location.reload()` — goes straight back to the dashboard instead of asking for the
// password again every time.
function getAuth() {
  try { return JSON.parse(localStorage.getItem('ruins_auth') || 'null'); } catch { return null; }
}
function setAuth(username) { localStorage.setItem('ruins_auth', JSON.stringify({ username })); }
function clearAuth() { localStorage.removeItem('ruins_auth'); }

// The signed-in account's chosen customization color — fetched once on showing the dashboard,
// re-sent on every `hello` (see sendHello() below, which reads myPrimaryColor directly since
// it's declared in this same module) so the server can attach it to this player's room entry
// and broadcast it to everyone else's `characters.js` remote-figure rendering.
let myUsername = null;
let myPrimaryColor = null;
let mySecondaryColor = null;

function showDashboard(username) {
  authScreen.hidden = true;
  dashboardScreen.hidden = false;
  myUsername = username;
  dashAccountLabel.textContent = `Signed in as ${username}`;
  if (!nameInput.value) nameInput.value = username;
  loadProfile();
}
function showAuth() {
  dashboardScreen.hidden = true;
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
    showDashboard(username);
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
dashLogoutBtn.addEventListener('click', () => { clearAuth(); showAuth(); });

const savedAuth = getAuth();
if (savedAuth && savedAuth.username) showDashboard(savedAuth.username);
else showAuth();

// ---------- Dashboard: sidebar nav + panes, Play modal open/close ----------
function setDashPane(pane) {
  dashNavBtns.forEach((b) => b.classList.toggle('active', b.dataset.pane === pane));
  dashPanes.forEach((p) => { p.hidden = p.dataset.pane !== pane; });
}
dashNavBtns.forEach((btn) => btn.addEventListener('click', () => setDashPane(btn.dataset.pane)));

function openPlayModal() {
  dashboardScreen.hidden = true;
  menuScreen.hidden = false;
  sendMsg({ type: 'listRooms' });
}
function closePlayModal() {
  menuScreen.hidden = true;
  dashboardScreen.hidden = false;
}
dashPlayBtn.addEventListener('click', openPlayModal);
closeMenuBtn.addEventListener('click', closePlayModal);

// ---------- Profile tab: lifetime stats fetched from the account's DB row ----------
const statKills = document.getElementById('statKills');
const statDeaths = document.getElementById('statDeaths');
const statKD = document.getElementById('statKD');
const statMatches = document.getElementById('statMatches');
const primaryColorInput = document.getElementById('primaryColorInput');
const secondaryColorInput = document.getElementById('secondaryColorInput');
const charPreviewPrimary = document.getElementById('charPreviewPrimary');
const charPreviewSecondary = document.getElementById('charPreviewSecondary');
const saveCharacterBtn = document.getElementById('saveCharacterBtn');
const characterSaveMsg = document.getElementById('characterSaveMsg');

async function loadProfile() {
  if (!myUsername) return;
  try {
    const res = await fetch(`/api/profile?username=${encodeURIComponent(myUsername)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return;
    statKills.textContent = data.kills;
    statDeaths.textContent = data.deaths;
    statKD.textContent = data.deaths > 0 ? (data.kills / data.deaths).toFixed(2) : data.kills.toFixed(2);
    statMatches.textContent = data.matchesPlayed;
    myPrimaryColor = data.primaryColor;
    mySecondaryColor = data.secondaryColor;
    primaryColorInput.value = data.primaryColor;
    secondaryColorInput.value = data.secondaryColor;
    charPreviewPrimary.style.background = data.primaryColor;
    charPreviewSecondary.style.background = data.secondaryColor;
  } catch (err) {
    // Profile is a nice-to-have on the dashboard, not a gate on playing — a failed fetch just
    // leaves the stat cards at their placeholder '–' rather than blocking anything.
  }
}

primaryColorInput.addEventListener('input', () => { charPreviewPrimary.style.background = primaryColorInput.value; });
secondaryColorInput.addEventListener('input', () => { charPreviewSecondary.style.background = secondaryColorInput.value; });

saveCharacterBtn.addEventListener('click', async () => {
  if (!myUsername) return;
  saveCharacterBtn.disabled = true;
  characterSaveMsg.textContent = '';
  try {
    const res = await fetch('/api/customization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: myUsername,
        primaryColor: primaryColorInput.value,
        secondaryColor: secondaryColorInput.value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      characterSaveMsg.textContent = data.error || 'Save failed.';
      return;
    }
    myPrimaryColor = primaryColorInput.value;
    mySecondaryColor = secondaryColorInput.value;
    characterSaveMsg.textContent = 'Saved.';
    setTimeout(() => { characterSaveMsg.textContent = ''; }, 2500);
  } catch (err) {
    characterSaveMsg.textContent = 'Could not reach the server.';
  } finally {
    saveCharacterBtn.disabled = false;
  }
});

// ---------- Settings tab: master volume + mouse sensitivity, saved to localStorage ----------
const masterVolumeInput = document.getElementById('masterVolumeInput');
const masterVolumeVal = document.getElementById('masterVolumeVal');
const mouseSensInput = document.getElementById('mouseSensInput');
const mouseSensVal = document.getElementById('mouseSensVal');

function loadSettings() {
  const savedVol = localStorage.getItem('ruins_masterVolume');
  const vol = savedVol !== null ? Number(savedVol) : 80;
  masterVolumeInput.value = vol;
  masterVolumeVal.textContent = `${vol}%`;
  setMasterVolume(vol / 100);

  const savedSens = localStorage.getItem('ruins_mouseSensitivity');
  const sens = savedSens !== null ? Number(savedSens) : 100;
  mouseSensInput.value = sens;
  mouseSensVal.textContent = `${sens}%`;
  state.mouseSensitivity = sens / 100;
}
loadSettings();

masterVolumeInput.addEventListener('input', () => {
  const vol = Number(masterVolumeInput.value);
  masterVolumeVal.textContent = `${vol}%`;
  setMasterVolume(vol / 100);
  localStorage.setItem('ruins_masterVolume', String(vol));
});
mouseSensInput.addEventListener('input', () => {
  const sens = Number(mouseSensInput.value);
  mouseSensVal.textContent = `${sens}%`;
  state.mouseSensitivity = sens / 100;
  localStorage.setItem('ruins_mouseSensitivity', String(sens));
});

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
  // Fixed corners now, not a random pick of any 2-of-4 — top-right and bottom-left specifically
  // (reported as "messy": a random corner + a negative offset let the decal's own square image
  // bounds bleed OUTSIDE the button's edge, reading as a floating rectangle against the page
  // background rather than a stain on the button). `overflow: hidden` on the button (set below)
  // now guarantees the decal is clipped to the button's own rounded rect no matter its rotation,
  // so it only ever covers part of that corner, never spills past it.
  const corners = [{ top: '-4px', right: '-4px' }, { bottom: '-4px', left: '-4px' }];
  // .modalClose excluded: it's a tiny icon-only "×" button (~30px) — decals sized for a normal
  // label button (16-30px each) would swallow the glyph entirely rather than just accenting a
  // corner of it.
  document.querySelectorAll('button:not(.modalClose)').forEach((btn) => {
    if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
    btn.style.overflow = 'hidden';
    corners.forEach((corner) => {
      const decal = document.createElement('img');
      decal.className = 'btnBloodDecal';
      decal.alt = '';
      decal.src = images[Math.floor(Math.random() * images.length)];
      const size = 16 + Math.random() * 14; // 16-30px — small enough to stay out of the label's way
      decal.style.width = `${size}px`;
      const rot = Math.floor(Math.random() * 360);
      const flip = Math.random() < 0.5 ? -1 : 1;
      decal.style.transform = `rotate(${rot}deg) scaleX(${flip})`;
      Object.assign(decal.style, corner);
      btn.appendChild(decal);
    });
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

// Re-sent every time we "introduce" ourselves to the server (name change, create/join room) —
// carries the account username (so the server can link this connection to a real DB row for
// persisted stats) and the chosen Character-tab color (so remote players render it, see
// characters.js/getMyColor). Both optional server-side: a guest with no linked account still
// plays fine, just without persisted stats or a custom color.
function sendHello() {
  sendMsg({ type: 'hello', name: currentName(), username: myUsername || undefined, color: myPrimaryColor || undefined });
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
  sendHello();
  const rn = (roomNameInput.value || 'Ruins Match').trim().slice(0, 24) || 'Ruins Match';
  const durationSec = parseDurationSec(matchDurationInput.value);
  sendMsg({ type: 'createRoom', roomName: rn, map: mapSelect.value || DEFAULT_MAP, durationSec, memeMode: memeModeOn });
});

matchEndQuitBtn.addEventListener('click', () => { location.reload(); });

nameInput.addEventListener('change', sendHello);

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
      sendHello();
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
