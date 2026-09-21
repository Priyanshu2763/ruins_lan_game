// The local player's first-person arms + weapon. characters.js builds the rig (the player's own dressed
// character, arms only, posed by the same two-arm IK as every world figure); this module decides where
// the gun IS each frame — camera-space pose per weapon plus sway, walk bob, sprint carry, recoil,
// reload dip, weapon-switch raise and knife slash — and draws it in its OWN pass after the world, with
// the depth buffer cleared, so the gun can never poke through a wall you're standing next to.
import * as THREE from 'three';
import { WEAPONS } from '/shared/gameData.js';
import { state } from './state.js';
import { buildFirstPersonRig, updateFirstPersonRig, redressFirstPersonRig, onCharacterTemplateReady, getMuzzleAlongBarrel, attachFirstPersonProp, FP_GRENADE_ID } from './characters.js';
import { createGrenade, onGrenadeModelReady, setPinPull, setPinVisible } from './grenadeModel.js';
import { createGunAnim } from './gunanim.js';

// Resting pose per weapon id: where the gun's grip point sits in camera space (x right, y up, -z forward)
// and an extra rotation about that point (radians, camera space). Tuned by rendering the view.
const REST = {
  0: { pos: new THREE.Vector3(0.085, -0.225, -0.54), rot: new THREE.Euler(0.02, 0.04, 0), scale: 1 },   // AKM
  1: { pos: new THREE.Vector3(0.085, -0.215, -0.52), rot: new THREE.Euler(0.02, 0.04, 0), scale: 1 },   // Shotgun
  2: { pos: new THREE.Vector3(0.03, -0.125, -0.50), rot: new THREE.Euler(0.04, 0.14, 0), scale: 1.3 }, // Glock (angled a little so the slide and ejection port show)
  3: { pos: new THREE.Vector3(0.16, -0.21, -0.40), rot: new THREE.Euler(0.25, 0.25, -0.5), scale: 1 }, // Knife
};
// Sprinting: gun lowered and canted across the body, the classic "port arms" carry.
const SPRINT = { pos: new THREE.Vector3(0.0, -0.09, 0.05), rot: new THREE.Euler(0.22, -0.30, 0.10) };

let fpScene = null, fpRoot = null, rig = null, muzzleFlash = null;
let appearance = null;
let templateReady = false;

// Motion state
let recoil = 0;          // 0..1 kick, decays fast
let slash = 0;           // 0..1 knife swing progress (>0 while swinging)
let switchT = 1;         // 0 -> 1 raise animation after a weapon change (starts lowered)
let reloadT = -1;        // 0..1 while reloading, -1 when not
let reloadDur = 1;
let bob = 0, sprintBlend = 0, flashMs = 0;
let weaponId = 0, visible = true;
let triggerHeld = false; // fire button currently down
let fireHold = 0;        // seconds the gun stays squared-up after a shot (single taps too)
const gunAnim = createGunAnim(); // per-gun fire cycles + reload choreography (gunanim.js)
let curLeftGrip = null;          // support-hand override from gunAnim for this frame
let flash = { t: 0, dur: 0.05, size: 0.17, light: 2, rot: 0 };
let flashStar = null, flashLight = null;

export function initViewmodel() {
  if (fpScene) return;
  fpScene = new THREE.Scene();
  fpRoot = new THREE.Group();
  fpRoot.matrixAutoUpdate = false; // follows the camera's world matrix, set each frame in renderViewmodel
  fpScene.add(fpRoot);
  // Same lights as the world so the arms/gun are lit consistently with their surroundings.
  state.scene.children.forEach((o) => { if (o.isLight && !o.isPointLight) fpScene.add(o.clone()); });
  const key = new THREE.DirectionalLight(0xfff1dc, 0.9); key.position.set(-1, 2, 1.5); fpRoot.add(key); // soft camera-relative key so the side facing you never goes black
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,180,1)'); grad.addColorStop(0.4, 'rgba(255,190,80,0.9)'); grad.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
  muzzleFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
  muzzleFlash.scale.set(0, 0, 0);
  fpScene.add(muzzleFlash);
  // a jagged star flash on top of the round glow, and a real warm light that lights the gun and hands
  const sc = document.createElement('canvas'); sc.width = sc.height = 128;
  const sx = sc.getContext('2d'); sx.translate(64, 64);
  const g2 = sx.createRadialGradient(0, 0, 2, 0, 0, 62); g2.addColorStop(0, 'rgba(255,250,215,1)'); g2.addColorStop(0.35, 'rgba(255,205,110,0.85)'); g2.addColorStop(1, 'rgba(255,140,40,0)');
  sx.fillStyle = g2; sx.beginPath();
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, r = i % 2 ? 22 : 62; sx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  sx.closePath(); sx.fill();
  flashStar = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthTest: false, blending: THREE.AdditiveBlending }));
  flashStar.scale.set(0, 0, 0); fpScene.add(flashStar);
  flashLight = new THREE.PointLight(0xffb060, 0, 1.6); fpScene.add(flashLight);
  onCharacterTemplateReady(() => { templateReady = true; rebuild(); });
  onGrenadeModelReady(mountGrenadeProp);
}

