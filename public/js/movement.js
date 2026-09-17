import {
  MAP_BOUNDS, PLAYER_RADIUS, STAND_EYE_HEIGHT, CROUCH_EYE_HEIGHT, PRONE_EYE_HEIGHT, PRONE_SPEED,
} from '/shared/gameData.js';
import { state } from './state.js';
import { playBuffer } from './audio.js';
import { sendMsg } from './net.js';
import { setCrosshairSpread } from './weapons.js';

const stanceLabel = document.getElementById('stanceLabel');

function clamp01(t) { return Math.max(0, Math.min(1, t)); }

// The player's standing surface height at (x,z) — 0 (plain ground) unless they're on a ramp
// (interpolated) or a building's upper floor platform (flat). Platforms and ramps never
// overlap in x/z (see gameData.js's makeRuinHouse), so at most one of these ever matches.
// Which house's platform (index into ACTIVE_PLATFORMS) the player is currently "on", or -1 for
// ground level. A house's upper floor sits DIRECTLY above its ground floor now (the reference
// photos' actual layout — two stacked rooms, same footprint), so position alone can't tell the
// floors apart: (x,z) inside a house's footprint is valid at BOTH wallH (upper floor) and 0
// (ground floor). Only STATE resolves that — you're "on" the platform because you walked up
// its stairs, not because of where you happen to be standing. See below.
export function surfaceHeightAt(x, z) {
  // Ramps are always position-based (their own footprint is disjoint from every house's, per
  // gameData.js's makeRuinHouse) and are what TOGGLES standingPlatformIndex: reaching a ramp's
  // top edge marks its matching platform (same array index — see getMapLayout) as "on";
  // reaching its bottom edge, or stepping off that platform's footprint any other way (a
  // window gap, jumping the parapet), clears it and you drop to ground height.
  for (let i = 0; i < state.ACTIVE_RAMPS.length; i++) {
    const s = state.ACTIVE_RAMPS[i];
    const hw = s.w / 2, hd = s.d / 2;
    if (Math.abs(x - s.x) <= hw && Math.abs(z - s.z) <= hd) {
      // axis:'x' ramps climb along X instead of Z (needed for a staircase running alongside
      // an east-west wall, like the mansion's back — every ramp before this climbed along Z
      // only, which is why this field existed but was never actually read until now).
      const isX = s.axis === 'x';
      const half = isX ? hw : hd;
      const coord = isX ? x : z;
      const center = isX ? s.x : s.z;
      const t = clamp01((coord - (center - half)) / (half * 2));
      const st = s.reverse ? 1 - t : t;
      // A wide trigger band (last/first 30% of the climb, not the last 1.5%) — movement
      // advances in per-frame position steps, so a razor-thin threshold near the very top can
      // fall entirely between two consecutive frames and never fire at all. This was the
      // actual "can't get into the 1st floor" bug: the platform never activated because
      // nobody's movement ever lands inside a 0.015-wide window by chance. Triggering a bit
      // early just means the last stretch of the climb snaps to floorY a little sooner, which
      // reads fine — nowhere close to the old "can't enter at all".
      // 0.6, not 0.7: the mansion's stairs now have a real ceiling directly overhead (added
      // so grenades can't fly through it, see gameData.js), and a climbing body's head starts
      // clipping that ceiling's underside at ~66.6% of the climb (fromY+toY, PLAYER_HEIGHT
      // math) — computed exactly, not guessed. The old 0.7 trigger fired AFTER that point,
      // meaning there was a real ~3-4% stretch of the climb where raw (un-snapped) height was
      // already too tall for the ceiling but state hadn't fired yet to rescue it via the
      // platform-priority check below — a genuine stuck-in-place bug, not a stutter (you
      // can't climb far enough in X to escape the ceiling without first reaching a height the
      // ceiling won't allow). 0.6 snaps to full height before that zone is ever reached. Still
      // plenty wide for the "can't get into the 1st floor" fix from before (per-frame movement
      // steps landing inside this window reliably) — the house stairs, which have no ceiling
      // to worry about, are unaffected by the earlier snap either way.
      if (st >= 0.6) state.standingPlatformIndex = i;
      else if (st <= 0.3) state.standingPlatformIndex = -1;
      // Once "on" this ramp's platform (state just set to i), prefer the platform's own flat
      // height over the ramp's interpolated one if we're already within the platform's
      // (deliberately overlapping) footprint too — otherwise a player who triggers at 70% and
      // immediately turns toward the building stays at ~70% height for a while longer, and if
      // there's a roof/ceiling overhead (the mansion has one, the houses don't — this never
      // came up before), their body can be tall enough to clip its underside from below while
      // still short of the platform itself. Snapping to full height the moment state sets
      // sidesteps that entirely. Descending (st back under 0.3, state cleared) falls straight
      // through to the normal interpolated value below, so the climb-down still looks right.
      if (state.standingPlatformIndex === i) {
        const p = state.ACTIVE_PLATFORMS[i];
        if (p && Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) return p.y;
      }
      return s.fromY + (s.toY - s.fromY) * st;
    }
  }
  if (state.standingPlatformIndex >= 0) {
    const p = state.ACTIVE_PLATFORMS[state.standingPlatformIndex];
    if (p && Math.abs(x - p.x) <= p.w / 2 && Math.abs(z - p.z) <= p.d / 2) return p.y;
    state.standingPlatformIndex = -1; // stepped off this platform's own footprint — falls to ground
  }
  return 0;
}

