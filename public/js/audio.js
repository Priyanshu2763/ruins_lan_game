import * as THREE from 'three';
import { MAPS, DEFAULT_MAP } from '/shared/gameData.js';
import { state } from './state.js';

// ---------- Sound: real recorded clips for weapons/grenade, synthesized WebAudio for
// everything else (hit markers, pickups, damage, melee, the grenade throw cue — no recording
// was provided for those) ----------
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function unlockAudio() { if (audioCtx.state === 'suspended') audioCtx.resume(); }
document.addEventListener('click', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });
// Touch controls call preventDefault() on their own touchstart (to block native scroll/pinch-zoom
// while dragging the joystick/look-zone/buttons), which can suppress the synthetic 'click' this
// would otherwise rely on — a real gap, not just defensive, so touchstart gets its own explicit
// unlock rather than trusting the click listener above to still fire on every touch device.
document.addEventListener('touchstart', unlockAudio, { once: true });

// Three-tier gain structure: every sound routes through EITHER musicGain or sfxGain first (so
// the Settings tab's separate Music/SFX sliders are real independent controls, BGMI-style),
// and both of those feed into the shared masterGain on their way to the real audio output.
// `bus` on playBuffer() picks which one a given clip uses — background music is the only thing
// that ever passes 'music', everything else (gunfire, UI cues, footsteps, positional audio)
// defaults to 'sfx'.
const masterGain = audioCtx.createGain();
masterGain.connect(audioCtx.destination);
const musicGain = audioCtx.createGain();
const sfxGain = audioCtx.createGain();
musicGain.connect(masterGain);
sfxGain.connect(masterGain);
export function setMasterVolume(v) { masterGain.gain.value = Math.max(0, Math.min(1, v)); }
export function setMusicVolume(v) { musicGain.gain.value = Math.max(0, Math.min(1, v)); }
export function setSfxVolume(v) { sfxGain.gain.value = Math.max(0, Math.min(1, v)); }

// Decoded once each at page load (these are all under 4s, so by the time a player has gotten
// through auth + the menu + actually joined a room, decoding is long finished) and cached —
// `playBuffer` just clones a fresh BufferSource per play, which is what lets the same clip
// overlap itself (two grenades ticking at once, rapid-fire glock taps) with zero extra work.
const SOUND_FILES = {
  akmFire: '/sounds/akm-fire.mp3',
  akmReload: '/sounds/akm-reload.mp3',
  glockFire: '/sounds/glock-fire.mp3',
  glockReload: '/sounds/glock-reload.mp3',
  shotgunFire: '/sounds/shotgun-fire.mp3',
  shotgunPump: '/sounds/shotgunpump.mp3',
  shotgunReload: '/sounds/shotgun-reload.mp3',
  grenadeClock: '/sounds/grenade-clock.mp3',
  grenadeExplosion: '/sounds/grenade-blast.mp3',
  grenadePin: '/sounds/grenade-pin.mp3',
  grenadeThrow: '/sounds/grenade-throw.mp3',
  grenadeGround: '/sounds/grenade-ground.mp3',
  grenadeWall: '/sounds/grenade-wall.mp3',
  gameOver: '/sounds/game-over.mp3',
  background: '/sounds/backround.mp3',
  ring: '/sounds/ring.mp3',
  knifeStab: '/sounds/knife-stab.mp3',
  running: '/sounds/running.mp3',
  walking: '/sounds/walking.mp3',
  fall: '/sounds/fall.mp3',
  respawn: '/sounds/respawn.mp3',
  bg2: '/sounds/bg2.mp3',
  lavaSound: '/sounds/lava-sound.mp3',
};
const soundBuffers = {};
// Tiny synthesized "brass on the floor" clinks (a few decaying sine partials) — no recorded clip exists for
// casings, and a real one would only add a file to load for a 60 ms sound.
function synthClink(freqs, dur, gain) {
  const sr = audioCtx.sampleRate, n = Math.floor(sr * dur), buf = audioCtx.createBuffer(1, n, sr), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) { const t = i / sr; let v = 0; freqs.forEach((f, k) => { v += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * (38 + k * 22)); }); d[i] = v * gain * (i < 20 ? i / 20 : 1); }
  return buf;
}
for (const [key, url] of Object.entries(SOUND_FILES)) {
  fetch(url)
    .then((res) => res.arrayBuffer())
    .then((arr) => audioCtx.decodeAudioData(arr))
    .then((buf) => { soundBuffers[key] = buf; })
    .catch((err) => console.error(`sound load failed: ${key}`, err));
}
soundBuffers.casingRifle = synthClink([4200, 6100], 0.09, 0.5);
soundBuffers.casingPistol = synthClink([5200, 7300], 0.07, 0.45);
soundBuffers.shellDrop = synthClink([1900, 3100], 0.12, 0.5);
soundBuffers.magDrop = synthClink([900, 1700, 2600], 0.16, 0.6);
// Returns the BufferSource so a caller can `.stop()` it early (only the AKM's looped spray
// clip needs that — every other sound is a one-shot that's left to finish on its own).
// Silently no-ops if the buffer hasn't decoded yet instead of throwing — there's no sane
// fallback for a specific missing recording, and this only matters in the first instant after
// page load, well before a player can actually be in a match to fire/reload/throw anything.
export function playBuffer(key, { gain = 1, loop = false, bus = 'sfx' } = {}) {
  const buffer = soundBuffers[key];
  if (!buffer) return null;
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.loop = loop;
  const g = audioCtx.createGain();
  g.gain.value = gain;
  src.connect(g); g.connect(bus === 'music' ? musicGain : sfxGain);
  src.start();
  return src;
}

