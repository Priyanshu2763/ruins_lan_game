import * as THREE from 'three';
import { GLTFLoader } from '/vendor/three-examples/loaders/GLTFLoader.js';

// The game's grenade. Preferred: the real M67 model in /models/grenade (see loadM67 below). Until that file
// has loaded — and if it ever fails — a fragmentation ("pineapple") grenade built from primitives stands
// in, so a grenade is never invisible. Unit scale: the body radius is 1, the body spans y -1..1 and the fuse
// assembly rises to about y 1.55, so callers just scale the whole group. Origin = body centre, +Y up.
// The safety lever ("spoon") hugs the +X side and the pin ring sits on the -X side; `userData.pin`
// is the pin + ring so the first-person animation can pull it.
let bodyTex = null, bodyBump = null;
function bodyTextures() {
  if (bodyTex) return { map: bodyTex, bump: bodyBump };
  const W = 256, H = 256, COLS = 8, ROWS = 5;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const c = mk(), b = mk(), x = c.getContext('2d'), y = b.getContext('2d');
  x.fillStyle = '#56643a'; x.fillRect(0, 0, W, H);
  y.fillStyle = '#000'; y.fillRect(0, 0, W, H); // bump: grooves dark, raised cells light
  const cw = W / COLS, ch = H / ROWS, gap = 7;
  for (let r = 0; r < ROWS; r++) for (let q = 0; q < COLS; q++) {
    const px = q * cw + gap / 2, py = r * ch + gap / 2, w = cw - gap, h = ch - gap;
    // each raised cell: a lighter, slightly domed olive tile
    const g = x.createRadialGradient(px + w / 2, py + h / 2, 2, px + w / 2, py + h / 2, w * 0.75);
    g.addColorStop(0, '#6d7d4a'); g.addColorStop(1, '#4a5730');
    x.fillStyle = g; x.fillRect(px, py, w, h);
    const g2 = y.createRadialGradient(px + w / 2, py + h / 2, 1, px + w / 2, py + h / 2, w * 0.7);
    g2.addColorStop(0, '#fff'); g2.addColorStop(1, '#9a9a9a');
    y.fillStyle = g2; y.fillRect(px, py, w, h);
  }
  // worn paint / grime speckle
  for (let i = 0; i < 700; i++) {
    x.fillStyle = `rgba(${Math.random() < 0.5 ? '20,24,10' : '150,150,110'},${0.05 + Math.random() * 0.1})`;
    x.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  bodyTex = new THREE.CanvasTexture(c); bodyTex.colorSpace = THREE.SRGBColorSpace; bodyTex.anisotropy = 4;
  bodyBump = new THREE.CanvasTexture(b);
  for (const t of [bodyTex, bodyBump]) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; }
  return { map: bodyTex, bump: bodyBump };
}

const steel = (color, rough = 0.42, metal = 0.7) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function buildProceduralGrenade() {
  const g = new THREE.Group();
  const { map, bump } = bodyTextures();
  const profile = [[0.001, -1.0], [0.45, -0.99], [0.7, -0.9], [0.87, -0.72], [0.96, -0.45], [1.0, -0.15], [1.0, 0.15], [0.96, 0.45], [0.87, 0.7], [0.72, 0.88], [0.52, 0.98], [0.4, 1.02]]
    .map(([r, h]) => new THREE.Vector2(r, h));
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 32), new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 3.2, roughness: 0.6, metalness: 0.25 }));
  g.add(body);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.44, 0.26, 18), steel(0x2c2f31));
  neck.position.y = 1.13; g.add(neck);
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 18), steel(0x3b3e40, 0.38));
  head.position.y = 1.4; g.add(head);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.1, 18), steel(0x2a2c2e));
  cap.position.y = 1.6; g.add(cap);

  // safety lever: a plate curved to hug the body on the +X side, running up into a bar over the shoulder
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(1.045, 1.045, 1.5, 18, 1, true, Math.PI / 2 - 0.33, 0.66), steel(0x3c3f41, 0.4, 0.65));
  plate.material.side = THREE.DoubleSide; plate.position.y = -0.2; g.add(plate);
  const barLen = 1.05, bar = new THREE.Mesh(new THREE.BoxGeometry(0.2, barLen, 0.07), steel(0x3c3f41, 0.4, 0.65));
  bar.position.set(0.86, 0.95, 0); bar.rotation.z = -0.86; g.add(bar); // from the shoulder up over the fuse head
  const tip = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.34), steel(0x3c3f41, 0.4, 0.65));
  tip.position.set(0.28, 1.5, 0); g.add(tip);

  // pin through the head + the ring on the -X side
  const pinGroup = new THREE.Group();
  const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.8, 8), steel(0xb59a4a, 0.35, 0.85));
  pin.rotation.z = Math.PI / 2; pin.position.set(-0.05, 1.4, 0); pinGroup.add(pin);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 8, 20), steel(0xb59a4a, 0.35, 0.85));
  ring.rotation.y = Math.PI / 2; ring.position.set(-0.56, 1.36, 0); pinGroup.add(ring);
  pinGroup.name = 'GrenadePin';
  g.add(pinGroup);
  plate.name = 'GrenadeLever'; bar.name = 'GrenadeLever2'; tip.name = 'GrenadeLever3';
  return g;
}

