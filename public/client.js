import * as THREE from 'three';
import {
  WEAPONS, FLOOR, getMapLayout, MAP_BOUNDS, MAX_HEALTH, MAPS, DEFAULT_MAP,
  STAND_EYE_HEIGHT, CROUCH_EYE_HEIGHT, PRONE_EYE_HEIGHT, PLAYER_RADIUS, PRONE_SPEED,
  GRENADE_COOLDOWN_MS, GRENADE_RADIUS, GRENADE_VISUAL_RADIUS, GRENADE_BLAST_RADIUS,
  GRENADE_THROW_SPEED, GRENADE_START_COUNT, GRENADE_MAX_CARRY, GRENADE_ICON, GRENADE_IMAGE,
} from '/shared/gameData.js';

// Each room picks its own map, so the obstacle/platform/ramp/grass layout is per-session state
// (populated by initScene once a room is joined), not a static import like it used to be.
let ACTIVE_WALLS = [], ACTIVE_PLATFORMS = [], ACTIVE_RAMPS = [], ACTIVE_GRASS = [], ACTIVE_DECOR = [];

function clamp01(t) { return Math.max(0, Math.min(1, t)); }

// The player's standing surface height at (x,z) — 0 (plain ground) unless they're on a ramp
// (interpolated) or a building's upper floor platform (flat). Platforms and ramps never
// overlap in x/z (see gameData.js's makeRuinHouse), so at most one of these ever matches.
// Which house's platform (index into ACTIVE_PLATFORMS) the player is currently "on", or -1 for
// ground level. A house's upper floor sits DIRECTLY above its ground floor now (the reference
// photos' actual layout — two stacked rooms, same footprint), so position alone can't tell the
// floors apart: (x,z) inside a house's footprint is valid at BOTH wallH (upper floor) and 0
// (ground floor). Only STATE resolves that — you're "on" the platform because you walked up
// its stairs, not because of where you happen to be standing. See surfaceHeightAt below.
let standingPlatformIndex = -1;

function surfaceHeightAt(x, z) {
  // Ramps are always position-based (their own footprint is disjoint from every house's, per
  // gameData.js's makeRuinHouse) and are what TOGGLES standingPlatformIndex: reaching a ramp's
  // top edge marks its matching platform (same array index — see getMapLayout) as "on";
  // reaching its bottom edge, or stepping off that platform's footprint any other way (a
  // window gap, jumping the parapet), clears it and you drop to ground height.
  for (let i = 0; i < ACTIVE_RAMPS.length; i++) {
    const s = ACTIVE_RAMPS[i];
    const hw = s.w / 2, hd = s.d / 2;
    if (Math.abs(x - s.x) <= hw && Math.abs(z - s.z) <= hd) {
      const t = clamp01((z - (s.z - hd)) / s.d);
      const st = s.reverse ? 1 - t : t;
      // A wide trigger band (last/first 30% of the climb, not the last 1.5%) — movement
      // advances in per-frame position steps, so a razor-thin threshold near the very top can
      // fall entirely between two consecutive frames and never fire at all. This was the
      // actual "can't get into the 1st floor" bug: the platform never activated because
      // nobody's movement ever lands inside a 0.015-wide window by chance. Triggering a bit
      // early just means the last stretch of the climb snaps to floorY a little sooner, which
      // reads fine — nowhere close to the old "can't enter at all".
      if (st >= 0.7) standingPlatformIndex = i;
      else if (st <= 0.3) standingPlatformIndex = -1;
      return s.fromY + (s.toY - s.fromY) * st;
    }
  }
  if (standingPlatformIndex >= 0) {
    const p = ACTIVE_PLATFORMS[standingPlatformIndex];
    if (p && Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) return p.y;
    standingPlatformIndex = -1; // stepped off this platform's own footprint — falls to ground
  }
  return 0;
}

// ---------- DOM ----------
const menuScreen = document.getElementById('menuScreen');
const nameInput = document.getElementById('nameInput');
const roomNameInput = document.getElementById('roomNameInput');
const createBtn = document.getElementById('createBtn');
const refreshBtn = document.getElementById('refreshBtn');
const tabJoinBtn = document.getElementById('tabJoinBtn');
const tabCreateBtn = document.getElementById('tabCreateBtn');
const joinPanel = document.getElementById('joinPanel');
const createPanel = document.getElementById('createPanel');
const roomListEl = document.getElementById('roomList');
const gameContainer = document.getElementById('gameContainer');
const hud = document.getElementById('hud');
const lockHint = document.getElementById('lockHint');
const healthFill = document.getElementById('healthFill');
const killFeed = document.getElementById('killFeed');
const centerMsg = document.getElementById('centerMsg');
const roomTag = document.getElementById('roomTag');
const scoreboard = document.getElementById('scoreboard');
const scoreboardBody = document.getElementById('scoreboardBody');
const crosshair = document.getElementById('crosshair');
const minimapCanvas = document.getElementById('minimap');
const minimapCtx = minimapCanvas.getContext('2d');

const dmgFlash = document.createElement('div');
dmgFlash.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse at center, rgba(200,20,20,0) 40%, rgba(200,20,20,0.45) 100%);opacity:0;transition:opacity 0.4s;z-index:5;';
document.body.appendChild(dmgFlash);

const weaponBar = document.getElementById('weaponBar');
const pickupToast = document.getElementById('pickupToast');
const mapSelect = document.getElementById('mapSelect');
const matchDurationInput = document.getElementById('matchDurationInput');
const matchTimer = document.getElementById('matchTimer');
const matchEndScreen = document.getElementById('matchEndScreen');
const matchEndBody = document.getElementById('matchEndBody');
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

// ---------- Sound: everything synthesized with WebAudio, no asset files ----------
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function unlockAudio() { if (audioCtx.state === 'suspended') audioCtx.resume(); }
document.addEventListener('click', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });

function tone(freq, dur, type, gain, glideTo) {
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g); g.connect(audioCtx.destination);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}
function noiseBurst(dur, gain, filterFreq) {
  const t0 = audioCtx.currentTime;
  const n = Math.floor(audioCtx.sampleRate * dur);
  const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const filt = audioCtx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.value = filterFreq || 2000;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filt); filt.connect(g); g.connect(audioCtx.destination);
  src.start(t0);
}
const sfx = {
  shoot(w) {
    if (w.type === 'melee') { tone(180, 0.06, 'square', 0.12, 90); return; }
    if (w.pump) { noiseBurst(0.16, 0.34, 1700); tone(90, 0.14, 'sawtooth', 0.22, 40); return; }
    noiseBurst(0.09, 0.22, 3200);
    tone(140, 0.07, 'square', 0.14, 60);
  },
  pump() { tone(950, 0.03, 'square', 0.09); setTimeout(() => tone(600, 0.04, 'square', 0.1), 90); },
  reload() { tone(500, 0.05, 'square', 0.08, 700); setTimeout(() => tone(700, 0.06, 'square', 0.08, 500), 140); },
  empty() { tone(220, 0.045, 'square', 0.1); },
  hitMarker() { tone(1400, 0.04, 'square', 0.09); },
  damage() { noiseBurst(0.18, 0.16, 700); },
  grenadeThrow() { tone(260, 0.14, 'sine', 0.1, 120); },
  grenadeTick() { tone(1200, 0.03, 'square', 0.05); },
  explosion() { noiseBurst(0.5, 0.35, 900); tone(70, 0.4, 'sawtooth', 0.22, 30); },
  pickup() { tone(700, 0.07, 'sine', 0.12, 1100); setTimeout(() => tone(1100, 0.08, 'sine', 0.1, 1500), 70); },
  death() { tone(300, 0.3, 'sawtooth', 0.16, 60); },
};

// ---------- Networking / lobby ----------
const ws = new WebSocket(`ws://${location.host}`);
let localId = null;
let roomId = null;
let localAlive = true;

ws.addEventListener('open', () => {
  const saved = localStorage.getItem('ruins_name');
  if (saved) nameInput.value = saved;
  sendMsg({ type: 'listRooms' });
});

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  handleMessage(msg);
});

