// World-space weapon effects that are physically simulated: ejected casings and shotgun shells (with a
// bounce and a tiny clink where they land), muzzle smoke, and a magazine that falls out during a reload.
// Everything is pooled — an AKM on full auto ejects ~9 casings a second and must never allocate.
import * as THREE from 'three';
import { state } from './state.js';
import { sfx } from './audio.js';

const G = -9.8;
const flashes = []; // world muzzle flashes (other players' shots): {sprite, life, max, size}
let flashTex = null;
let inited = false;
const casings = [];   // {mesh, vel, spin, life, rested, kind}
const smokes = [];    // {sprite, vel, life, max, size}
const props = [];     // falling magazines etc: {obj, vel, spin, life, rested}
const caseGeo = { rifle: null, pistol: null, shell: null };
let brassMat, shellMat, shellBaseMat, smokeTex;

function init() {
  if (inited) return; inited = true;
  brassMat = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.85, roughness: 0.32 });
  shellMat = new THREE.MeshStandardMaterial({ color: 0xb02a22, roughness: 0.55 });
  shellBaseMat = new THREE.MeshStandardMaterial({ color: 0xd2b45a, metalness: 0.8, roughness: 0.35 });
  caseGeo.rifle = new THREE.CylinderGeometry(0.0055, 0.0068, 0.039, 8);
  caseGeo.pistol = new THREE.CylinderGeometry(0.0046, 0.0048, 0.019, 8);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(200,196,188,0.55)'); g.addColorStop(0.5, 'rgba(160,156,150,0.25)'); g.addColorStop(1, 'rgba(140,136,130,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  smokeTex = new THREE.CanvasTexture(c);
}

// A shotgun shell: red hull + brass head (also used as the "shell in hand" prop when reloading).
export function buildShellMesh() {
  init();
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.0095, 0.0095, 0.048, 10), shellMat); g.add(hull);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.0102, 0.0102, 0.02, 10), shellBaseMat); head.position.y = -0.03; g.add(head);
  g.rotation.z = Math.PI / 2; // lie along +X like the gun does
  const holder = new THREE.Group(); holder.add(g);
  return holder;
}

const groundY = () => (state.currentGroundY || 0);

export function spawnCasing(kind, pos, vel) {
  init();
  let c = casings.length < 36 ? null : casings.shift(); // recycle the oldest when the pool is full
  if (!c) {
    c = { mesh: null, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, rested: false, kind };
  }
  if (c.mesh) state.scene.remove(c.mesh);
  c.mesh = kind === 'shell' ? buildShellMesh() : new THREE.Mesh(caseGeo[kind], brassMat);
  c.kind = kind; c.mesh.position.copy(pos);
  c.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
  c.mesh.scale.setScalar(1);
  c.vel.copy(vel); c.spin.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
  c.life = 0; c.rested = false; c.bounces = 0;
  state.scene.add(c.mesh);
  casings.push(c);
}

// A short additive star flash at `pos` (another player's muzzle). Pooled like everything else here.
export function spawnMuzzleFlash(pos, size = 0.25) {
  init();
  if (!flashTex) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); x.translate(64, 64);
    const g = x.createRadialGradient(0, 0, 2, 0, 0, 62); g.addColorStop(0, 'rgba(255,250,215,1)'); g.addColorStop(0.35, 'rgba(255,205,110,0.85)'); g.addColorStop(1, 'rgba(255,140,40,0)');
    x.fillStyle = g; x.beginPath();
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, r = i % 2 ? 22 : 62; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    x.closePath(); x.fill(); flashTex = new THREE.CanvasTexture(c);
  }
  let f = flashes.length < 10 ? null : flashes.shift();
  if (!f) f = { sprite: new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })), life: 0, max: 0.06, size };
  f.sprite.position.copy(pos); f.life = 0; f.size = size; f.sprite.material.rotation = Math.random() * 6.28; f.sprite.material.opacity = 1;
  f.sprite.scale.setScalar(size);
  state.scene.add(f.sprite); flashes.push(f);
}

