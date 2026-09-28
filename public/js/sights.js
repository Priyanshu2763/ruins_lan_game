// Real red-dot and holographic sight models — replaces two earlier, weaker attempts (a first pass
// downloaded two cartoonish free CC0 models, a second pass hand-built simple procedural shapes;
// the user correctly rejected both as "trash"/"drawn by hand"). These are real, detailed FBX
// models the user sourced and dropped in (EOTECH+HWS+EXPS2.fbx — a real EOTech-style holographic
// sight, 13.7k tris; FBX-+Red+Dot+Sight.fbx — a real flip-up reflex/red-dot sight, ~2.3k tris,
// already split into RedDot_BodyLow/RedDot_GlassLow meshes). Both loaded as loose FBX with NO
// accompanying texture files (confirmed — searched every location they could plausibly be in),
// so their materials arrive as flat placeholder "UV-checker ID" colors (a saturated, distinct
// color per material name, meant for baking real textures downstream, not real appearance) —
// restyled here by material NAME into real matte-black/gunmetal PBR, same technique
// characters.js's restyleGunMaterials already uses for the gun FBX packs.
//
// Both models were rendered and measured (MeshNormalMaterial debug pass + top-down orientation
// check) before writing this: BOTH already use +X = toward the muzzle (matching the gun's own
// barrel axis, matching GUN_FIT's convention) and +Y = up — no extra rotation needed, only real-
// world-scale normalization from their measured bounding box (same GUN_FIT-style "measure, don't
// guess the source unit" approach) and recentering so the origin sits at the mount foot's
// bottom-center (so `characters.js`'s mountSight can position it exactly like the old procedural
// version, with zero other changes needed there).
import * as THREE from 'three';
import { FBXLoader } from '/vendor/three-examples/loaders/FBXLoader.js';

const URLS = { reddot: '/models/sights/reddot.fbx', holo: '/models/sights/holo.fbx' };
// Real-world target LENGTH (the model's own measured X-span maps to this) — a compact pistol
// reflex sight is genuinely much smaller than a rifle/shotgun holographic sight in real life;
// this is what "maintain the size ratio, don't put a big holo on the pistol" actually means
// mechanically: two believable absolute sizes, not one shape reused at two different scales.
const TARGET_LENGTH = { reddot: 0.065, holo: 0.135 };

// Real matte-black/gunmetal restyle, by material name — the two models don't share names (no
// overlap risk), so one shared table covers both. Names not listed here (there are none left
// unlisted, but a future model swap might have one) fall back to a plain dark plastic default.
const REAL_MATERIALS = {
  // EOTech holographic sight
  main_color: { color: 0x121212, roughness: 0.55, metalness: 0.3 },
  main_color_metalic: { color: 0x2a2a2c, roughness: 0.35, metalness: 0.75 },
  main_color_metalic_litt: { color: 0x3a3a3d, roughness: 0.3, metalness: 0.8 },
  screws_metal: { color: 0x4a4a4a, roughness: 0.4, metalness: 0.85 },
  screws_metal_2: { color: 0x555555, roughness: 0.4, metalness: 0.85 },
  cable: { color: 0x0a0a0a, roughness: 0.7, metalness: 0.1 },
  plastic: { color: 0x161616, roughness: 0.6, metalness: 0.1 },
  plastic_2: { color: 0x1c1c1c, roughness: 0.6, metalness: 0.1 },
  // Red dot sight
  RedDot: { color: 0x151515, roughness: 0.5, metalness: 0.4 },
};
const DEFAULT_MATERIAL = { color: 0x1a1a1a, roughness: 0.55, metalness: 0.3 };
// The actual glass panes (EOTech's "holo_glass", the red dot's "Glass") get a real tinted,
// semi-transparent optical-glass look instead of a flat color — the reticle itself is a SEPARATE
// overlay plane added in front of the glass (see addReticle below), not baked onto the glass's
// own UVs, since those UVs are the source model's own arbitrary layout and can't be trusted to
// map a canvas texture on straight.
const GLASS_NAMES = new Set(['holo_glass', 'Glass']);
// Real bug caught only by measuring (not eyeballing) the result: this used to build the glass
// replacement material WITHOUT preserving the original material's name — findGlassCenter (below)
// identifies the glass by name, so the reticle overlay was silently never added at all (no error,
// just missing geometry), which is what actually made the sights look "wrong" beyond just the
// mount-height bug — there was no dot/reticle floating in the lens at all, on either sight.
//
// A SECOND real bug, found from a live report ("switching guns makes the screen go blank white
// or black"): this originally used MeshPhysicalMaterial's `transmission` — a real, expensive
// three.js feature that requires copying the CURRENT framebuffer into a texture behind the
// scenes to fake refraction. That's fundamentally incompatible with this project's custom
// dual-pass render setup (world scene, then the separate first-person viewmodel scene rendered
// again over it with a manually-cleared depth buffer, see viewmodel.js's renderViewmodel) — the
// transmission pass's own internal render-target juggling collided with that manual state and
// blanked the canvas the instant a transmissive material actually entered the scene (i.e. the
// moment you switched TO the Glock/Shotgun, whose sight carries this material). Switched to a
// plain transparent MeshStandardMaterial — no framebuffer trickery, cannot conflict with the
// custom render pass — still reads as tinted glass via color+opacity alone.
const GLASS_MATERIAL = (name) => new THREE.MeshStandardMaterial({ name, color: 0x8fc4d8, transparent: true, opacity: 0.35, roughness: 0.15, metalness: 0.1 });

