// The touch-control layer — self-builds only on a detected/forced touch device (mirrors
// weapons.js's self-invoking buildWeaponBar() pattern), populating the static, empty
// #touchControls container from index.html. Every gameplay action calls the SAME exported
// functions the desktop keyboard/mouse path already uses (tryJump, setStance, startFireSequence,
// stopFiring, reload, setWeapon, startGrenadeAim/releaseGrenadeThrow/cancelGrenadeAim,
// applyLookDelta) directly — no synthesized KeyboardEvent/MouseEvent anywhere, so there is no
// second copy of any gameplay logic to keep in sync with the desktop path.
import { state } from './state.js';
import { isTouchDevice } from './touchDetect.js';
import { tryJump, setStance, applyLookDelta } from './movement.js';
import {
  startFireSequence, stopFiring, reload, setWeapon, cancelGrenadeAim,
  equipGrenadeMobile, startAimingThrowMobile, releaseGrenadeThrow, cancelGrenadeEquipMobile, isGrenadeEquippedMobile,
  startAim, stopAim, toggleAim,
} from './weapons.js';
import { isGrenadeBusy } from './viewmodel.js';
import { pauseMenu, openChat, closeChat, registerTouchLockHandlers, showScoreboard, hideScoreboard } from './ui.js';
import { loadTouchLayout, makeDraggable, makeLookZoneHandleDraggable, getLookZoneLeftPct, exitCustomizeMode } from './touchLayout.js';

if (isTouchDevice()) buildTouchControls();

