import * as THREE from 'three';
import {
  WEAPONS, GRENADE_COOLDOWN_MS, GRENADE_RADIUS, GRENADE_THROW_SPEED,
  GRENADE_START_COUNT, GRENADE_MAX_CARRY, GRENADE_ICON, GRENADE_IMAGE,
} from '/shared/gameData.js';
import { state } from './state.js';
import { sfx, playBuffer, playPositionalOneShot, playPositionalLoopStart, updatePositionalTarget } from './audio.js';
import { sendMsg } from './net.js';

const crosshair = document.getElementById('crosshair');
const weaponBar = document.getElementById('weaponBar');

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

export function initViewmodels() {
  const specs = [
    buildRifleViewmodel({ long: false, scope: false }), // Vulcan Rifle
    buildRifleViewmodel({ long: true, scope: true }),   // Hawk Marksman
    buildPistolViewmodel(),                              // Sidearm Pistol
    buildKnifeViewmodel(),                                // Combat Knife
  ];
  for (const g of specs) {
    g.position.set(0.32, -0.28, -0.55);
    g.visible = false;
    state.camera.add(g);
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
  state.camera.add(muzzleFlash);
}

// grenades.js's explosion flash reuses this same sprite texture rather than importing THREE
// and building its own — this getter is the only thing it needs from here.
export function getMuzzleFlashTexture() { return muzzleFlash.material.map; }

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
  state.camera.getWorldPosition(origin);
  state.camera.getWorldDirection(dir);
  const worldMuzzle = m.clone();
  state.camera.localToWorld(worldMuzzle);
  const end = worldMuzzle.clone().addScaledVector(dir, 12);
  const geo = new THREE.BufferGeometry().setFromPoints([worldMuzzle, end]);
  const mat = new THREE.LineBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.8 });
  const line = new THREE.Line(geo, mat);
  state.scene.add(line);
  setTimeout(() => { state.scene.remove(line); geo.dispose(); mat.dispose(); }, 70);
}

export function updateViewmodelKick(dt) {
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

let grenadeCountEl;
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
  grenadeCountEl = document.getElementById('grenadeCountEl');
}
buildWeaponBar();

let grenadeCount = GRENADE_START_COUNT;

export function updateWeaponBar() {
  WEAPONS.forEach((w, i) => {
    const card = weaponCardEls[i];
    card.classList.toggle('active', i === currentWeapon);
    const ammoEl = card.querySelector('.wAmmo');
    ammoEl.textContent = w.magSize == null ? '—' : `${ammo[i].mag}/${ammo[i].reserve}`;
  });
  grenadeCountEl.textContent = String(grenadeCount);
}

let currentWeapon = 0;
export function getCurrentWeaponIndex() { return currentWeapon; }

export function setWeapon(idx) {
  if (idx < 0 || idx >= WEAPONS.length) return;
  cancelReload(); // switching weapons drops any in-progress reload, no ammo change
  stopFiring(); // switching away mid-hold shouldn't leave a stale interval/spray loop running
  currentWeapon = idx;
  for (let i = 0; i < viewmodels.length; i++) viewmodels[i].visible = i === idx;
  updateWeaponBar();
}
updateWeaponBar();

// Reload takes real time (per-weapon `reloadTime`) instead of being instant — the card shows
// a blinking ring + remaining-seconds countdown while it runs. Firing is blocked until it
// completes; switching weapons cancels it outright (no partial credit).
let reloadState = null; // { idx, startedAt, endsAt, duration }
// Handle for the currently-playing reload clip (see sfx.reload's return in audio.js) — kept so
// cancelReload can actually stop it early instead of letting it play out to completion under a
// weapon that's no longer reloading.
let reloadSoundSource = null;
export function reload() {
  const w = WEAPONS[currentWeapon];
  if (w.magSize == null || !w.reloadTime) return; // melee — nothing to reload
  if (reloadState) return; // already reloading
  const a = ammo[currentWeapon];
  if (w.magSize - a.mag <= 0) return;
  if (a.reserve <= 0) { sfx.empty(); return; }
  const now = performance.now();
  reloadState = { idx: currentWeapon, startedAt: now, endsAt: now + w.reloadTime, duration: w.reloadTime };
  reloadSoundSource = sfx.reload(w);
  const ring = weaponCardEls[currentWeapon].querySelector('.reloadRing');
  if (ring) ring.hidden = false;
}
function cancelReload() {
  if (!reloadState) return;
  if (reloadSoundSource) { try { reloadSoundSource.stop(); } catch { /* already finished */ } reloadSoundSource = null; }
  const ring = weaponCardEls[reloadState.idx].querySelector('.reloadRing');
  if (ring) ring.hidden = true;
  reloadState = null;
}
export function updateReload() {
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
    reloadSoundSource = null; // finished on its own, nothing left to stop
    updateWeaponBar();
  }
}