function restyleSightMaterials(obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const swap = (m) => {
      if (GLASS_NAMES.has(m.name)) return GLASS_MATERIAL(m.name);
      const def = REAL_MATERIALS[m.name] || DEFAULT_MATERIAL;
      return new THREE.MeshStandardMaterial({ ...def, name: m.name });
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
}

// ---- Reticles (unchanged from the previous procedural pass — these were never the part the
// user objected to; the housings were). Red dot: a small bright center dot. Holo: the circle +
// center-dot + tick-mark pattern real holographic sights (and the reference screenshots) show. ----
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
let holoReticleTex = null;
function holoReticleTexture() {
  if (holoReticleTex) return holoReticleTex;
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 256);
  x.strokeStyle = '#ff2a1a'; x.fillStyle = '#ff2a1a';
  x.shadowColor = 'rgba(255,40,20,0.9)'; x.shadowBlur = 6;
  x.lineWidth = 5;
  x.beginPath(); x.arc(128, 128, 62, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.arc(128, 128, 7, 0, Math.PI * 2); x.fill();
  for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    const x0 = 128 + Math.cos(a) * 74, y0 = 128 + Math.sin(a) * 74;
    const x1 = 128 + Math.cos(a) * 92, y1 = 128 + Math.sin(a) * 92;
    x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
  }
  holoReticleTex = new THREE.CanvasTexture(c);
  return holoReticleTex;
}

// Finds the real world-space center of whichever mesh/material actually represents the glass, so
// the reticle overlay lands exactly on it regardless of the source model's own geometry layout —
// measured directly rather than guessed, same principle as every other "don't guess, measure"
// placement in this project (gun grips, muzzle points, mount rails).
function findGlassCenter(root) {
  const box = new THREE.Box3();
  let found = false;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const glassIdx = mats.map((m, i) => (m.name && GLASS_NAMES.has(m.name) ? i : -1)).filter((i) => i >= 0);
    if (!glassIdx.length) return;
    const geo = o.geometry;
    const pos = geo.attributes.position;
    const groups = geo.groups.length ? geo.groups : [{ start: 0, count: (geo.index ? geo.index.count : pos.count), materialIndex: 0 }];
    const idx = geo.index ? geo.index.array : null;
    const v = new THREE.Vector3();
    for (const g of groups) {
      if (!glassIdx.includes(g.materialIndex)) continue;
      for (let i = g.start; i < g.start + g.count; i++) {
        const vi = idx ? idx[i] : i;
        v.fromBufferAttribute(pos, vi).applyMatrix4(o.matrixWorld);
        box.expandByPoint(v);
        found = true;
      }
    }
  });
  return found ? box.getCenter(new THREE.Vector3()) : null;
}

