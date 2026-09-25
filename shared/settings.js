// Shared between client (public/js/ui.js) and server (server/index.js) for the Settings tab's
// values — same pattern as shared/appearance.js and shared/touchLayout.js. These now sync per
// ACCOUNT (DB), not just per device (localStorage stays as an instant-load cache only, same
// relationship touch-layout already has to its own DB column).
//
// forceTouchUI is deliberately NOT included here — it's a statement about whether THIS SPECIFIC
// device auto-detects correctly as touch-capable, not a player preference; syncing it to the
// account would force a phone's override onto a desktop session (or vice versa) on next login,
// which is exactly the wrong behavior for what it's for. It stays in localStorage only.
export const DEFAULT_SETTINGS = {
  masterVolume: 80,
  musicVolume: 70,
  sfxVolume: 100,
  mouseSensitivity: 100,
  fov: 75,
  toggleSprint: false,
  touchLookSensitivity: 100,
};

export function sanitizeSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  const pct = (v, fallback, min, max) => (Number.isFinite(v) ? clamp(v, min, max) : fallback);
  return {
    masterVolume: pct(src.masterVolume, DEFAULT_SETTINGS.masterVolume, 0, 100),
    musicVolume: pct(src.musicVolume, DEFAULT_SETTINGS.musicVolume, 0, 100),
    sfxVolume: pct(src.sfxVolume, DEFAULT_SETTINGS.sfxVolume, 0, 100),
    mouseSensitivity: pct(src.mouseSensitivity, DEFAULT_SETTINGS.mouseSensitivity, 20, 200),
    fov: pct(src.fov, DEFAULT_SETTINGS.fov, 60, 110),
    toggleSprint: src.toggleSprint === true,
    touchLookSensitivity: pct(src.touchLookSensitivity, DEFAULT_SETTINGS.touchLookSensitivity, 20, 200),
  };
}
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
