// Default positions, persistence, and edit-mode dragging for the touch-control layout. Deliberately
// minimal imports (just state.js) — same "safe for anything to depend on with zero circular-import
// risk" reasoning net.js already documents for itself. touchControls.js builds the actual control
// elements and calls makeDraggable() on each one; this file never reaches into touchControls.js.
import { state } from './state.js';

// Every control's position is an anchor corner ('bl'/'br'/'tl'/'tr') + an {x,y} offset in CSS
// pixels from that corner — not raw absolute coordinates, so the layout scales sanely across
// different phone screen sizes/aspect ratios instead of controls drifting off-screen on a
// smaller device. x = distance from the anchor's vertical edge (left for bl/tl, right for br/tr),
// y = distance from the anchor's horizontal edge (bottom for bl/br, top for tl/tr).
// Arrangement mirrors BGMI's default HUD: joystick bottom-left, fire (large) bottom-right, the
// rest of the action cluster fanned around it, free-look drag zone implied by lookZoneLeftPct
// (everything right of that % of the viewport width, excluding the buttons themselves).
export const DEFAULT_TOUCH_LAYOUT = {
  joystick:     { anchor: 'bl', x: 95,  y: 110 },
  fire:         { anchor: 'br', x: 70,  y: 95 },
  jump:         { anchor: 'br', x: 165, y: 165 },
  crouch:       { anchor: 'br', x: 165, y: 80 },  // tap = crouch, double-tap = prone
  reload:       { anchor: 'br', x: 70,  y: 200 },
  weaponSwitch: { anchor: 'br', x: 225, y: 55 },
  grenade:      { anchor: 'br', x: 225, y: 165 },
  lookZoneLeftPct: 34, // left edge of the free-look drag zone, as a % of viewport width
};

const KEY = 'ruins_touchLayout';

export function loadTouchLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULT_TOUCH_LAYOUT, ...saved };
  } catch {
    return { ...DEFAULT_TOUCH_LAYOUT };
  }
}

function saveTouchLayout(layout) {
  try { localStorage.setItem(KEY, JSON.stringify(layout)); } catch { /* storage unavailable — layout just won't persist */ }
}

// Live in-memory layout + element registry, populated incrementally as touchControls.js calls
// makeDraggable() for each control it builds — lets resetTouchLayout()/applyPosition() reposition
// every live element without touchControls.js needing to expose anything back to this file.
let liveLayout = loadTouchLayout();
const registry = new Map(); // key -> HTMLElement

function applyPosition(el, key) {
  const p = liveLayout[key];
  if (!p) return;
  el.style.left = el.style.right = el.style.top = el.style.bottom = '';
  if (p.anchor === 'bl') { el.style.left = `${p.x}px`; el.style.bottom = `${p.y}px`; }
  else if (p.anchor === 'br') { el.style.right = `${p.x}px`; el.style.bottom = `${p.y}px`; }
  else if (p.anchor === 'tl') { el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; }
  else { el.style.right = `${p.x}px`; el.style.top = `${p.y}px`; }
}

export function resetTouchLayout() {
  liveLayout = { ...DEFAULT_TOUCH_LAYOUT };
  saveTouchLayout(liveLayout);
  for (const [key, el] of registry) applyPosition(el, key);
  const zone = document.getElementById('tcLookZone');
  if (zone) zone.style.left = `${liveLayout.lookZoneLeftPct}%`;
}