function addReticle(root, kind) {
  const center = findGlassCenter(root);
  if (!center) return; // shouldn't happen for either model, but never crash a sight over a decoration
  if (kind === 'reddot') {
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: redDotTexture(), transparent: true, depthTest: true, blending: THREE.AdditiveBlending }));
    dot.scale.setScalar(0.012);
    dot.position.copy(center);
    dot.name = 'ADS_RETICLE'; // findable for the reticle-alignment math in viewmodel.js
    root.add(dot);
  } else {
    const reticle = new THREE.Mesh(
      new THREE.PlaneGeometry(0.05, 0.05),
      new THREE.MeshBasicMaterial({ map: holoReticleTexture(), transparent: true, alphaTest: 0.1, side: THREE.DoubleSide, depthWrite: false })
    );
    reticle.rotation.y = Math.PI / 2; // face along the model's own +/-X (viewing axis) — matches the glass pane's own orientation (a vertical window facing down the barrel)
    reticle.position.copy(center);
    reticle.name = 'ADS_RETICLE';
    root.add(reticle);
  }
}

// Real bug, found from a live browser report: these FBX files were exported with material texture
// slots pointing at filenames (RedDot_Base_color.png, main_color_metalic_Roughness.png, etc.)
// that were never actually shipped with the models (see the file-level comment above — confirmed
// no accompanying textures exist anywhere) — FBXLoader tries to fetch every one of those on
// parse, which the browser reports as ~37 individual 404s. restyleSightMaterials() below already
// throws away and replaces EVERY material wholesale by name right after load, so none of those
// textures are ever actually used for anything — but the loader doesn't know that yet when it's
// mid-parse, so it fetches them anyway. Over a real network (this is served through a reverse
// proxy on the live domain, not raw localhost) ~37 doomed requests competing for the browser's
// small per-host connection pool alongside the REAL character/gun/hair fetches is exactly the
// kind of thing that can stall or starve those out on a slow connection — a plausible contributor
// to "sometimes on start or on refresh the gun/hands don't show", on top of the already-fixed
// Promise.all coupling bug. Fixed at the source with a LoadingManager.setURLModifier: any texture
// path FBXLoader tries to fetch under /models/sights/ is transparently redirected to a 1x1
// transparent data: URI instead of a real network request — no 404s, no wasted connections, and
// zero visual difference since that texture is discarded a moment later anyway.
const TRANSPARENT_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const sightManager = new THREE.LoadingManager();
sightManager.setURLModifier((url) => (/\/models\/sights\/.*\.(png|jpe?g|tga|bmp)$/i.test(url) ? TRANSPARENT_PIXEL : url));
const loader = new FBXLoader(sightManager);
const templates = {}; // 'reddot' | 'holo' -> normalized, restyled, reticle-equipped Object3D template
let loadPromise = null;

async function loadOne(key) {
  const raw = await loader.loadAsync(URLS[key]);
  raw.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(raw);
  const size = box.getSize(new THREE.Vector3());
  const s = TARGET_LENGTH[key] / size.x;
  restyleSightMaterials(raw);
  // Recenter so local origin = bottom-center of the mount foot (min Y, center X/Z of the
  // UNSCALED box) — same "outer wraps a positioned+scaled inner" shape normalizeGun uses for guns.
  const holder = new THREE.Group();
  raw.position.set(-box.getCenter(new THREE.Vector3()).x, -box.min.y, -box.getCenter(new THREE.Vector3()).z);
  holder.add(raw);
  holder.scale.setScalar(s);
  const outer = new THREE.Group();
  outer.add(holder);
  outer.updateMatrixWorld(true);
  addReticle(outer, key);
  return outer;
}

function loadSightTemplates() {
  if (!loadPromise) {
    loadPromise = Promise.all([loadOne('reddot'), loadOne('holo')]).then(([reddot, holo]) => {
      templates.reddot = reddot;
      templates.holo = holo;
    });
  }
  return loadPromise;
}

// Public API kept identical in shape to the previous procedural version so characters.js's
// mountSight needs no changes beyond awaiting readiness once, at template-load time (see
// characters.js's loadTemplate, which already awaits everything else the same way).
export async function preloadSights() { await loadSightTemplates(); }
export function buildRedDotSight() { return templates.reddot ? templates.reddot.clone(true) : new THREE.Group(); }
export function buildHoloSight() { return templates.holo ? templates.holo.clone(true) : new THREE.Group(); }