let fireIntervalId = null;
// The AKM's spray-clip loop — started on mousedown, stopped on mouseup/empty-mag/weapon-switch.
// Every stop path calls this same helper so there's exactly one place that can leave it
// playing by mistake, not three copies of "if akmLoopSource, .stop() it" to keep in sync.
let akmLoopSource = null;
export function stopAkmLoop() {
  if (!akmLoopSource) return;
  try { akmLoopSource.stop(); } catch { /* already finished on its own */ }
  akmLoopSource = null;
}
// Clears the fire interval AND the AKM loop together — used both internally (setWeapon) and by
// the bootstrap's onMatchEnded, which otherwise had to reach into this module's private
// fireIntervalId directly.
export function stopFiring() {
  if (fireIntervalId) { clearInterval(fireIntervalId); fireIntervalId = null; }
  stopAkmLoop();
}
document.addEventListener('mousedown', (e) => {
  if (!state.pointerLocked || e.button !== 0) return;
  const w = WEAPONS[currentWeapon];
  // Checked BEFORE fire() runs, not after — this has to be "was there a bullet to fire",
  // not "is the mag still non-empty now": firing the LAST bullet legitimately drops the mag
  // to 0 inside fire() itself, and since the AKM's sfx.shoot() does nothing (the loop below IS
  // its sound), checking ammo after fire() would skip starting the loop for that final shot
  // and it'd fire completely silently. Checked before, an empty mag correctly never starts the
  // interval/loop at all — this used to unconditionally start both regardless of fire()'s
  // outcome, so clicking an already-empty AKM leaked the spray-loop clip for ~110ms (one tick)
  // before the interval's next fire() call caught the still-empty mag and stopped it.
  const hadAmmo = w.magSize == null || ammo[currentWeapon].mag > 0;
  fire();
  if (w.auto && hadAmmo) fireIntervalId = setInterval(fire, w.fireInterval);
  if (w.id === 0 && hadAmmo) akmLoopSource = playBuffer('akmFire', { loop: true });
});
document.addEventListener('mouseup', () => { stopFiring(); });

let lastLocalFire = 0;
function fire() {
  if (!state.localAlive || !state.sceneReady) return;
  const w = WEAPONS[currentWeapon];
  const now = performance.now();
  if (now - lastLocalFire < w.fireInterval - 5) return;
  if (reloadState && reloadState.idx === currentWeapon) return;
  lastLocalFire = now;

  if (w.magSize != null) {
    const a = ammo[currentWeapon];
    if (a.mag <= 0) {
      sfx.empty();
      stopFiring();
      return;
    }
    a.mag -= 1;
    updateWeaponBar();
  }

  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  state.camera.getWorldPosition(origin);
  state.camera.getWorldDirection(dir);
  sendMsg({ type: 'attack', weapon: currentWeapon, origin: [origin.x, origin.y, origin.z], dir: [dir.x, dir.y, dir.z] });
  triggerFireEffects(currentWeapon);
  crosshairKick();
  sfx.shoot(w);
  if (w.pump) setTimeout(() => sfx.pump(), 200); // the pump-action "cha-chk" after the blast
}

// ---------- Grenade throw: hold G to aim (shows the predicted landing arc), release to throw ----------
let lastGrenadeThrow = -Infinity;
let grenadeAiming = false;
let trajectoryLine, trajectoryMarker;

export function initTrajectoryVisuals() {
  const maxPts = 40;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPts * 3), 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthTest: false });
  trajectoryLine = new THREE.Line(geo, mat);
  trajectoryLine.frustumCulled = false;
  trajectoryLine.visible = false;
  state.scene.add(trajectoryLine);

  const markerMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false });
  trajectoryMarker = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.4, 20), markerMat);
  trajectoryMarker.rotation.x = -Math.PI / 2;
  trajectoryMarker.visible = false;
  state.scene.add(trajectoryMarker);
}

export function startGrenadeAim() {
  if (!state.localAlive || !state.sceneReady || !state.pointerLocked || grenadeAiming) return;
  if (grenadeCount <= 0) { sfx.empty(); return; }
  if (performance.now() - lastGrenadeThrow < GRENADE_COOLDOWN_MS) return;
  grenadeAiming = true;
  trajectoryLine.visible = true;
  trajectoryMarker.visible = true;
}

export function releaseGrenadeThrow() {
  if (!grenadeAiming) return;
  grenadeAiming = false;
  trajectoryLine.visible = false;
  trajectoryMarker.visible = false;
  if (!state.localAlive || !state.sceneReady) return;
  lastGrenadeThrow = performance.now();
  grenadeCount = Math.max(0, grenadeCount - 1);
  updateWeaponBar();
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  state.camera.getWorldPosition(origin);
  state.camera.getWorldDirection(dir);
  sendMsg({ type: 'throwGrenade', origin: [origin.x, origin.y, origin.z], dir: [dir.x, dir.y, dir.z] });
  recoilKick = 1; // reuse the existing viewmodel kick as a simple throw animation
  sfx.grenadeThrow();
}

// Called from ui.js's pointerlockchange handler — losing focus/lock mid-hold (alt-tab, etc.)
// can eat the keyup, so this needs to be reachable from outside without exposing grenadeAiming/
// trajectoryLine/trajectoryMarker themselves. No-ops if not currently aiming.
export function cancelGrenadeAim() {
  if (!grenadeAiming) return;
  grenadeAiming = false;
  trajectoryLine.visible = false;
  trajectoryMarker.visible = false;
}

