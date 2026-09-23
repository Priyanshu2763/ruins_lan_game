// One tiny module, one job: decide whether this session should use the touch-control layer
// (touchControls.js) instead of desktop keyboard/mouse. Queried at import time by both
// touchControls.js (whether to self-build at all) and ui.js (lockHint/resumeBtn branching), so
// there's a single source of truth rather than each caller re-deriving its own guess.
//
// `(pointer: coarse)` (the primary input is imprecise, i.e. a finger, not a mouse) combined with
// touch-capability detection avoids the common false-positive of a touch-capable laptop that's
// actually being driven by a mouse right now — pointer:coarse only matches when touch really is
// the PRIMARY pointer, not merely present alongside a mouse. Still imperfect for genuine hybrid
// devices (a tablet with a paired mouse, say), which is exactly why the override below exists.
const AUTO = ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.matchMedia('(pointer: coarse)').matches;

const OVERRIDE_KEY = 'ruins_forceTouchUI';

export function isTouchDevice() {
  const override = localStorage.getItem(OVERRIDE_KEY);
  if (override === '1') return true;
  if (override === '0') return false;
  return AUTO;
}

// '1' forces touch UI on, '0' forces it off, null/'auto' (or clearing the key) goes back to
// auto-detection — used by the Settings tab's "Force Touch UI" toggle for hybrid devices.
export function setTouchOverride(value) {
  if (value == null) localStorage.removeItem(OVERRIDE_KEY);
  else localStorage.setItem(OVERRIDE_KEY, value ? '1' : '0');
}

export function getTouchOverride() {
  return localStorage.getItem(OVERRIDE_KEY); // '1' | '0' | null
}
