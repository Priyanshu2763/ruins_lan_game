import { RESPAWN_MS, STAND_EYE_HEIGHT } from '/shared/gameData.js';
import { state } from './state.js';
import { sfx } from './audio.js';
import { resetLoadout } from './weapons.js';
import { setStance } from './movement.js';

const centerMsg = document.getElementById('centerMsg');
const healthFill = document.getElementById('healthFill');

const dmgFlash = document.createElement('div');
dmgFlash.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:radial-gradient(ellipse at center, rgba(200,20,20,0) 40%, rgba(200,20,20,0.45) 100%);opacity:0;transition:opacity 0.4s;z-index:5;';
document.body.appendChild(dmgFlash);

// Death/respawn "eyelids" — two black panels sliding in from the top/bottom edges with a
// curved leading edge (border-radius on the meeting side) so they read as lids closing over
// the view rather than a flat wipe. Height is driven every frame by setEyelidCoverage() during
// the death-fall and respawn sequences (see updateDeathAnim/onLocalRespawn) rather than a CSS
// transition, so it can be kept in exact sync with the fall/respawn audio clips' real length.
const eyelidTop = document.createElement('div');
eyelidTop.style.cssText = 'position:fixed;top:0;left:0;right:0;height:0;background:linear-gradient(#050403,#0a0806);pointer-events:none;z-index:7;border-bottom-left-radius:50% 40px;border-bottom-right-radius:50% 40px;';
const eyelidBottom = document.createElement('div');
eyelidBottom.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:0;background:linear-gradient(#0a0806,#050403);pointer-events:none;z-index:7;border-top-left-radius:50% 40px;border-top-right-radius:50% 40px;';
document.body.appendChild(eyelidTop);
document.body.appendChild(eyelidBottom);
// pct: 0 = fully open (no coverage), 1 = fully closed (screen fully black). Each lid goes a
// touch past 50vh so the curved edges still meet with full coverage at pct=1, not just the
// flat parts. Tracks the last value it was set to (eyelidPct) so a later caller — the respawn
// open sequence — can start from wherever the lids actually are instead of assuming 1, in case
// the server's respawn message lands slightly before/after the death close finishes.
let eyelidPct = 0;
function setEyelidCoverage(pct) {
  eyelidPct = Math.max(0, Math.min(1, pct));
  const h = eyelidPct * 54;
  eyelidTop.style.height = h + 'vh';
  eyelidBottom.style.height = h + 'vh';
}
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInCubic(t) { return t * t * t; }
// Reverse of the death close — eyes opening back up as the player wakes up at their new spawn,
// synced to respawn.mp3's length. Self-driving rAF loop (same pattern as grenades.js's
// explosion flash animation) since it only runs for ~1.5s right at respawn, not worth a
// persistent flag in the main animate() loop.
function openEyelids() {
  const start = performance.now();
  const startPct = eyelidPct;
  const DURATION = 1500; // respawn.mp3's measured length
  (function step() {
    const t = Math.min(1, (performance.now() - start) / DURATION);
    setEyelidCoverage(startPct * (1 - easeOutCubic(t)));
    if (t < 1) requestAnimationFrame(step);
  })();
}

export function setHealth(hp) {
  healthFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
}

export function flashDamage() {
  dmgFlash.style.opacity = '1';
  setTimeout(() => { dmgFlash.style.opacity = '0'; }, 60);
  sfx.damage();
}

// Death-fall camera sequence: the view drops to near-ground and tilts to look straight up
// ("falls to the ground flat, face/camera to the sky"), synced to fall.mp3's exact length,
// while the eyelid overlay flutters (a couple of quick blinks) then slowly closes to black
// over the rest of the RESPAWN_MS window — landing fully shut right as the server's actual
// respawn arrives. Driven from the bootstrap's animate() (see updateDeathAnim) rather than a
// CSS transition so it can react to the live eyeHeight/pitch at the moment of death and to
// whatever stance the player was in.
const DEATH_FALL_MS = 1848; // fall.mp3's measured length (mutagen) — camera motion matches it exactly
const DEATH_BLINK_MS = 500; // quick eyelid flutter right at the start, before the slow close
const DEATH_REST_EYE_Y = 0.32; // resting camera height above whatever floor they died on
const DEATH_TARGET_PITCH = 1.5; // ~86 degrees -- looking almost straight up
let deathStartEyeY = 0, deathStartPitch = 0, deathTargetEyeY = 0, deathRollTarget = 0, deathAnimStart = 0;

export function onLocalDeath(killerName) {
  state.localAlive = false;
  centerMsg.hidden = false;
  centerMsg.textContent = killerName
    ? `Eliminated by ${killerName} — respawning...`
    : `You fell from the playing area — respawning...`;

  state.deathAnimActive = true;
  deathAnimStart = performance.now();
  deathStartEyeY = state.yawObject.position.y;
  // Drop BY (current eye height - resting height), not to a fixed world Y — so this lands
  // correctly whether they died on ground level, a rooftop, or already crouched/prone.
  deathTargetEyeY = deathStartEyeY - (state.eyeHeight - DEATH_REST_EYE_Y);
  deathStartPitch = state.pitch;
  deathRollTarget = (Math.random() < 0.5 ? -1 : 1) * (0.16 + Math.random() * 0.14); // topples slightly to one side, not a perfectly clean drop
  setEyelidCoverage(0);
  sfx.fall();
}

// Called every frame from the bootstrap's animate() while state.deathAnimActive.
export function updateDeathAnim() {
  const elapsed = performance.now() - deathAnimStart;

  const fallEase = easeOutCubic(Math.min(1, elapsed / DEATH_FALL_MS));
  state.yawObject.position.y = deathStartEyeY + (deathTargetEyeY - deathStartEyeY) * fallEase;
  state.camera.rotation.x = deathStartPitch + (DEATH_TARGET_PITCH - deathStartPitch) * fallEase;
  state.camera.rotation.z = deathRollTarget * fallEase;

  if (elapsed < DEATH_BLINK_MS) {
    // two quick flutter pulses (consciousness flickering) before the real close begins
    const flutter = Math.abs(Math.sin((elapsed / DEATH_BLINK_MS) * Math.PI * 2)) * 0.16;
    setEyelidCoverage(flutter);
  } else {
    const closeT = Math.min(1, (elapsed - DEATH_BLINK_MS) / (RESPAWN_MS - DEATH_BLINK_MS));
    setEyelidCoverage(easeInCubic(closeT));
  }

  // Safety stop well past when the server's respawn should have arrived — keeps this from
  // running forever if a respawn message is ever lost; onLocalRespawn normally stops it first.
  if (elapsed >= RESPAWN_MS + 600) state.deathAnimActive = false;
}

export function onLocalRespawn(pos, hp) {
  state.deathAnimActive = false; // stop the death-fall update even if it hasn't hit its own end yet
  state.localAlive = true;
  centerMsg.hidden = true;
  state.eyeHeight = STAND_EYE_HEIGHT;
  setStance(false, false);
  state.yawObject.position.set(pos[0], state.eyeHeight, pos[2]);
  // The death fall drove camera.rotation.x/z directly, bypassing the `pitch` variable (mouse
  // look is frozen via the localAlive guard in movement.js's mousemove handler while dead) —
  // restore the normal look angle and clear the death-fall's topple roll.
  state.camera.rotation.x = state.pitch;
  state.camera.rotation.z = 0;
  state.playerX = pos[0]; state.playerZ = pos[2];
  state.currentGroundY = 0; // every spawn point is ground-level
  state.standingPlatformIndex = -1;
  state.fellOffSent = false;
  state.falling = false; state.fallVel = 0; state.fallDepth = 0;
  setHealth(hp);
  resetLoadout();
  openEyelids();
}
