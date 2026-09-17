import * as THREE from 'three';
import { WEAPONS, HEAD_CENTER_Y, HEAD_HALF, CROUCH_SCALE_Y } from '/shared/gameData.js';
import { state } from './state.js';
import { playPositionalLoopStart, dryPositionFor, applyOcclusionParams, isOccludedBetween, localListenerPos } from './audio.js';

function colorForId(id) {
  const c = new THREE.Color();
  c.setHSL((id * 0.157) % 1, 0.55, 0.55);
  return c;
}

// HEAD_Y/head box size come from gameData.js (HEAD_CENTER_Y/HEAD_HALF) — shared with the
// server's hit-cylinder/headshot logic so the visual head and the hittable head can't drift
// apart again (see handleAttack, server/index.js).
const HIP_Y = 0.9, SHOULDER_Y = 1.45, HEAD_Y = HEAD_CENTER_Y;

function buildCharacterFigure(id, name, colorHex) {
  const root = new THREE.Group(); // origin at feet (y=0) so crouch scaling just works
  const skin = new THREE.MeshStandardMaterial({ color: 0xc79b73, roughness: 0.6, metalness: 0.05 });
  // A player's chosen Character-tab color overrides the id-hashed default when they have one set
  // (see the dashboard's Character tab / player_customization table) — colorForId stays as the
  // fallback for anyone who hasn't customized (or is a guest with no linked account).
  const suit = new THREE.MeshStandardMaterial({ color: colorHex || colorForId(id), roughness: 0.45, metalness: 0.25 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.28), suit);
  torso.position.set(0, HIP_Y + 0.35, 0);
  root.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(HEAD_HALF * 2, HEAD_HALF * 2, HEAD_HALF * 2), skin);
  head.position.set(0, HEAD_Y, 0);
  root.add(head);

  function limb(mat, w, h, d, pivotY, localY) {
    const pivot = new THREE.Object3D();
    pivot.position.set(0, pivotY, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(0, localY, 0);
    pivot.add(mesh);
    root.add(pivot);
    return pivot;
  }

  const legL = limb(suit, 0.18, HIP_Y, 0.2, HIP_Y, -HIP_Y / 2);
  const legR = limb(suit, 0.18, HIP_Y, 0.2, HIP_Y, -HIP_Y / 2);
  legL.position.x = -0.14; legR.position.x = 0.14;

  const armLen = SHOULDER_Y - HIP_Y + 0.1;
  const armL = limb(skin, 0.15, armLen, 0.15, SHOULDER_Y, -armLen / 2);
  const armR = limb(skin, 0.15, armLen, 0.15, SHOULDER_Y, -armLen / 2);
  armL.position.x = -0.34; armR.position.x = 0.34;

  // A weapon silhouette in the right hand — swapped by visibility per equipped weapon, so an
  // enemy reads as armed with something specific instead of a bare-handed generic figure.
  const gunMat = new THREE.MeshStandardMaterial({ color: 0x1c1a16, roughness: 0.4, metalness: 0.6 });
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xc9c9c9, roughness: 0.25, metalness: 0.9 });
  const longGun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.55), gunMat);
  longGun.position.set(0.04, -armLen + 0.05, -0.28);
  const pistol = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.2), gunMat);
  pistol.position.set(0.04, -armLen + 0.05, -0.14);
  const knife = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.2), bladeMat);
  knife.position.set(0.04, -armLen + 0.05, -0.14);
  armR.add(longGun, pistol, knife);

  return { root, legL, legR, armL, armR, heldGuns: { longGun, pistol, knife }, suit };
}

function heldWeaponKind(weapon) {
  if (!weapon) return 'longGun';
  if (weapon.type === 'melee') return 'knife';
  if (weapon.name === 'Glock') return 'pistol';
  return 'longGun';
}

const remotePlayers = new Map(); // id -> { mesh, legL, legR, armL, armR, walkPhase, targetPos, targetRotY, crouch, moving }

export function hasRemote(id) { return remotePlayers.has(id); }

export function createRemote(id, name, pos, colorHex) {
  const fig = buildCharacterFigure(id, name, colorHex);
  fig.root.position.set(pos[0], pos[1] || 0, pos[2]);
  state.scene.add(fig.root);
  remotePlayers.set(id, {
    id, mesh: fig.root, legL: fig.legL, legR: fig.legR, armL: fig.armL, armR: fig.armR,
    heldGuns: fig.heldGuns, suit: fig.suit, color: colorHex || null, weapon: 0,
    targetPos: new THREE.Vector3(pos[0], pos[1] || 0, pos[2]), targetRotY: 0,
    walkPhase: 0, moving: false, crouch: false, prone: false,
  });
}

export function removeRemote(id) {
  const rp = remotePlayers.get(id);
  if (!rp) return;
  state.scene.remove(rp.mesh);
  remotePlayers.delete(id);
  setRemoteFootstepMode(id, null, null); // don't leave a loop orphaned if they disconnect mid-stride
}

// Applies one incoming per-player `state` update to its remote figure — the local player's own
// entry is handled by the caller (it needs setHealth from death.js, not this module), so this
// is only ever called for p.id !== localId.
export function syncRemotePlayer(p) {
  let rp = remotePlayers.get(p.id);
  if (!rp) {
    createRemote(p.id, `Player${p.id}`, p.pos, p.color);
    rp = remotePlayers.get(p.id);
  }
  rp.targetPos.set(p.pos[0], p.pos[1] || 0, p.pos[2]);
  rp.targetRotY = p.rot[0];
  rp.mesh.visible = p.alive;
  rp.crouch = !!p.crouch;
  rp.prone = !!p.prone;
  rp.moving = !!p.moving;
  rp.weapon = p.weapon;
  // A player's color is set once at join and doesn't change mid-match, but this cheaply covers
  // the rare case where their `joined`/first `state` snapshot arrived before their `hello`'s
  // accountId lookup resolved server-side (see server/index.js) and a later tick carries it.
  if (p.color && p.color !== rp.color) { rp.color = p.color; rp.suit.color.set(p.color); }
  setRemoteFootstepMode(p.id, !p.alive || !p.moving ? null : p.sprint ? 'run' : 'walk', p.pos);
}