// Called once per control by touchControls.js at build time. Registers the element, applies its
// current (saved-or-default) position, and wires up the pointer-capture drag pattern (same
// mechanics as preview.js's character-preview drag: setPointerCapture so the drag continues even
// if the finger leaves the element, manual clientX/Y delta computation, pointerup AND pointercancel
// both treated as "drag ended" since a slipped thumb has the same failure mode as an interrupted
// gesture). Dragging is only live while state.touchCustomizing is true — outside edit mode this is
// a no-op wrapper around the control's normal gameplay listeners (registered separately).
export function makeDraggable(el, key) {
  registry.set(key, el);
  applyPosition(el, key);
  // Two distinct coordinate spaces tracked separately (a real bug in an earlier draft merged
  // them via object-spread, silently overwriting the touch's own start position with the
  // control's layout offset): `pointerStartX/Y` is where the finger first touched down (raw
  // screen pixels), `layoutStartX/Y` is the control's own anchor-offset position at that same
  // instant — the drag adds the finger's delta onto the LATTER, never confusing the two.
  let drag = null; // { pointerId, pointerStartX, pointerStartY, layoutStartX, layoutStartY }
  el.addEventListener('pointerdown', (e) => {
    if (!state.touchCustomizing) return;
    e.preventDefault();
    e.stopPropagation(); // don't let this pointerdown also reach the control's gameplay handler
    el.setPointerCapture(e.pointerId);
    const p = liveLayout[key];
    drag = { pointerId: e.pointerId, pointerStartX: e.clientX, pointerStartY: e.clientY, layoutStartX: p.x, layoutStartY: p.y };
  }, { passive: false });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.pointerStartX, dy = e.clientY - drag.pointerStartY;
    const p = liveLayout[key];
    // Anchor-relative deltas: moving right/down INCREASES x/y for a left/top anchor but
    // DECREASES it for a right/bottom anchor (since x/y are measured from that far edge).
    const signX = p.anchor === 'bl' || p.anchor === 'tl' ? 1 : -1;
    const signY = p.anchor === 'tl' || p.anchor === 'tr' ? 1 : -1;
    p.x = clamp(drag.layoutStartX + signX * dx, 0, window.innerWidth - 20);
    p.y = clamp(drag.layoutStartY + signY * dy, 0, window.innerHeight - 20);
    applyPosition(el, key);
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = null;
    saveTouchLayout(liveLayout);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

// Look-zone boundary drag: a thin vertical handle (built by touchControls.js) that only adjusts
// lookZoneLeftPct on horizontal drag, clamped to a sane range so the zone can't be dragged to
// nothing or to swallow the whole screen.
export function makeLookZoneHandleDraggable(handleEl, zoneEl) {
  let startX = null, startPct = null, pointerId = null;
  handleEl.addEventListener('pointerdown', (e) => {
    if (!state.touchCustomizing) return;
    e.preventDefault();
    handleEl.setPointerCapture(e.pointerId);
    pointerId = e.pointerId; startX = e.clientX; startPct = liveLayout.lookZoneLeftPct;
  }, { passive: false });
  handleEl.addEventListener('pointermove', (e) => {
    if (pointerId !== e.pointerId) return;
    const dxPct = ((e.clientX - startX) / window.innerWidth) * 100;
    liveLayout.lookZoneLeftPct = clamp(startPct + dxPct, 20, 60);
    zoneEl.style.left = `${liveLayout.lookZoneLeftPct}%`;
    handleEl.style.left = `${liveLayout.lookZoneLeftPct}%`;
  });
  const end = (e) => {
    if (pointerId !== e.pointerId) return;
    pointerId = null;
    saveTouchLayout(liveLayout);
  };
  handleEl.addEventListener('pointerup', end);
  handleEl.addEventListener('pointercancel', end);
}

export function getLookZoneLeftPct() { return liveLayout.lookZoneLeftPct; }

export function enterCustomizeMode() {
  state.touchCustomizing = true;
  const root = document.getElementById('touchControls');
  if (root) root.classList.add('tcCustomizing');
  const done = document.getElementById('tcDoneBtn');
  if (done) done.hidden = false;
}
export function exitCustomizeMode() {
  state.touchCustomizing = false;
  const root = document.getElementById('touchControls');
  if (root) root.classList.remove('tcCustomizing');
  const done = document.getElementById('tcDoneBtn');
  if (done) done.hidden = true;
}