function sendMsg(obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

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

function currentName() {
  const n = (nameInput.value || 'Player').trim().slice(0, 16) || 'Player';
  localStorage.setItem('ruins_name', n);
  return n;
}

// "HH:MM" from the native time input -> total minutes. 00:00 (or empty/unset) means no limit.
function parseDurationMin(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return 0;
  return Math.max(0, parseInt(m[1], 10) * 60 + parseInt(m[2], 10));
}

createBtn.addEventListener('click', () => {
  sendMsg({ type: 'hello', name: currentName() });
  const rn = (roomNameInput.value || 'Ruins Match').trim().slice(0, 24) || 'Ruins Match';
  const durationMin = parseDurationMin(matchDurationInput.value);
  sendMsg({ type: 'createRoom', roomName: rn, map: mapSelect.value || DEFAULT_MAP, durationMin });
});

matchEndQuitBtn.addEventListener('click', () => { location.reload(); });

nameInput.addEventListener('change', () => sendMsg({ type: 'hello', name: currentName() }));

function renderRoomList(rooms) {
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

// ---------- Three.js scene (built once, on first join) ----------
let scene, camera, renderer, yawObject, clock;
let sceneReady = false;
const remotePlayers = new Map(); // id -> { mesh, legL, legR, armL, armR, walkPhase, targetPos, targetRotY, crouch, moving }
let eyeHeight = STAND_EYE_HEIGHT;
let isCrouched = false;
let isProne = false;
function setStance(crouch, prone) {
  isCrouched = crouch;
  isProne = prone;
}
let grenadeCount = GRENADE_START_COUNT;

// A painted horizon wrapped around the whole arena, same trick as a matte painting: draw one
// illustrated skyline on canvas — bright midday sky, drifting clouds, a hazy downtown skyline —
// and wrap it around a big cylinder, instead of the flat single-color background. It never has
// to hold up to being viewed close, because at this radius it never is.
function buildHorizonTexture(theme) {
  const dusk = theme === 'dusk';
  const W = 2048, H = 560;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.62);
  if (dusk) {
    sky.addColorStop(0.0, '#241f16'); sky.addColorStop(0.45, '#5a4423');
    sky.addColorStop(0.78, '#9c7233'); sky.addColorStop(1.0, '#d3a24c');
  } else {
    sky.addColorStop(0.0, '#3f8fe0'); sky.addColorStop(0.55, '#8fc3f0');
    sky.addColorStop(0.85, '#cfe6f5'); sky.addColorStop(1.0, '#eaf3f5');
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  if (dusk) {
    // sparse haze motes instead of a bright sun/clouds — a dying-light warzone mood
    ctx.fillStyle = 'rgba(255,225,190,0.3)';
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * W, y = Math.random() * H * 0.35;
      ctx.fillRect(x, y, Math.random() < 0.15 ? 2 : 1, Math.random() < 0.15 ? 2 : 1);
    }
  } else {
    // sun disc, high and bright, with a soft glow — the actual light comes from the
    // directional light, this is just the visible anchor for "the sun is up"
    const sunX = W * 0.24, sunY = H * 0.16;
    const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 130);
    sunGlow.addColorStop(0, 'rgba(255,252,230,1)');
    sunGlow.addColorStop(0.25, 'rgba(255,248,210,0.85)');
    sunGlow.addColorStop(1, 'rgba(255,248,210,0)');
    ctx.fillStyle = sunGlow;
    ctx.fillRect(sunX - 130, sunY - 130, 260, 260);
    ctx.fillStyle = '#fffdf2';
    ctx.beginPath(); ctx.arc(sunX, sunY, 34, 0, Math.PI * 2); ctx.fill();

    function cloud(cx, cy, scale) {
      const puffs = [[0, 0, 1], [0.9, 0.1, 0.75], [-0.9, 0.15, 0.7], [0.35, -0.3, 0.65], [-0.4, -0.25, 0.6]];
      for (const [dx, dy, s] of puffs) {
        const r = 60 * scale * s;
        const x = cx + dx * 90 * scale, y = cy + dy * 40 * scale;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.7, 'rgba(255,255,255,0.75)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    for (let i = 0; i < 7; i++) {
      cloud(Math.random() * W, H * 0.1 + Math.random() * H * 0.28, 0.6 + Math.random() * 0.9);
    }
  }

  if (dusk) {
    // Ruins horizon: jagged lava-mountain hills with glowing branching cracks, not a city
    // skyline — same "pin start/end height" trick so the 360 wrap has no seam, ported from
    // the volcanic-horizon technique in the sibling ~/a/games/ascend project.
    function lavaRidge(baseY, amp, segs, top, bottom) {
      const ys = [baseY];
      let y = baseY;
      for (let i = 1; i < segs; i++) {
        y += (Math.random() - 0.5) * amp;
        y = Math.max(baseY - amp * 2.2, Math.min(baseY + amp * 0.6, y));
        ys.push(y);
      }
      ys.push(baseY);
      const tail = Math.min(4, segs - 1);
      for (let k = 0; k < tail; k++) {
        const idx = segs - tail + k, t = (k + 1) / (tail + 1);
        ys[idx] = ys[idx] * (1 - t) + baseY * t;
      }
      const step = W / segs;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i <= segs; i++) {
        ctx.lineTo(i * step, ys[i]);
        if (Math.random() < 0.45 && i < segs) ctx.lineTo(i * step + step * 0.5, ys[i] - amp * (0.4 + Math.random() * 0.9));
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, baseY - amp * 2, 0, H);
      g.addColorStop(0, top); g.addColorStop(1, bottom);
      ctx.fillStyle = g;
      ctx.fill();
    }
    function lavaCrack(x0, y0, len, angle, width) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,140,40,0.9)';
      ctx.shadowColor = 'rgba(255,120,30,0.9)';
      ctx.shadowBlur = 12;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      (function branch(x, y, a, len, depth) {
        const segs = 4 + Math.floor(Math.random() * 4);
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let s = 0; s < segs; s++) {
          a += (Math.random() - 0.5) * 1.3;
          const stepLen = (len / segs) * (0.7 + Math.random() * 0.6);
          x += Math.cos(a) * stepLen; y += Math.sin(a) * stepLen;
          ctx.lineTo(x, y);
          if (depth > 0 && Math.random() < 0.35 && s < segs - 1) {
            branch(x, y, a + (Math.random() < 0.5 ? -1 : 1) * 0.8, len * 0.5, depth - 1);
          }
        }
        ctx.stroke();
      })(x0, y0, angle, len, 1);
      ctx.restore();
    }
    lavaRidge(H * 0.5, 40, 16, '#1c0906', '#120502');
    lavaRidge(H * 0.58, 62, 12, '#0d0402', '#050201');
    for (let i = 0; i < 9; i++) {
      const x0 = (i + 0.5) * (W / 9) + (Math.random() - 0.5) * 60;
      lavaCrack(x0, H * 0.5 + Math.random() * 40, 70 + Math.random() * 60, Math.PI / 2 - 0.2 + Math.random() * 0.4, 2 + Math.random() * 1.5);
    }
  } else {
    // hazy downtown skyline — pinned to match height at x=0 and x=W so the 360 wrap has no seam
    function skyline(baseY, segs, colorFar) {
      const step = W / segs;
      ctx.fillStyle = colorFar;
      let prevH = 40 + Math.random() * 60;
      const firstH = prevH;
      for (let i = 0; i < segs; i++) {
        const isLast = i === segs - 1;
        const bh = isLast ? firstH : 40 + Math.random() * 130;
        const bw = step * (0.55 + Math.random() * 0.4);
        const bx = i * step + (step - bw) / 2;
        ctx.fillRect(bx, baseY - bh, bw, bh);
        // a damaged/jagged roofline on some buildings, keeping the "ruins" identity
        if (Math.random() < 0.4) {
          ctx.beginPath();
          ctx.moveTo(bx, baseY - bh);
          ctx.lineTo(bx + bw * 0.3, baseY - bh - 16 - Math.random() * 20);
          ctx.lineTo(bx + bw * 0.6, baseY - bh + 8);
          ctx.lineTo(bx + bw, baseY - bh);
          ctx.closePath();
          ctx.fill();
        }
        prevH = bh;
      }
    }
    skyline(H * 0.62, 22, 'rgba(120,140,160,0.55)'); // far, hazier
    skyline(H * 0.64, 16, 'rgba(90,105,120,0.75)'); // near, clearer
  }

  const baseGrad = ctx.createLinearGradient(0, H * 0.9, 0, H);
  if (dusk) { baseGrad.addColorStop(0, 'rgba(10,8,5,0)'); baseGrad.addColorStop(1, 'rgba(8,6,4,1)'); }
  else { baseGrad.addColorStop(0, 'rgba(60,68,74,0)'); baseGrad.addColorStop(1, 'rgba(50,58,64,1)'); }
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, H * 0.9, W, H * 0.1);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.x = 3;
  return tex;
}

function buildHorizon(theme) {
  const tex = buildHorizonTexture(theme);
  const geo = new THREE.CylinderGeometry(170, 170, 240, 32, 1, true);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 30, 0);
  scene.add(mesh);
}

// A shared concrete-crack-and-graffiti texture applied (with a per-obstacle color tint) to
// every wall — replaces the old flat single-color materials, which is a big part of why
// everything read as dull. One texture, many tinted materials: cheap to share.
// Decorative-only thick grass tufts (Ruins extension) — purely visual cover, not a collision
// or line-of-sight system (bullets shouldn't be stopped by grass); it just breaks up the
// ground clutter enough that a prone player actually blends in a bit. One InstancedMesh per
// patch (a handful of randomly placed/rotated thin cone "blades") keeps this cheap.
// Real photo (grass.png, background-removed) on crossed alpha-tested planes — a classic
// cheap-but-convincing "3D grass clump" technique, two perpendicular cards per clump so it
// reads from most angles, not just face-on. Denser/bigger than a first pass at this would be —
// "thick enough to actually hide a prone player in", not a light dusting of blades.
function buildGrassPatches(patches) {
  const grassTex = loadPhotoTexture('/images/grass.png');
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9 });
  const planeGeo = new THREE.PlaneGeometry(1.4, 0.95);
  const dummy = new THREE.Object3D();
  for (const patch of patches) {
    // Dense enough that adjacent clumps' foliage actually overlaps — a prone player (very low
    // silhouette) should have no clean sightline through it from most angles, not just "some
    // grass nearby". A sparse scatter with visible gaps of bare dirt doesn't hide anyone.
    const clumps = Math.round(patch.r * patch.r * 1.8);
    const mesh = new THREE.InstancedMesh(planeGeo, grassMat, clumps * 2);
    let i = 0;
    for (let c = 0; c < clumps; c++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random()) * patch.r; // sqrt so density stays even out to the edge, not center-biased
      const cx = patch.x + Math.cos(ang) * dist, cz = patch.z + Math.sin(ang) * dist;
      const s = 1.1 + Math.random() * 0.8;
      const baseRot = Math.random() * Math.PI;
      for (const rot of [baseRot, baseRot + Math.PI / 2]) {
        dummy.position.set(cx, 0.46 * s, cz);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  }
}

