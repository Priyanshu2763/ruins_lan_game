import * as THREE from 'three';
import { GRENADE_BLAST_RADIUS } from '/shared/gameData.js';
import { state } from './state.js';
import { sfx, dryPositionFor, applyOcclusionParams, isOccludedBetween, localListenerPos } from './audio.js';
import { createGrenade, setPinVisible } from './grenadeModel.js';
import { getMuzzleFlashTexture } from './weapons.js';

// ---------- Grenades: flying projectile meshes + explosion VFX ----------
// The thrown grenade is the real fragmentation-grenade model (grenadeModel.js) — no more red glowing
// cylinder/point light. It rolls as it travels, proportionally to the distance moved.
const grenadeMeshes = new Map(); // id -> { mesh, targetPos, tick }
const GRENADE_WORLD_SCALE = 0.11; // model body radius is 1 -> 11cm here: a little oversize so it reads at range, and sits on the ground properly

export function syncGrenades(list) {
  const seen = new Set();
  for (const g of list) {
    seen.add(g.id);
    let gm = grenadeMeshes.get(g.id);
    if (!gm) {
      const mesh = createGrenade(); // the M67 (or the built-in stand-in until it has loaded); shares geometry/materials, cheap
      setPinVisible(mesh, false); // a thrown grenade has already had its pin pulled
      mesh.scale.setScalar(GRENADE_WORLD_SCALE);
      mesh.position.set(g.pos[0], g.pos[1], g.pos[2]);
      state.scene.add(mesh);
      gm = { mesh, targetPos: new THREE.Vector3(), tick: null };
      grenadeMeshes.set(g.id, gm);
      // The full ticking-clock clip, once, the instant a grenade (yours or anyone else's)
      // first appears — GRENADE_FUSE_MS is set to this clip's exact length so it finishes
      // right as the server detonates it, not a repeating short beep for as long as any
      // grenade is live like before. The returned handle is kept on `gm` so updateGrenades can
      // keep its panner tracking the grenade's live position for the rest of the tick's ~3.6s.
      gm.tick = sfx.grenadeTick(g.pos);
    }
    gm.targetPos.set(g.pos[0], g.pos[1], g.pos[2]);
  }
  for (const [id, gm] of grenadeMeshes) {
    if (!seen.has(id)) { state.scene.remove(gm.mesh); grenadeMeshes.delete(id); }
  }
}

// Called once per frame from the bootstrap's animate() — lerps every live grenade toward its
// latest network position and keeps its ticking sound's panner tracking that same live position.
export function updateGrenades(dt) {
  for (const gm of grenadeMeshes.values()) {
    const before = gm.mesh.position.clone();
    gm.mesh.position.lerp(gm.targetPos, Math.min(1, dt * 12));
    // tumble: roll about the axis perpendicular to the direction of travel, by distance / radius
    const move = gm.mesh.position.clone().sub(before), dist = move.length();
    if (dist > 1e-5) {
      const axis = new THREE.Vector3(0, 1, 0).cross(move).normalize();
      if (axis.lengthSq() > 0.5) gm.mesh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, dist / (GRENADE_WORLD_SCALE * 1.4)));
    }
    if (gm.tick) {
      const p = gm.mesh.position;
      const pos = [p.x, p.y, p.z];
      gm.tick.wetPanner.positionX.value = p.x; gm.tick.wetPanner.positionY.value = p.y; gm.tick.wetPanner.positionZ.value = p.z;
      const dp = dryPositionFor(pos);
      gm.tick.dryPanner.positionX.value = dp[0]; gm.tick.dryPanner.positionY.value = dp[1]; gm.tick.dryPanner.positionZ.value = dp[2];
      // Repositioning every frame is cheap (a few AudioParam writes); the occlusion raycast
      // isn't free (O(wall count)), so it's throttled to ~5-6 times/sec instead of every frame
      // — plenty responsive for a grenade rolling past a corner, not wasted on frames where
      // nothing's changed enough to matter.
      const now = performance.now();
      if (now - (gm.tickOcclusionCheckedAt || 0) > 180) {
        gm.tickOcclusionCheckedAt = now;
        applyOcclusionParams(gm.tick.filter, gm.tick.gainNode, 1, isOccludedBetween(localListenerPos(), pos));
      }
    }
  }
}

function smokeSpriteTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(210,200,185,0.9)');
  g.addColorStop(0.5, 'rgba(140,130,115,0.55)');
  g.addColorStop(1, 'rgba(90,82,70,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
const smokeTex = smokeSpriteTexture();

// Respawn "beam-in" — light circles pulsing outward from the ground plus a soft glowing column,
// like a spaceship's tractor beam, synced to respawn.mp3 (~1.5s). Triggered from every incoming
// `respawn` broadcast (server already sends id/pos/health to the whole room, not just the
// respawning player), so anyone nearby sees a teammate or enemy visibly reappear, not just the
// player it happened to.
export function spawnRespawnEffect(pos) {
  sfx.respawnBeam(pos);
  const DURATION = 1500; // respawn.mp3's measured length
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x8fe8ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
  const ringGeo = new THREE.RingGeometry(0.55, 0.72, 40);
  const rings = [0, 140, 280].map((delay) => {
    const mat = ringMat.clone();
    const mesh = new THREE.Mesh(ringGeo, mat);
    mesh.rotation.x = -Math.PI / 2; // flat on the ground
    mesh.position.set(pos[0], pos[1] + 0.05, pos[2]);
    mesh.scale.setScalar(0.01);
    state.scene.add(mesh);
    return { mesh, mat, delay };
  });
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xcdfaff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.32, 2.6, 24, 1, true), beamMat);
  beam.position.set(pos[0], pos[1] + 1.3, pos[2]);
  state.scene.add(beam);

  const start = performance.now();
  (function anim() {
    const elapsed = performance.now() - start;
    let allDone = true;
    for (const r of rings) {
      const t = Math.max(0, Math.min(1, (elapsed - r.delay) / (DURATION - r.delay)));
      if (t < 1) allDone = false;
      r.mesh.scale.setScalar(0.4 + t * 3.2);
      r.mat.opacity = 0.85 * (1 - t);
    }
    const bt = Math.min(1, elapsed / DURATION);
    if (bt < 1) allDone = false;
    beamMat.opacity = 0.5 * (1 - bt);
    beam.scale.y = 1 + bt * 0.4;
    if (allDone) {
      for (const r of rings) { state.scene.remove(r.mesh); r.mat.dispose(); }
      ringGeo.dispose(); ringMat.dispose();
      state.scene.remove(beam); beam.geometry.dispose(); beamMat.dispose();
      return;
    }
    requestAnimationFrame(anim);
  })();
}

export function spawnExplosion(pos) {
  sfx.explosion(pos);
  // bright blast flash — additive, expands and fades fast
  const flashMat = new THREE.SpriteMaterial({
    map: getMuzzleFlashTexture(), transparent: true, depthTest: false, blending: THREE.AdditiveBlending, opacity: 1,
  });
  const flash = new THREE.Sprite(flashMat);
  flash.position.set(pos[0], pos[1] + 0.3, pos[2]);
  flash.scale.set(0.5, 0.5, 0.5);
  state.scene.add(flash);
  const flashStart = performance.now();
  (function animFlash() {
    const t = (performance.now() - flashStart) / 260;
    if (t >= 1) { state.scene.remove(flash); flashMat.dispose(); return; }
    const s = 0.5 + t * 7;
    flash.scale.set(s, s, s);
    flashMat.opacity = 1 - t;
    requestAnimationFrame(animFlash);
  })();

  // dust/smoke puffs — normal alpha blending (additive would make grey smoke look wrong), drift
  // outward and up, fading over ~1.4s.
  const puffCount = 16;
  const puffs = [];
  for (let i = 0; i < puffCount; i++) {
    const mat = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.85 });
    const s = new THREE.Sprite(mat);
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 1.2;
    s.position.set(pos[0] + Math.cos(a) * r, pos[1] + 0.2 + Math.random() * 0.6, pos[2] + Math.sin(a) * r);
    const scale0 = 0.6 + Math.random() * 0.5;
    s.scale.set(scale0, scale0, scale0);
    state.scene.add(s);
    puffs.push({
      sprite: s, mat,
      vel: new THREE.Vector3(Math.cos(a), 0.9 + Math.random() * 0.6, Math.sin(a)).multiplyScalar(1.2 + Math.random() * 1.6),
      life: 0, maxLife: 1.0 + Math.random() * 0.6, scale0,
    });
  }
  const smokeStart = performance.now();
  let lastT = smokeStart;
  (function animSmoke() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    let alive = false;
    for (const p of puffs) {
      p.life += dt;
      if (p.life >= p.maxLife) { if (p.sprite.parent) { state.scene.remove(p.sprite); p.mat.dispose(); } continue; }
      alive = true;
      p.vel.multiplyScalar(1 - Math.min(1, dt * 1.5)); // drag
      p.sprite.position.addScaledVector(p.vel, dt);
      const t = p.life / p.maxLife;
      const s = p.scale0 * (1 + t * 2.2);
      p.sprite.scale.set(s, s, s);
      p.mat.opacity = 0.85 * (1 - t);
    }
    if (alive) requestAnimationFrame(animSmoke);
  })();

  // a mild screen shake if the local player is close to the blast
  const local = new THREE.Vector3();
  state.camera.getWorldPosition(local);
  const dist = local.distanceTo(new THREE.Vector3(pos[0], pos[1], pos[2]));
  if (dist < GRENADE_BLAST_RADIUS * 1.4) {
    state.screenShake = Math.max(state.screenShake, (1 - dist / (GRENADE_BLAST_RADIUS * 1.4)) * 0.35);
  }
}