function buildTouchControls() {
  const root = document.getElementById('touchControls');
  root.hidden = false;
  loadTouchLayout(); // primes touchLayout.js's live layout before any control asks to be positioned

  // ---- Look zone (free-look drag) — built first so it sits BEHIND everything else z-order-wise ----
  const lookZone = document.createElement('div');
  lookZone.id = 'tcLookZone';
  lookZone.style.left = `${getLookZoneLeftPct()}%`;
  root.appendChild(lookZone);
  bindLookZone(lookZone);

  const handle = document.createElement('div');
  handle.id = 'tcLookZoneHandle';
  handle.style.left = `${getLookZoneLeftPct()}%`;
  root.appendChild(handle);
  makeLookZoneHandleDraggable(handle, lookZone);

  // ---- Joystick ----
  const joyBase = document.createElement('div');
  joyBase.id = 'tcJoystick';
  joyBase.className = 'tcJoystickBase';
  const joyKnob = document.createElement('div');
  joyKnob.className = 'tcJoystickKnob';
  joyBase.appendChild(joyKnob);
  root.appendChild(joyBase);
  makeDraggable(joyBase, 'joystick');
  bindJoystick(joyBase, joyKnob);

  // ---- Action buttons ---- (no weapon-switch button — see the weapon-card tap handler below,
  // which replaces it with real BGMI-style tap-a-card switching on the existing #weaponBar)
  const fireBtn = makeButton('tcFire', 'tcBtnLg', 'FIRE');
  const jumpBtn = makeButton('tcJump', 'tcBtnSm', '');
  jumpBtn.classList.add('tcJumpIcon');
  const crouchBtn = makeButton('tcCrouch', 'tcBtnSm', 'CR');
  const proneBtn = makeButton('tcProne', 'tcBtnSm', 'PR');
  const reloadBtn = makeButton('tcReload', 'tcBtnSm', 'RLD');
  const grenadeBtn = makeButton('tcGrenade', 'tcBtnSm', 'GRN');
  const adsBtn = makeButton('tcAds', 'tcBtnSm', 'ADS');
  const grenadeBadge = document.createElement('span');
  grenadeBadge.id = 'tcGrenadeBadge';
  grenadeBtn.appendChild(grenadeBadge); // count shown here instead of a separate weapon-bar card, see below
  [fireBtn, jumpBtn, crouchBtn, proneBtn, reloadBtn, grenadeBtn, adsBtn].forEach((el) => root.appendChild(el));
  makeDraggable(fireBtn, 'fire');
  makeDraggable(jumpBtn, 'jump');
  makeDraggable(crouchBtn, 'crouch');
  makeDraggable(proneBtn, 'prone');
  makeDraggable(reloadBtn, 'reload');
  makeDraggable(grenadeBtn, 'grenade');
  makeDraggable(adsBtn, 'ads');

  bindFire(fireBtn);
  bindTap(jumpBtn, () => tryJump());
  // A dedicated prone button now, not a hidden double-tap-on-crouch gesture — a real user report
  // that "the prone button is missing" (double-tap timing on a real touchscreen isn't as
  // discoverable/reliable as a plain second button). Crouch is now a single, simple toggle.
  bindTap(crouchBtn, () => setStance(!state.isCrouched, false));
  bindTap(proneBtn, () => setStance(false, !state.isProne));
  bindTap(reloadBtn, () => reload());
  bindGrenade(grenadeBtn);
  bindAds(adsBtn);
  bindWeaponCards();

  // ---- Pause + chat (small, top-area utility buttons; not part of the draggable BGMI cluster) ----
  const pauseBtn = document.createElement('button');
  pauseBtn.id = 'tcPauseBtn';
  pauseBtn.type = 'button';
  pauseBtn.textContent = '☰';
  root.appendChild(pauseBtn);
  pauseBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pauseTouchControls();
    pauseMenu.hidden = false;
  }, { passive: false });

  const chatBtn = document.createElement('button');
  chatBtn.id = 'tcChatBtn';
  chatBtn.type = 'button';
  chatBtn.textContent = '💬';
  root.appendChild(chatBtn);
  chatBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state.touchCustomizing) return;
    if (state.chatOpen) closeChat(); else openChat();
  }, { passive: false });

  // Always-available fullscreen toggle — see toggleFullscreen()'s own comment for why this needs
  // to be a dedicated, directly-tappable control rather than only an automatic side effect.
  const fsBtn = document.createElement('button');
  fsBtn.id = 'tcFullscreenBtn';
  fsBtn.type = 'button';
  fsBtn.textContent = '⛶';
  root.appendChild(fsBtn);
  fsBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state.touchCustomizing) return;
    toggleFullscreen();
  }, { passive: false });

  // Stats — desktop views the live MATCH scoreboard/leaderboard by holding Tab (client.js); touch
  // has no keyboard, so this button mirrors that exact hold-to-view behavior (show on press, hide
  // on release) rather than a tap-toggle, using the same #scoreboard element and
  // showScoreboard()/hideScoreboard() desktop already calls — this is the match leaderboard
  // (kills/deaths per player in the room), not the dashboard's own per-account profile stats.
  // Top-middle, per the explicit placement ask.
  const statsBtn = document.createElement('button');
  statsBtn.id = 'tcStatsBtn';
  statsBtn.type = 'button';
  statsBtn.textContent = '📊';
  root.appendChild(statsBtn);
  statsBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (state.touchCustomizing) return;
    showScoreboard();
  }, { passive: false });
  statsBtn.addEventListener('pointerup', (e) => { e.preventDefault(); hideScoreboard(); }, { passive: false });
  statsBtn.addEventListener('pointercancel', (e) => { e.preventDefault(); hideScoreboard(); }, { passive: false });

  // ---- Customize-mode "Done" button (hidden outside edit mode, see touchLayout.js) ----
  const doneBtn = document.createElement('button');
  doneBtn.id = 'tcDoneBtn';
  doneBtn.type = 'button';
  doneBtn.textContent = 'Done';
  doneBtn.hidden = true;
  root.appendChild(doneBtn);
  doneBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); exitCustomizeMode(); }, { passive: false });

  // A slipped thumb / an interrupted gesture (incoming call, OS back-swipe) has the same failure
  // mode as alt-tab losing Pointer Lock on desktop — pointercancel on each control covers the
  // gesture-level interruption; this covers the coarser "the whole page went into the background"
  // case, which pointercancel isn't guaranteed to fire for on every browser.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelGrenadeAim(); stopFiring(); stopAim(); hideScoreboard(); syncAdsVisual(); }
  });

  window.addEventListener('resize', updateRotateOverlay);
  window.addEventListener('orientationchange', updateRotateOverlay);
  updateRotateOverlay();

  registerTouchLockHandlers(engageTouchControls, resumeTouchControls);
}