// Rusted drums (real photo on the barrel's side, a plain dark cap top/bottom — the photo is a
// single angled shot, not a seamless wrap, so it goes where it reads best) and stacked tires
// (plain dark rubber tori — no photo needed, a procedural ring already reads fine as a tire).
// Sized to actually block a crouching/prone silhouette, not just decorate the ground.
function buildPropMeshes(drums, tires) {
  if (drums.length) {
    const drumTex = loadPhotoTexture('/images/drum.png');
    const sideMat = new THREE.MeshStandardMaterial({ map: drumTex, roughness: 0.6, metalness: 0.4 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2e2a24, roughness: 0.7, metalness: 0.3 });
    const geo = new THREE.CylinderGeometry(0.47, 0.47, 1.15, 14);
    for (const d of drums) {
      const mesh = new THREE.Mesh(geo, [sideMat, capMat, capMat]);
      mesh.position.set(d.x, 0.575, d.z); // half the mesh height — sits flush on the ground
      scene.add(mesh);
    }
  }
  if (tires.length) {
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    const ringGeo = new THREE.TorusGeometry(0.42, 0.16, 8, 16);
    const step = 0.16 * 2; // 2x tube radius — rings sit flush, no gap or overlap between them
    for (const t of tires) {
      for (let i = 0; i < 4; i++) {
        const ring = new THREE.Mesh(ringGeo, tireMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(t.x, 0.16 + i * step, t.z); // bottom ring's underside sits at y=0
        scene.add(ring);
      }
    }
  }
}

// A real visible staircase — solid ascending blocks (each filled from the ground up to its own
// tread height, like a poured concrete/packed-earth ramp) rather than floating individual
// treads, so there's never a visible gap between the ground floor and the roof it leads to.
// Purely visual: the actual walkable height along here comes from surfaceHeightAt/ACTIVE_RAMPS,
// these meshes are not collision obstacles (they'd otherwise block the very ramp they dress up).
function buildRampSteps(ramps, color) {
  const steps = 12;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  for (const ramp of ramps) {
    const hd = ramp.d / 2;
    const stepDepth = ramp.d / steps;
    for (let i = 0; i < steps; i++) {
      const t = (i + 1) / steps; // far edge of this step — matches surfaceHeightAt's value there
      const zLocal = (i + 0.5) * stepDepth; // 0 at the ramp's low-z edge
      const zPos = ramp.reverse ? ramp.z + hd - zLocal : ramp.z - hd + zLocal;
      const topY = ramp.fromY + (ramp.toY - ramp.fromY) * t;
      const h = Math.max(0.15, topY);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(ramp.w * 0.92, h, stepDepth * 0.96), mat);
      mesh.position.set(ramp.x, h / 2, zPos);
      scene.add(mesh);
    }
  }
}

function buildWallTexture() {
  const S = 512;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);
  // subtle concrete mottling (this texture multiplies the material's tint color, so stay near-white)
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 6 + Math.random() * 26;
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // crack network
  ctx.strokeStyle = 'rgba(20,18,16,0.55)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    let x = Math.random() * S, y = Math.random() * S, a = Math.random() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(x, y);
    const segs = 5 + Math.floor(Math.random() * 5);
    for (let s = 0; s < segs; s++) {
      a += (Math.random() - 0.5) * 1.4;
      x += Math.cos(a) * (14 + Math.random() * 18);
      y += Math.sin(a) * (14 + Math.random() * 18);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // graffiti tags — simple bold spray-paint-style scribbles/shapes in a couple of accent colors
  const tagColors = ['#ff3b6e', '#3bd6ff', '#ffd23b', '#7dff3b'];
  for (let i = 0; i < 3; i++) {
    const color = tagColors[Math.floor(Math.random() * tagColors.length)];
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 6 + Math.random() * 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const ox = 40 + Math.random() * (S - 200), oy = 60 + Math.random() * (S - 220);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.quadraticCurveTo(ox + 40, oy - 30, ox + 90, oy + 10);
    ctx.quadraticCurveTo(ox + 130, oy + 40, ox + 170, oy - 10);
    ctx.stroke();
    // a couple of accent dots/stars near the tag
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      ctx.arc(ox + Math.random() * 160, oy + 40 + Math.random() * 40, 5 + Math.random() * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.6, 1.2);
  return tex;
}

// Weathered mud-brick, for the Ruins extension houses (and the whole Ruins map, for
// consistency) — brick coursing instead of graffiti, a heavier crack network, warm
// tan/ochre mottling, matching the reference photos of a real crumbled adobe ruin.
function buildMudTexture() {
  const S = 512;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e4cfa0';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 8 + Math.random() * 30;
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(90,60,30,0.10)' : 'rgba(255,240,200,0.14)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // faint brick coursing — staggered horizontal rows, like sun-baked mud blocks
  ctx.strokeStyle = 'rgba(80,55,30,0.25)';
  ctx.lineWidth = 2;
  const rowH = 34;
  for (let row = 0, y = 10; y < S; y += rowH, row++) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke();
    const offset = row % 2 === 0 ? 0 : 55;
    for (let x = offset; x < S; x += 110) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + rowH); ctx.stroke();
    }
  }
  // heavier crack network than the concrete texture — this is a real ruin, not just weathered
  ctx.strokeStyle = 'rgba(35,24,14,0.6)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    let x = Math.random() * S, y = Math.random() * S, a = Math.random() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(x, y);
    const segs = 5 + Math.floor(Math.random() * 6);
    for (let s = 0; s < segs; s++) {
      a += (Math.random() - 0.5) * 1.6;
      x += Math.cos(a) * (12 + Math.random() * 20);
      y += Math.sin(a) * (12 + Math.random() * 20);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.6, 1.2);
  return tex;
}

function initScene(mapKey) {
  if (sceneReady) return;
  sceneReady = true;
  const theme = MAPS[mapKey]?.theme || MAPS[DEFAULT_MAP].theme;
  const dusk = theme === 'dusk';

  const layout = getMapLayout(mapKey);
  ACTIVE_WALLS = layout.walls;
  ACTIVE_PLATFORMS = layout.platforms;
  ACTIVE_RAMPS = layout.ramps;
  ACTIVE_GRASS = layout.grass;
  ACTIVE_DECOR = layout.decor;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(dusk ? 0x3a2c17 : 0x8fc3f0);
  // Far distance raised from 110 to 230 — the map's extension reaches z:120 now, well past the
  // old fog cutoff, which would have made the far half of it fade to nothing before you could
  // see it at all.
  scene.fog = new THREE.Fog(dusk ? 0x4a3826 : 0xbcdcf0, 45, 230);
  buildHorizon(theme);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
  yawObject = new THREE.Object3D();
  yawObject.add(camera);
  scene.add(yawObject);

  renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  gameContainer.appendChild(renderer.domElement);

  // bright lighting either way — high sun for day, a warmer/lower-angled one for dusk — both
  // materially brighter than the original scene (a big chunk of why it read as dull/flat)
  const ambient = new THREE.HemisphereLight(dusk ? 0xd8a860 : 0xbfe0ff, dusk ? 0x4a3018 : 0x9a8f74, dusk ? 0.75 : 0.9);
  const sun = new THREE.DirectionalLight(dusk ? 0xffcf8a : 0xfffaf0, dusk ? 1.7 : 2.0);
  sun.position.set(35, dusk ? 45 : 85, 25);
  const fill = new THREE.DirectionalLight(dusk ? 0xffa860 : 0xcfe6ff, 0.5);
  fill.position.set(-30, 40, -20);
  scene.add(ambient, sun, fill);

  // Ruins gets a weathered mud-brick texture map-wide (not just the new houses) for a
  // consistent "old adobe ruin" read; City keeps the cracked-concrete-and-graffiti texture.
  const wallTex = dusk ? buildMudTexture() : buildWallTexture();
  const floorGeo = new THREE.BoxGeometry(FLOOR.w, FLOOR.h, FLOOR.d);
  const floorMat = new THREE.MeshStandardMaterial({ color: FLOOR.color, roughness: 0.85, metalness: 0.05 });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.set(FLOOR.x, FLOOR.y, FLOOR.z);
  scene.add(floorMesh);

  for (const o of [...ACTIVE_WALLS, ...ACTIVE_PLATFORMS]) {
    if (o.renderAs) continue; // drums/tires get their own mesh shape below, not a generic box
    const geo = new THREE.BoxGeometry(o.w, o.h, o.d);
    const mat = new THREE.MeshStandardMaterial({ map: wallTex, color: o.color, roughness: 0.7, metalness: 0.12 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(o.x, o.y, o.z);
    scene.add(mesh);
  }
  // Broken-parapet rubble, base debris, crenellations, decorative door panels — plain-tinted
  // boxes (no need for the full wall texture on tiny scattered chunks), non-collidable, purely
  // dressing. `rotY` (used by the mansion's door panels — one shut, one swung ajar) is optional.
  for (const o of ACTIVE_DECOR) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.85 }));
    mesh.position.set(o.x, o.y, o.z);
    if (o.rotY) mesh.rotation.y = o.rotY;
    scene.add(mesh);
  }
  buildPropMeshes(ACTIVE_WALLS.filter((o) => o.renderAs === 'drum'), ACTIVE_WALLS.filter((o) => o.renderAs === 'tire'));
  buildRampSteps(ACTIVE_RAMPS, dusk ? 0x9c7a3d : 0x6f7275);
  if (ACTIVE_GRASS.length) buildGrassPatches(ACTIVE_GRASS);

  initViewmodels();
  initTrajectoryVisuals();

  clock = new THREE.Clock();
  window.addEventListener('resize', onResize);
  animate();
}