// Reposition a respawning remote player's mesh (the 'respawn' broadcast carries only pos/health,
// not a full `state` update) and make sure it's visible again.
export function respawnRemote(id, pos) {
  const rp = remotePlayers.get(id);
  if (rp) { rp.mesh.position.set(pos[0], 0, pos[2]); rp.targetPos.copy(rp.mesh.position); rp.mesh.visible = true; }
}

// Other players' footsteps — positional (full base gain, distance/occlusion do the fading,
// exactly like gunfire), unlike your own which are flat and deliberately quieter (see
// movement.js's setFootstepMode). Same "one swappable loop per source, no timeout needed" idea
// as the AKM's remote spray loop, but simpler here: that one had to guess "are they still
// firing" from a timeout between discrete shot events, while movement state arrives
// continuously (every `state` tick, ~20Hz) so the mode is just directly known, no inference
// required.
const remoteFootstepLoops = new Map(); // playerId -> { mode, loop }
export function setRemoteFootstepMode(playerId, mode, pos) {
  const entry = remoteFootstepLoops.get(playerId);
  if (entry && entry.mode === mode) return;
  if (entry && entry.loop) { try { entry.loop.source.stop(); } catch { /* already finished */ } }
  remoteFootstepLoops.delete(playerId);
  if (mode === 'run' || mode === 'walk') {
    const loop = playPositionalLoopStart(mode === 'run' ? 'running' : 'walking', pos, 1);
    if (loop) remoteFootstepLoops.set(playerId, { mode, loop });
  }
}

function animateRemoteFigure(rp, dt) {
  if (rp.moving) rp.walkPhase += dt * 7;
  const targetSwing = rp.moving ? Math.sin(rp.walkPhase) * 0.55 : 0;
  const lerpT = Math.min(1, dt * 8);
  rp.legL.rotation.x += (targetSwing - rp.legL.rotation.x) * lerpT;
  rp.legR.rotation.x += (-targetSwing - rp.legR.rotation.x) * lerpT;
  rp.armL.rotation.x += (-targetSwing * 0.7 - rp.armL.rotation.x) * lerpT;
  rp.armR.rotation.x += (targetSwing * 0.7 - rp.armR.rotation.x) * lerpT;

  // Crouch: shorten the standing figure (still upright). Prone: actually lie the figure flat
  // instead of just squashing it — a squashed-but-still-upright box read as "standing but
  // short", not "lying down", so shots into a prone player looked unfair from the shooter's
  // side even though the server hitbox was already correctly small.
  const targetScaleY = rp.prone ? 1 : rp.crouch ? CROUCH_SCALE_Y : 1;
  rp.mesh.scale.y += (targetScaleY - rp.mesh.scale.y) * lerpT;
  const targetRotX = rp.prone ? -Math.PI / 2 : 0;
  rp.mesh.rotation.x += (targetRotX - rp.mesh.rotation.x) * lerpT;

  if (rp.heldGuns) {
    const kind = heldWeaponKind(WEAPONS[rp.weapon]);
    rp.heldGuns.longGun.visible = kind === 'longGun';
    rp.heldGuns.pistol.visible = kind === 'pistol';
    rp.heldGuns.knife.visible = kind === 'knife';
  }
}

// Called once per frame from the bootstrap's animate() — lerps every remote figure toward its
// latest network position/rotation, drives its walk animation, and keeps any active footstep
// loop's panner tracking the (lerped, so visually smooth) position.
export function updateRemotePlayers(dt) {
  for (const rp of remotePlayers.values()) {
    rp.mesh.position.lerp(rp.targetPos, Math.min(1, dt * 10));
    let dr = rp.targetRotY - rp.mesh.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    rp.mesh.rotation.y += dr * Math.min(1, dt * 10);
    animateRemoteFigure(rp, dt);
    // Keep an active footstep loop's panners tracking this player's live (lerped) position —
    // same split as the grenade tick: reposition every frame (cheap), throttle the occlusion
    // raycast to ~5-6/sec (not free, and with several players potentially moving/running at
    // once this adds up faster than the one-off grenade tick case did).
    const fsEntry = remoteFootstepLoops.get(rp.id);
    if (fsEntry && fsEntry.loop) {
      const p = rp.mesh.position;
      const pos = [p.x, p.y, p.z];
      fsEntry.loop.wetPanner.positionX.value = p.x; fsEntry.loop.wetPanner.positionY.value = p.y; fsEntry.loop.wetPanner.positionZ.value = p.z;
      const dp = dryPositionFor(pos);
      fsEntry.loop.dryPanner.positionX.value = dp[0]; fsEntry.loop.dryPanner.positionY.value = dp[1]; fsEntry.loop.dryPanner.positionZ.value = dp[2];
      const now = performance.now();
      if (now - (fsEntry.occlusionCheckedAt || 0) > 180) {
        fsEntry.occlusionCheckedAt = now;
        applyOcclusionParams(fsEntry.loop.filter, fsEntry.loop.gainNode, fsEntry.loop.gain, isOccludedBetween(localListenerPos(), pos));
      }
    }
  }
}
