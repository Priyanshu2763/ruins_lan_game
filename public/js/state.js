// Shared mutable state for the whole client — a single plain object rather than per-variable
// exports, because ES modules only allow REASSIGNING a binding from the module that declared
// it (`export let x` can't be set from an importer), while mutating a PROPERTY of an imported
// object (`state.x = ...`) is always legal. Flat, not nested (`state.playerX`, not
// `state.player.x`) so every call site is a direct rename of the old bare variable, nothing more.
//
// Only genuinely cross-module state lives here — anything only ever touched inside one feature
// file (e.g. reload timers, the AKM loop handle, grenade-aim UI state) stays a private `let`
// in that file instead, to keep this list as small as it can honestly be. This module has zero
// imports of its own, which is what makes it safe for every other module to depend on without
// any risk of a circular import.
export const state = {
  // ---- three.js scene/session (populated by world.js's initScene) ----
  scene: null,
  camera: null,
  renderer: null,
  yawObject: null,
  clock: null,
  sceneReady: false,

  // ---- current room's map layout (populated by world.js's initScene) ----
  ACTIVE_WALLS: [],
  ACTIVE_PLATFORMS: [],
  ACTIVE_RAMPS: [],
  ACTIVE_GRASS: [],
  ACTIVE_DECOR: [],

  // ---- local player position/stance (movement.js owns the writes; read by net.js's
  // sendState, death.js's death/respawn sequence, ui.js's minimap) ----
  playerX: 0,
  playerZ: 0,
  currentGroundY: 0,
  eyeHeight: 0, // set to STAND_EYE_HEIGHT by movement.js/death.js once gameData is available
  isCrouched: false,
  isProne: false,
  isMoving: false,
  isSprinting: false,
  standingPlatformIndex: -1,
  fellOffSent: false,
  falling: false,
  fallVel: 0,
  fallDepth: 0,

  // ---- camera look direction (movement.js's mouse handler owns the writes; read by death.js,
  // net.js's sendState, ui.js's minimap triangle) ----
  pitch: 0,
  yaw: 0,

  // ---- settings (dashboard's Settings tab owns the writes, persisted to localStorage there;
  // movement.js/audio.js/world.js read these) ----
  mouseSensitivity: 1,
  fov: 75,
  toggleSprint: false, // false = hold Shift to sprint (default), true = tap Shift to toggle it
  sprintToggledOn: false, // only meaningful while toggleSprint is true — movement.js owns this

  // ---- session/alive flags (death.js and the bootstrap's onMatchEnded own the writes; read
  // almost everywhere movement/firing/input needs to be frozen) ----
  localAlive: true,
  localId: null,

  // ---- death-fall sequence (death.js owns the writes; the bootstrap's animate() reads this
  // to decide whether to call updateDeathAnim() each frame) ----
  deathAnimActive: false,

  // ---- input (ui.js's pointerlockchange owns pointerLocked; movement.js's key listeners own
  // the keys Set — both read from movement.js/weapons.js for gating input) ----
  pointerLocked: false,
  chatOpen: false, // typing in the chat box: movement/fire/weapon hotkeys must ignore the keyboard
  keys: new Set(),

  // ---- match/session (bootstrap's onJoined/onMatchEnded own the writes) ----
  matchEndsAt: null,
  matchOver: false,

  // ---- camera shake (grenades.js sets it on a nearby explosion; the bootstrap's animate()
  // decays it and applies it to the camera each frame) ----
  screenShake: 0,
};