// ---------- First-person viewmodel guns (dummy shapes) + fire effects ----------
const viewmodels = []; // one Group per weapon index, child of camera
const MUZZLE_LOCAL = []; // local offset (relative to camera) of each weapon's muzzle tip
let muzzleFlash, flashTimeMs = 0;
let recoilKick = 0; // 0..1, decays each frame, drives viewmodel kick + knife swing

function addBox(parent, w, h, d, x, y, z, color) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.6 }));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function buildRifleViewmodel({ long, scope }) {
  const g = new THREE.Group();
  const barrelLen = long ? 0.85 : 0.55;
  addBox(g, 0.09, 0.09, barrelLen, 0, 0.02, -barrelLen / 2 - 0.15, 0x2b2b2b); // barrel
  addBox(g, 0.14, 0.16, 0.4, 0, -0.05, 0.05, 0x3a3226); // body/stock
  addBox(g, 0.06, 0.18, 0.1, 0, -0.16, -0.02, 0x2b2b2b); // magazine
  if (scope) addBox(g, 0.06, 0.06, 0.22, 0, 0.11, -0.25, 0x1c1c1c); // scope
  g.userData.muzzleZ = -barrelLen - 0.15;
  return g;
}

function buildPistolViewmodel() {
  const g = new THREE.Group();
  addBox(g, 0.09, 0.14, 0.32, 0, 0.02, -0.14, 0x2b2b2b); // slide/barrel
  addBox(g, 0.09, 0.2, 0.1, 0, -0.14, 0.06, 0x3a3226); // grip
  g.userData.muzzleZ = -0.3;
  return g;
}

function buildKnifeViewmodel() {
  const g = new THREE.Group();
  addBox(g, 0.05, 0.05, 0.18, 0, -0.02, 0.05, 0x4a3a26); // handle
  addBox(g, 0.03, 0.14, 0.32, 0, 0.02, -0.2, 0xcfd4d8); // blade
  g.userData.muzzleZ = -0.36;
  return g;
}

function initViewmodels() {
  const specs = [
    buildRifleViewmodel({ long: false, scope: false }), // Vulcan Rifle
    buildRifleViewmodel({ long: true, scope: true }),   // Hawk Marksman
    buildPistolViewmodel(),                              // Sidearm Pistol
    buildKnifeViewmodel(),                                // Combat Knife
  ];
  for (const g of specs) {
    g.position.set(0.32, -0.28, -0.55);
    g.visible = false;
    camera.add(g);
    viewmodels.push(g);
    MUZZLE_LOCAL.push(new THREE.Vector3(0.32, -0.28 + 0.03, -0.55 + g.userData.muzzleZ));
  }
  viewmodels[0].visible = true;

  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,180,1)');
  grad.addColorStop(0.4, 'rgba(255,190,80,0.9)');
  grad.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  const flashMat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false, blending: THREE.AdditiveBlending,
  });
  muzzleFlash = new THREE.Sprite(flashMat);
  muzzleFlash.scale.set(0, 0, 0);
  camera.add(muzzleFlash);
}

function triggerFireEffects(weaponIdx) {
  recoilKick = 1;
  const weapon = WEAPONS[weaponIdx];
  if (weapon.type === 'melee') return;
  const m = MUZZLE_LOCAL[weaponIdx];
  muzzleFlash.position.copy(m);
  muzzleFlash.material.opacity = 1;
  muzzleFlash.scale.set(0.28, 0.28, 0.28);
  flashTimeMs = 70;

  // brief forward tracer from the muzzle world position
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  camera.getWorldPosition(origin);
  camera.getWorldDirection(dir);
  const worldMuzzle = m.clone();
  camera.localToWorld(worldMuzzle);
  const end = worldMuzzle.clone().addScaledVector(dir, 12);
  const geo = new THREE.BufferGeometry().setFromPoints([worldMuzzle, end]);
  const mat = new THREE.LineBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.8 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  setTimeout(() => { scene.remove(line); geo.dispose(); mat.dispose(); }, 70);
}

function onResize() {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function nameSpriteFor(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 32px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#e8e2d0';
  ctx.fillText(name, 128, 42);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(2, 0.5, 1);
  sprite.position.set(0, 2.3, 0);
  return sprite;
}

function colorForId(id) {
  const c = new THREE.Color();
  c.setHSL((id * 0.157) % 1, 0.55, 0.55);
  return c;
}

const HIP_Y = 0.9, SHOULDER_Y = 1.45, HEAD_Y = 1.7;

function buildCharacterFigure(id, name) {
  const root = new THREE.Group(); // origin at feet (y=0) so crouch scaling just works
  const skin = new THREE.MeshStandardMaterial({ color: 0xc79b73, roughness: 0.6, metalness: 0.05 });
  const suit = new THREE.MeshStandardMaterial({ color: colorForId(id), roughness: 0.45, metalness: 0.25 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.28), suit);
  torso.position.set(0, HIP_Y + 0.35, 0);
  root.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.32), skin);
  head.position.set(0, HEAD_Y, 0);
  root.add(head);

  function limb(mat, w, h, d, pivotY, localY) {
    const pivot = new THREE.Object3D();
    pivot.position.set(0, pivotY, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(0, localY, 0);
    pivot.add(mesh);
    root.add(pivot);
    return pivot;
  }

  const legL = limb(suit, 0.18, HIP_Y, 0.2, HIP_Y, -HIP_Y / 2);
  const legR = limb(suit, 0.18, HIP_Y, 0.2, HIP_Y, -HIP_Y / 2);
  legL.position.x = -0.14; legR.position.x = 0.14;

  const armLen = SHOULDER_Y - HIP_Y + 0.1;
  const armL = limb(skin, 0.15, armLen, 0.15, SHOULDER_Y, -armLen / 2);
  const armR = limb(skin, 0.15, armLen, 0.15, SHOULDER_Y, -armLen / 2);
  armL.position.x = -0.34; armR.position.x = 0.34;

  const sprite = nameSpriteFor(name);
  sprite.position.set(0, HEAD_Y + 0.55, 0);
  root.add(sprite);

  // A weapon silhouette in the right hand — swapped by visibility per equipped weapon, so an
  // enemy reads as armed with something specific instead of a bare-handed generic figure.
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.4, metalness: 0.6 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xc9c9c9, roughness: 0.25, metalness: 0.9 });
  const longGun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.55), gunMat);
  longGun.position.set(0.04, -armLen + 0.05, -0.28);
  const pistol = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.2), gunMat);
  pistol.position.set(0.04, -armLen + 0.05, -0.14);
  const knife = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.2), bladeMat);
  knife.position.set(0.04, -armLen + 0.05, -0.14);
  armR.add(longGun, pistol, knife);

  return { root, legL, legR, armL, armR, heldGuns: { longGun, pistol, knife } };
}

function heldWeaponKind(weapon) {
  if (!weapon) return 'longGun';
  if (weapon.type === 'melee') return 'knife';
  if (weapon.name === 'Glock') return 'pistol';
  return 'longGun';
}

function createRemote(id, name, pos) {
  const fig = buildCharacterFigure(id, name);
  fig.root.position.set(pos[0], pos[1] || 0, pos[2]);
  scene.add(fig.root);
  remotePlayers.set(id, {
    mesh: fig.root, legL: fig.legL, legR: fig.legR, armL: fig.armL, armR: fig.armR,
    heldGuns: fig.heldGuns, weapon: 0,
    targetPos: new THREE.Vector3(pos[0], pos[1] || 0, pos[2]), targetRotY: 0,
    walkPhase: 0, moving: false, crouch: false, prone: false,
  });
}

function removeRemote(id) {
  const rp = remotePlayers.get(id);
  if (!rp) return;
  scene.remove(rp.mesh);
  remotePlayers.delete(id);
}

const textureLoader = new THREE.TextureLoader();
const photoTexCache = {};
function loadPhotoTexture(url) {
  if (!photoTexCache[url]) photoTexCache[url] = textureLoader.load(url);
  return photoTexCache[url];
}

// ---------- Grenades: flying projectile meshes + explosion VFX ----------
// A real small grenade-sized object using the actual photo (on the cap faces, like the ammo
// crate lid) instead of an oversized glowing red sphere — a dim point light still makes it
// spottable at range without the mesh itself reading as a giant ball.
const grenadeMeshes = new Map(); // id -> { mesh, targetPos }
const grenadeSideMat = new THREE.MeshStandardMaterial({ color: 0x3a4a2e, emissive: 0xff2200, emissiveIntensity: 0.2, roughness: 0.45, metalness: 0.4 });
const grenadeCapTex = loadPhotoTexture(`/images/${GRENADE_IMAGE}`);
const grenadeCapMat = new THREE.MeshStandardMaterial({ map: grenadeCapTex, roughness: 0.5, metalness: 0.15 });
const grenadeGeo = new THREE.CylinderGeometry(GRENADE_VISUAL_RADIUS, GRENADE_VISUAL_RADIUS, GRENADE_VISUAL_RADIUS * 1.3, 14);
const grenadeMats = [grenadeSideMat, grenadeCapMat, grenadeCapMat]; // [side, top, bottom]