function makeButton(id, sizeClass, label) {
  const btn = document.createElement('button');
  btn.id = id;
  btn.type = 'button';
  btn.className = `tcBtn ${sizeClass}`;
  btn.textContent = label;
  return btn;
}

// ---- Joystick: continuously (each pointermove) snaps the drag angle onto state.keys as if the
// nearest 1-2 WASD keys were held — movement.js's updateMovement() already normalizes any
// combination of those to a unit vector, so this needs zero changes to the movement math itself.
// Pushing past ~75% of the base's radius also adds ShiftLeft (sprint), matching how
// shiftActive already reads state.keys.has('ShiftLeft') today. ----
function bindJoystick(base, knob) {
  const RADIUS = 48; // px the knob can travel from center before clamping
  const SPRINT_THRESHOLD = 0.75;
  let pointerId = null;
  const clearKeys = () => { for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft']) state.keys.delete(k); };
  base.addEventListener('pointerdown', (e) => {
    if (state.touchCustomizing) return;
    e.preventDefault();
    base.setPointerCapture(e.pointerId);
    pointerId = e.pointerId;
    updateFromEvent(e);
  }, { passive: false });
  base.addEventListener('pointermove', (e) => {
    if (pointerId !== e.pointerId || state.touchCustomizing) return;
    updateFromEvent(e);
  });
  const end = (e) => {
    if (pointerId !== e.pointerId) return;
    pointerId = null;
    knob.style.transform = '';
    clearKeys();
  };
  base.addEventListener('pointerup', end);
  base.addEventListener('pointercancel', end);

  function updateFromEvent(e) {
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, RADIUS);
    const angle = Math.atan2(dy, dx);
    knob.style.transform = `translate(${Math.cos(angle) * clamped}px, ${Math.sin(angle) * clamped}px)`;

    clearKeys();
    const norm = dist === 0 ? 0 : Math.min(1, dist / RADIUS);
    if (norm < 0.15) return; // dead zone near center — avoid jittery direction snapping from a resting thumb
    // 8-way snap: whichever WASD combination best matches the drag angle. Screen dx/dy map onto
    // forward/right in view space the same way movement.js's own yaw-rotation already expects
    // (mz negative = forward/KeyW, matching the desktop convention exactly).
    const deg = (angle * 180) / Math.PI; // -180..180, 0 = right, 90 = down (screen space)
    if (deg > -157.5 && deg <= -112.5) { state.keys.add('KeyW'); state.keys.add('KeyA'); }
    else if (deg > -112.5 && deg <= -67.5) state.keys.add('KeyW');
    else if (deg > -67.5 && deg <= -22.5) { state.keys.add('KeyW'); state.keys.add('KeyD'); }
    else if (deg > -22.5 && deg <= 22.5) state.keys.add('KeyD');
    else if (deg > 22.5 && deg <= 67.5) { state.keys.add('KeyS'); state.keys.add('KeyD'); }
    else if (deg > 67.5 && deg <= 112.5) state.keys.add('KeyS');
    else if (deg > 112.5 && deg <= 157.5) { state.keys.add('KeyS'); state.keys.add('KeyA'); }
    else state.keys.add('KeyA');
    if (norm > SPRINT_THRESHOLD) state.keys.add('ShiftLeft');
  }
}