function rebuild() {
  if (!templateReady || !fpRoot) return;
  if (rig) { fpRoot.remove(rig.root); rig = null; }
  rig = buildFirstPersonRig(appearance);
  if (!rig) return;
  fpRoot.add(rig.root);
  grenadeProp = null;
  mountGrenadeProp();
  gunAnim.bind(rig);
}
// (Re)creates the grenade in the right hand — called when the rig is built and again if the M67 model
// finishes loading after it (until then the built-in stand-in is used).
function mountGrenadeProp() {
  if (!rig) return;
  if (grenadeProp) { rig.aim.remove(grenadeProp); rig.heldGuns.delete(FP_GRENADE_ID); }
  grenadeProp = createGrenade();
  grenadeProp.scale.setScalar(GRENADE_FP_SCALE);
  grenadeProp.position.copy(GRENADE_IN_HAND);
  attachFirstPersonProp(rig, FP_GRENADE_ID, grenadeProp);
  grenadeProp.visible = gPhase !== 'none' && gPhase !== 'lower' && !gReleased;
}
// Called with the player's saved look (skin/sleeves/gloves show on the arms). Same body -> just re-dress.
export function setViewmodelAppearance(app) {
  const bodyChanged = appearance && app && appearance.character !== app.character;
  appearance = app;
  if (!rig || bodyChanged) { rebuild(); return; }
  redressFirstPersonRig(rig, app);
}
export function getMuzzleFlashTexture() { return muzzleFlash.material.map; }

export function setViewmodelWeapon(id) { if (id !== weaponId) { weaponId = id; switchT = 0; slash = 0; } }
export function setViewmodelVisible(v) { visible = v; }
// A shot was fired: `emptyAfter` = that was the last round (the Glock's slide then stays back).
export function kickViewmodel(id, emptyAfter = false) {
  if (WEAPONS[id]?.type === 'melee') { slash = 0.0001; return; }
  gunAnim.onShot(id, emptyAfter);
  const f = GUN_FLASH[id]; if (f) flash = { t: f.dur, dur: f.dur, size: f.size, light: f.light, rot: Math.random() * 6.28 };
  fireHold = 0.3;
}
const GUN_FLASH = { 0: { dur: 0.05, size: 0.17, light: 2.2 }, 1: { dur: 0.09, size: 0.36, light: 3.6 }, 2: { dur: 0.04, size: 0.12, light: 1.3 } };
// Tell the viewmodel how many rounds are left in the current weapon (the Glock's slide locks back on empty).
export function setViewmodelAmmo(id, mag) { gunAnim.setEmpty(mag === 0, id); }
export function throwKick() { recoil = 1; }
// While the trigger is down (and briefly after each shot) a sprinting player's gun comes back to the
// straight aiming pose instead of firing from the sideways sprint carry.
export function setTriggerHeld(v) { triggerHeld = v; }
export function startReloadAnim(ms) { gunAnim.startReload(weaponId, ms); }
export function cancelReloadAnim() { gunAnim.cancelReload(); }