function syncGrenades(list) {
  const seen = new Set();
  for (const g of list) {
    seen.add(g.id);
    let gm = grenadeMeshes.get(g.id);
    if (!gm) {
      const mesh = new THREE.Mesh(grenadeGeo, grenadeMats);
      mesh.position.set(g.pos[0], g.pos[1], g.pos[2]);
      const light = new THREE.PointLight(0xff3300, 0.7, 3.5);
      mesh.add(light);
      scene.add(mesh);
      gm = { mesh, targetPos: new THREE.Vector3() };
      grenadeMeshes.set(g.id, gm);
    }
    gm.targetPos.set(g.pos[0], g.pos[1], g.pos[2]);
  }
  for (const [id, gm] of grenadeMeshes) {
    if (!seen.has(id)) { scene.remove(gm.mesh); grenadeMeshes.delete(id); }
  }
}

// A simple global ticking cue (not per-grenade distance-based) while any grenade is live
// anywhere in the room — a clear, unmissable "something's about to go off" warning.
let grenadeTickTimer = 0;
function updateGrenadeTicking(dt) {
  if (grenadeMeshes.size === 0) { grenadeTickTimer = 0; return; }
  grenadeTickTimer -= dt;
  if (grenadeTickTimer <= 0) { sfx.grenadeTick(); grenadeTickTimer = 0.3; }
}

// ---------- Pickups: floating rotating markers, distinct per type/caliber so you can tell
// what's on the ground before walking over it. Stays real 3D box geometry (kept small, on
// purpose — this is a pickup crate on the floor, not a poster) with the caliber's real product
// photo textured onto the top face where one exists, falling back to a plain caption texture
// for calibers with no photo (12ga).
const pickupMeshes = new Map(); // idx -> mesh
const CALIBER_BODY_COLOR = { '7.62mm': 0x6b5a2a, '9mm': 0x54585c, '12ga': 0x5a2222 };
const CALIBER_LABEL_BG = { '7.62mm': '#c9a84a', '9mm': '#9aa0a6', '12ga': '#c94a4a' };
const ammoLabelTexCache = {};
function ammoLabelTexture(text) {
  if (ammoLabelTexCache[text]) return ammoLabelTexCache[text];
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = CALIBER_LABEL_BG[text] || '#c9a84a';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#141210';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 34);
  const tex = new THREE.CanvasTexture(c);
  ammoLabelTexCache[text] = tex;
  return tex;
}
function ammoBoxMesh(weapon) {
  // The photo is one of the crate's own six faces (the lid), not a flat plane floating
  // above a plain box — a genuine solid object with real depth/edges from every angle,
  // not a sticker glued on top of unrelated geometry.
  const caliber = weapon ? weapon.caliber : null;
  const sideColor = CALIBER_BODY_COLOR[caliber] || 0x6b5a2a;
  const sideMat = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.6, metalness: 0.3 });
  const bottomMat = new THREE.MeshStandardMaterial({ color: 0x2a2418, roughness: 0.8, metalness: 0.1 });
  const lidTex = weapon && weapon.ammoImage
    ? loadPhotoTexture(`/images/${weapon.ammoImage}`)
    : ammoLabelTexture(caliber || '?');
  const lidMat = new THREE.MeshStandardMaterial({ map: lidTex, roughness: 0.5, metalness: 0.15 });
  // BoxGeometry face material order: [+x, -x, +y(top), -y(bottom), +z, -z]
  const materials = [sideMat, sideMat, lidMat, bottomMat, sideMat, sideMat];
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.28), materials); // small crate, not a billboard
  return box;
}
function healthCrossMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xe84b4b, emissive: 0x6a1010, emissiveIntensity: 0.6, roughness: 0.4 });
  const a = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.13, 0.13), mat);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.4, 0.13), mat);
  g.add(a, b);
  return g;
}
function grenadePickupMesh() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a4a2e, roughness: 0.5, metalness: 0.3 });
  return new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat);
}
function pickupMeshFor(p) {
  if (p.type === 'health') return healthCrossMesh();
  if (p.type === 'grenade') return grenadePickupMesh();
  const weapon = WEAPONS.find((w) => w.id === p.weaponId);
  return ammoBoxMesh(weapon);
}

function syncPickups(list) {
  const seen = new Set();
  for (const p of list) {
    seen.add(p.idx);
    let mesh = pickupMeshes.get(p.idx);
    if (!mesh) {
      mesh = pickupMeshFor(p);
      mesh.position.set(p.pos[0], 0.9, p.pos[2]);
      scene.add(mesh);
      pickupMeshes.set(p.idx, mesh);
    }
  }
  for (const [idx, mesh] of pickupMeshes) {
    if (!seen.has(idx)) { scene.remove(mesh); pickupMeshes.delete(idx); }
  }
}

function animatePickups(dt) {
  for (const mesh of pickupMeshes.values()) {
    mesh.rotation.y += dt * 1.4;
    mesh.position.y = 0.9 + Math.sin(performance.now() * 0.002 + mesh.id) * 0.12;
  }
}

let pickupToastTimer = null;
function showPickupToast(text) {
  pickupToast.textContent = text;
  pickupToast.classList.add('show');
  clearTimeout(pickupToastTimer);
  pickupToastTimer = setTimeout(() => pickupToast.classList.remove('show'), 2200);
}

function smokeSpriteTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(210,200,185,0.9)');
  g.addColorStop(0.5, 'rgba(140,130,115,0.55)');
  g.addColorStop(1, 'rgba(90,82,70,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const smokeTex = smokeSpriteTexture();

function spawnExplosion(pos) {
  sfx.explosion();
  // bright blast flash — additive, expands and fades fast
  const flashMat = new THREE.SpriteMaterial({
    map: muzzleFlash.material.map, transparent: true, depthTest: false, blending: THREE.AdditiveBlending, opacity: 1,
  });
  const flash = new THREE.Sprite(flashMat);
  flash.position.set(pos[0], pos[1] + 0.3, pos[2]);
  flash.scale.set(0.5, 0.5, 0.5);
  scene.add(flash);
  const flashStart = performance.now();
  (function animFlash() {
    const t = (performance.now() - flashStart) / 260;
    if (t >= 1) { scene.remove(flash); flashMat.dispose(); return; }
    const s = 0.5 + t * 7;
    flash.scale.set(s, s, s);
    flashMat.opacity = 1 - t;
    requestAnimationFrame(animFlash);
  })();

  // dust/smoke puffs — normal alpha blending (additive would make grey smoke look wrong), drift
  // outward and up, fading over ~1.4s.
  const puffCount = 16;
  const puffs = [];
  for (let i = 0; i < puffCount; i++) {
    const mat = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.85 });
    const s = new THREE.Sprite(mat);
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 1.2;
    s.position.set(pos[0] + Math.cos(a) * r, pos[1] + 0.2 + Math.random() * 0.6, pos[2] + Math.sin(a) * r);
    const scale0 = 0.6 + Math.random() * 0.5;
    s.scale.set(scale0, scale0, scale0);
    scene.add(s);
    puffs.push({
      sprite: s, mat,
      vel: new THREE.Vector3(Math.cos(a), 0.9 + Math.random() * 0.6, Math.sin(a)).multiplyScalar(1.2 + Math.random() * 1.6),
      life: 0, maxLife: 1.0 + Math.random() * 0.6, scale0,
    });
  }
  const smokeStart = performance.now();
  let lastT = smokeStart;
  (function animSmoke() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    let alive = false;
    for (const p of puffs) {
      p.life += dt;
      if (p.life >= p.maxLife) { if (p.sprite.parent) { scene.remove(p.sprite); p.mat.dispose(); } continue; }
      alive = true;
      p.vel.multiplyScalar(1 - Math.min(1, dt * 1.5)); // drag
      p.sprite.position.addScaledVector(p.vel, dt);
      const t = p.life / p.maxLife;
      const s = p.scale0 * (1 + t * 2.2);
      p.sprite.scale.set(s, s, s);
      p.mat.opacity = 0.85 * (1 - t);
    }
    if (alive) requestAnimationFrame(animSmoke);
  })();

  // a mild screen shake if the local player is close to the blast
  const local = new THREE.Vector3();
  camera.getWorldPosition(local);
  const dist = local.distanceTo(new THREE.Vector3(pos[0], pos[1], pos[2]));
  if (dist < GRENADE_BLAST_RADIUS * 1.4) {
    screenShake = Math.max(screenShake, (1 - dist / (GRENADE_BLAST_RADIUS * 1.4)) * 0.35);
  }
}