export function setStance(crouch, prone) {
  state.isCrouched = crouch;
  state.isProne = prone;
  stanceLabel.textContent = prone ? 'PRONE' : crouch ? 'CROUCHED' : 'STANDING';
}

const GRAVITY = -20;
const JUMP_VEL = 6.2;
const PLAYER_HEIGHT = 1.8; // approximate vertical extent used only for collision height checks
let yVel = 0, jumpOffset = 0;

export function tryJump() {
  if (state.isProne) return;
  if (jumpOffset === 0 && yVel === 0) yVel = JUMP_VEL;
}

// `y` is the player's CURRENT standing height (their feet) — a wall only blocks if its own
// vertical span actually overlaps the player's body at that height. This is what lets you walk
// on the ground floor underneath a building's upper-floor parapet without it blocking you, and
// still get properly blocked by that same parapet once you've walked up to platform height.
export function collidesAt(x, z, y) {
  for (const o of state.ACTIVE_WALLS) {
    const hw = o.w / 2 + PLAYER_RADIUS;
    const hd = o.d / 2 + PLAYER_RADIUS;
    if (Math.abs(x - o.x) >= hw || Math.abs(z - o.z) >= hd) continue;
    const oMinY = o.y - o.h / 2, oMaxY = o.y + o.h / 2;
    if (y + PLAYER_HEIGHT > oMinY && y < oMaxY) return true;
  }
  return false;
}

// Footstep loop — same "one swap-able looping source" pattern as the AKM's spray loop: running.mp3
// while sprinting (shift held), walking.mp3 while moving without it, silence otherwise. Both
// clips are real footstep recordings — untrimmed as provided, so a fresh cadence-safe loop
// region was picked out of each by ear-free analysis (ffmpeg silencedetect + an RMS envelope
// over the decoded PCM, not guessed): running keeps its full length minus the lead-in/trail
// silence either side of the last real step; walking's usable region turned out to be only its
// first ~6s — the back half of that recording is a denser, differently-textured stretch that
// doesn't match the discrete-step character of the front, so it was left out rather than
// looping something that would sound like a different recording partway through.
let footstepSource = null;
let footstepMode = null; // 'run' | 'walk' | null
export function setFootstepMode(mode) {
  if (mode === footstepMode) return;
  if (footstepSource) { try { footstepSource.stop(); } catch { /* already finished */ } footstepSource = null; }
  footstepMode = mode;
  // 0.75 gain (was full volume) — your OWN footsteps deliberately sit quieter than an enemy's
  // now that remote ones exist too (see characters.js's setRemoteFootstepMode), so the two are
  // distinguishable by loudness alone, not just the directional/distance cues.
  if (mode === 'run') footstepSource = playBuffer('running', { loop: true, gain: 0.75 });
  else if (mode === 'walk') footstepSource = playBuffer('walking', { loop: true, gain: 0.75 });
}

