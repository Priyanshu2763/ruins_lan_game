// The touch-control layer — self-builds only on a detected/forced touch device (mirrors
// weapons.js's self-invoking buildWeaponBar() pattern), populating the static, empty
// #touchControls container from index.html. Every gameplay action calls the SAME exported
// functions the desktop keyboard/mouse path already uses (tryJump, setStance, startFireSequence,
// stopFiring, reload, setWeapon, startGrenadeAim/releaseGrenadeThrow/cancelGrenadeAim,
// applyLookDelta) directly — no synthesized KeyboardEvent/MouseEvent anywhere, so there is no
// second copy of any gameplay logic to keep in sync with the desktop path.
import { state } from './state.js';
import { WEAPONS } from '/shared/gameData.js';
import { isTouchDevice } from './touchDetect.js';
import { tryJump, setStance, applyLookDelta } from './movement.js';
import { startFireSequence, stopFiring, reload, setWeapon, getCurrentWeaponIndex, startGrenadeAim, releaseGrenadeThrow, cancelGrenadeAim } from './weapons.js';
import { isGrenadeBusy } from './viewmodel.js';
import { lockHint, pauseMenu, openChat, closeChat, registerTouchLockHandlers } from './ui.js';
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

  // ---- Action buttons ----
  const fireBtn = makeButton('tcFire', 'tcBtnLg', 'FIRE');
  const jumpBtn = makeButton('tcJump', 'tcBtnSm', '');
  jumpBtn.classList.add('tcJumpIcon');
  const crouchBtn = makeButton('tcCrouch', 'tcBtnSm', 'CR');
  const reloadBtn = makeButton('tcReload', 'tcBtnSm', 'RLD');
  const weaponBtn = makeButton('tcWeaponSwitch', 'tcBtnSm', 'SWP');
  const grenadeBtn = makeButton('tcGrenade', 'tcBtnSm', 'GRN');
  [fireBtn, jumpBtn, crouchBtn, reloadBtn, weaponBtn, grenadeBtn].forEach((el) => root.appendChild(el));
  makeDraggable(fireBtn, 'fire');
  makeDraggable(jumpBtn, 'jump');
  makeDraggable(crouchBtn, 'crouch');
  makeDraggable(reloadBtn, 'reload');
  makeDraggable(weaponBtn, 'weaponSwitch');
  makeDraggable(grenadeBtn, 'grenade');

  bindFire(fireBtn);
  bindTap(jumpBtn, () => tryJump());
  bindCrouch(crouchBtn);
  bindTap(reloadBtn, () => reload());
  bindTap(weaponBtn, () => setWeapon((getCurrentWeaponIndex() + 1) % WEAPONS.length));
  bindGrenade(grenadeBtn);

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
    if (document.hidden) { cancelGrenadeAim(); stopFiring(); }
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
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    applyLookDelta(dx, dy, state.touchLookSensitivity);
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

function bindFire(el) {
  el.addEventListener('pointerdown', (e) => {
    if (state.touchCustomizing || state.chatOpen || !state.controlsActive || isGrenadeBusy()) return;
    e.preventDefault();
    startFireSequence();
  }, { passive: false });
  const end = () => { if (!state.touchCustomizing) stopFiring(); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// Tap = crouch toggle, double-tap = prone toggle — same 320ms window preview.js's double-click
// reset already uses.
function bindCrouch(el) {
  let lastTap = 0;
  el.addEventListener('pointerdown', (e) => {
    if (state.touchCustomizing) return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastTap < 320) { setStance(false, !state.isProne); lastTap = 0; }
    else { setStance(!state.isCrouched, false); lastTap = now; }
  }, { passive: false });
}

function bindGrenade(el) {
  el.addEventListener('pointerdown', (e) => {
    if (state.touchCustomizing) return;
    e.preventDefault();
    startGrenadeAim();
  }, { passive: false });
  const release = () => { if (!state.touchCustomizing) releaseGrenadeThrow(); };
  const cancel = () => { if (!state.touchCustomizing) cancelGrenadeAim(); };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', cancel); // a slipped thumb here must NOT complete the throw
}

// ---- Fullscreen + landscape lock + the controlsActive gate itself ----
export async function engageTouchControls() {
  try {
    if (state.renderer?.domElement.requestFullscreen) await state.renderer.domElement.requestFullscreen();
    if (screen.orientation?.lock) await screen.orientation.lock('landscape');
  } catch { /* unsupported (iOS Safari has neither) — updateRotateOverlay() is the fallback */ }
  lockHint.hidden = true;
  state.controlsActive = true;
}
export function pauseTouchControls() {
  state.controlsActive = false;
  state.keys.clear();
  stopFiring();
  cancelGrenadeAim();
}
export function resumeTouchControls() {
  state.controlsActive = true;
  pauseMenu.hidden = true;
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
