// ---------- Bootstrap / composition root ----------
// This is the ONE file allowed to import every feature module — the inbound message dispatch
// (handleMessage) and the main render loop (animate) both legitimately touch nearly all of
// them, which is exactly the shape that would otherwise force circular imports between feature
// modules. Every feature module itself only ever imports state.js and (at most) a couple of
// narrowly-scoped exports from one or two siblings — see the module-boundary notes in each file.
import { DEFAULT_MAP, MAX_HEALTH, STAND_EYE_HEIGHT } from '/shared/gameData.js';
import { state } from './js/state.js';
import { connectWebSocket, sendMsg, sendState, saveSession, loadSession, saveLoadout, loadLoadout, clearSession } from './js/net.js';
import { startBackgroundMusic, stopBackgroundMusic, playBuffer, playRingEffect, sfx, updateAudioListener } from './js/audio.js';
import { initScene, onResize } from './js/world.js';
import {
  renderRoomList, nameInput, menuScreen, gameContainer, hud, lockHint, roomTag, matchTimer,
  matchEndScreen, matchEndBody, pauseMenu, pushKillFeed, renderBoardInto, renderLeaderboard,
  drawMinimap, updateMatchTimerDisplay, hideScoreboard, showScoreboard,
  showConn, hideConn, addChatLine, resetChat, openChat, sendHello,
  showRejoinPrompt, hideRejoinPrompt, isRejoinPromptOpen, showRejoinError,
} from './js/ui.js';
import { createRemote, removeRemote, hasRemote, syncRemotePlayer, respawnRemote, updateRemotePlayers, setRemoteAppearance, clearRemotes } from './js/characters.js';
import { syncPickups, animatePickups, showPickupToast } from './js/pickups.js';
import { syncGrenades, spawnExplosion, spawnRespawnEffect, updateGrenades } from './js/grenades.js';
import {
  initViewmodels, initTrajectoryVisuals, setWeapon, resetLoadout,
  stopFiring, showHitMarker, handleRemoteShot, applyPickup, updateReload, updateTrajectoryPreview,
  getCurrentWeaponIndex, startGrenadeAim, releaseGrenadeThrow, reload, getLoadout, applyLoadout,
} from './js/weapons.js';
import { renderViewmodel, setViewmodelAppearance, updateAdsFov } from './js/viewmodel.js';
import { updateWeaponFx } from './js/weaponfx.js';
import { guestAppearance } from '/shared/appearance.js';
import { onLocalDeath, onLocalRespawn, updateDeathAnim, setHealth, flashDamage } from './js/death.js';
import { updateMovement, setStance, setFootstepMode, tryJump } from './js/movement.js';
import './js/touchControls.js'; // side-effect only: self-builds the touch UI on a detected touch device, no-ops on desktop

// roomId is write-only in the original code (set here, never read back anywhere) — kept as a
// plain local rather than shared state, same as it effectively was before.
let roomId = null;