// Samples the same physics the server simulates (gravity arc, ground stop) so the preview line
// actually matches where the grenade will land, not just an approximate direction.
export function updateTrajectoryPreview() {
  if (!grenadeAiming) return;
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  state.camera.getWorldPosition(origin);
  state.camera.getWorldDirection(dir);
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

// ---------- Crosshair feedback ----------
export function showHitMarker() {
  crosshair.style.setProperty('--ch-color', '#e04b4b');
  crosshair.style.transform = 'scale(1.8)';
  setTimeout(() => { crosshair.style.removeProperty('--ch-color'); crosshair.style.transform = ''; }, 120);
  sfx.hitMarker();
}

// Fire bloom: kick the ticks out fast (no easing in, matches the snap of a recoiling gun),
// then let the existing 140ms ease-out transition (see #crosshair .ch-tick in index.html)
// pull them back to the sprint-aware base --spread on its own.
let crosshairKickTimer = null;
function crosshairKick() {
  crosshair.style.setProperty('--extra', '6px');
  clearTimeout(crosshairKickTimer);
  crosshairKickTimer = setTimeout(() => { crosshair.style.setProperty('--extra', '0px'); }, 70);
}
// movement.js calls this every frame with the sprint-aware base gap — kept here rather than
// letting movement.js reach into the crosshair DOM element directly, since every other
// crosshair write already lives in this module.
export function setCrosshairSpread(px) {
  crosshair.style.setProperty('--spread', px);
}

// ---------- Remote gunfire (positional) ----------
// Server broadcasts one `shotFired` per shot any OTHER player takes (see server/index.js's
// handleAttack) — never for the local player's own shots, those already play locally the
// instant fire() runs. Glock/Shotgun are one-shot plays per message, same as their local sound.
// The AKM needs different handling here too, same reason as the local loop (batch 35): its clip
// is a continuous spray, not a single shot, and the server sends a fresh shotFired roughly
// every fireInterval (110ms) for as long as that player holds the trigger. One looping
// BufferSource is started per shooter on their FIRST shot and just kept alive/repositioned by
// each subsequent one — a timeout (slightly longer than fireInterval) stops it automatically
// once shots stop arriving, which naturally covers them releasing the trigger, dying, or
// disconnecting without needing separate handling for any of those.
const remoteGunLoops = new Map(); // shooter playerId -> { source, panner, filter, gainNode, gain, timeoutId }
export function stopRemoteGunLoop(playerId) {
  const entry = remoteGunLoops.get(playerId);
  if (!entry) return;
  try { entry.source.stop(); } catch { /* already finished */ }
  clearTimeout(entry.timeoutId);
  remoteGunLoops.delete(playerId);
}
export function handleRemoteShot(msg) {
  const w = WEAPONS[msg.weapon];
  if (!w) return;
  if (w.id === 0) {
    let entry = remoteGunLoops.get(msg.playerId);
    if (!entry) {
      const started = playPositionalLoopStart('akmFire', msg.pos, 1);
      if (!started) return;
      entry = { ...started, timeoutId: null };
      remoteGunLoops.set(msg.playerId, entry);
    } else {
      updatePositionalTarget(entry, msg.pos);
    }
    clearTimeout(entry.timeoutId);
    entry.timeoutId = setTimeout(() => stopRemoteGunLoop(msg.playerId), 220);
    return;
  }
  if (w.id === 1) { playPositionalOneShot('shotgunFire', msg.pos); return; }
  if (w.id === 2) { playPositionalOneShot('glockFire', msg.pos); return; }
}

// ---------- Loadout reset (new spawn / new match) + incoming ammo/grenade pickups ----------
export function resetLoadout() {
  WEAPONS.forEach((w, i) => { ammo[i] = { mag: w.magSize, reserve: w.reserveMax }; });
  grenadeCount = GRENADE_START_COUNT;
  updateWeaponBar();
}

// Ammo/grenade branches of the `pickup` message — the health branch is ui.js/death.js's concern
// (setHealth + the pickup toast), the bootstrap calls both from the same handleMessage case.
// Returns the toast text so the bootstrap can show it via ui.js's showPickupToast, keeping the
// pickupToast DOM element itself owned by pickups.js rather than duplicated here.
export function applyPickup(msg) {
  if (msg.kind === 'grenade') {
    grenadeCount = Math.min(GRENADE_MAX_CARRY, grenadeCount + msg.amount);
    updateWeaponBar();
    return `+${msg.amount} grenades picked`;
  }
  const w = WEAPONS.find((x) => x.id === msg.weaponId);
  if (w) {
    const idx = WEAPONS.indexOf(w);
    ammo[idx].reserve = Math.min(w.reserveMax, ammo[idx].reserve + msg.amount);
    updateWeaponBar();
  }
  return `+${msg.amount} ${msg.caliber || msg.weaponName} picked`;
}
