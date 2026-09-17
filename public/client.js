// ---------- Bootstrap / composition root ----------
// This is the ONE file allowed to import every feature module — the inbound message dispatch
// (handleMessage) and the main render loop (animate) both legitimately touch nearly all of
// them, which is exactly the shape that would otherwise force circular imports between feature
// modules. Every feature module itself only ever imports state.js and (at most) a couple of
// narrowly-scoped exports from one or two siblings — see the module-boundary notes in each file.
import { DEFAULT_MAP, MAX_HEALTH, STAND_EYE_HEIGHT } from '/shared/gameData.js';
import { state } from './js/state.js';
import { connectWebSocket, sendMsg, sendState } from './js/net.js';
import { startBackgroundMusic, stopBackgroundMusic, playBuffer, playRingEffect, sfx, updateAudioListener } from './js/audio.js';
import { initScene, onResize } from './js/world.js';
import {
  renderRoomList, nameInput, menuScreen, gameContainer, hud, lockHint, roomTag, matchTimer,
  matchEndScreen, matchEndBody, pauseMenu, pushKillFeed, renderBoardInto, renderLeaderboard,
  drawMinimap, updateMatchTimerDisplay, hideScoreboard, showScoreboard,
} from './js/ui.js';
import { createRemote, removeRemote, hasRemote, syncRemotePlayer, respawnRemote, updateRemotePlayers } from './js/characters.js';
import { syncPickups, animatePickups, showPickupToast } from './js/pickups.js';
import { syncGrenades, spawnExplosion, spawnRespawnEffect, updateGrenades } from './js/grenades.js';
import {
  initViewmodels, initTrajectoryVisuals, updateViewmodelKick, setWeapon, resetLoadout,
  stopFiring, showHitMarker, handleRemoteShot, applyPickup, updateReload, updateTrajectoryPreview,
  getCurrentWeaponIndex, startGrenadeAim, releaseGrenadeThrow, reload,
} from './js/weapons.js';
import { onLocalDeath, onLocalRespawn, updateDeathAnim, setHealth, flashDamage } from './js/death.js';
import { updateMovement, setStance, setFootstepMode, tryJump } from './js/movement.js';

// roomId is write-only in the original code (set here, never read back anywhere) — kept as a
// plain local rather than shared state, same as it effectively was before.
let roomId = null;

function onJoined(msg) {
  state.localId = msg.playerId;
  roomId = msg.roomId;
  roomTag.textContent = `Room: ${msg.roomName} (${msg.roomId})`;
  menuScreen.hidden = true;
  gameContainer.hidden = false;
  hud.hidden = false;
  lockHint.hidden = false;
  state.matchEndsAt = msg.matchEndsAt || null;
  state.matchOver = false;
  matchTimer.hidden = !state.matchEndsAt;
  startBackgroundMusic(msg.map || DEFAULT_MAP);

  initScene(msg.map || DEFAULT_MAP, msg.memeMode !== false);
  startGameLoopOnce();
  state.playerX = msg.players.find((p) => p.id === state.localId)?.pos[0] ?? 0;
  state.playerZ = msg.players.find((p) => p.id === state.localId)?.pos[2] ?? 0;
  state.eyeHeight = STAND_EYE_HEIGHT;
  setStance(false, false);
  state.yawObject.position.set(state.playerX, state.eyeHeight, state.playerZ);

  for (const p of msg.players) {
    if (p.id === state.localId) continue;
    createRemote(p.id, p.name, p.pos, p.color);
  }
  setWeapon(0);
  setHealth(MAX_HEALTH);
  resetLoadout();
}

function onMatchEnded(list) {
  state.matchOver = true;
  matchTimer.hidden = true;
  state.localAlive = false; // freezes movement/firing via their existing localAlive checks
  stopFiring(); // a stray spray loop still playing under the game-over sound would undercut it
  stopBackgroundMusic(); // same reason — let the game-over sting land clean, not under the loop
  if (document.pointerLockElement) document.exitPointerLock();
  pauseMenu.hidden = true;
  hideScoreboard();
  renderBoardInto(matchEndBody, list);
  matchEndScreen.hidden = false; // unhiding a freshly-visible element replays its CSS
  // animation from the start — the GAME OVER title/blood-splat entrance (see index.html) only
  // ever needs to run once per match anyway, since "Quit to Menu" is a full page reload.
  playBuffer('gameOver');
}

