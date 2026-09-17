import * as THREE from 'three';
import { WEAPONS } from '/shared/gameData.js';
import { state } from './state.js';
import { loadPhotoTexture } from './world.js';

const pickupToast = document.getElementById('pickupToast');

// ---------- Pickups: floating rotating markers, distinct per type/caliber so you can tell
// what's on the ground before walking over it. Stays real 3D box geometry (kept small, on
// purpose — this is a pickup crate on the floor, not a poster) with the caliber's real product
// photo textured onto the top face where one exists, falling back to a plain caption texture
// for calibers with no photo (12ga).
const pickupMeshes = new Map(); // idx -> mesh
const CALIBER_BODY_COLOR = { '7.62mm': 0x6b5a2a, '9mm': 0x54585c, '12ga': 0x5a2222 };
const CALIBER_LABEL_BG = { '7.62mm': '#c9a84a', '9mm': '#9aa0a6', '12ga': '#c94a4a' };
const ammoLabelTexCache = {};
function ammoLabelTexture(text) {
  if (ammoLabelTexCache[text]) return ammoLabelTexCache[text];
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = CALIBER_LABEL_BG[text] || '#c9a84a';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#141210';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 34);
  const tex = new THREE.CanvasTexture(c);
  ammoLabelTexCache[text] = tex;
  return tex;
}
function ammoBoxMesh(weapon) {
  // The photo is one of the crate's own six faces (the lid), not a flat plane floating
  // above a plain box — a genuine solid object with real depth/edges from every angle,
  // not a sticker glued on top of unrelated geometry.
  const caliber = weapon ? weapon.caliber : null;
  const sideColor = CALIBER_BODY_COLOR[caliber] || 0x6b5a2a;
  const sideMat = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.6, metalness: 0.3 });
  const bottomMat = new THREE.MeshStandardMaterial({ color: 0x2a2418, roughness: 0.8, metalness: 0.1 });
  const lidTex = weapon && weapon.ammoImage
    ? loadPhotoTexture(`/images/${weapon.ammoImage}`)
    : ammoLabelTexture(caliber || '?');
  const lidMat = new THREE.MeshStandardMaterial({ map: lidTex, roughness: 0.5, metalness: 0.15 });
  // BoxGeometry face material order: [+x, -x, +y(top), -y(bottom), +z, -z]
  const materials = [sideMat, sideMat, lidMat, bottomMat, sideMat, sideMat];
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.28), materials); // small crate, not a billboard
  return box;
}
function healthCrossMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xe84b4b, emissive: 0x6a1010, emissiveIntensity: 0.6, roughness: 0.4 });
  const a = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.13, 0.13), mat);
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.4, 0.13), mat);
  g.add(a, b);
  return g;
}
function grenadePickupMesh() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a4a2e, roughness: 0.5, metalness: 0.3 });
  return new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), mat);
}
function pickupMeshFor(p) {
  if (p.type === 'health') return healthCrossMesh();
  if (p.type === 'grenade') return grenadePickupMesh();
  const weapon = WEAPONS.find((w) => w.id === p.weaponId);
  return ammoBoxMesh(weapon);
}

export function syncPickups(list) {
  const seen = new Set();
  for (const p of list) {
    seen.add(p.idx);
    let mesh = pickupMeshes.get(p.idx);
    if (!mesh) {
      mesh = pickupMeshFor(p);
      mesh.position.set(p.pos[0], 0.9, p.pos[2]);
      state.scene.add(mesh);
      pickupMeshes.set(p.idx, mesh);
    }
  }
  for (const [idx, mesh] of pickupMeshes) {
    if (!seen.has(idx)) { state.scene.remove(mesh); pickupMeshes.delete(idx); }
  }
}

export function animatePickups(dt) {
  for (const mesh of pickupMeshes.values()) {
    mesh.rotation.y += dt * 1.4;
    mesh.position.y = 0.9 + Math.sin(performance.now() * 0.002 + mesh.id) * 0.12;
  }
}

let pickupToastTimer = null;
export function showPickupToast(text) {
  pickupToast.textContent = text;
  pickupToast.classList.add('show');
  clearTimeout(pickupToastTimer);
  pickupToastTimer = setTimeout(() => pickupToast.classList.remove('show'), 2200);
}