// ---------- Message handling ----------
function handleMessage(msg) {
  switch (msg.type) {
    case 'rooms':
      renderRoomList(msg.rooms);
      break;
    case 'joined':
      onJoined(msg);
      break;
    case 'playerJoined':
      if (sceneReady && !remotePlayers.has(msg.player.id)) {
        createRemote(msg.player.id, msg.player.name, [0, 0, 0]);
      }
      break;
    case 'playerLeft':
      removeRemote(msg.id);
      break;
    case 'state':
      for (const p of msg.players) {
        if (p.id === localId) {
          setHealth(p.health);
          continue;
        }
        let rp = remotePlayers.get(p.id);
        if (!rp) {
          createRemote(p.id, `Player${p.id}`, p.pos);
          rp = remotePlayers.get(p.id);
        }
        rp.targetPos.set(p.pos[0], p.pos[1] || 0, p.pos[2]);
        rp.targetRotY = p.rot[0];
        rp.mesh.visible = p.alive;
        rp.crouch = !!p.crouch;
        rp.prone = !!p.prone;
        rp.moving = !!p.moving;
        rp.weapon = p.weapon;
      }
      if (Array.isArray(msg.grenades)) syncGrenades(msg.grenades);
      if (Array.isArray(msg.pickups)) syncPickups(msg.pickups);
      break;
    case 'grenadeExploded':
      spawnExplosion(msg.pos);
      break;
    case 'pickup':
      if (msg.kind === 'health') {
        setHealth(msg.health);
        showPickupToast('Medkit picked — health restored');
      } else if (msg.kind === 'grenade') {
        grenadeCount = Math.min(GRENADE_MAX_CARRY, grenadeCount + msg.amount);
        updateWeaponBar();
        showPickupToast(`+${msg.amount} grenades picked`);
      } else {
        const w = WEAPONS.find((x) => x.id === msg.weaponId);
        if (w) {
          const idx = WEAPONS.indexOf(w);
          ammo[idx].reserve = Math.min(w.reserveMax, ammo[idx].reserve + msg.amount);
          updateWeaponBar();
        }
        showPickupToast(`+${msg.amount} ${msg.caliber || msg.weaponName} picked`);
      }
      sfx.pickup();
      break;
    case 'hit':
      if (msg.shooterId === localId) showHitMarker();
      if (msg.targetId === localId) { setHealth(msg.health); flashDamage(); }
      break;
    case 'killed':
      if (msg.killerId === null) {
        pushKillFeed(`${msg.victimName} fell from the playing area`);
      } else {
        pushKillFeed(`${msg.killerName} eliminated ${msg.victimName} with ${msg.weapon || 'Unknown'}`);
      }
      if (msg.victimId === localId) { onLocalDeath(msg.killerId === null ? null : msg.killerName); sfx.death(); }
      break;
    case 'respawn': {
      const rp = remotePlayers.get(msg.id);
      if (rp) { rp.mesh.position.set(msg.pos[0], 0, msg.pos[2]); rp.targetPos.copy(rp.mesh.position); rp.mesh.visible = true; }
      if (msg.id === localId) onLocalRespawn(msg.pos, msg.health);
      break;
    }
    case 'leaderboard':
      renderLeaderboard(msg.list);
      break;
    case 'matchEnded':
      onMatchEnded(msg.list);
      break;
    case 'error':
      alert(msg.message);
      break;
  }
}

function onMatchEnded(list) {
  matchOver = true;
  matchTimer.hidden = true;
  localAlive = false; // freezes movement/firing via their existing localAlive checks
  if (fireIntervalId) { clearInterval(fireIntervalId); fireIntervalId = null; }
  if (document.pointerLockElement) document.exitPointerLock();
  pauseMenu.hidden = true;
  scoreboard.hidden = true;
  renderBoardInto(matchEndBody, list);
  matchEndScreen.hidden = false;
}

let matchEndsAt = null;
let matchOver = false;
function onJoined(msg) {
  localId = msg.playerId;
  roomId = msg.roomId;
  roomTag.textContent = `Room: ${msg.roomName} (${msg.roomId})`;
  menuScreen.hidden = true;
  gameContainer.hidden = false;
  hud.hidden = false;
  lockHint.hidden = false;
  matchEndsAt = msg.matchEndsAt || null;
  matchOver = false;
  matchTimer.hidden = !matchEndsAt;

  initScene(msg.map || DEFAULT_MAP);
  playerX = msg.players.find((p) => p.id === localId)?.pos[0] ?? 0;
  playerZ = msg.players.find((p) => p.id === localId)?.pos[2] ?? 0;
  eyeHeight = STAND_EYE_HEIGHT;
  setStance(false, false);
  yawObject.position.set(playerX, eyeHeight, playerZ);

  for (const p of msg.players) {
    if (p.id === localId) continue;
    createRemote(p.id, p.name, p.pos);
  }
  setWeapon(0);
  setHealth(MAX_HEALTH);
  resetLoadout();
}

function pushKillFeed(text) {
  const div = document.createElement('div');
  div.textContent = text;
  killFeed.prepend(div);
  setTimeout(() => div.remove(), 4500);
  while (killFeed.children.length > 5) killFeed.lastChild.remove();
}

function renderBoardInto(tbody, list) {
  tbody.innerHTML = list
    .map((p, i) => `<tr><td>${i + 1}</td><td class="name">${escapeHtml(p.name)}${p.id === localId ? ' (you)' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`)
    .join('');
}
function renderLeaderboard(list) {
  renderBoardInto(scoreboardBody, list);
}

function setHealth(hp) {
  healthFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
}

function flashDamage() {
  dmgFlash.style.opacity = '1';
  setTimeout(() => { dmgFlash.style.opacity = '0'; }, 60);
  sfx.damage();
}

function showHitMarker() {
  crosshair.style.background = '#e04b4b';
  crosshair.style.transform = 'translate(-50%,-50%) scale(1.8)';
  setTimeout(() => { crosshair.style.background = ''; crosshair.style.transform = ''; }, 120);
  sfx.hitMarker();
}

function onLocalDeath(killerName) {
  localAlive = false;
  centerMsg.hidden = false;
  centerMsg.textContent = killerName
    ? `Eliminated by ${killerName} — respawning...`
    : `You fell from the playing area — respawning...`;
}

function resetLoadout() {
  WEAPONS.forEach((w, i) => { ammo[i] = { mag: w.magSize, reserve: w.reserveMax }; });
  grenadeCount = GRENADE_START_COUNT;
  updateWeaponBar();
}

function onLocalRespawn(pos, hp) {
  localAlive = true;
  centerMsg.hidden = true;
  eyeHeight = STAND_EYE_HEIGHT;
  setStance(false, false);
  yawObject.position.set(pos[0], eyeHeight, pos[2]);
  playerX = pos[0]; playerZ = pos[2];
  currentGroundY = 0; // every spawn point is ground-level
  standingPlatformIndex = -1;
  fellOffSent = false;
  falling = false; fallVel = 0; fallDepth = 0;
  setHealth(hp);
  resetLoadout();
}

// ---------- Pointer lock + input ----------
const pauseMenu = document.getElementById('pauseMenu');
const resumeBtn = document.getElementById('resumeBtn');
const pauseControlsBtn = document.getElementById('pauseControlsBtn');
const quitBtn = document.getElementById('quitBtn');
let pointerLocked = false;
let everLocked = false; // first-ever lock shows the plain "click to enter" hint; after that,
                         // losing the lock (Esc, alt-tab) shows the full pause menu instead

function requestLock() { renderer.domElement.requestPointerLock(); }
lockHint.addEventListener('click', requestLock);
resumeBtn.addEventListener('click', requestLock);
pauseControlsBtn.addEventListener('click', () => { pauseMenu.hidden = true; controlsOpenedFromPause = true; controlsModal.hidden = false; });
quitBtn.addEventListener('click', () => { location.reload(); });

document.addEventListener('pointerlockchange', () => {
  pointerLocked = document.pointerLockElement === renderer?.domElement;
  if (pointerLocked) {
    everLocked = true;
    lockHint.hidden = true;
    pauseMenu.hidden = true;
  } else if (!hud.hidden && !matchOver) { // not pre-join menu, not after the match has ended
    if (everLocked) pauseMenu.hidden = false;
    else lockHint.hidden = false;
  }
  // losing focus/lock mid-hold (alt-tab, etc.) can eat the keyup — don't leave the trajectory
  // preview stuck on screen or a throw silently queued for whenever G is next released
  if (!pointerLocked && grenadeAiming) {
    grenadeAiming = false;
    if (trajectoryLine) trajectoryLine.visible = false;
    if (trajectoryMarker) trajectoryMarker.visible = false;
  }
});

let yaw = 0, pitch = 0;
document.addEventListener('mousemove', (e) => {
  if (!pointerLocked) return;
  yaw -= e.movementX * 0.0022;
  pitch -= e.movementY * 0.0022;
  pitch = Math.max(-1.3, Math.min(1.3, pitch));
  yawObject.rotation.y = yaw;
  camera.rotation.x = pitch;
});

const keys = new Set();
document.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code >= 'Digit1' && e.code <= 'Digit4') setWeapon(Number(e.code.slice(-1)) - 1);
  if (e.code === 'Space') tryJump();
  if (e.code === 'KeyC') setStance(!isCrouched, false);
  if (e.code === 'KeyZ') setStance(false, !isProne);
  if (e.code === 'KeyG') startGrenadeAim();
  if (e.code === 'KeyR') reload();
  if (e.code === 'Tab') { e.preventDefault(); scoreboard.hidden = false; }
});
document.addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'KeyG') releaseGrenadeThrow();
  if (e.code === 'Tab') scoreboard.hidden = true;
});

// ---------- Ammo + weapon card bar ----------
// Ammo is tracked client-side only, same trust model as crouch/prone/movement already are in
// this LAN game (see README — no anti-cheat). mag/reserve stay null for melee (unlimited).
const ammo = WEAPONS.map((w) => ({ mag: w.magSize, reserve: w.reserveMax }));
const weaponCardEls = [];

// Card icon: try the real product photo first (once the user drops files in /public/images —
// see CLAUDE.md), falling back to the emoji if that file 404s. mix-blend-mode:multiply fakes
// background removal for a photo shot on a white backdrop, without needing an image editor.
function iconHtml(w) {
  if (!w.image) return w.icon;
  return `<img class="wImg" src="/images/${w.image}" onerror="this.replaceWith(document.createTextNode('${w.icon}'))">`;
}