// ---------- Grenade: pull the pin, wind back, overhand toss ----------
// Phases: lower (gun dips away) -> prep (grenade rises into the right hand, left hand pulls the pin) -> hold
// (aiming, as long as G is held) -> wind (arm cocks back) -> toss (arm snaps forward; the grenade leaves
// the hand — and the throw is sent to the server — at the peak) -> follow (arm carries through and drops)
// -> the gun raises again. All poses are the gun-anchor's position/rotation in camera space; the arms follow.
const GRENADE_FP_SCALE = 0.05;                      // model body radius 1 -> 4cm in hand
const GRENADE_IN_HAND = new THREE.Vector3(0.0, 0.085, -0.005);
const GT = { lower: 0.12, prep: 0.26, wind: 0.15, toss: 0.15, follow: 0.2 };
const P = (x, y, z, rx, ry, rz) => ({ pos: new THREE.Vector3(x, y, z), rot: new THREE.Euler(rx, ry, rz) });
const G_LOW = P(0.22, -0.52, -0.28, 0.5, 0.2, 0);
const G_HOLD = P(0.12, -0.14, -0.38, 0.25, 0.15, 0);
const G_WIND = P(0.25, -0.05, -0.13, -0.35, 0.25, -0.4);
const G_TOSS = P(0.09, -0.13, -0.56, 0.5, -0.1, 0.15);
const G_FOLLOW = P(0.13, -0.36, -0.46, 0.9, -0.1, 0.2);
const L_FROM = new THREE.Vector3(-0.20, -0.50, -0.20);      // left hand rising from below
const L_PIN = G_HOLD.pos.clone().add(new THREE.Vector3(-0.06, -0.03, 0.02)); // ... to the pin ring
const L_PARK = new THREE.Vector3(-0.2, -0.45, 0.45);         // ... then out of frame (behind the camera)
let grenadeProp = null, gPhase = 'none', gT = 0, gWantThrow = null, gReleased = false, gPinSounded = false;
let pinHook = null;
// Registered by weapons.js: called once, at the instant the pin comes out (plays the pin sound).
export function onGrenadePin(fn) { pinHook = fn; }
const ease = (p) => p * p * (3 - 2 * p), easeOut = (p) => 1 - Math.pow(1 - p, 3);
const mix = (a, b, e) => ({ pos: a.pos.clone().lerp(b.pos, e), rot: new THREE.Euler(a.rot.x + (b.rot.x - a.rot.x) * e, a.rot.y + (b.rot.y - a.rot.y) * e, a.rot.z + (b.rot.z - a.rot.z) * e) });
function setPin(v) { if (grenadeProp) setPinVisible(grenadeProp, v); }
function pullPin(k) {
  if (grenadeProp) setPinPull(grenadeProp, k);
  if (k > 0 && !gPinSounded) { gPinSounded = true; pinHook?.(); }
}
export function isGrenadeBusy() { return gPhase !== 'none'; }
export function grenadeReady() { if (gPhase !== 'none') return; gPhase = 'lower'; gT = 0; gWantThrow = null; gReleased = false; gPinSounded = false; reloadT = -1; setPin(true); if (grenadeProp) grenadeProp.visible = false; }
// `cb` runs at the release point of the toss (send the throw / play the sound there). With no rig (models
// not loaded) or no grenade sequence running it just runs immediately.
export function grenadeThrow(cb) {
  if (!rig || gPhase === 'none') { cb(); return; }
  gWantThrow = cb;
  if (gPhase === 'hold') startWind();
}
export function grenadeCancel() { if (gPhase !== 'none') endGrenade(); }
function startWind() { gPhase = 'wind'; gT = 0; pullPin(1); }
function endGrenade() { gPhase = 'none'; gT = 0; gWantThrow = null; switchT = 0; } // gun comes back up from below
// Pose for every phase after `lower` (that one is a dip applied to the gun's own pose in computePose).
// Returns null once the whole sequence has finished.
function grenadePose(dt) {
  gT += dt;
  let pose, left = L_PARK;
  switch (gPhase) {
    case 'prep': {
      const p = Math.min(1, gT / GT.prep);
      pose = mix(G_LOW, G_HOLD, easeOut(p));
      left = p < 0.55 ? L_FROM.clone().lerp(L_PIN, ease(p / 0.55)) : L_PIN.clone().lerp(L_PARK, ease((p - 0.55) / 0.45));
      pullPin(Math.min(1, Math.max(0, (p - 0.5) / 0.17))); // the pin slides out as the left hand pulls it
      if (gT >= GT.prep) { if (gWantThrow) startWind(); else { gPhase = 'hold'; gT = 0; } }
      break;
    }
    case 'hold': pose = mix(G_HOLD, G_HOLD, 0); if (gWantThrow) startWind(); break;
    case 'wind': {
      pose = mix(G_HOLD, G_WIND, ease(Math.min(1, gT / GT.wind)));
      if (gT >= GT.wind) { gPhase = 'toss'; gT = 0; gReleased = false; }
      break;
    }
    case 'toss': {
      const p = Math.min(1, gT / GT.toss);
      pose = mix(G_WIND, G_TOSS, p * p); // accelerates through the throw
      if (!gReleased && p >= 0.55) { gReleased = true; if (grenadeProp) grenadeProp.visible = false; const cb = gWantThrow; gWantThrow = null; cb?.(); }
      if (gT >= GT.toss) { gPhase = 'follow'; gT = 0; }
      break;
    }
    case 'follow': {
      pose = mix(G_TOSS, G_FOLLOW, easeOut(Math.min(1, gT / GT.follow)));
      if (gT >= GT.follow) { endGrenade(); return null; }
      break;
    }
    default: return null;
  }
  return { pos: pose.pos, rot: pose.rot, left };
}