export function spawnSmoke(pos, dir, size = 0.12) {
  init();
  let s = smokes.length < 30 ? null : smokes.shift();
  if (!s) { s = { sprite: new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false })), vel: new THREE.Vector3(), life: 0, max: 1, size }; }
  s.sprite.material.opacity = 0.9; s.sprite.position.copy(pos);
  s.vel.copy(dir).multiplyScalar(0.5 + Math.random() * 0.5).add(new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.25 + Math.random() * 0.2, (Math.random() - 0.5) * 0.15));
  s.life = 0; s.max = 0.55 + Math.random() * 0.4; s.size = size * (0.8 + Math.random() * 0.5);
  s.sprite.scale.setScalar(s.size);
  state.scene.add(s.sprite);
  smokes.push(s);
}

// A physical prop dropped in the world (the spent magazine): `obj` must already carry its world transform.
export function dropProp(obj, vel, spin) {
  init();
  if (props.length >= 6) { const old = props.shift(); state.scene.remove(old.obj); }
  state.scene.add(obj);
  props.push({ obj, vel: vel.clone(), spin: spin.clone(), life: 0, rested: false, bounces: 0 });
}

export function updateWeaponFx(dt) {
  if (!inited) return;
  const gy = groundY();
  for (let i = casings.length - 1; i >= 0; i--) {
    const c = casings[i]; c.life += dt;
    if (!c.rested) {
      c.vel.y += G * dt; c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.y += c.spin.y * dt; c.mesh.rotation.z += c.spin.z * dt;
      const half = c.kind === 'shell' ? 0.01 : 0.006;
      if (c.mesh.position.y <= gy + half) {
        c.mesh.position.y = gy + half;
        if (Math.abs(c.vel.y) > 0.8 && c.bounces < 3) {
          if (c.bounces === 0) sfx.casingDrop(c.mesh.position, c.kind);
          c.vel.y *= -0.35; c.vel.x *= 0.6; c.vel.z *= 0.6; c.spin.multiplyScalar(0.6); c.bounces++;
        } else { c.rested = true; c.mesh.rotation.x = 0; c.mesh.rotation.z = c.kind === 'shell' ? c.mesh.rotation.z : Math.PI / 2; }
      }
    }
    if (c.life > 4) { const k = Math.max(0, 1 - (c.life - 4) / 1); c.mesh.scale.setScalar(k); }
    if (c.life > 5) { state.scene.remove(c.mesh); casings.splice(i, 1); }
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i]; f.life += dt; const k = f.life / f.max;
    if (k >= 1) { state.scene.remove(f.sprite); flashes.splice(i, 1); continue; }
    f.sprite.material.opacity = 1 - k; f.sprite.scale.setScalar(f.size * (1 - 0.3 * k));
  }
  for (let i = smokes.length - 1; i >= 0; i--) {
    const s = smokes[i]; s.life += dt; const k = s.life / s.max;
    if (k >= 1) { state.scene.remove(s.sprite); smokes.splice(i, 1); continue; }
    s.sprite.position.addScaledVector(s.vel, dt); s.vel.multiplyScalar(Math.pow(0.25, dt));
    s.sprite.material.opacity = 0.55 * (1 - k); s.sprite.scale.setScalar(s.size * (1 + k * 2.2));
  }
  for (let i = props.length - 1; i >= 0; i--) {
    const p = props[i]; p.life += dt;
    if (!p.rested) {
      p.vel.y += G * dt; p.obj.position.addScaledVector(p.vel, dt);
      p.obj.rotation.x += p.spin.x * dt; p.obj.rotation.y += p.spin.y * dt; p.obj.rotation.z += p.spin.z * dt;
      if (p.obj.position.y <= gy + 0.03) {
        p.obj.position.y = gy + 0.03;
        if (Math.abs(p.vel.y) > 1.2 && p.bounces < 2) { if (p.bounces === 0) sfx.casingDrop(p.obj.position, 'mag'); p.vel.y *= -0.25; p.vel.x *= 0.5; p.vel.z *= 0.5; p.spin.multiplyScalar(0.4); p.bounces++; }
        else { p.rested = true; }
      }
    }
    if (p.life > 6) { state.scene.remove(p.obj); props.splice(i, 1); }
  }
}