function buildWeaponBar() {
  weaponBar.innerHTML = '';
  WEAPONS.forEach((w, i) => {
    const card = document.createElement('div');
    card.className = 'weaponCard';
    const ringHtml = w.reloadTime
      ? `<div class="reloadRing" hidden><span class="reloadNum"></span></div>` : '';
    card.innerHTML = `<div class="wIcon">${iconHtml(w)}${ringHtml}</div><div class="wName">${w.name}</div><div class="wAmmo"></div><div class="wKey">${i + 1}</div>`;
    weaponBar.appendChild(card);
    weaponCardEls.push(card);
  });

  const gCard = document.createElement('div');
  gCard.className = 'weaponCard';
  gCard.id = 'grenadeCard';
  const grenadeIconHtml = `<img class="wImg" src="/images/${GRENADE_IMAGE}" onerror="this.replaceWith(document.createTextNode('${GRENADE_ICON}'))">`;
  gCard.innerHTML = `<div class="wIcon">${grenadeIconHtml}</div><div class="wName">Grenade</div><div class="wAmmo" id="grenadeCountEl"></div><div class="wKey">Hold G</div>`;
  weaponBar.appendChild(gCard);
}
buildWeaponBar();
const grenadeCountEl = document.getElementById('grenadeCountEl');

function updateWeaponBar() {
  WEAPONS.forEach((w, i) => {
    const card = weaponCardEls[i];
    card.classList.toggle('active', i === currentWeapon);
    const ammoEl = card.querySelector('.wAmmo');
    ammoEl.textContent = w.magSize == null ? '—' : `${ammo[i].mag}/${ammo[i].reserve}`;
  });
  grenadeCountEl.textContent = String(grenadeCount);
}

let currentWeapon = 0;
function setWeapon(idx) {
  if (idx < 0 || idx >= WEAPONS.length) return;
  cancelReload(); // switching weapons drops any in-progress reload, no ammo change
  currentWeapon = idx;
  for (let i = 0; i < viewmodels.length; i++) viewmodels[i].visible = i === idx;
  updateWeaponBar();
}
updateWeaponBar();

// Reload takes real time (per-weapon `reloadTime`) instead of being instant — the card shows
// a blinking ring + remaining-seconds countdown while it runs. Firing is blocked until it
// completes; switching weapons cancels it outright (no partial credit).
let reloadState = null; // { idx, startedAt, endsAt, duration }
function reload() {
  const w = WEAPONS[currentWeapon];
  if (w.magSize == null || !w.reloadTime) return; // melee — nothing to reload
  if (reloadState) return; // already reloading
  const a = ammo[currentWeapon];
  if (w.magSize - a.mag <= 0) return;
  if (a.reserve <= 0) { sfx.empty(); return; }
  const now = performance.now();
  reloadState = { idx: currentWeapon, startedAt: now, endsAt: now + w.reloadTime, duration: w.reloadTime };
  sfx.reload();
  const ring = weaponCardEls[currentWeapon].querySelector('.reloadRing');
  if (ring) ring.hidden = false;
}
function cancelReload() {
  if (!reloadState) return;
  const ring = weaponCardEls[reloadState.idx].querySelector('.reloadRing');
  if (ring) ring.hidden = true;
  reloadState = null;
}
function updateReload() {
  if (!reloadState) return;
  const now = performance.now();
  const remaining = Math.max(0, reloadState.endsAt - now);
  const ring = weaponCardEls[reloadState.idx].querySelector('.reloadRing');
  if (ring) {
    const pct = 100 * (1 - remaining / reloadState.duration);
    ring.style.setProperty('--pct', `${pct}%`);
    ring.querySelector('.reloadNum').textContent = (remaining / 1000).toFixed(1);
  }
  if (remaining <= 0) {
    const w = WEAPONS[reloadState.idx];
    const a = ammo[reloadState.idx];
    const take = Math.min(w.magSize - a.mag, a.reserve);
    a.mag += take;
    a.reserve -= take;
    if (ring) ring.hidden = true;
    reloadState = null;
    updateWeaponBar();
  }
}

let fireIntervalId = null;
document.addEventListener('mousedown', (e) => {
  if (!pointerLocked || e.button !== 0) return;
  fire();
  const w = WEAPONS[currentWeapon];
  if (w.auto) fireIntervalId = setInterval(fire, w.fireInterval);
});
document.addEventListener('mouseup', () => {
  if (fireIntervalId) { clearInterval(fireIntervalId); fireIntervalId = null; }
});

let lastLocalFire = 0;
function fire() {
  if (!localAlive || !sceneReady) return;
  const w = WEAPONS[currentWeapon];
  const now = performance.now();
  if (now - lastLocalFire < w.fireInterval - 5) return;
  if (reloadState && reloadState.idx === currentWeapon) return;
  lastLocalFire = now;

  if (w.magSize != null) {
    const a = ammo[currentWeapon];
    if (a.mag <= 0) {
      sfx.empty();
      if (fireIntervalId) { clearInterval(fireIntervalId); fireIntervalId = null; }
      return;
    }
    a.mag -= 1;
    updateWeaponBar();
  }

  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  camera.getWorldPosition(origin);
  camera.getWorldDirection(dir);
  sendMsg({ type: 'attack', weapon: currentWeapon, origin: [origin.x, origin.y, origin.z], dir: [dir.x, dir.y, dir.z] });
  triggerFireEffects(currentWeapon);
  sfx.shoot(w);
  if (w.pump) setTimeout(() => sfx.pump(), 200); // the pump-action "cha-chk" after the blast
}

// ---------- Grenade throw: hold G to aim (shows the predicted landing arc), release to throw ----------
let lastGrenadeThrow = -Infinity;
let grenadeAiming = false;
let trajectoryLine, trajectoryMarker;

function initTrajectoryVisuals() {
  const maxPts = 40;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPts * 3), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthTest: false });
  trajectoryLine = new THREE.Line(geo, mat);
  trajectoryLine.frustumCulled = false;
  trajectoryLine.visible = false;
  scene.add(trajectoryLine);

  const markerMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false });
  trajectoryMarker = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.4, 20), markerMat);
  trajectoryMarker.rotation.x = -Math.PI / 2;
  trajectoryMarker.visible = false;
  scene.add(trajectoryMarker);
}

function startGrenadeAim() {
  if (!localAlive || !sceneReady || !pointerLocked || grenadeAiming) return;
  if (grenadeCount <= 0) { sfx.empty(); return; }
  if (performance.now() - lastGrenadeThrow < GRENADE_COOLDOWN_MS) return;
  grenadeAiming = true;
  trajectoryLine.visible = true;
  trajectoryMarker.visible = true;
}

function releaseGrenadeThrow() {
  if (!grenadeAiming) return;
  grenadeAiming = false;
  trajectoryLine.visible = false;
  trajectoryMarker.visible = false;
  if (!localAlive || !sceneReady) return;
  lastGrenadeThrow = performance.now();
  grenadeCount = Math.max(0, grenadeCount - 1);
  updateWeaponBar();
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  camera.getWorldPosition(origin);
  camera.getWorldDirection(dir);
  sendMsg({ type: 'throwGrenade', origin: [origin.x, origin.y, origin.z], dir: [dir.x, dir.y, dir.z] });
  recoilKick = 1; // reuse the existing viewmodel kick as a simple throw animation
  sfx.grenadeThrow();
}

// Samples the same physics the server simulates (gravity arc, ground stop) so the preview line
// actually matches where the grenade will land, not just an approximate direction.
function updateTrajectoryPreview() {
  if (!grenadeAiming) return;
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  camera.getWorldPosition(origin);
  camera.getWorldDirection(dir);
  const vel = dir.clone().multiplyScalar(GRENADE_THROW_SPEED);
  vel.y += 4; // matches the server's upward toss bias
  const pos = origin.clone();
  const pts = [];
  const dt = 0.045, g = -20;
  for (let i = 0; i < 40; i++) {
    vel.y += g * dt;
    pos.addScaledVector(vel, dt);
    if (pos.y <= GRENADE_RADIUS) { pos.y = GRENADE_RADIUS; pts.push(pos.clone()); break; }
    pts.push(pos.clone());
  }
  const posAttr = trajectoryLine.geometry.attributes.position;
  const arr = posAttr.array;
  const n = Math.min(pts.length, arr.length / 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = pts[i].x; arr[i * 3 + 1] = pts[i].y; arr[i * 3 + 2] = pts[i].z; }
  trajectoryLine.geometry.setDrawRange(0, n);
  posAttr.needsUpdate = true;
  const land = pts[pts.length - 1];
  if (land) trajectoryMarker.position.set(land.x, land.y + 0.02, land.z);
}

// ---------- Movement + collision ----------
let playerX = 0, playerZ = 0;
let currentGroundY = 0; // the surface height (ramp/platform/ground) the player is standing on
let fellOffSent = false;
let falling = false, fallVel = 0, fallDepth = 0;
let yVel = 0, jumpOffset = 0;
const GRAVITY = -20;
const JUMP_VEL = 6.2;
const PLAYER_HEIGHT = 1.8; // approximate vertical extent used only for collision height checks

function tryJump() {
  if (isProne) return;
  if (jumpOffset === 0 && yVel === 0) yVel = JUMP_VEL;
}