// ---- Look zone: same manual-delta-per-pointermove technique as preview.js's drag-to-rotate
// widget (no Pointer Lock / movementX equivalent exists off a real mouse). Multi-touch safe via
// its own tracked pointerId, independent of the joystick/fire/grenade pointers — this is what
// lets "hold grenade with one thumb, aim by dragging with the other" just work with no special
// gesture code in the grenade button itself. ----
//
// Explicit ask: a half-screen-width drag should rotate almost a full 360°, well beyond desktop's
// per-pixel mouse feel (which assumes small movementX deltas under Pointer Lock, not a whole
// screen's worth of finger travel) — so touch needs a genuinely different base sensitivity, not
// just a different SLIDER position on the same scale. TOUCH_BASE_SENS_MULT is that base,
// calculated (not guessed) so a half-width drag at REFERENCE_WIDTH lands just under 360°:
// (REFERENCE_WIDTH/2) * 0.0022 (applyLookDelta's own per-pixel constant) * TOUCH_BASE_SENS_MULT
// ≈ 342°. state.touchLookSensitivity (the Settings slider, 20%-200%) then multiplies ON TOP of
// this new base, so "increase from Settings" scales up from the already-boosted feel, not from
// desktop's much smaller baseline. dx/dy are normalized against REFERENCE_WIDTH before that, so
// the "half screen = ~360°" feel holds regardless of the actual device's real screen width.
const REFERENCE_WIDTH = 800;
const TOUCH_BASE_SENS_MULT = 6.8;
function bindLookZone(zone) {
  let pointerId = null, lastX = 0, lastY = 0;
  zone.addEventListener('pointerdown', (e) => {
    if (state.chatOpen || state.touchCustomizing) return;
    e.preventDefault();
    zone.setPointerCapture(e.pointerId);
    pointerId = e.pointerId; lastX = e.clientX; lastY = e.clientY;
  }, { passive: false });
  zone.addEventListener('pointermove', (e) => {
    if (pointerId !== e.pointerId) return;
    const widthScale = REFERENCE_WIDTH / window.innerWidth;
    const dx = (e.clientX - lastX) * widthScale, dy = (e.clientY - lastY) * widthScale;
    lastX = e.clientX; lastY = e.clientY;
    applyLookDelta(dx, dy, TOUCH_BASE_SENS_MULT * (state.aiming ? state.adsTouchSensitivity : state.touchLookSensitivity));
  });
  const end = (e) => { if (pointerId === e.pointerId) pointerId = null; };
  zone.addEventListener('pointerup', end);
  zone.addEventListener('pointercancel', end);
}

function bindTap(el, fn) {
  el.addEventListener('pointerdown', (e) => {
    if (state.touchCustomizing) return;
    e.preventDefault();
    fn();
  }, { passive: false });
}