const _e = new THREE.Euler(), _p = new THREE.Vector3();
function computePose(dt) {
  const w = weaponId, rest = REST[w] || REST[0];
  const pos = rest.pos.clone(), rot = new THREE.Euler().copy(rest.rot);

  // No look-sway on purpose: a gun that lags the camera while you turn reads as waving/bending (the IK
  // arms flex to follow it) and its size depended on the frame rate. The gun is locked to the view;
  // only walking, firing, reloading etc. move it (no idle breathing either: standing still = perfectly still).

  // walk bob (stronger and faster while sprinting)
  const moving = state.isMoving && !state.falling;
  const sprinting = moving && state.isSprinting;
  fireHold = Math.max(0, fireHold - dt);
  const squaredUp = triggerHeld || fireHold > 0; // firing: straighten out, even while still running
  const sprintTarget = sprinting && !squaredUp ? 1 : 0;
  sprintBlend += (sprintTarget - sprintBlend) * Math.min(1, dt * (sprintTarget < sprintBlend ? 18 : 8)); // snaps straight fast, eases back into the carry
  if (moving) bob += dt * (sprinting ? 12.5 : 8.5);
  const bobAmt = moving ? (sprinting && !squaredUp ? 1.0 : 0.55) : 0;
  pos.y += Math.abs(Math.sin(bob)) * 0.014 * bobAmt - 0.005 * bobAmt;
  pos.x += Math.cos(bob) * 0.008 * bobAmt;

  // sprint carry
  if (sprintBlend > 0.001 && WEAPONS[w]?.type !== 'melee') {
    pos.lerp(pos.clone().add(SPRINT.pos), sprintBlend);
    rot.x += SPRINT.rot.x * sprintBlend; rot.y += SPRINT.rot.y * sprintBlend; rot.z += SPRINT.rot.z * sprintBlend;
  }

  // throw kick (grenade) — gun recoil and reloading are per-gun, see gunanim.js
  recoil = Math.max(0, recoil - dt * 9);
  pos.z += recoil * 0.06; pos.y += recoil * 0.012; rot.x += recoil * 0.09;
  const ga = gunAnim.update(dt);
  pos.add(ga.dpos); rot.x += ga.drot.x; rot.y += ga.drot.y; rot.z += ga.drot.z;
  curLeftGrip = ga.leftGrip;

  // weapon switch: rises from below
  if (switchT < 1) {
    switchT = Math.min(1, switchT + dt / 0.32);
    const e = 1 - Math.pow(1 - switchT, 3);
    pos.y -= (1 - e) * 0.32; rot.x -= (1 - e) * 0.6;
  }

  // knife slash: wind back, sweep across, recover
  if (slash > 0) {
    slash += dt / 0.32;
    const p = Math.min(1, slash);
    const swing = p < 0.3 ? -p / 0.3 * 0.5 : Math.sin(((p - 0.3) / 0.7) * Math.PI) * 1.0 - 0.5 * (1 - (p - 0.3) / 0.7);
    pos.x += swing * -0.2; pos.z += -Math.abs(swing) * 0.08; pos.y += swing * 0.05;
    rot.y += swing * 0.9; rot.z += swing * -0.6; rot.x += swing * 0.25;
    if (slash >= 1) slash = 0;
  }
  // grenade sequence, first beat: the gun dips away before the grenade comes up
  if (gPhase === 'lower') {
    gT += dt;
    const e = ease(Math.min(1, gT / GT.lower));
    pos.y -= e * 0.42; pos.x += e * 0.05; rot.x -= e * 0.8;
    if (gT >= GT.lower) { gPhase = 'prep'; gT = 0; setPin(true); }
  }
  return { pos, rot };
}