function onJoined(msg) {
  const resumed = !!msg.reconnected;
  // Remember which match this tab is in (and the secret that reclaims our slot) so a refresh or a
  // dropped connection can come straight back to it instead of dumping us at the dashboard.
  saveSession({ roomId: msg.roomId, token: msg.sessionToken, roomName: msg.roomName });
  hideConn();
  hideRejoinPrompt();
  resetChat(msg.chat);
  // Same page, scene already running (a network blip): just resync — re-initialising the whole
  // scene would throw away the running game.
  if (resumed && state.sceneReady && state.localId != null) { onRejoined(msg); return; }

  state.localId = msg.playerId;
  roomId = msg.roomId;
  roomTag.textContent = `Room: ${msg.roomName} (${msg.roomId})`;
  menuScreen.hidden = true;
  document.getElementById('dashboardScreen').hidden = true; // a resumed match skips the Play modal entirely
  gameContainer.hidden = false;
  hud.hidden = false;
  lockHint.hidden = false;
  state.matchEndsAt = msg.matchEndsAt || null;
  state.matchOver = false;
  matchTimer.hidden = !state.matchEndsAt;
  startBackgroundMusic(msg.map || DEFAULT_MAP);

  initScene(msg.map || DEFAULT_MAP, msg.memeMode !== false);
  startGameLoopOnce();
  setViewmodelAppearance(msg.players.find((p) => p.id === msg.playerId)?.appearance || guestAppearance(msg.playerId));
  state.playerX = msg.players.find((p) => p.id === state.localId)?.pos[0] ?? 0;
  state.playerZ = msg.players.find((p) => p.id === state.localId)?.pos[2] ?? 0;
  state.eyeHeight = STAND_EYE_HEIGHT;
  setStance(false, false);
  state.yawObject.position.set(state.playerX, state.eyeHeight, state.playerZ);

  for (const p of msg.players) {
    if (p.id === state.localId) continue;
    setRemoteAppearance(p.id, p.appearance);
    createRemote(p.id, p.name, p.pos);
  }
  setWeapon(0);
  setHealth(resumed ? msg.you.health : MAX_HEALTH);
  resetLoadout();
  if (resumed) {
    // A refreshed tab lost every client-side variable — put back the ammo/grenades it was carrying
    // (snapshotted to sessionStorage once a second) and the server's record of our health.
    const saved = loadLoadout();
    if (saved && saved.roomId === msg.roomId) applyLoadout(saved);
    if (!msg.you.alive) onLocalDeath(null); // died before the drop: run the death sequence, the server's respawn timer is still ticking
  }
}

// The match kept running on this page while the connection was down: adopt the server's
// authoritative player list (ids are preserved by the server, but people may have come and
// gone), our health, and our alive/dead state. Position stays local — movement is
// client-authoritative and we kept simulating throughout.
function onRejoined(msg) {
  state.localId = msg.playerId;
  clearRemotes();
  for (const p of msg.players) {
    if (p.id === state.localId) continue;
    setRemoteAppearance(p.id, p.appearance);
    createRemote(p.id, p.name, p.pos);
  }
  state.matchEndsAt = msg.matchEndsAt || null;
  stopFiring();
  setHealth(msg.you.health);
  if (msg.you.alive && !state.localAlive) onLocalRespawn(msg.you.pos, msg.you.health);
  else if (!msg.you.alive && state.localAlive) onLocalDeath(null);
}