// Fire does double duty on mobile: normal shooting, OR — while a grenade is equipped via the
// grenade button (see bindGrenade below) — holding it is what shows the aim trajectory, and
// releasing it is what actually throws. This is the real fix for "can't move the camera while
// the grenade button is held": the OLD flow needed the grenade button held the whole time you
// aimed, which ties up the exact touch point BGMI players use to look around one-handed. Now the
// grenade button is a quick tap (equip only, look-zone stays completely free the whole time it's
// just sitting in your hand), and aiming/throwing piggybacks on the SAME fire button players
// already know, exactly matching BGMI's own mobile grenade flow.
function bindFire(el) {
  // Tracked per-gesture (set at press, read at release) rather than re-checking
  // isGrenadeEquippedMobile() at release time — an edge case worth guarding against: if it were
  // re-checked at release, a normal fire-hold that happens to still be in progress right as a
  // grenade gets equipped by a second finger could release into the wrong branch (throwing
  // instead of just stopping the gun).
  let aimingGrenadeThisPress = false;
  el.addEventListener('pointerdown', (e) => {
    if (state.touchCustomizing || state.chatOpen || !state.controlsActive) return;
    e.preventDefault();
    aimingGrenadeThisPress = isGrenadeEquippedMobile();
    if (aimingGrenadeThisPress) startAimingThrowMobile();
    else if (!isGrenadeBusy()) startFireSequence();
  }, { passive: false });
  const end = () => {
    if (state.touchCustomizing) return;
    if (aimingGrenadeThisPress) releaseGrenadeThrow();
    else stopFiring();
    updateGrenadeEquippedVisual(); // the throw just cleared grenadeEquippedMobile — reflect that
    syncAdsVisual();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

function updateGrenadeEquippedVisual() {
  const el = document.getElementById('tcGrenade');
  if (el) el.classList.toggle('tcGrenadeEquipped', isGrenadeEquippedMobile());
}

// Same "resync after a cross-module state change" need as updateGrenadeEquippedVisual above —
// stopAim() is called from several places outside this file (setWeapon, reload, grenade equip),
// so the button's own highlight class needs a matching resync at every point that might have
// triggered one of those, not just its own bindAds handler.
function syncAdsVisual() {
  const el = document.getElementById('tcAds');
  if (el) el.classList.toggle('tcAdsActive', state.aiming);
}

// A plain tap now, not a hold — equips the grenade (into-hand, no trajectory yet); tapping again
// while already equipped un-equips it (an explicit way to back out without needing to switch
// weapons or hold-and-release fire). Aiming/throwing happens on the fire button, see bindFire.
function bindGrenade(el) {
  el.addEventListener('pointerdown', (e) => {
    if (state.touchCustomizing) return;
    e.preventDefault();
    if (isGrenadeEquippedMobile()) cancelGrenadeEquipMobile();
    else equipGrenadeMobile();
    updateGrenadeEquippedVisual();
    syncAdsVisual();
  }, { passive: false });
}

// Dedicated ADS button, PUBG-style — reads the same state.aimMode Settings-tab choice as
// desktop's right-click (see weapons.js), so switching HOLD/TOGGLE there applies identically to
// both input methods rather than needing a second mobile-only setting.
function bindAds(el) {
  el.addEventListener('pointerdown', (e) => {
    if (state.touchCustomizing) return;
    e.preventDefault();
    if (state.aimMode === 'toggle') toggleAim(); else startAim();
    el.classList.toggle('tcAdsActive', state.aiming);
  }, { passive: false });
  const end = () => {
    if (state.touchCustomizing || state.aimMode === 'toggle') return;
    stopAim();
    el.classList.remove('tcAdsActive');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// BGMI-style weapon switching: tap a card in the existing #weaponBar directly instead of cycling
// through a separate "SWP" button. Reuses the SAME weapon-bar DOM the desktop HUD already shows
// (ammo counts and all) rather than building a second, parallel weapon display — mobile just
// gets a CSS-only shrink (see the @media rule) plus this tap handler, gated to touch devices only
// so desktop's card-click behavior is completely unchanged (clicking a card with a mouse still
// does nothing there, exactly as before this batch).
// Event DELEGATION on the always-present #weaponBar container (not on the individual .weaponCard
// children) deliberately sidesteps any question of whether buildWeaponBar() (weapons.js) has
// already populated its cards by the time this runs — the listener works correctly regardless of
// which module's top-level code happened to execute first.
function bindWeaponCards() {
  const weaponBar = document.getElementById('weaponBar');
  weaponBar.addEventListener('pointerdown', (e) => {
    if (state.touchCustomizing) return;
    const card = e.target.closest('.weaponCard');
    if (!card || card.id === 'grenadeCard') return; // grenade has no card on mobile — see the @media rule and #tcGrenadeBadge
    e.preventDefault();
    const weaponCards = [...weaponBar.children].filter((c) => c.id !== 'grenadeCard');
    const idx = weaponCards.indexOf(card);
    if (idx < 0) return;
    cancelGrenadeEquipMobile(); // tapping a weapon card should back out of a pending grenade equip, same as any other weapon switch
    setWeapon(idx);
    updateGrenadeEquippedVisual();
    syncAdsVisual();
  }, { passive: false });
}

// ---- Best-effort fullscreen + landscape lock ----
// The CRITICAL "controls are now live" step (hiding lockHint/pauseMenu, flipping
// state.controlsActive) lives directly in ui.js's lockHint/resumeBtn click handlers now, not
// here — a real bug found via a real-device report: this file used to own that critical step
// entirely, registered into ui.js via a callback (registerTouchLockHandlers) at module-evaluation
// time. On a slower device, a tap could arrive before that registration finished, and ui.js's
// handler fell back to desktop's requestLock() (useless on a touchscreen) instead — the overlay
// never disappeared, exactly as reported. These two functions are now purely an OPTIONAL bonus
// ui.js calls if/when they happen to be registered by the time of the tap, never required for the
// game to actually start playing. (A second, earlier bug already fixed here: awaiting
// requestFullscreen()/orientation.lock() before doing anything — some mobile browsers leave those
// promises pending forever rather than rejecting, which used to hang this whole function.)
// Real bug found via a real-device report: this used to fullscreen `state.renderer.domElement`
// (the bare WebGL canvas) — but #hud, #touchControls, #lockHint, #pauseMenu etc are all SEPARATE
// top-level siblings in the page, not descendants of the canvas. The Fullscreen API only shows
// the fullscreened element and ITS OWN subtree; everything else on the page is hidden while it's
// active. Fullscreening just the canvas made every control disappear the moment it engaged —
// exactly "the controls disappear" as reported. Fixed by fullscreening `document.documentElement`
// (the whole page) instead, so nothing outside the canvas gets hidden.
function requestGameFullscreen() {
  return Promise.resolve()
    .then(() => document.documentElement.requestFullscreen?.())
    .then(() => screen.orientation?.lock?.('landscape'))
    .catch(() => { /* unsupported (iOS Safari has neither), or the user already backed out of it — updateRotateOverlay() and #tcFullscreenBtn below are the fallbacks */ });
}
export function engageTouchControls() { requestGameFullscreen(); }
export function pauseTouchControls() {
  state.controlsActive = false;
  state.keys.clear();
  stopFiring();
  cancelGrenadeAim(); // covers mid-aim (fire was held); also clears a pending equip as of its own fix below
  cancelGrenadeEquipMobile(); // covers "equipped but never held fire" — cancelGrenadeAim() alone no-ops in that case since grenadeAiming is still false
  stopAim();
  updateGrenadeEquippedVisual();
  syncAdsVisual();
}
export function resumeTouchControls() { requestGameFullscreen(); }

// The other half of the same real-device bug report: browsers only grant fullscreen from a
// genuine, direct user gesture — a device's OS/browser "back" gesture exits fullscreen (a real,
// expected way to leave it, not a bug), but nothing was then offering a way back IN, since every
// other fullscreen attempt in this file is a best-effort side effect of some OTHER action
// (engaging/resuming), not a dedicated, always-available control of its own. This button IS that
// dedicated control — a direct tap on it is exactly the kind of gesture the Fullscreen API
// requires, so it reliably works even when the automatic attempts elsewhere don't.
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else requestGameFullscreen();
}

// Best-effort landscape nudge for browsers where screen.orientation.lock is unsupported (iOS
// Safari has neither the fullscreen-gated lock working reliably nor unprefixed support at all) —
// a plain "please rotate" overlay costs nothing and covers the gap gracefully instead of leaving
// the game silently unplayable in portrait.
function updateRotateOverlay() {
  const overlay = document.getElementById('rotateOverlay');
  if (!overlay) return;
  overlay.hidden = !(isTouchDevice() && window.innerHeight > window.innerWidth);
}