// ---------- Message handling ----------
function handleMessage(msg) {
  switch (msg.type) {
    case 'rooms':
      renderRoomList(msg.rooms);
      break;
    case 'joined':
      onJoined(msg);
      break;
    case 'playerJoined':
      if (state.sceneReady && !hasRemote(msg.player.id)) {
        createRemote(msg.player.id, msg.player.name, [0, 0, 0]);
      }
      break;
    case 'playerLeft':
      removeRemote(msg.id);
      break;
    case 'state':
      for (const p of msg.players) {
        if (p.id === state.localId) {
          setHealth(p.health);
          continue;
        }
        syncRemotePlayer(p);
      }
      if (Array.isArray(msg.grenades)) syncGrenades(msg.grenades);
      if (Array.isArray(msg.pickups)) syncPickups(msg.pickups);
      break;
    case 'grenadeExploded':
      spawnExplosion(msg.pos);
      break;
    case 'shotFired':
      handleRemoteShot(msg);
      break;
    case 'pickup': {
      let text;
      if (msg.kind === 'health') {
        setHealth(msg.health);
        text = 'Medkit picked — health restored';
      } else {
        text = applyPickup(msg);
      }
      showPickupToast(text);
      sfx.pickup();
      break;
    }
    case 'hit':
      if (msg.shooterId === state.localId) showHitMarker();
      if (msg.targetId === state.localId) {
        setHealth(msg.health);
        flashDamage();
        if (msg.weapon === 'Grenade') playRingEffect();
      }
      break;
    case 'killed':
      if (msg.killerId === null) {
        pushKillFeed(`${msg.victimName} fell from the playing area`);
      } else {
        pushKillFeed(`${msg.killerName} eliminated ${msg.victimName} with ${msg.weapon || 'Unknown'}`);
      }
      if (msg.victimId === state.localId) onLocalDeath(msg.killerId === null ? null : msg.killerName); // plays sfx.fall() itself, in sync with the fall-camera sequence it starts
      break;
    case 'respawn':
      respawnRemote(msg.id, msg.pos);
      if (state.sceneReady) spawnRespawnEffect(msg.pos); // every respawn, local or remote -- anyone nearby sees/hears it
      if (msg.id === state.localId) onLocalRespawn(msg.pos, msg.health);
      break;
    case 'leaderboard':
      renderLeaderboard(msg.list);
      break;
    case 'matchEnded':
      onMatchEnded(msg.list);
      break;
    case 'error':
      alert(msg.message);
      break;
  }
}

// ---------- Keyboard input (spans movement/weapons/UI — kept here rather than forcing it into
// one of those, same reasoning as handleMessage/animate) ----------
document.addEventListener('keydown', (e) => {
  state.keys.add(e.code);
  if (e.code >= 'Digit1' && e.code <= 'Digit4') setWeapon(Number(e.code.slice(-1)) - 1);
  if (e.code === 'Space') tryJump();
  if (e.code === 'KeyC') setStance(!state.isCrouched, false);
  if (e.code === 'KeyZ') setStance(false, !state.isProne);
  if (e.code === 'KeyG') startGrenadeAim();
  if (e.code === 'KeyR') reload();
  if (e.code === 'Tab') { e.preventDefault(); showScoreboard(); }
});
document.addEventListener('keyup', (e) => {
  state.keys.delete(e.code);
  if (e.code === 'KeyG') releaseGrenadeThrow();
  if (e.code === 'Tab') hideScoreboard();
});

// ---------- One-time game-loop start, gated separately from initScene's own `sceneReady`
// guard — initScene (world.js) intentionally doesn't call these itself, which would have
// required it to import weapons.js/this bootstrap and created a circular import; this achieves
// the exact same "only ever runs once" behavior the original single-file version had (both
// guards trip together in practice, since onJoined only ever runs once per page load). ----------
let gameStarted = false;
function startGameLoopOnce() {
  if (gameStarted) return;
  gameStarted = true;
  initViewmodels();
  initTrajectoryVisuals();
  window.addEventListener('resize', onResize);
  animate();
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, state.clock.getDelta());
  if (state.pointerLocked && state.localAlive) updateMovement(dt);
  else setFootstepMode(null); // paused/dead/menu — updateMovement won't run to catch this itself
  if (state.deathAnimActive) updateDeathAnim();
  if (state.sceneReady) updateViewmodelKick(dt);
  if (state.sceneReady) updateAudioListener();
  updateRemotePlayers(dt);
  updateGrenades(dt);
  updateTrajectoryPreview();
  animatePickups(dt);
  updateReload();
  if (state.sceneReady) drawMinimap();
  updateMatchTimerDisplay();
  if (state.screenShake > 0.001) {
    state.screenShake *= Math.max(0, 1 - dt * 6);
    state.camera.position.set((Math.random() - 0.5) * state.screenShake, (Math.random() - 0.5) * state.screenShake, 0);
  } else if (state.camera.position.x !== 0 || state.camera.position.y !== 0) {
    state.camera.position.set(0, 0, 0);
  }
  sendState(dt, getCurrentWeaponIndex());
  state.renderer.render(state.scene, state.camera);
}

// ---------- Networking bootstrap ----------
function onOpen() {
  const saved = localStorage.getItem('ruins_name');
  if (saved) nameInput.value = saved;
  sendMsg({ type: 'listRooms' });
}
connectWebSocket(onOpen, handleMessage);