// Ear-ringing effect for anyone actually caught in a grenade blast (see the 'hit' handler —
// server tags grenade damage with weapon:'Grenade' specifically so this doesn't fire on every
// hit). Flat/non-positional on purpose — this represents damage to YOUR OWN ears, not a world
// sound to localize. Plays the full 4.2s clip at full volume, then fades to silent over the
// last ~0.8s ("at last it fades away") via a real gain ramp — the source clip itself doesn't
// need to have that fade baked in.
export function playRingEffect() {
  const buffer = soundBuffers.ring;
  if (!buffer) return;
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const g = audioCtx.createGain();
  const t0 = audioCtx.currentTime;
  const dur = buffer.duration;
  const fadeDur = Math.min(0.8, dur * 0.3);
  g.gain.setValueAtTime(1, t0);
  g.gain.setValueAtTime(1, t0 + dur - fadeDur);
  g.gain.linearRampToValueAtTime(0, t0 + dur);
  src.connect(g); g.connect(sfxGain);
  src.start();
}

// ---------- Positional audio (remote gunfire + explosions): real 3D panning/distance falloff
// via WebAudio's own AudioListener/PannerNode (HRTF binaural panning — genuinely directional on
// headphones, this is the actual tool for "hear where the enemy is", not a hand-rolled stereo
// hack) plus wall occlusion. Everything here is for OTHER players' sounds only — your own gun
// is always right at your ears and stays the flat, non-positional playBuffer() above.
audioCtx.listener.panningModel = 'HRTF';
export function updateAudioListener() {
  const pos = new THREE.Vector3();
  const dir = new THREE.Vector3();
  state.camera.getWorldPosition(pos);
  state.camera.getWorldDirection(dir);
  const l = audioCtx.listener;
  if (l.positionX) { // modern AudioParam-based API
    l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
    l.forwardX.value = dir.x; l.forwardY.value = dir.y; l.forwardZ.value = dir.z;
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else if (l.setPosition) { // older browsers
    l.setPosition(pos.x, pos.y, pos.z);
    l.setOrientation(dir.x, dir.y, dir.z, 0, 1, 0);
  }
}

// Cheap ray-segment-vs-AABB occlusion test (same slab method as every other AABB check in this
// project, just bounded to the segment's own length instead of an infinite ray) against
// ACTIVE_WALLS — the same list that already blocks bullets server-side, so "behind a wall"
// here matches what actually blocks a shot, invisible collision-only pieces included. O(wall
// count) per call (~150 walls, each a handful of comparisons) — negligible even run on every
// single gunshot event; the "optimized" part is WHEN it's called, not making the test itself
// fancier: once per one-shot sound, and for the AKM's looping spray, re-checked only on each
// incoming shotFired tick (~every 110ms while held) rather than every render frame.
export function isOccludedBetween(fromPos, toPos) {
  const dx = toPos[0] - fromPos[0], dy = toPos[1] - fromPos[1], dz = toPos[2] - fromPos[2];
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.001) return false;
  const dirx = dx / dist, diry = dy / dist, dirz = dz / dist;
  for (const o of state.ACTIVE_WALLS) {
    const hw = o.w / 2, hh = o.h / 2, hd = o.d / 2;
    let tmin = 0, tmax = dist;
    if (Math.abs(dirx) < 1e-8) { if (fromPos[0] < o.x - hw || fromPos[0] > o.x + hw) continue; }
    else {
      const t1 = (o.x - hw - fromPos[0]) / dirx, t2 = (o.x + hw - fromPos[0]) / dirx;
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmin > tmax) continue;
    }
    if (Math.abs(diry) < 1e-8) { if (fromPos[1] < o.y - hh || fromPos[1] > o.y + hh) continue; }
    else {
      const t1 = (o.y - hh - fromPos[1]) / diry, t2 = (o.y + hh - fromPos[1]) / diry;
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmin > tmax) continue;
    }
    if (Math.abs(dirz) < 1e-8) { if (fromPos[2] < o.z - hd || fromPos[2] > o.z + hd) continue; }
    else {
      const t1 = (o.z - hd - fromPos[2]) / dirz, t2 = (o.z + hd - fromPos[2]) / dirz;
      tmin = Math.max(tmin, Math.min(t1, t2)); tmax = Math.min(tmax, Math.max(t1, t2));
      if (tmin > tmax) continue;
    }
    return true;
  }
  return false;
}

