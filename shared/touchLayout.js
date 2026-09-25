// Shared between client (public/js/touchLayout.js) and server (server/index.js) so both sides
// agree on the default layout shape and the server can validate an incoming save without
// trusting the client's JSON blindly — same reasoning/pattern as shared/appearance.js's
// sanitizeAppearance for character customization.

// No weaponSwitch entry — that button was replaced by tap-to-switch on the existing weapon-bar
// cards (see touchControls.js's bindWeaponCards); sanitizeTouchLayout below simply drops the key
// from any older saved layout that still has one, same as it would any other unrecognized field.
export const DEFAULT_TOUCH_LAYOUT = {
  joystick: { anchor: 'bl', x: 95,  y: 110 },
  fire:     { anchor: 'br', x: 70,  y: 95 },
  jump:     { anchor: 'br', x: 165, y: 165 },
  crouch:   { anchor: 'br', x: 165, y: 80 },
  prone:    { anchor: 'br', x: 225, y: 55 },
  reload:   { anchor: 'br', x: 70,  y: 200 },
  grenade:  { anchor: 'br', x: 225, y: 130 },
  ads:      { anchor: 'br', x: 295, y: 95 },
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
      out[key] = { anchor: p.anchor, x: clamp(p.x, 0, 4000), y: clamp(p.y, 0, 4000) };
    } else {
      out[key] = { ...DEFAULT_TOUCH_LAYOUT[key] };
    }
  }
  out.lookZoneLeftPct = Number.isFinite(src.lookZoneLeftPct) ? clamp(src.lookZoneLeftPct, 20, 60) : DEFAULT_TOUCH_LAYOUT.lookZoneLeftPct;
  return out;
}
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
