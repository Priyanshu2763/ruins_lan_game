// Real (procedural, not downloaded) red-dot and holographic sights — replaces the first free CC0
// models that were tried here (Pichuliru/Poly Pizza), which the user correctly called out as
// looking too crude/flat/"drawn by hand" next to a real optic. Built the same way as every other
// hand-crafted prop in this project (the grenade before the real M67 arrived, the banner/ivy
// textures, the crosshair, the muzzle flash) — a real shape with real PBR materials and a
// canvas-drawn reticle, not a placeholder. Both builders return an Object3D in SIGHT-LOCAL space:
// +X = the viewing axis (the shooter looks through the sight along +X, toward the muzzle,
// matching the gun's own barrel axis in gun-space — see characters.js's mountSight, which
// orients these onto the gun with no extra rotation needed), +Y = up, origin = base of the mount.
import * as THREE from 'three';

const HOUSING_MAT = new THREE.MeshStandardMaterial({ color: 0x131313, roughness: 0.55, metalness: 0.35 });
const HOUSING_MAT_LIGHT = new THREE.MeshStandardMaterial({ color: 0x232323, roughness: 0.45, metalness: 0.4 }); // rim/turret highlight, slightly lighter so the shape actually reads under flat lighting
const GLASS_MAT = new THREE.MeshPhysicalMaterial({ color: 0x8fb8c8, transparent: true, opacity: 0.22, roughness: 0.08, metalness: 0, transmission: 0.55, thickness: 0.01 });

// ---- Red dot reticle: a crisp, small, genuinely centered dot (the earlier version's glow
// sprite was fine in concept but the complaint was about the HOUSING/lens looking amateurish,
// not the dot itself — kept here, redrawn a little cleaner/smaller). ----
let redDotTex = null;
function redDotTexture() {
  if (redDotTex) return redDotTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 10);
  g.addColorStop(0, 'rgba(255,55,35,1)'); g.addColorStop(0.5, 'rgba(255,25,15,0.95)'); g.addColorStop(1, 'rgba(255,20,10,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  redDotTex = new THREE.CanvasTexture(c);
  return redDotTex;
}

// ---- Holo reticle: the circle-with-center-dot pattern real holographic sights (EOTech-style,
// matching the reference screenshots) project — drawn once, reused by every holo instance.
// Alpha-tested transparent background (same technique as the grass/ivy canvas textures already
// in this project) so only the reticle lines show against the glass, not a filled square.
let holoReticleTex = null;
function holoReticleTexture() {
  if (holoReticleTex) return holoReticleTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 256);
  x.strokeStyle = '#ff2a1a'; x.fillStyle = '#ff2a1a';
  x.shadowColor = 'rgba(255,40,20,0.9)'; x.shadowBlur = 6;
  x.lineWidth = 5;
  x.beginPath(); x.arc(128, 128, 62, 0, Math.PI * 2); x.stroke(); // outer ring
  x.beginPath(); x.arc(128, 128, 7, 0, Math.PI * 2); x.fill(); // center dot
  // four short tick marks off the ring, the detail that reads as "holo reticle" rather than a
  // plain circle at a glance (matches the reference screenshots' reticle silhouette)
  const ticks = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
  for (const a of ticks) {
    const x0 = 128 + Math.cos(a) * 74, y0 = 128 + Math.sin(a) * 74;
    const x1 = 128 + Math.cos(a) * 92, y1 = 128 + Math.sin(a) * 92;
    x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
  }
  holoReticleTex = new THREE.CanvasTexture(c);
  return holoReticleTex;
}

function mountBase(width, depth, height) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), HOUSING_MAT);
  m.position.set(0, height / 2, 0);
  return m;
}