function onMatchEnded(list) {
  state.matchOver = true;
  clearSession(); // the match is over — a reload should land on the dashboard, not try to resume
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
    case 'chat':
      addChatLine(msg);
      break;
    case 'grenadeBounce':
      sfx.grenadeBounce(msg.pos, msg.surface, msg.speed);
      break;
    case 'reconnectFailed':
      // Grace period ran out, the room ended, or the server restarted: the slot is gone.
      clearSession();
      if (state.sceneReady) { showConn('Could not rejoin the match — returning to the menu'); setTimeout(() => location.reload(), 1600); }
      else if (isRejoinPromptOpen()) { hideConn(); showRejoinError('That match has ended or your spot expired.'); setTimeout(hideRejoinPrompt, 2200); sendMsg({ type: 'listRooms' }); }
      else hideConn();
      break;
    case 'abandoned':
      sendMsg({ type: 'listRooms' });
      break;
    case 'joined':
      onJoined(msg);
      break;
    case 'playerJoined':
      if (state.sceneReady && !hasRemote(msg.player.id)) {
        setRemoteAppearance(msg.player.id, msg.player.appearance);
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
  if (state.chatOpen) return; // the chat box owns the keyboard while it's open
  if (e.code === 'Enter' && state.pointerLocked && state.localId != null && !state.matchOver) { e.preventDefault(); openChat(); return; }
  state.keys.add(e.code);
  if (e.code >= 'Digit1' && e.code <= 'Digit4') setWeapon(Number(e.code.slice(-1)) - 1);
  if (e.code === 'Space') tryJump();
  if (e.code === 'KeyC') setStance(!state.isCrouched, false);
  if (e.code === 'KeyZ') setStance(false, !state.isProne);
  if (e.code === 'KeyG') startGrenadeAim();
  if (e.code === 'KeyR') reload();
  if (e.code === 'Tab') { e.preventDefault(); showScoreboard(); }
  // Toggle-sprint mode (Settings tab) — a Shift PRESS flips the toggle instead of driving
  // sprint directly; movement.js reads state.sprintToggledOn while this mode is active. Only
  // reacts on the actual keydown transition (not the repeat=true auto-fired events a held key
  // sends), otherwise holding Shift would flicker the toggle on/off many times a second.
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && state.toggleSprint && !e.repeat) {
    state.sprintToggledOn = !state.sprintToggledOn;
  }
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
  if (state.controlsActive && state.localAlive) updateMovement(dt);
  else setFootstepMode(null); // paused/dead/menu — updateMovement won't run to catch this itself
  if (state.deathAnimActive) updateDeathAnim();
  if (state.sceneReady) updateAudioListener();
  updateRemotePlayers(dt);
  updateGrenades(dt);
  updateWeaponFx(dt); // casings, shells, smoke and the dropped magazine
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
  updateAdsFov(dt); // must run before the world render below — see its own comment
  state.renderer.render(state.scene, state.camera);
  renderViewmodel(state.renderer, state.camera, dt); // arms + gun, drawn over the world with a cleared depth buffer
}

// ---------- Networking bootstrap ----------
// Runs on every (re)connect. If this tab has a match session (a refresh, or a dropped
// connection), ask the server to hand our slot back; otherwise it's a normal lobby connection.
function onOpen() {
  const saved = localStorage.getItem('ruins_name');
  if (saved) nameInput.value = saved;
  sendHello();
  const session = loadSession();
  if (session && session.roomId && session.token) {
    // Same page, match already on screen (a network blip): quietly resume, nothing to ask. A fresh
    // page (refresh / reopened tab) instead ASKS first — never drop the player into a match they
    // didn't choose to go back to.
    if (state.sceneReady) { showConn('Rejoining your match…'); sendMsg({ type: 'reconnect', roomId: session.roomId, token: session.token }); return; }
    hideConn();
    sendMsg({ type: 'listRooms' });
    if (!isRejoinPromptOpen()) showRejoinPrompt(session.roomName ? `${session.roomName} (${session.roomId})` : `room ${session.roomId}`, acceptRejoin, declineRejoin);
  } else {
    hideConn();
    sendMsg({ type: 'listRooms' });
  }
}
function acceptRejoin() {
  const session = loadSession();
  if (!session) { hideRejoinPrompt(); return; }
  showConn('Rejoining your match…');
  sendMsg({ type: 'reconnect', roomId: session.roomId, token: session.token });
}
// "No": tell the server to remove us from that room and drop our stats there, then forget it locally.
function declineRejoin() {
  const session = loadSession();
  if (session) sendMsg({ type: 'abandon', roomId: session.roomId, token: session.token });
  clearSession();
  hideConn();
}
function onStatus(kind, attempt) {
  if (kind !== 'reconnecting') return;
  // Only nag with a banner if there's something to lose — in the lobby a quiet retry is enough.
  if (state.localId != null || loadSession()) showConn(attempt === 1 ? 'Connection lost — reconnecting…' : `Reconnecting… (attempt ${attempt})`);
}
connectWebSocket({ onOpen, onMessage: handleMessage, onStatus });

// Ammo/grenades live only in this tab, so snapshot them once a second — that's what lets a
// refreshed tab rejoin with what it was actually carrying instead of full magazines.
setInterval(() => {
  if (state.localId != null && !state.matchOver && roomId) saveLoadout({ roomId, ...getLoadout() });
}, 1000);
