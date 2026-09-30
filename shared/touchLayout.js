// Shared between client (public/js/touchLayout.js) and server (server/index.js) so both sides
// agree on the default layout shape and the server can validate an incoming save without
// trusting the client's JSON blindly — same reasoning/pattern as shared/appearance.js's
// sanitizeAppearance for character customization.

// No weaponSwitch entry — that button was replaced by tap-to-switch on the existing weapon-bar
// cards (see touchControls.js's bindWeaponCards); sanitizeTouchLayout below simply drops the key
// from any older saved layout that still has one, same as it would any other unrecognized field.
// `scale` (1 = default size) rides along in the same per-key object as anchor/x/y — reuses the
// exact same persistence pipeline (localStorage cache + per-account server sync via
// syncToServer/applyServerTouchLayout in touchLayout.js) with zero new plumbing, so a resized
// button survives a restart/reinstall/new-device login the same way a repositioned one already
// did. Included on `joystick` too for schema uniformity even though the BGMI-style resize slider
// (touchLayout.js's selectControl) deliberately excludes it from being selectable for now — its
// drag RADIUS (touchControls.js's bindJoystick) is a fixed pixel constant independent of this
// scale, so resizing it visually would desync the knob's travel distance from the base's own
// drawn size without also reworking that math, which wasn't asked for.
export const DEFAULT_TOUCH_LAYOUT = {
  joystick: { anchor: 'bl', x: 95,  y: 110, scale: 1 },
  fire:     { anchor: 'br', x: 70,  y: 95,  scale: 1 },
  jump:     { anchor: 'br', x: 165, y: 165, scale: 1 },
  crouch:   { anchor: 'br', x: 165, y: 80,  scale: 1 },
  prone:    { anchor: 'br', x: 225, y: 55,  scale: 1 },
  reload:   { anchor: 'br', x: 70,  y: 200, scale: 1 },
  grenade:  { anchor: 'br', x: 225, y: 130, scale: 1 },
  ads:      { anchor: 'br', x: 295, y: 95,  scale: 1 },
  lookZoneLeftPct: 34,
};

const ANCHORS = new Set(['bl', 'br', 'tl', 'tr']);
const CONTROL_KEYS = ['joystick', 'fire', 'jump', 'crouch', 'prone', 'reload', 'grenade', 'ads'];

// Unknown keys are dropped, bad shapes fall back to the default for that one control (not the
// whole layout) — a corrupt/tampered single entry shouldn't cost the player their entire saved
// arrangement, same "sanitize per-field, not all-or-nothing" spirit as sanitizeAppearance.
export function sanitizeTouchLayout(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const key of CONTROL_KEYS) {
    const p = src[key];
    if (p && typeof p === 'object' && ANCHORS.has(p.anchor) && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      const scale = Number.isFinite(p.scale) ? clamp(p.scale, 0.6, 1.8) : 1;
      out[key] = { anchor: p.anchor, x: clamp(p.x, 0, 4000), y: clamp(p.y, 0, 4000), scale };
    } else {
      out[key] = { ...DEFAULT_TOUCH_LAYOUT[key] };
    }
  }
  out.lookZoneLeftPct = Number.isFinite(src.lookZoneLeftPct) ? clamp(src.lookZoneLeftPct, 20, 60) : DEFAULT_TOUCH_LAYOUT.lookZoneLeftPct;
  return out;
}
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