export function localListenerPos() {
  const v = new THREE.Vector3();
  state.camera.getWorldPosition(v);
  return [v.x, v.y, v.z];
}
export function localListenerForward() {
  const v = new THREE.Vector3();
  state.camera.getWorldDirection(v);
  return [v.x, v.y, v.z];
}

function makePannerAt(pos) {
  const panner = audioCtx.createPanner();
  panner.panningModel = 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = 10; // full volume out to ~10 units, then falls off — same "room-scale" feel as the local sfx
  panner.maxDistance = 120; // roughly the map's own scale (the doubled arena+extension)
  panner.rolloffFactor = 1.2;
  panner.positionX.value = pos[0]; panner.positionY.value = pos[1]; panner.positionZ.value = pos[2];
  return panner;
}
// A "dry" companion position for the wet/dry blend below — same DISTANCE from the listener as
// the real source (so it inherits the exact same distance-falloff curve for free, reusing the
// browser's own panner math instead of hand-rolling the 'inverse' distance formula a second
// time), but placed dead along the listener's own forward vector, i.e. "straight ahead" —
// which panningModel:'equalpower' resolves to a clean, guaranteed-symmetric 50/50 split
// between ears. Recomputed on every reposition (see updatePositionalTarget / the grenade-tick
// loop in animate()) since "straight ahead" only stays straight ahead as the listener turns.
export function dryPositionFor(sourcePos) {
  const lp = localListenerPos();
  const lf = localListenerForward();
  const dist = Math.hypot(sourcePos[0] - lp[0], sourcePos[1] - lp[1], sourcePos[2] - lp[2]);
  return [lp[0] + lf[0] * dist, lp[1] + lf[1] * dist, lp[2] + lf[2] * dist];
}
// Pure HRTF panning is TOO extreme for gameplay comfort — a source directly to one side reads
// at near-zero in the off ear, which is physically accurate (that's genuinely what real ears
// do) but disorienting, and HRTF's exact character varies by browser/headphones on top of that.
// Real shooters don't ship raw HRTF for this reason — they blend a fully-panned "wet" copy with
// a smaller always-centered "dry" copy of the SAME sound, so the off ear keeps a real floor of
// presence instead of dropping out. SPATIAL_WET+SPATIAL_DRY intentionally sum to just over 1 —
// the goal is "the near ear stays at ~its normal unblended level", not "total loudness must
// stay fixed", so adding the dry floor doesn't quietly dim the near ear to compensate.
const SPATIAL_WET = 0.68;
const SPATIAL_DRY = 0.34;
// A lowpass filter is ALWAYS in the chain (even a wide-open one when not occluded) rather than
// conditionally inserted — swapping its cutoff/gain is one param write, cheaper and simpler
// than rewiring the audio graph. Occluded: heavy lowpass + reduced gain — real walls absorb
// high frequencies far more than low ones, so a muffled thump-through-a-wall reads as duller,
// not just quieter, which pure gain reduction wouldn't capture. Applied ONCE, after the wet and
// dry paths are already summed — a wall muffles the whole arriving sound, not one path of it.
export function applyOcclusionParams(filter, gainNode, baseGain, occluded) {
  filter.frequency.value = occluded ? 900 : 20000;
  gainNode.gain.value = occluded ? baseGain * 0.45 : baseGain;
}
function startPositionalSource(key, pos, gain, loop) {
  const buffer = soundBuffers[key];
  if (!buffer) return null;
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.loop = loop;

  const wetPanner = makePannerAt(pos);
  const wetGain = audioCtx.createGain();
  wetGain.gain.value = gain * SPATIAL_WET;

  const dryPanner = makePannerAt(dryPositionFor(pos));
  dryPanner.panningModel = 'equalpower'; // guaranteed-centered when "straight ahead", unlike HRTF's real-ear-modeled frontal response
  const dryGain = audioCtx.createGain();
  dryGain.gain.value = gain * SPATIAL_DRY;

  const filter = audioCtx.createBiquadFilter(); // shared, post-mix — see applyOcclusionParams
  filter.type = 'lowpass';
  const mixGain = audioCtx.createGain();

  src.connect(wetPanner); wetPanner.connect(wetGain); wetGain.connect(filter);
  src.connect(dryPanner); dryPanner.connect(dryGain); dryGain.connect(filter); // WebAudio sums multiple inputs into one node automatically
  filter.connect(mixGain); mixGain.connect(sfxGain);

  applyOcclusionParams(filter, mixGain, 1, isOccludedBetween(localListenerPos(), pos));
  src.start();
  return { source: src, wetPanner, dryPanner, filter, gainNode: mixGain, gain };
}
// Returns the same trackable handle as the loop version (wetPanner/dryPanner/filter/gainNode) —
// most one-shot callers (explosions) just ignore it, but a one-shot can still be LONG (the
// grenade tick clip is 3.657s) and the thing making the sound can keep moving for all of that,
// so a caller that wants to keep its panners' positions (and occlusion) current over that time
// — see updatePositionalTarget below, used for the grenade tick — needs a handle to update.
export function playPositionalOneShot(key, pos, gain = 1) {
  return startPositionalSource(key, pos, gain, false);
}
export function playPositionalLoopStart(key, pos, gain = 1) {
  return startPositionalSource(key, pos, gain, true);
}
// Shared by the AKM's remote loop (repositioned on each incoming shotFired) and the grenade
// tick (repositioned every frame to track the live grenade, see animate()) — moves BOTH panners
// (the dry one recomputed fresh since "straight ahead" changes as the listener turns) and
// re-runs the occlusion check against the true source position.
export function updatePositionalTarget(entry, pos) {
  entry.wetPanner.positionX.value = pos[0]; entry.wetPanner.positionY.value = pos[1]; entry.wetPanner.positionZ.value = pos[2];
  const dp = dryPositionFor(pos);
  entry.dryPanner.positionX.value = dp[0]; entry.dryPanner.positionY.value = dp[1]; entry.dryPanner.positionZ.value = dp[2];
  applyOcclusionParams(entry.filter, entry.gainNode, 1, isOccludedBetween(localListenerPos(), pos));
}