// Draws the viewmodel over the already-rendered world. Called from the bootstrap right after the main
// render (so camera.matrixWorld is this frame's).
export function renderViewmodel(renderer, camera, dt) {
  if (!fpScene || !rig || !visible || !state.localAlive || state.deathAnimActive) { if (gPhase !== 'none') grenadeCancel(); return; }
  fpRoot.matrix.copy(camera.matrixWorld);
  fpRoot.matrixWorldNeedsUpdate = true;
  let g = null;
  if (gPhase !== 'none' && gPhase !== 'lower') g = grenadePose(dt);
  if (g) {
    updateFirstPersonRig(rig, FP_GRENADE_ID, g.pos, g.rot, g.left);
    muzzleFlash.scale.set(0, 0, 0); flashStar.scale.set(0, 0, 0); flashLight.intensity = 0;
  } else {
    const { pos, rot } = computePose(dt);
    const rest = REST[weaponId] || REST[0];
    const gun = rig.heldGuns.get(weaponId);
    if (gun) gun.scale.setScalar(rest.scale);
    gunAnim.setWeapon(weaponId, rest.scale);
    updateFirstPersonRig(rig, weaponId, pos, rot, null, { leftGrip: curLeftGrip });

    // muzzle flash: round glow + jagged star at the barrel tip, and a real light on the gun/hands
    if (flash.t > 0) {
      flash.t -= dt;
      const f = Math.max(0, flash.t / flash.dur);
      const along = getMuzzleAlongBarrel(weaponId) * rest.scale;
      _p.set(along, 0.01, 0).applyMatrix4(rig.aim.matrixWorld);
      muzzleFlash.position.copy(_p); flashStar.position.copy(_p); flashLight.position.copy(_p);
      muzzleFlash.material.opacity = f; muzzleFlash.material.rotation = flash.rot;
      flashStar.material.opacity = Math.min(1, f * 1.3); flashStar.material.rotation = flash.rot + 0.4;
      const sz = flash.size * (0.55 + 0.45 * f);
      muzzleFlash.scale.setScalar(sz * 0.75); flashStar.scale.setScalar(sz * 1.5);
      flashLight.intensity = flash.light * f; flashLight.distance = 1.6;
    } else { muzzleFlash.scale.set(0, 0, 0); flashStar.scale.set(0, 0, 0); flashLight.intensity = 0; }
  }

  const autoClear = renderer.autoClear;
  renderer.autoClear = false;
  renderer.clearDepth();
  renderer.render(fpScene, camera);
  renderer.autoClear = autoClear;
}
// World position of the barrel tip as of the last drawn frame (the tracer starts here); falls back to a
// point ahead of the camera before the first frame / when the rig isn't ready.
export function getMuzzleWorld(camera) {
  if (!rig) return new THREE.Vector3(0.14, -0.2, -0.9).applyMatrix4(camera.matrixWorld);
  const rest = REST[weaponId] || REST[0];
  return new THREE.Vector3(getMuzzleAlongBarrel(weaponId) * rest.scale, 0.01, 0).applyMatrix4(rig.aim.matrixWorld);
}
// New spawn: the weapon comes up from below again.
export function raiseViewmodel() { switchT = 0; slash = 0; reloadT = -1; recoil = 0; gunAnim.cancelReload(); }