export function updateMovement(dt) {
  // Once you've walked off the edge, you're committed — actually fall (drop the camera) for
  // a beat before dying, instead of dying the instant you cross the boundary line. Movement
  // input is ignored while falling; there's no recovering mid-drop.
  if (state.falling) {
    state.fallVel += GRAVITY * dt * 1.6;
    state.fallDepth -= state.fallVel * dt;
    state.yawObject.position.y = state.eyeHeight - state.fallDepth;
    if (state.fallDepth > 9 && !state.fellOffSent) {
      state.fellOffSent = true;
      sendMsg({ type: 'fellOff' });
    }
    setFootstepMode(null); // airborne — not walking or running
    return;
  }

  const sprinting = !state.isCrouched && !state.isProne && (state.keys.has('ShiftLeft') || state.keys.has('ShiftRight'));
  state.isSprinting = sprinting;
  setCrosshairSpread(sprinting ? '13px' : '7px');
  const speed = state.isProne ? PRONE_SPEED : state.isCrouched ? 3.0 : sprinting ? 8.5 : 5.5;
  let mx = 0, mz = 0;
  if (state.keys.has('KeyW')) mz -= 1;
  if (state.keys.has('KeyS')) mz += 1;
  if (state.keys.has('KeyA')) mx -= 1;
  if (state.keys.has('KeyD')) mx += 1;
  state.isMoving = mx !== 0 || mz !== 0;
  if (mx !== 0 || mz !== 0) {
    const len = Math.hypot(mx, mz);
    mx /= len; mz /= len;
    const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
    const worldDx = (mx * cos + mz * sin) * speed * dt;
    const worldDz = (-mx * sin + mz * cos) * speed * dt;
    // jumpOffset counts toward the collision height now, not just currentGroundY — jump was
    // purely a cosmetic camera bob before (zero effect on collision), which meant a low rail
    // (e.g. the stairs' side barrier) was just as solid as a full-height wall. A jump's ~0.96
    // unit peak still can't clear the 1.65-unit cover blocks in the core arena (comfortably
    // taller than that), so this only opens up rails/ledges genuinely low enough to hop.
    const jumpY = state.currentGroundY + jumpOffset;
    const nx = state.playerX + worldDx;
    if (!collidesAt(nx, state.playerZ, jumpY)) state.playerX = nx;
    const nz = state.playerZ + worldDz;
    if (!collidesAt(state.playerX, nz, jumpY)) state.playerZ = nz;
  }

  state.currentGroundY = surfaceHeightAt(state.playerX, state.playerZ);

  yVel += GRAVITY * dt;
  jumpOffset += yVel * dt;
  if (jumpOffset < 0) { jumpOffset = 0; yVel = 0; }

  const targetEye = state.isProne ? PRONE_EYE_HEIGHT : state.isCrouched ? CROUCH_EYE_HEIGHT : STAND_EYE_HEIGHT;
  state.eyeHeight += (targetEye - state.eyeHeight) * Math.min(1, dt * 10);
  state.yawObject.position.set(state.playerX, state.currentGroundY + state.eyeHeight + jumpOffset, state.playerZ);

  if (state.playerX < MAP_BOUNDS.minX || state.playerX > MAP_BOUNDS.maxX || state.playerZ < MAP_BOUNDS.minZ || state.playerZ > MAP_BOUNDS.maxZ) {
    state.falling = true;
    state.fallVel = 0;
    state.fallDepth = 0;
    state.isMoving = false;
  }

  setFootstepMode(!state.isMoving ? null : sprinting ? 'run' : 'walk');
}

// Mouse look — frozen while dead too, not just unlocked, otherwise mouse movement during the
// death-fall sequence would fight the scripted camera drop/tilt (see death.js's updateDeathAnim,
// which drives camera.rotation.x/z directly).
document.addEventListener('mousemove', (e) => {
  if (!state.pointerLocked || !state.localAlive) return;
  state.yaw -= e.movementX * 0.0022;
  state.pitch -= e.movementY * 0.0022;
  state.pitch = Math.max(-1.3, Math.min(1.3, state.pitch));
  state.yawObject.rotation.y = state.yaw;
  state.camera.rotation.x = state.pitch;
});