function tone(freq, dur, type, gain, glideTo) {
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type || 'sine';
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g); g.connect(sfxGain);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}
// `filterType` defaults to lowpass (a dull "thud"/boom — explosions, damage, the old
// generic weapon sounds) — pump/reload mechanicals pass 'highpass' instead, which keeps only
// the bright/metallic end of the noise, reading as a hard clack/click rather than a thump.
// That's the actual fix for "the shotgun pump sounds cartoonish": the old version used plain
// oscillator tones (smooth, tonal, no transient noise at all) for a sound that in real life is
// pure percussive metal-on-metal contact — no clean pitch to it whatsoever.
function noiseBurst(dur, gain, filterFreq, filterType) {
  const t0 = audioCtx.currentTime;
  const n = Math.floor(audioCtx.sampleRate * dur);
  const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  const filt = audioCtx.createBiquadFilter();
  filt.type = filterType || 'lowpass';
  filt.frequency.value = filterFreq || 2000;
  const g = audioCtx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filt); filt.connect(g); g.connect(sfxGain);
  src.start(t0);
}
// Per-weapon gunshots use the provided recordings. Glock and Shotgun fire semi-auto (one
// trigger pull, one shot) so their clip is just a normal one-shot play, restarted on every
// `fire()` call — exactly like every other one-shot sfx here. The AKM is different: its
// recording is a full automatic-fire spray (2.1s), not a single shot, so playing it fresh on
// every `fire()` tick (every 110ms while held) would stack a dozen overlapping copies of the
// same spray clip within one burst — instead it's started ONCE as a loop on mousedown and
// stopped on mouseup (see weapons.js), so `shoot()` does nothing at all for the AKM; the
// continuous loop IS its firing sound.
export const sfx = {
  shoot(w) {
    if (w.type === 'melee') { playBuffer('knifeStab'); return; }
    if (w.id === 0) return; // AKM — handled by the looped spray clip, not per-shot
    if (w.id === 1) { playBuffer('shotgunFire'); return; }
    if (w.id === 2) { playBuffer('glockFire'); return; }
  },
  pump() { playBuffer('shotgunPump'); },
  // Per-weapon reload recordings — `reloadTime` in gameData.js was set to match each clip's
  // real length exactly (AKM 3480ms, Shotgun 3792ms, Glock 2351ms) so the mechanical
  // reload/UI-lockout window lines up with the sound, not a guessed duration. Returns the
  // BufferSource (playBuffer already gives us this for free) so a caller can stop it early if
  // the reload gets cancelled — switching weapons mid-reload used to leave this clip playing to
  // completion with nothing left visually happening, since nothing kept a handle to it.
  reload(w) {
    if (w && w.id === 0) return playBuffer('akmReload');
    if (w && w.id === 1) return playBuffer('shotgunReload');
    if (w && w.id === 2) return playBuffer('glockReload');
  },
  empty() { tone(220, 0.045, 'square', 0.1); },
  hitMarker() { tone(1400, 0.04, 'square', 0.09); },
  damage() { noiseBurst(0.18, 0.16, 700); },
  // Local-only (flat), like your own gunfire: the pin coming out as your left hand pulls it, and the
  // effort/whoosh as the arm lets go. Both are cut from the same source clip at the silent gap between them.
  grenadePin() { playBuffer('grenadePin', { gain: 1.4 }); },
  // Positional and quiet: brass / shell / magazine landing on the floor near you.
  casingDrop(pos, kind) {
    const key = kind === 'shell' ? 'shellDrop' : kind === 'pistol' ? 'casingPistol' : kind === 'mag' ? 'magDrop' : 'casingRifle';
    if (!soundBuffers[key]) return;
    playPositionalOneShot(key, [pos.x, pos.y, pos.z], kind === 'mag' ? 0.9 : 0.5);
  },
  grenadeThrow() { playBuffer('grenadeThrow', { gain: 1.6 }); },
  // Positional for everyone in the room (the server announces each real impact — see 'grenadeBounce' in
  // client.js): a clink off the ground or a harder knock off a wall, louder for harder hits.
  grenadeBounce(pos, surface, speed) {
    const gain = Math.min(1.8, 0.45 + (speed || 4) / 9);
    playPositionalOneShot(surface === 'wall' ? 'grenadeWall' : 'grenadeGround', pos, gain);
  },
  // Positional, same as gunfire/explosions — a grenade only threatens players within its own
  // blast radius, so a full-volume tick heard from across the map wasn't a meaningful warning
  // for anyone it couldn't reach, just noise; the players who actually need to hear it are
  // already well within refDistance. Started once per grenade (see syncGrenades) and then
  // TRACKED — a thrown grenade can travel for its whole ~3.6s fuse, so a static position
  // snapshot from the throw would read as coming from the wrong place by the time it's sitting
  // on the ground about to go off; syncGrenades stores the returned handle on the grenade's own
  // tracking object and animate() keeps its panner position current every frame, same object
  // the visual mesh position already gets lerped from. GRENADE_FUSE_MS is set to this clip's
  // exact 3657ms length so the explosion lands right as the ticking finishes, not mid-tick.
  grenadeTick(pos) { return playPositionalOneShot('grenadeClock', pos); },
  // 3.5x gain now (was 2x — still came back "too low" after that first bump). Positional, not
  // flat/global — the blast happens at a world position distinct from where any given player
  // currently stands (including the thrower, who may have moved off), so unlike your own
  // gunfire this always goes through the panner/occlusion path; the gain here is the sound's
  // OWN base loudness before distance falloff applies on top of it.
  // The blast clip (grenade-blast.mp3) is ~1.2x louder than the one it replaced, so 2.9 here plays at the same
  // level the old one did at 3.5.
  explosion(pos) { playPositionalOneShot('grenadeExplosion', pos, 2.9); },
  pickup() { tone(700, 0.07, 'sine', 0.12, 1100); setTimeout(() => tone(1100, 0.08, 'sine', 0.1, 1500), 70); },
  // Flat/non-positional, like the grenade ear-ring (batch 46) — this is the sound of YOUR OWN
  // view collapsing to the ground, not a world event other players need to localize.
  fall() { playBuffer('fall'); },
  // Positional — the respawn "beam" (see spawnRespawnEffect) is a real world-space visual
  // around the character, so anyone nearby should hear it fade in with distance too, same
  // treatment as every other world event (gunfire/explosions/footsteps).
  respawnBeam(pos) { return playPositionalOneShot('respawn', pos, 1.5); },
};

// Background music — one or more looping layers, per map (see MAPS[mapKey].music in
// gameData.js, the single source of truth for what each map sounds like). Flat/non-positional
// (it's a soundtrack, not a world sound), same loop-handle pattern as the AKM's spray loop:
// keep every started source so they can all be stopped explicitly rather than left running
// under the game-over sting. Array-based rather than a single slot specifically so a map can
// carry any number of layers (City: one track; Ruins: a bed track + a separate lava-ambience
// layer) without the start/stop logic itself needing to know or care how many there are.
let backgroundMusicSources = [];
export function startBackgroundMusic(mapKey) {
  if (backgroundMusicSources.length) return; // already playing — joining mid-match shouldn't restart it
  const layers = MAPS[mapKey]?.music || MAPS[DEFAULT_MAP].music;
  for (const { key, gain } of layers) {
    const src = playBuffer(key, { loop: true, gain, bus: 'music' });
    if (src) backgroundMusicSources.push(src);
  }
}
export function stopBackgroundMusic() {
  for (const src of backgroundMusicSources) {
    try { src.stop(); } catch { /* already finished */ }
  }
  backgroundMusicSources = [];
}