// `y` is the player's CURRENT standing height (their feet) — a wall only blocks if its own
// vertical span actually overlaps the player's body at that height. This is what lets you walk
// on the ground floor underneath a building's upper-floor parapet without it blocking you, and
// still get properly blocked by that same parapet once you've walked up to platform height.
function collidesAt(x, z, y) {
  for (const o of ACTIVE_WALLS) {
    const hw = o.w / 2 + PLAYER_RADIUS;
    const hd = o.d / 2 + PLAYER_RADIUS;
    if (Math.abs(x - o.x) >= hw || Math.abs(z - o.z) >= hd) continue;
    const oMinY = o.y - o.h / 2, oMaxY = o.y + o.h / 2;
    if (y + PLAYER_HEIGHT > oMinY && y < oMaxY) return true;
  }
  return false;
}

let isMoving = false;
function updateMovement(dt) {
  // Once you've walked off the edge, you're committed — actually fall (drop the camera) for
  // a beat before dying, instead of dying the instant you cross the boundary line. Movement
  // input is ignored while falling; there's no recovering mid-drop.
  if (falling) {
    fallVel += GRAVITY * dt * 1.6;
    fallDepth -= fallVel * dt;
    yawObject.position.y = eyeHeight - fallDepth;
    if (fallDepth > 9 && !fellOffSent) {
      fellOffSent = true;
      sendMsg({ type: 'fellOff' });
    }
    return;
  }

  const sprinting = !isCrouched && !isProne && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
  const speed = isProne ? PRONE_SPEED : isCrouched ? 3.0 : sprinting ? 8.5 : 5.5;
  let mx = 0, mz = 0;
  if (keys.has('KeyW')) mz -= 1;
  if (keys.has('KeyS')) mz += 1;
  if (keys.has('KeyA')) mx -= 1;
  if (keys.has('KeyD')) mx += 1;
  isMoving = mx !== 0 || mz !== 0;
  if (mx !== 0 || mz !== 0) {
    const len = Math.hypot(mx, mz);
    mx /= len; mz /= len;
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    const worldDx = (mx * cos + mz * sin) * speed * dt;
    const worldDz = (-mx * sin + mz * cos) * speed * dt;
    // jumpOffset counts toward the collision height now, not just currentGroundY — jump was
    // purely a cosmetic camera bob before (zero effect on collision), which meant a low rail
    // (e.g. the stairs' side barrier) was just as solid as a full-height wall. A jump's ~0.96
    // unit peak still can't clear the 1.65-unit cover blocks in the core arena (comfortably
    // taller than that), so this only opens up rails/ledges genuinely low enough to hop.
    const jumpY = currentGroundY + jumpOffset;
    const nx = playerX + worldDx;
    if (!collidesAt(nx, playerZ, jumpY)) playerX = nx;
    const nz = playerZ + worldDz;
    if (!collidesAt(playerX, nz, jumpY)) playerZ = nz;
  }

  currentGroundY = surfaceHeightAt(playerX, playerZ);

  yVel += GRAVITY * dt;
  jumpOffset += yVel * dt;
  if (jumpOffset < 0) { jumpOffset = 0; yVel = 0; }

  const targetEye = isProne ? PRONE_EYE_HEIGHT : isCrouched ? CROUCH_EYE_HEIGHT : STAND_EYE_HEIGHT;
  eyeHeight += (targetEye - eyeHeight) * Math.min(1, dt * 10);
  yawObject.position.set(playerX, currentGroundY + eyeHeight + jumpOffset, playerZ);

  if (playerX < MAP_BOUNDS.minX || playerX > MAP_BOUNDS.maxX || playerZ < MAP_BOUNDS.minZ || playerZ > MAP_BOUNDS.maxZ) {
    falling = true;
    fallVel = 0;
    fallDepth = 0;
    isMoving = false;
  }
}

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
function drawMinimap() {
  const ctx = minimapCtx;
  ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
  ctx.fillStyle = 'rgba(140,124,102,0.55)';
  for (const o of ACTIVE_WALLS) {
    const [cx, cy] = toMinimap(o.x, o.z);
    ctx.fillRect(cx - (o.w * MINIMAP_SCALE) / 2, cy - (o.d * MINIMAP_SCALE) / 2, o.w * MINIMAP_SCALE, o.d * MINIMAP_SCALE);
  }
  ctx.fillStyle = 'rgba(200,190,150,0.7)'; // upper-floor platforms drawn brighter, distinct from walls
  for (const p of ACTIVE_PLATFORMS) {
    const [cx, cy] = toMinimap(p.x, p.z);
    ctx.fillRect(cx - (p.w * MINIMAP_SCALE) / 2, cy - (p.d * MINIMAP_SCALE) / 2, p.w * MINIMAP_SCALE, p.d * MINIMAP_SCALE);
  }
  // Same forward-vector convention as updateMovement's WASD-to-world mapping: at yaw=0,
  // "forward" is world (0,-1) — the triangle itself points this way, so a separate ray line
  // was redundant (and looked odd) on top of it.
  const [px, py] = toMinimap(playerX, playerZ);
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
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

let netTimer = 0;
function sendState(dt) {
  netTimer += dt;
  if (netTimer < 0.066) return;
  netTimer = 0;
  // pos[1] is the player's standing SURFACE height (0 on plain ground, floorY on a building's
  // upper platform) — not eye height/jump — so server-side hit detection (which builds each
  // target's hit-cylinder up from pos[1]) is correct for players on an elevated floor too.
  sendMsg({ type: 'state', pos: [playerX, currentGroundY, playerZ], rot: [yaw, pitch], weapon: currentWeapon, crouch: isCrouched, prone: isProne, moving: isMoving });
}

function animateRemoteFigure(rp, dt) {
  if (rp.moving) rp.walkPhase += dt * 7;
  const targetSwing = rp.moving ? Math.sin(rp.walkPhase) * 0.55 : 0;
  const lerpT = Math.min(1, dt * 8);
  rp.legL.rotation.x += (targetSwing - rp.legL.rotation.x) * lerpT;
  rp.legR.rotation.x += (-targetSwing - rp.legR.rotation.x) * lerpT;
  rp.armL.rotation.x += (-targetSwing * 0.7 - rp.armL.rotation.x) * lerpT;
  rp.armR.rotation.x += (targetSwing * 0.7 - rp.armR.rotation.x) * lerpT;

  // Crouch: shorten the standing figure (still upright). Prone: actually lie the figure flat
  // instead of just squashing it — a squashed-but-still-upright box read as "standing but
  // short", not "lying down", so shots into a prone player looked unfair from the shooter's
  // side even though the server hitbox was already correctly small.
  const targetScaleY = rp.prone ? 1 : rp.crouch ? 0.72 : 1;
  rp.mesh.scale.y += (targetScaleY - rp.mesh.scale.y) * lerpT;
  const targetRotX = rp.prone ? -Math.PI / 2 : 0;
  rp.mesh.rotation.x += (targetRotX - rp.mesh.rotation.x) * lerpT;

  if (rp.heldGuns) {
    const kind = heldWeaponKind(WEAPONS[rp.weapon]);
    rp.heldGuns.longGun.visible = kind === 'longGun';
    rp.heldGuns.pistol.visible = kind === 'pistol';
    rp.heldGuns.knife.visible = kind === 'knife';
  }
}

function updateViewmodelKick(dt) {
  recoilKick = Math.max(0, recoilKick - dt * 9);
  const active = viewmodels[currentWeapon];
  if (active) {
    if (WEAPONS[currentWeapon].type === 'melee') {
      active.rotation.z = -recoilKick * 1.1;
      active.position.z = -0.55 - recoilKick * 0.15;
    } else {
      active.position.z = -0.55 + recoilKick * 0.12;
      active.rotation.x = -recoilKick * 0.22;
    }
  }
  if (flashTimeMs > 0) {
    flashTimeMs -= dt * 1000;
    const t = Math.max(0, flashTimeMs / 70);
    muzzleFlash.material.opacity = t;
    muzzleFlash.scale.set(0.28 * t, 0.28 * t, 0.28 * t);
  }
}

let screenShake = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, clock.getDelta());
  if (pointerLocked && localAlive) updateMovement(dt);
  if (sceneReady) updateViewmodelKick(dt);
  for (const rp of remotePlayers.values()) {
    rp.mesh.position.lerp(rp.targetPos, Math.min(1, dt * 10));
    let dr = rp.targetRotY - rp.mesh.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    rp.mesh.rotation.y += dr * Math.min(1, dt * 10);
    animateRemoteFigure(rp, dt);
  }
  for (const gm of grenadeMeshes.values()) {
    gm.mesh.position.lerp(gm.targetPos, Math.min(1, dt * 12));
  }
  updateTrajectoryPreview();
  updateGrenadeTicking(dt);
  animatePickups(dt);
  updateReload();
  if (sceneReady) drawMinimap();
  if (matchEndsAt && !matchOver) {
    const remaining = Math.max(0, matchEndsAt - Date.now());
    const mm = Math.floor(remaining / 60000);
    const ss = Math.floor((remaining % 60000) / 1000);
    matchTimer.textContent = `${mm}:${String(ss).padStart(2, '0')}`;
  }
  if (screenShake > 0.001) {
    screenShake *= Math.max(0, 1 - dt * 6);
    camera.position.set((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake, 0);
  } else if (camera.position.x !== 0 || camera.position.y !== 0) {
    camera.position.set(0, 0, 0);
  }
  sendState(dt);
  renderer.render(scene, camera);
}