// ---------- Real M67 model ----------
// "M67 Hand Grenade" by Loukey (https://sketchfab.com/Loukey), CC BY 4.0 — credited in the dashboard's
// Settings tab. One mesh in the file, but the pin ring, pin shaft and pin ends are separate islands of
// triangles, so the pin (ring + shaft + ends) is split out into its own group at load and can really be pulled.
// (The lever is fused to the body in the file, so it stays on.) Textures were downsized to 1024px (the 2048px originals were ~48 MB
// of GPU memory for a prop that's a few dozen pixels across).
const M67_URL = '/models/grenade/m67_hand_grenade.glb';
let m67 = null;
const readyCbs = [];
export function onGrenadeModelReady(fn) { if (m67) fn(); else readyCbs.push(fn); }
export function isM67Ready() { return !!m67; }

function splitIslands(scene) {
  let mesh = null;
  scene.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  if (!mesh) return false;
  const geo = mesh.geometry, pos = geo.attributes.position, index = geo.index;
  if (!index) return false;
  // weld vertices by position (UV seams duplicate vertices), then union-find over triangles
  const weld = new Int32Array(pos.count), keys = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    let id = keys.get(k); if (id === undefined) { id = keys.size; keys.set(k, id); } weld[i] = id;
  }
  const parent = Array.from({ length: keys.size }, (_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const ia = index.array;
  for (let t = 0; t < ia.length; t += 3) { const r = find(weld[ia[t]]); parent[find(weld[ia[t + 1]])] = r; parent[find(weld[ia[t + 2]])] = r; }
  const tris = new Map();
  for (let t = 0; t < ia.length; t += 3) { const r = find(weld[ia[t]]); let a = tris.get(r); if (!a) { a = []; tris.set(r, a); } a.push(ia[t], ia[t + 1], ia[t + 2]); }
  const islands = [...tris.values()].sort((a, b) => b.length - a.length);
  if (islands.length !== 5) return false; // not the model we tuned this for — leave it whole
  const [body, ...pinParts] = islands; // the safety lever is welded into the body island; the four small islands are the pin ring, shaft and ends
  const make = (arr, name) => {
    const g = new THREE.BufferGeometry();
    for (const n of Object.keys(geo.attributes)) g.setAttribute(n, geo.attributes[n]);
    g.setIndex(arr);
    const m = new THREE.Mesh(g, mesh.material); m.name = name;
    return m;
  };
  const parentNode = mesh.parent;
  const pin = new THREE.Group(); pin.name = 'GrenadePin';
  for (const arr of pinParts) pin.add(make(arr, 'pinPart'));
  parentNode.add(make(body, 'GrenadeBody'), pin);
  parentNode.remove(mesh);
  return true;
}

new GLTFLoader().loadAsync(M67_URL).then((gltf) => {
  const scene = gltf.scene;
  const split = splitIslands(scene);
  // Body radius 1, centred on the origin, so it's a drop-in for the procedural model's unit scale.
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const s = 1 / (Math.max(size.x, size.z) / 2);
  const root = new THREE.Group();
  scene.scale.setScalar(s);
  scene.position.copy(center.multiplyScalar(-s));
  root.add(scene);
  root.name = 'M67';
  root.userData.split = split; // (a plain boolean survives Object3D.clone's JSON copy)
  m67 = root;
  readyCbs.splice(0).forEach((fn) => fn());
}).catch((err) => console.error('grenade model load failed, keeping the built-in one:', err));

// A fresh grenade to put in the world / a hand: the M67 once loaded, the built-in stand-in before that.
export function createGrenade() {
  return (m67 || (proceduralTemplate ||= buildProceduralGrenade())).clone(true);
}
let proceduralTemplate = null;
// Pin pull, p 0..1: slides the pin out along its axis and hides it at the end.
export function setPinPull(grenade, p) {
  const pin = grenade.getObjectByName('GrenadePin'); if (!pin) return;
  pin.visible = p < 1;
  pin.position.y = grenade.name === 'M67' ? p * 2.2 : 0; // M67: raw model units along the pin axis; the built-in one just disappears
}
export function setPinVisible(grenade, v) { const pin = grenade.getObjectByName('GrenadePin'); if (pin) { pin.visible = v; pin.position.y = 0; } }