// A real open-reflex red dot: a short tube (open both ends — you see straight through it, same
// as a real reflex sight) on a mount base, with a tinted glass lens at the front (the end nearer
// the shooter's eye) and the glowing dot sitting just behind that glass.
export function buildRedDotSight() {
  const g = new THREE.Group();
  const baseH = 0.014;
  g.add(mountBase(0.028, 0.05, baseH));

  const tubeR = 0.021, tubeLen = 0.05;
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(tubeR, tubeR * 1.08, tubeLen, 20, 1, true), HOUSING_MAT_LIGHT);
  tube.rotation.z = Math.PI / 2; // cylinder's default Y axis -> sight's X (viewing) axis
  tube.position.set(0, baseH + tubeR, 0);
  g.add(tube);
  // A thin rim at each end reads as the housing's real wall thickness, not a paper-thin tube
  for (const side of [-1, 1]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(tubeR, 0.003, 8, 20), HOUSING_MAT);
    rim.rotation.y = Math.PI / 2;
    rim.position.set(side * tubeLen / 2, baseH + tubeR, 0);
    g.add(rim);
  }
  const lens = new THREE.Mesh(new THREE.CircleGeometry(tubeR * 0.92, 24), GLASS_MAT);
  lens.rotation.y = Math.PI / 2;
  lens.position.set(-tubeLen / 2 + 0.002, baseH + tubeR, 0); // near end = the shooter's-eye side
  g.add(lens);

  const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: redDotTexture(), transparent: true, depthTest: true, blending: THREE.AdditiveBlending }));
  dot.scale.setScalar(0.01);
  dot.position.set(-tubeLen / 2 + 0.012, baseH + tubeR, 0);
  g.add(dot);

  g.userData.viewPoint = new THREE.Vector3(-tubeLen / 2 + 0.012, baseH + tubeR, 0); // where the reticle actually sits, for alignment/debugging
  return g;
}

// A holographic sight: a boxy housing with a large rounded-rectangular window open front AND
// back (the real, distinctive silhouette real holo sights — and the reference screenshots —
// have, unlike a red dot's round tube), the reticle rendered on the back glass.
export function buildHoloSight() {
  const g = new THREE.Group();
  const baseH = 0.016;
  g.add(mountBase(0.05, 0.07, baseH));

  const w = 0.056, h = 0.042, depth = 0.06, wallT = 0.008, r = 0.01;
  const bodyY = baseH + h / 2;
  // Frame built from 4 bars around a rounded-rect window (top/bottom/left/right), rather than a
  // solid box with a hole cut in it — the same "assemble the silhouette from simple pieces"
  // approach this project already uses (e.g. the diagonal cover wall) — reads correctly as an
  // open window without needing CSG.
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(w, wallT, depth), HOUSING_MAT);
  topBar.position.set(0, bodyY + h / 2 - wallT / 2, 0); g.add(topBar);
  const botBar = new THREE.Mesh(new THREE.BoxGeometry(w, wallT, depth), HOUSING_MAT);
  botBar.position.set(0, bodyY - h / 2 + wallT / 2, 0); g.add(botBar);
  const sideH = h - wallT * 2;
  const leftBar = new THREE.Mesh(new THREE.BoxGeometry(wallT, sideH, depth), HOUSING_MAT);
  leftBar.position.set(-w / 2 + wallT / 2, bodyY, 0); g.add(leftBar);
  const rightBar = new THREE.Mesh(new THREE.BoxGeometry(wallT, sideH, depth), HOUSING_MAT);
  rightBar.position.set(w / 2 - wallT / 2, bodyY, 0); g.add(rightBar);
  // Rounded corner posts (small cylinders) so the window silhouette reads as rounded-rect, not
  // a hard-cornered box, matching the reference sights' actual shape.
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(r, r, depth, 10), HOUSING_MAT);
    post.position.set(sx * (w / 2 - wallT / 2), bodyY + sy * (h / 2 - wallT / 2), 0);
    g.add(post);
  }
  // A solid base chassis under the window (real holo sights are noticeably boxier/taller below
  // the window than a red dot, housing the actual projector) — closes the bottom visually.
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(w * 0.86, baseH * 0.9, depth * 0.8), HOUSING_MAT_LIGHT);
  chassis.position.set(0, baseH + baseH * 0.45, 0);
  g.add(chassis);

  const winW = w - wallT * 2.4, winH = h - wallT * 2.4;
  const backGlass = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), GLASS_MAT);
  backGlass.rotation.y = Math.PI / 2;
  backGlass.position.set(-depth / 2 + 0.003, bodyY, 0);
  g.add(backGlass);
  const reticle = new THREE.Mesh(
    new THREE.PlaneGeometry(winW * 0.85, winH * 0.85),
    new THREE.MeshBasicMaterial({ map: holoReticleTexture(), transparent: true, alphaTest: 0.1, side: THREE.DoubleSide, depthWrite: false })
  );
  reticle.rotation.y = Math.PI / 2;
  reticle.position.set(-depth / 2 + 0.004, bodyY, 0);
  g.add(reticle);

  g.userData.viewPoint = new THREE.Vector3(-depth / 2 + 0.004, bodyY, 0);
  return g;
}
