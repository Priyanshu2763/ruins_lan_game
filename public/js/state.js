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

  // ---- aim-down-sights (weapons.js owns the writes; movement.js reads `aiming` to block sprint
  // and to pick ADS vs normal look sensitivity; viewmodel.js reads it to blend to the aim pose) ----
  aiming: false,
  aimMode: 'hold', // 'hold' = right-click/button held down (PUBG default), 'toggle' = one press each way — Settings tab
  adsMouseSensitivity: 1,
  adsTouchSensitivity: 1,

  // ---- session/alive flags (death.js and the bootstrap's onMatchEnded own the writes; read
  // almost everywhere movement/firing/input needs to be frozen) ----
  localAlive: true,
  localId: null,

  // ---- death-fall sequence (death.js owns the writes; the bootstrap's animate() reads this
  // to decide whether to call updateDeathAnim() each frame) ----
  deathAnimActive: false,

  // ---- input (ui.js's pointerlockchange owns pointerLocked; movement.js's key listeners own
  // the keys Set — both read from movement.js/weapons.js for gating input) ----
  pointerLocked: false, // real desktop Pointer Lock API state — ONLY meaningful on desktop; touch
                         // has no equivalent at all, so desktop-only concerns (pause-menu/lockHint
                         // visibility in ui.js) should keep reading this specifically.
  controlsActive: false, // unified "the player is actively controlling the game right now" gate,
                          // for the few call sites BOTH input methods actually share (client.js's
                          // animate() movement gate, weapons.js's startGrenadeAim() guard). Desktop's
                          // pointerlockchange handler mirrors pointerLocked into this; touchControls.js
                          // sets it directly via engageTouchControls()/pauseTouchControls(). Read this,
                          // not pointerLocked, anywhere the check needs to pass for EITHER input method.
  chatOpen: false, // typing in the chat box: movement/fire/weapon hotkeys must ignore the keyboard
  keys: new Set(),
  touchLookSensitivity: 1, // touch look-drag multiplier, separate from mouseSensitivity since touch
                            // deltas are raw CSS pixels, not OS-scaled movementX/Y — different feel,
                            // Settings tab's own slider (mirrors the existing mouseSensInput pattern)
  touchCustomizing: false, // true while the touch-control layout edit/drag mode is open — gameplay
                            // touch handlers (fire/move/look/etc) no-op while this is true so dragging
                            // a control around doesn't also fire the weapon or walk the player

  // ---- match/session (bootstrap's onJoined/onMatchEnded own the writes) ----
  matchEndsAt: null,
  matchOver: false,

  // ---- camera shake (grenades.js sets it on a nearby explosion; the bootstrap's animate()
  // decays it and applies it to the camera each frame) ----
  screenShake: 0,
};
