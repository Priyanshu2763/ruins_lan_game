import { MAPS, MAP_BOUNDS, DEFAULT_MAP } from '/shared/gameData.js';
import { state } from './state.js';
import { sendMsg, leaveConnection, clearSession } from './net.js';
import { cancelGrenadeAim } from './weapons.js';
import { setMasterVolume, setMusicVolume, setSfxVolume } from './audio.js';
import { setFov } from './world.js';
import { mountPreviewInto, resizePreview, setPreviewAppearance, startPreviewLoop, stopPreviewLoop } from './preview.js';
import { CHARACTERS, SKIN_TONES, HAIR_COLORS, CLOTH_COLORS, SLOTS, MODES, OPERATORS, CAN_STRIP_CLOTHES, sanitizeAppearance } from '/shared/appearance.js';

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

// The signed-in account's saved character appearance (body, skin, hair, clothes) — fetched once
// on showing the dashboard and re-sent on every `hello` (see sendHello() below) so the server can
// attach it to this player's room entry and hand it to everyone else's remote-figure rendering.
let myUsername = null;
let myAppearance = sanitizeAppearance(null);   // what's saved
let draftAppearance = myAppearance;            // what the closet is currently showing (unsaved)

function showDashboard(username) {
  authScreen.hidden = true;
  dashboardScreen.hidden = false;
  myUsername = username;
  dashAccountLabel.textContent = `Signed in as ${username}`;
  if (!nameInput.value) nameInput.value = username;
  loadProfile();
  syncPreviewForPane(activePane);
}
function showAuth() {
  dashboardScreen.hidden = true;
  menuScreen.hidden = true;
  authScreen.hidden = false;
  authPassInput.value = '';
  authError.textContent = '';
  authUserInput.focus();
  stopPreviewLoop();
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
dashLogoutBtn.addEventListener('click', () => { clearAuth(); clearSession(); showAuth(); });

// ---------- Dashboard: sidebar nav + panes, Play modal open/close ----------
const playPreviewSlot = document.getElementById('playPreviewSlot');
const characterPreviewSlot = document.getElementById('characterPreviewSlot');
const playPreviewName = document.getElementById('playPreviewName');

// The 3D preview widget (preview.js) is one shared canvas moved between the Play and Character
// panes' slots — only mounted+animating while one of those two panes is actually visible, so
// switching to Profile/Settings (or opening the Play modal, which covers the dashboard entirely)
// stops the render loop instead of spinning a hidden canvas for no reason.
let activePane = 'play';
function syncPreviewForPane(pane) {
  if (pane === 'play') { mountPreviewInto(playPreviewSlot); startPreviewLoop(); resizePreview(); }
  else if (pane === 'character') { mountPreviewInto(characterPreviewSlot); startPreviewLoop(); resizePreview(); }
  else stopPreviewLoop();
}

function setDashPane(pane) {
  activePane = pane;
  dashNavBtns.forEach((b) => b.classList.toggle('active', b.dataset.pane === pane));
  dashPanes.forEach((p) => { p.hidden = p.dataset.pane !== pane; });
  syncPreviewForPane(pane);
}
dashNavBtns.forEach((btn) => btn.addEventListener('click', () => setDashPane(btn.dataset.pane)));
window.addEventListener('resize', () => { if (!dashboardScreen.hidden) resizePreview(); });

function openPlayModal() {
  dashboardScreen.hidden = true;
  menuScreen.hidden = false;
  stopPreviewLoop(); // covered by the modal — no point rendering it while hidden
  sendMsg({ type: 'listRooms' });
}
function closePlayModal() {
  menuScreen.hidden = true;
  dashboardScreen.hidden = false;
  syncPreviewForPane(activePane);
}
dashPlayBtn.addEventListener('click', openPlayModal);
closeMenuBtn.addEventListener('click', closePlayModal);

// ---------- Profile tab: lifetime stats + a BGMI-style rank tier (computed client-side from
// lifetime kills — purely cosmetic, no new server concept needed for it) ----------
const statKills = document.getElementById('statKills');
const statDeaths = document.getElementById('statDeaths');
const statKD = document.getElementById('statKD');
const statWins = document.getElementById('statWins');
const statWinRate = document.getElementById('statWinRate');
const statMatches = document.getElementById('statMatches');
const profileAvatar = document.getElementById('profileAvatar');
const profileUsername = document.getElementById('profileUsername');
const profileMemberSince = document.getElementById('profileMemberSince');
const profileRankBadge = document.getElementById('profileRankBadge');
const profileRankLabel = document.getElementById('profileRankLabel');
const closetEl = document.getElementById('closet');
const resetCharacterBtn = document.getElementById('resetCharacterBtn');
const saveCharacterBtn = document.getElementById('saveCharacterBtn');
const characterSaveMsg = document.getElementById('characterSaveMsg');

const RANK_TIERS = [
  { min: 0, cls: 'rank-bronze', label: 'Bronze' },
  { min: 10, cls: 'rank-silver', label: 'Silver' },
  { min: 30, cls: 'rank-gold', label: 'Gold' },
  { min: 75, cls: 'rank-platinum', label: 'Platinum' },
  { min: 150, cls: 'rank-diamond', label: 'Diamond' },
  { min: 300, cls: 'rank-crown', label: 'Crown' },
  { min: 600, cls: 'rank-ace', label: 'Ace' },
];
function rankTierFor(kills) {
  let tier = RANK_TIERS[0];
  for (const t of RANK_TIERS) if (kills >= t.min) tier = t;
  return tier;
}

async function loadProfile() {
  if (!myUsername) return;
  try {
    const res = await fetch(`/api/profile?username=${encodeURIComponent(myUsername)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return;
    statKills.textContent = data.kills;
    statDeaths.textContent = data.deaths;
    statKD.textContent = data.deaths > 0 ? (data.kills / data.deaths).toFixed(2) : data.kills.toFixed(2);
    statWins.textContent = data.wins;
    statWinRate.textContent = data.matchesPlayed > 0 ? `${Math.round((data.wins / data.matchesPlayed) * 100)}%` : '–';
    statMatches.textContent = data.matchesPlayed;

    profileUsername.textContent = data.username;
    profileAvatar.style.background = data.appearance.skin;
    if (data.memberSince) {
      const d = new Date(data.memberSince);
      profileMemberSince.textContent = `Member since ${d.toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}`;
    }
    const tier = rankTierFor(data.kills);
    profileRankBadge.className = `rankBadge ${tier.cls}`;
    profileRankLabel.textContent = tier.label;

    myAppearance = sanitizeAppearance(data.appearance);
    setDraft(myAppearance);
    playPreviewName.textContent = data.username;
  } catch (err) {
    // Profile is a nice-to-have on the dashboard, not a gate on playing — a failed fetch just
    // leaves the stat cards at their placeholder '–' rather than blocking anything.
  }
}

// ---------- Closet: every option below is generated from the shared catalog (shared/appearance.js),
// the same one the renderer and the server validate against, so the three can't disagree. ----------
const SLOT_LABELS = { hair: 'Hair', beard: 'Facial hair', top: 'Top', bottom: 'Bottom', shoes: 'Shoes', gloves: 'Gloves', head: 'Headwear' };
const SLOT_COLOR_FIELD = { hair: 'hairColor', top: 'topColor', bottom: 'bottomColor', shoes: 'shoesColor', gloves: 'glovesColor', head: 'headColor' };
const SLOT_PALETTE = { hair: HAIR_COLORS, top: CLOTH_COLORS, bottom: CLOTH_COLORS, shoes: CLOTH_COLORS, gloves: CLOTH_COLORS, head: CLOTH_COLORS };

function hexToRgb(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function rgbToHex(c) { return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join(''); }
// Continuous skin spectrum: 0..1 walks the anchor tones (white -> black), blending between neighbours.
function skinAt(t) {
  const x = Math.min(0.9999, Math.max(0, t)) * (SKIN_TONES.length - 1), i = Math.floor(x), f = x - i;
  const a = hexToRgb(SKIN_TONES[i]), b = hexToRgb(SKIN_TONES[i + 1]);
  return rgbToHex(a.map((v, k) => v + (b[k] - v) * f));
}
function skinToT(hex) {
  let best = 0, bestD = 1e9;
  for (let k = 0; k <= 200; k++) {
    const c = hexToRgb(skinAt(k / 200)), h = hexToRgb(hex);
    const d = c.reduce((s2, v, j) => s2 + (v - h[j]) ** 2, 0);
    if (d < bestD) { bestD = d; best = k / 200; }
  }
  return best;
}

function setDraft(app) {
  draftAppearance = sanitizeAppearance(app);
  renderCloset();
  setPreviewAppearance(draftAppearance);
}
function patchDraft(patch) { setDraft({ ...draftAppearance, ...patch }); }

function chipRow(options, current, onPick) {
  const row = document.createElement('div');
  row.className = 'chipRow';
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip' + (o.id === current ? ' active' : ''); b.textContent = o.label;
    b.addEventListener('click', () => onPick(o.id));
    row.appendChild(b);
  }
  return row;
}
function swatchRow(palette, current, onPick) {
  const row = document.createElement('div');
  row.className = 'swatchRow';
  for (const c of palette) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch' + (c.toLowerCase() === current.toLowerCase() ? ' active' : ''); b.style.background = c; b.title = c;
    b.addEventListener('click', () => onPick(c));
    row.appendChild(b);
  }
  const custom = document.createElement('input');
  custom.type = 'color'; custom.value = current; custom.title = 'Custom color';
  custom.addEventListener('input', () => onPick(custom.value));
  row.appendChild(custom);
  return row;
}
function section(title) {
  const el = document.createElement('div');
  el.className = 'closetSection';
  const h = document.createElement('h3'); h.textContent = title; el.appendChild(h);
  return el;
}

function renderCloset() {
  const a = draftAppearance;
  closetEl.innerHTML = '';

  const modeSec = section('Look');
  modeSec.appendChild(chipRow(MODES, a.mode, (id) => patchDraft({ mode: id })));
  closetEl.appendChild(modeSec);

  if (a.mode === 'operator') { renderOperatorPicker(a); return; }

  const body = section('Body');
  body.appendChild(chipRow(CHARACTERS, a.character, (id) => patchDraft({ character: id })));
  closetEl.appendChild(body);

  const skin = section('Skin tone');
  skin.appendChild(swatchRow(SKIN_TONES, a.skin, (c) => patchDraft({ skin: c })));
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = 0; slider.max = 1000; slider.value = Math.round(skinToT(a.skin) * 1000);
  slider.className = 'skinSlider';
  slider.style.setProperty('--skin-grad', `linear-gradient(90deg, ${SKIN_TONES.join(', ')})`);
  slider.addEventListener('input', () => {
    // drag without rebuilding the whole closet (that would drop the slider mid-drag)
    draftAppearance = sanitizeAppearance({ ...draftAppearance, skin: skinAt(slider.value / 1000) });
    setPreviewAppearance(draftAppearance);
  });
  slider.addEventListener('change', () => renderCloset());
  skin.appendChild(slider);
  closetEl.appendChild(skin);

  for (const slot of ['hair', 'beard', 'top', 'bottom', 'shoes', 'gloves', 'head']) {
    const sec = section(SLOT_LABELS[slot]);
    sec.appendChild(chipRow(SLOTS[slot], a[slot], (id) => patchDraft({ [slot]: id })));
    const cf = SLOT_COLOR_FIELD[slot];
    if (cf && a[slot] !== 'none') sec.appendChild(swatchRow(SLOT_PALETTE[slot], a[cf], (c) => patchDraft({ [cf]: c })));
    closetEl.appendChild(sec);
  }
}

// Operators mode: pick one of the 8 predefined named characters (own art/outfit, not closet-
// editable piece by piece — see shared/appearance.js) instead of the Custom body above. Grouped by
// gender purely for readability in a picker, same information CHARACTERS already carries per body.
function renderOperatorPicker(a) {
  const male = section('Male operators');
  male.appendChild(chipRow(OPERATORS.filter((o) => o.gender === 'male'), a.operator, (id) => patchDraft({ operator: id })));
  closetEl.appendChild(male);

  const female = section('Female operators');
  female.appendChild(chipRow(OPERATORS.filter((o) => o.gender === 'female'), a.operator, (id) => patchDraft({ operator: id })));
  closetEl.appendChild(female);

  const outfit = section('Outfit');
  const canStrip = CAN_STRIP_CLOTHES.has(a.operator);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'memeToggle ' + (a.stripClothes ? 'on' : 'off');
  btn.textContent = a.stripClothes ? 'CLOTHES OFF' : 'ORIGINAL OUTFIT';
  btn.disabled = !canStrip;
  btn.title = canStrip ? "Hide this operator's outfit" : "This operator's outfit isn't separate from their body yet — can't be removed";
  btn.addEventListener('click', () => patchDraft({ stripClothes: !a.stripClothes }));
  outfit.appendChild(btn);
  if (!canStrip) {
    const hint = document.createElement('p');
    hint.className = 'sub'; hint.style.marginTop = '8px';
    hint.textContent = "This operator's clothes are modeled as one piece with their body, so they can't be stripped yet — a real closet for Operators is planned.";
    outfit.appendChild(hint);
  }
  closetEl.appendChild(outfit);
}

resetCharacterBtn.addEventListener('click', () => setDraft(myAppearance));

saveCharacterBtn.addEventListener('click', async () => {
  if (!myUsername) return;
  saveCharacterBtn.disabled = true;
  characterSaveMsg.textContent = '';
  try {
    const res = await fetch('/api/customization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: myUsername, appearance: draftAppearance }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      characterSaveMsg.textContent = data.error || 'Save failed.';
      return;
    }
    myAppearance = sanitizeAppearance(data.appearance);
    profileAvatar.style.background = myAppearance.skin; // keep the Profile tab's avatar in sync too
    characterSaveMsg.textContent = 'Saved.';
    setTimeout(() => { characterSaveMsg.textContent = ''; }, 2500);
  } catch (err) {
    characterSaveMsg.textContent = 'Could not reach the server.';
  } finally {
    saveCharacterBtn.disabled = false;
  }
});
renderCloset();

// ---------- Settings tab: BGMI-style, grouped Sound/Sensitivity/Gameplay sections, every
// control wired to a real mechanism (not a decorative stub) — see audio.js's music/sfx gain
// split, world.js's setFov, and movement.js's toggle-sprint mode. All saved to localStorage,
// per-device rather than per-account (deliberately separate from the DB-backed profile). ----------
const masterVolumeInput = document.getElementById('masterVolumeInput');
const masterVolumeVal = document.getElementById('masterVolumeVal');
const musicVolumeInput = document.getElementById('musicVolumeInput');
const musicVolumeVal = document.getElementById('musicVolumeVal');
const sfxVolumeInput = document.getElementById('sfxVolumeInput');
const sfxVolumeVal = document.getElementById('sfxVolumeVal');
const mouseSensInput = document.getElementById('mouseSensInput');
const mouseSensVal = document.getElementById('mouseSensVal');
const fovInput = document.getElementById('fovInput');
const fovVal = document.getElementById('fovVal');
const sprintModeToggle = document.getElementById('sprintModeToggle');

function loadSettings() {
  const readPct = (key, fallback) => {
    const saved = localStorage.getItem(key);
    return saved !== null ? Number(saved) : fallback;
  };

  const vol = readPct('ruins_masterVolume', 80);
  masterVolumeInput.value = vol; masterVolumeVal.textContent = `${vol}%`; setMasterVolume(vol / 100);

  const musicVol = readPct('ruins_musicVolume', 70);
  musicVolumeInput.value = musicVol; musicVolumeVal.textContent = `${musicVol}%`; setMusicVolume(musicVol / 100);

  const sfxVol = readPct('ruins_sfxVolume', 100);
  sfxVolumeInput.value = sfxVol; sfxVolumeVal.textContent = `${sfxVol}%`; setSfxVolume(sfxVol / 100);

  const sens = readPct('ruins_mouseSensitivity', 100);
  mouseSensInput.value = sens; mouseSensVal.textContent = `${sens}%`; state.mouseSensitivity = sens / 100;

  const fov = readPct('ruins_fov', 75);
  fovInput.value = fov; fovVal.textContent = `${fov}°`; setFov(fov);

  const toggleSprint = localStorage.getItem('ruins_toggleSprint') === '1';
  state.toggleSprint = toggleSprint;
  sprintModeToggle.textContent = toggleSprint ? 'TOGGLE' : 'HOLD';
  sprintModeToggle.classList.toggle('on', toggleSprint);
  sprintModeToggle.classList.toggle('off', !toggleSprint);
}
loadSettings();

masterVolumeInput.addEventListener('input', () => {
  const vol = Number(masterVolumeInput.value);
  masterVolumeVal.textContent = `${vol}%`;
  setMasterVolume(vol / 100);
  localStorage.setItem('ruins_masterVolume', String(vol));
});
musicVolumeInput.addEventListener('input', () => {
  const vol = Number(musicVolumeInput.value);
  musicVolumeVal.textContent = `${vol}%`;
  setMusicVolume(vol / 100);
  localStorage.setItem('ruins_musicVolume', String(vol));
});
sfxVolumeInput.addEventListener('input', () => {
  const vol = Number(sfxVolumeInput.value);
  sfxVolumeVal.textContent = `${vol}%`;
  setSfxVolume(vol / 100);
  localStorage.setItem('ruins_sfxVolume', String(vol));
});
mouseSensInput.addEventListener('input', () => {
  const sens = Number(mouseSensInput.value);
  mouseSensVal.textContent = `${sens}%`;
  state.mouseSensitivity = sens / 100;
  localStorage.setItem('ruins_mouseSensitivity', String(sens));
});
fovInput.addEventListener('input', () => {
  const fov = Number(fovInput.value);
  fovVal.textContent = `${fov}°`;
  setFov(fov);
  localStorage.setItem('ruins_fov', String(fov));
});
sprintModeToggle.addEventListener('click', () => {
  const toggleSprint = !state.toggleSprint;
  state.toggleSprint = toggleSprint;
  state.sprintToggledOn = false; // clean slate switching modes mid-session
  sprintModeToggle.textContent = toggleSprint ? 'TOGGLE' : 'HOLD';
  sprintModeToggle.classList.toggle('on', toggleSprint);
  sprintModeToggle.classList.toggle('off', !toggleSprint);
  localStorage.setItem('ruins_toggleSprint', toggleSprint ? '1' : '0');
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
  // A diagonal corner-flag look, not a small floating splat: each square decal image is
  // clip-path'd down to a right triangle whose 90° corner sits exactly on the button's own
  // corner (legs flush with the button's top/left or bottom/right edges, hypotenuse cutting
  // diagonally across the corner into the button) — one triangle pinned to top-left, the other
  // to bottom-right, per the user's explicit ask ("square diagonally cut... one corner aligned
  // with top-left, another with bottom-right"). No rotation here (unlike a free-floating splat)
  // since any rotation would pull the triangle's legs away from the button's actual edges and
  // break the flush alignment that's the whole point of this shape.
  const placements = [
    { style: { top: '0', left: '0' }, clip: 'polygon(0 0, 100% 0, 0 100%)' },
    { style: { bottom: '0', right: '0' }, clip: 'polygon(100% 100%, 100% 0, 0 100%)' },
  ];
  // .modalClose excluded: it's a tiny icon-only "×" button (~30px) — a decal sized for a normal
  // label button would swallow the glyph entirely rather than just accenting a corner of it.
  document.querySelectorAll('button:not(.modalClose):not(.chip):not(.swatch)').forEach((btn) => {
    if (getComputedStyle(btn).position === 'static') btn.style.position = 'relative';
    btn.style.overflow = 'hidden';
    placements.forEach(({ style, clip }) => {
      const decal = document.createElement('img');
      decal.className = 'btnBloodDecal';
      decal.alt = '';
      decal.src = images[Math.floor(Math.random() * images.length)];
      const size = 22 + Math.random() * 14; // 22-36px square, clipped down to a corner triangle
      decal.style.width = `${size}px`;
      decal.style.height = `${size}px`;
      decal.style.objectFit = 'cover';
      decal.style.clipPath = clip;
      Object.assign(decal.style, style);
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
export function sendHello() {
  sendMsg({
    type: 'hello', name: currentName(), username: myUsername || undefined,
    appearance: myAppearance,
  });
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

matchEndQuitBtn.addEventListener('click', () => leaveMatchAndReload());

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
    .map((p, i) => `<tr><td>${i + 1}</td><td class="name">${escapeHtml(p.name)}${p.id === state.localId ? ' (you)' : ''}${p.dc ? '<span class="offlineTag">offline</span>' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`)
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
quitBtn.addEventListener('click', () => leaveMatchAndReload());

document.addEventListener('pointerlockchange', () => {
  state.pointerLocked = document.pointerLockElement === state.renderer?.domElement;
  if (!state.pointerLocked) closeChat(); // Esc (which drops the lock) also cancels a half-typed message
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

// ---------- Connection banner (reconnecting / rejoining) ----------
const connOverlay = document.getElementById('connOverlay');
const connText = document.getElementById('connText');
export function showConn(text) { connText.textContent = text; connOverlay.hidden = false; }
export function hideConn() { connOverlay.hidden = true; }

// Deliberate quit: free the slot on the server right away (no 30s grace period), forget the
// session so a reload doesn't try to resume, then reload back to the dashboard. The short delay
// lets the `leave` message flush before the page tears the socket down.
export function leaveMatchAndReload() {
  leaveConnection();
  setTimeout(() => location.reload(), 120);
}

// ---------- "Rejoin your match?" prompt ----------
// Shown after a refresh / reopened tab that still has a match session, instead of silently putting
// the player back into the match. Yes -> onYes(); No -> onNo() (the caller tells the server to drop
// them from that room and clear their stats there). Nothing else is clickable while it's up.
const rejoinPrompt = document.getElementById('rejoinPrompt');
const rejoinYesBtn = document.getElementById('rejoinYesBtn'), rejoinNoBtn = document.getElementById('rejoinNoBtn');
const rejoinErr = document.getElementById('rejoinErr');
let rejoinHandlers = null;
export function showRejoinPrompt(roomLabel, onYes, onNo) {
  document.getElementById('rejoinRoomName').textContent = roomLabel || 'a match';
  rejoinErr.hidden = true;
  rejoinYesBtn.disabled = rejoinNoBtn.disabled = false;
  rejoinHandlers = { onYes, onNo };
  rejoinPrompt.hidden = false;
}
export function hideRejoinPrompt() { rejoinPrompt.hidden = true; rejoinHandlers = null; }
export function isRejoinPromptOpen() { return !rejoinPrompt.hidden; }
// Shown inside the prompt when "Yes" comes back as "that match is gone / your spot expired".
export function showRejoinError(text) { rejoinErr.textContent = text; rejoinErr.hidden = false; rejoinYesBtn.disabled = true; }
rejoinYesBtn.addEventListener('click', () => { rejoinYesBtn.disabled = rejoinNoBtn.disabled = true; rejoinHandlers?.onYes(); });
rejoinNoBtn.addEventListener('click', () => { const h = rejoinHandlers; hideRejoinPrompt(); h?.onNo(); });

// ---------- Chat ----------
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const chatHint = document.getElementById('chatHint');
const CHAT_VISIBLE_MS = 12000; // a line fades this long after it arrives, unless the box is open
export function addChatLine(entry, { instantFade = false } = {}) {
  const line = document.createElement('div');
  line.className = 'chatLine' + (entry.system ? ' system' : '');
  // textContent / text nodes only — chat is other players' input, never interpreted as HTML
  if (entry.system) line.textContent = entry.text;
  else {
    const name = document.createElement('span');
    name.className = 'cName'; name.textContent = `${entry.name}: `;
    line.append(name, document.createTextNode(entry.text));
  }
  chatLog.appendChild(line);
  while (chatLog.children.length > 60) chatLog.firstChild.remove();
  if (instantFade) line.classList.add('faded');
  else setTimeout(() => line.classList.add('faded'), CHAT_VISIBLE_MS);
}
// Replays the server's recent history (on join/reconnect) — old lines start faded so a
// reconnect doesn't dump a wall of stale text over the screen, but they're all there when the
// box is opened.
export function resetChat(history) {
  chatLog.innerHTML = '';
  for (const e of history || []) addChatLine(e, { instantFade: Date.now() - (e.t || 0) > CHAT_VISIBLE_MS });
}
export function openChat() {
  state.chatOpen = true;
  state.keys.clear(); // a held W must not keep walking while you type
  chatLog.classList.add('open');
  chatInput.hidden = false;
  chatHint.hidden = true; // the input itself carries the instructions while it's open
  chatInput.value = '';
  chatInput.focus();
}
export function closeChat() {
  if (!state.chatOpen) return;
  state.chatOpen = false;
  chatLog.classList.remove('open');
  chatInput.hidden = true;
  chatHint.hidden = false;
  chatInput.blur();
}
chatInput.addEventListener('keydown', (e) => {
  e.stopPropagation(); // keep typing away from the game's document-level hotkeys
  if (e.key === 'Enter') {
    const text = chatInput.value.trim();
    if (text) sendMsg({ type: 'chat', text });
    closeChat();
  } else if (e.key === 'Escape') closeChat();
});
chatInput.addEventListener('keyup', (e) => e.stopPropagation());

// ---------- Dashboard tips (rotating one-liners under the Play button) ----------
const TIPS = [
  '<b>Enter</b> opens chat during a match.',
  'Hold <b>G</b> to aim a grenade, release to throw it.',
  '<b>C</b> crouches and <b>Z</b> goes prone — a smaller target and a lower profile.',
  'Headshots deal <b>2.5×</b> damage; a knife headshot is a one-hit kill.',
  'Fire while sprinting and your weapon squares up — release to run again.',
  'Lost connection? You have <b>30 s</b> to get back in, and nobody can hurt you meanwhile.',
  'Drag your character on the right to spin it; pinch or scroll to zoom.',
  'Shotgun damage falls off with distance — get close.',
];
const dashTip = document.getElementById('dashTip');
let tipIdx = Math.floor(Math.random() * TIPS.length);
function showTip() { if (!dashTip) return; dashTip.style.opacity = 0; setTimeout(() => { dashTip.innerHTML = TIPS[tipIdx++ % TIPS.length]; dashTip.style.opacity = 1; }, 400); }
showTip(); setInterval(() => { if (!dashboardScreen.hidden) showTip(); }, 7000);

// Kicks off the very first screen (dashboard or auth) — deliberately the LAST statement in this
// module, not right after getAuth()/showDashboard/showAuth are defined. showDashboard() calls
// into syncPreviewForPane(), which reads playPreviewSlot/characterPreviewSlot/activePane —
// const/let bindings declared further down in this same file. Calling it before those
// declarations had run threw a ReferenceError (the temporal dead zone) that silently killed the
// rest of this module's top-level execution — every event listener declared after that point
// (all of the dashboard nav, settings sliders, decorateButtonsWithBlood, etc.) never ran, which
// is why the preview card was empty AND every button was unresponsive. Putting this trigger
// last guarantees everything it can transitively reach has already been declared.
const savedAuth = getAuth();
if (savedAuth && savedAuth.username) showDashboard(savedAuth.username);
else showAuth();
