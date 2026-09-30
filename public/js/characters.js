import * as THREE from 'three';
import { GLTFLoader } from '/vendor/three-examples/loaders/GLTFLoader.js';
import { FBXLoader } from '/vendor/three-examples/loaders/FBXLoader.js';
import { clone as cloneSkinned } from '/vendor/three-examples/utils/SkeletonUtils.js';
import { state } from './state.js';
import { setupDressAssets, dressFigure, BODY_MATERIAL } from './dress.js';
import { guestAppearance, sanitizeAppearance } from '/shared/appearance.js';
import { playPositionalLoopStart, dryPositionFor, applyOcclusionParams, isOccludedBetween, localListenerPos } from './audio.js';
import { QUAT_TO_MIXAMO } from './retarget.js';
import { isOperatorId, canStripClothes, loadOperator, getLoadedOperator } from './operators.js';
import { buildRedDotSight, buildHoloSight, preloadSights } from './sights.js';

// Real assets (Quaternius, CC0 — see CLAUDE.md for the batch that added these) replacing the
// old stacked-BoxGeometry figure: a rigged/animated humanoid + a shared animation library +
// per-weapon FBX gun models, all sharing the same "Universal" bone naming (hand_r, Head, etc.)
// which is what lets one animation library drive this specific character with zero remapping.
const CHARACTER_URLS = { male: '/models/character/Superhero_Male_FullBody.gltf', female: '/models/character/Superhero_Female_FullBody.gltf' };
const HAIR_FILES = ['Hair_Buzzed', 'Hair_BuzzedFemale', 'Hair_SimpleParted', 'Hair_Long', 'Hair_Buns', 'Hair_Beard'];
const SKIN_TEXTURE_URLS = { male: '/models/character/T_Skin_Male_Neutral.png', female: '/models/character/T_Skin_Female_Neutral.png' };
const ANIMATIONS_URL = '/models/animations/animations.glb';
// Keyed by WEAPONS[].id (see shared/gameData.js) — 0 AKM, 1 Shotgun, 2 Glock, 3 Combat Knife.
const GUN_URLS = { 0: '/models/guns/akm.fbx', 1: '/models/guns/shotgun.fbx', 2: '/models/guns/glock.fbx', 3: '/models/guns/knife.fbx' };
// Optics for ADS (see viewmodel.js's AIM poses) — real procedural sights (sights.js), not a
// downloaded asset: the first attempt used free CC0 models (Pichuliru, Poly Pizza) but they read
// as crude/flat next to a real optic, so these were hand-built instead with real housing shapes
// and canvas-drawn reticles, same technique as every other hand-crafted prop in this project. The
// AKM uses its own molded iron sight (already part of its single fused mesh, see GUN_FIT's
// comment) — no attachment needed.
// weaponId -> which sight mounts on it, how far along the barrel (0=butt/grip .. 1=muzzle,
// same fraction convention GUN_FIT.grip already uses) and how high above the gun's own top
// surface. First-pass estimates, tuned by rendering the actual result (see normalizeGun below).
const SIGHT_MOUNTS = {
  // scale is 1.0 for both now — sights.js's TARGET_LENGTH already normalizes each model to a
  // real-world size (the old non-1.0 fudge factors were tuned against the earlier procedural
  // shapes' own arbitrary internal units, not applicable to these real, real-world-scaled models).
  1: { build: buildHoloSight, mountFrac: 0.42, gap: 0.006, scale: 1.0 }, // Shotgun — receiver-top rail
  2: { build: buildRedDotSight, mountFrac: 0.55, gap: 0.004, scale: 1.0 }, // Glock — slide-top rail
};

// The FBX guns arrive ~100x too large (the AKM measures 310 units long against a ~0.9m rifle) and
// with their origin at the stock end. Sizing from the MEASURED bounding box, rather than a
// hardcoded scale factor, means it stays correct whichever unit each file was exported in.
// `length` is the real-world target (barrel axis = the model's X), `grip` is how far along that
// length (0 = butt, 1 = muzzle) the hand should hold it.
// `slim` scales the gun's height and width (not its length): the pack's guns are chunky next to this
// slim body — a fat receiver and a deep magazine read as toy-sized props — so they're trimmed down.
const GUN_FIT = {
  0: { length: 0.84, grip: 0.3, slim: 0.72 },
  1: { length: 0.95, grip: 0.3, slim: 0.78 },
  2: { length: 0.19, grip: 0.15, slim: 0.82 },
  // Real bug, found from a live report ("the knife has disappeared from gameplay") — it hadn't
  // disappeared, it was rendering at roughly a TENTH of its intended size: measured directly
  // (a debug material + scale override on a live figure), the knife at its old `length: 0.3` was
  // a barely-visible speck; forcing a 5x scale override made it read as a properly-sized, clearly
  // held blade. The other three guns' own `length` values all render correctly at face value —
  // this looks specific to something in the knife's own FBX (traced as far as a raw mesh-level
  // scale of 100 buried inside it, an order of magnitude beyond what `normalizeGun`'s own
  // `s = length/size.x` calculation should need to fully correct for, though the exact internal
  // cause wasn't fully isolated under time pressure). Fixed pragmatically and verified visually:
  // scaled the target length up to compensate, checked by rendering the result directly rather
  // than assuming the multiplier was exactly right.
  3: { length: 0.9, grip: 0.1, slim: 1 },
};
// The FBX guns ship with near-black Phong colours (#070707 … #1d1e20) that read as flat silhouettes
// up close (the first-person view) — re-skin them as lit gunmetal/wood, keyed on the pack's own
// material names so every part keeps its role (barrel vs furniture vs grip).
const GUN_MATERIALS = {
  Wood: { color: 0x6b4630, metalness: 0.0, roughness: 0.7 },
  DarkWood: { color: 0x452f20, metalness: 0.0, roughness: 0.72 },
  Black: { color: 0x2c2d30, metalness: 0.3, roughness: 0.48 },
  Black2: { color: 0x202123, metalness: 0.3, roughness: 0.5 },
  DarkMetal: { color: 0x3b3e43, metalness: 0.45, roughness: 0.42 },
  Metal: { color: 0x585c62, metalness: 0.5, roughness: 0.38 },
  LightMetal: { color: 0x7d8288, metalness: 0.55, roughness: 0.36 },
  LightMetal2: { color: 0xa3a8ae, metalness: 0.6, roughness: 0.3 },
};
function restyleGunMaterials(obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const swap = (m) => { const def = GUN_MATERIALS[m.name]; return def ? new THREE.MeshStandardMaterial({ ...def, name: m.name }) : m; };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
}
// ---- Splitting a gun into animatable parts ----
// Each FBX gun is ONE mesh, but it is really a set of separate islands of triangles (the same trick used for
// the grenade pin). Islands are classified by where they sit inside the gun's bounding box (fractions of its
// length/height, so it is independent of the FBX unit): the Glock's slide (with its sights and serrations),
// the shotgun's pump, the AKM's magazine. Anything not classified stays in the fixed body.
const PART_RULES = {
  // AKM: the magazine is the island reaching the very bottom
  0: (isl, all) => (isl === all.lowest && isl.tris >= 60 && isl.tris <= 140 ? 'mag' : null),
  // Shotgun: the pump/fore-end is the biggest island
  1: (isl, all) => (isl === all.biggest ? 'pump' : null),
  // Glock: everything sitting above the frame's top edge, except the barrel (a 60-90 tri island in the front quarter)
  2: (isl) => (isl.fy0 >= 0.70 && !(isl.fx0 > 0.75 && isl.tris >= 60 && isl.tris <= 90) ? 'slide' : null),
};
function splitGunParts(obj, weaponId, box, size) {
  const rule = PART_RULES[weaponId]; if (!rule) return;
  let mesh = null; obj.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  if (!mesh) return;
  const geo = mesh.geometry, pos = geo.attributes.position;
  const ia = geo.index ? geo.index.array : Array.from({ length: pos.count }, (_, i) => i);
  // weld by position, union-find over triangles
  const keys = new Map(), weld = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) { const k = `${Math.round(pos.getX(i) * 100)},${Math.round(pos.getY(i) * 100)},${Math.round(pos.getZ(i) * 100)}`; let id = keys.get(k); if (id === undefined) { id = keys.size; keys.set(k, id); } weld[i] = id; }
  const par = Array.from({ length: keys.size }, (_, i) => i);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let t = 0; t < ia.length; t += 3) { const r = find(weld[ia[t]]); par[find(weld[ia[t + 1]])] = r; par[find(weld[ia[t + 2]])] = r; }
  const byRoot = new Map();
  for (let t = 0; t < ia.length; t += 3) { const r = find(weld[ia[t]]); let a = byRoot.get(r); if (!a) { a = []; byRoot.set(r, a); } a.push(t); }
  mesh.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const islands = [...byRoot.values()].map((tris) => {
    const b = new THREE.Box3();
    for (const t of tris) for (let k = 0; k < 3; k++) { v.fromBufferAttribute(pos, ia[t + k]).applyMatrix4(mesh.matrixWorld); b.expandByPoint(v); }
    return { tris: tris.length, triStarts: tris, fx0: (b.min.x - box.min.x) / size.x, fy0: (b.min.y - box.min.y) / size.y, box: b };
  });
  const all = { biggest: islands.reduce((a, b) => (b.tris > a.tris ? b : a)), lowest: islands.reduce((a, b) => (b.box.min.y < a.box.min.y ? b : a)) };
  const groupsOf = geo.groups.length ? geo.groups : [{ start: 0, count: ia.length, materialIndex: 0 }];
  const matOfTri = (t) => { for (const g of groupsOf) if (t >= g.start && t < g.start + g.count) return g.materialIndex; return 0; };
  const named = new Map(); // part name -> triangle starts
  const bodyTris = [];
  for (const isl of islands) { const n = rule(isl, all); if (n) { (named.get(n) || named.set(n, []).get(n)).push(...isl.triStarts); } else bodyTris.push(...isl.triStarts); }
  if (!named.size) return;
  // Build a mesh from a list of triangles, keeping each triangle's material (the geometry is grouped per material).
  const make = (starts, name) => {
    const byMat = new Map();
    for (const t of starts) { const m = matOfTri(t); (byMat.get(m) || byMat.set(m, []).get(m)).push(ia[t], ia[t + 1], ia[t + 2]); }
    const idx = [], groups = [];
    for (const [m, arr] of byMat) { groups.push({ start: idx.length, count: arr.length, materialIndex: m }); idx.push(...arr); }
    const g = new THREE.BufferGeometry();
    for (const n of Object.keys(geo.attributes)) g.setAttribute(n, geo.attributes[n]);
    g.setIndex(idx); groups.forEach((gr) => g.addGroup(gr.start, gr.count, gr.materialIndex));
    const m = new THREE.Mesh(g, mesh.material);
    m.name = name; m.position.copy(mesh.position); m.quaternion.copy(mesh.quaternion); m.scale.copy(mesh.scale);
    return m;
  };
  const parent = mesh.parent;
  parent.add(make(bodyTris, 'GunBody'));
  for (const [n, starts] of named) {
    const part = make(starts, `GunPart_${n}`);
    // the part's own centre (in obj-local coordinates) — where a hand should grab it
    part.geometry.computeBoundingBox();
    const c = part.geometry.boundingBox.getCenter(new THREE.Vector3());
    partCenters.set(part, c);
    parent.add(part);
  }
  parent.remove(mesh);
}
const partCenters = new WeakMap(); // part mesh -> centre in its own (obj-local) coordinates

// Mounts a red-dot/holo sight (SIGHT_MOUNTS) onto a gun's rail — attached to `outer` (not
// `holder`, which carries the gun's own non-uniform `fit.slim` squash) so the sight's own
// proportions aren't stretched by that. Position is computed directly in real-world meters from
// the SAME numbers normalizeGun already has (`s`, `fit`, `size`) rather than guessed constants,
// so it stays correct if GUN_FIT/SIGHT_MOUNTS get retuned later. sights.js's builders already
// return their own real-world-scale geometry with +X as the viewing axis (matching the gun's own
// +X/barrel axis) and origin at the mount's base — no extra rotation needed, just position.
function mountSight(outer, weaponId, s, fit, size) {
  const mount = SIGHT_MOUNTS[weaponId];
  if (!mount) return;
  const sight = mount.build();
  const topY = s * fit.slim * size.y / 2; // gun's own top surface in outer-local meters (see normalizeGun's own comment on this derivation)
  sight.scale.setScalar(mount.scale);
  sight.position.set(fit.length * mount.mountFrac, topY + mount.gap, 0);
  sight.name = 'ADS_SIGHT'; // findable for the reticle-alignment math in viewmodel.js
  outer.add(sight);
}

function normalizeGun(obj, fit, weaponId) {
  restyleGunMaterials(obj);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  splitGunParts(obj, weaponId, box, size);
  const s = fit.length / size.x;
  const holder = new THREE.Group();
  obj.position.set(-(box.min.x + size.x * fit.grip), -center.y, -center.z);
  holder.add(obj);
  holder.scale.set(s, s * fit.slim, s * fit.slim);
  const outer = new THREE.Group();
  outer.add(holder);
  mountSight(outer, weaponId, s, fit, size);
  return outer;
}

// Orientation that makes a gun's barrel (+X) point model-forward with the sights up, expressed in
// hand_r's own frame. The vectors are hand_r's forward/up/side directions MEASURED from the rig in
// its idle pose (headless-Chrome render + bone-axis dump), not guessed: in that frame the bone's +Y
// runs down the arm toward the fingers. Used for the knife (held in the right hand only) and to
// orient the right hand around a rifle/pistol grip.
const GUN_IN_HAND_QUAT = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0.004, 0.411, 0.911).normalize(),   // gun X (barrel)  -> model forward
    new THREE.Vector3(0.160, -0.900, 0.405).normalize(),  // gun Y (sights)  -> model up
    new THREE.Vector3(0.986, 0.144, -0.069).normalize(),  // gun Z           -> the remaining axis
  ),
);
const GUN_IN_HAND_QUAT_INV = GUN_IN_HAND_QUAT.clone().invert();
const GUN_IN_HAND_OFFSET = new THREE.Vector3(0.0, 0.07, 0.03); // grip point relative to the wrist bone, in hand space

// Two-handed stance. "Model frame" = +Z forward, +Y up, the character's right side is -X. The
// gun rides an anchor that follows the chest bone's position (not its rotation), and both arms are
// solved to the gun's grip points every frame (updateFigure). Arms are only ~0.545 long, so the
// gun has to sit close in at chest/shoulder height or the left hand can't reach the handguard.
const AIM_POS = new THREE.Vector3(-0.13, 1.36, 0.30);      // where the gun's grip point sits
const AIM_FORWARD = new THREE.Vector3(0, 0.02, 1).normalize();
const ELBOW_POLE = { r: new THREE.Vector3(-0.4, -1, -0.4), l: new THREE.Vector3(0.4, -1, -0.4) }; // elbows down + out
// Grip points in gun space (barrel = +X, sights = +Y). Only weapons listed here are held two-handed.
const GRIPS = {
  0: { right: new THREE.Vector3(0, -0.034, 0), left: new THREE.Vector3(0.13, -0.034, 0) },   // AKM: handguard
  1: { right: new THREE.Vector3(0, -0.036, 0), left: new THREE.Vector3(0.19, -0.032, 0) },   // Shotgun: pump
  2: { right: new THREE.Vector3(0, -0.043, 0), left: new THREE.Vector3(0.02, -0.065, 0) },   // Glock: cupped support hand
};
// Prone: the whole rig is laid flat by rotating the outer group, so in model space "the way the
// body faces" (+Z) now points at the ground and the head points along +Y. The gun has to be aimed
// along the body axis (+Y) with its sights toward the character's back (-Z), placed ahead of the
// chest so the stock sits by the shoulder and the muzzle clears the head; elbows go out to the
// sides and down toward the ground (+Z).
const AIM_POS_PRONE = new THREE.Vector3(-0.16, 1.8, -0.15);
const AIM_FORWARD_PRONE = new THREE.Vector3(0, 1, 0);
const AIM_UP_PRONE = new THREE.Vector3(0, 0, -1);
const ELBOW_POLE_PRONE = { r: new THREE.Vector3(-1, -0.2, 0.5), l: new THREE.Vector3(1, -0.2, 0.5) };
const PALM_OFFSET = 0.07; // wrist bone -> palm centre, along the fingers

const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();

let template = null; // { scene, clips: Map<name, AnimationClip>, guns: Map<weaponId, Object3D> }
const readyCallbacks = [];
function onceReady(fn) {
  if (template) fn();
  else readyCallbacks.push(fn);
}

async function loadTemplate() {
  const gunIds = Object.keys(GUN_URLS).map(Number);
  const texLoader = new THREE.TextureLoader();
  const loadSkin = (url) => texLoader.loadAsync(url).then((t) => {
    t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  });
  const [maleGltf, femaleGltf, animGltf, maleSkin, femaleSkin, ...rest] = await Promise.all([
    gltfLoader.loadAsync(CHARACTER_URLS.male),
    gltfLoader.loadAsync(CHARACTER_URLS.female),
    gltfLoader.loadAsync(ANIMATIONS_URL),
    loadSkin(SKIN_TEXTURE_URLS.male),
    loadSkin(SKIN_TEXTURE_URLS.female),
    ...gunIds.map((id) => fbxLoader.loadAsync(GUN_URLS[id])),
    ...HAIR_FILES.map((f) => gltfLoader.loadAsync(`/models/character/hair/${f}.gltf`)),
  ]);
  // Real regression, found from a live report: preloadSights() used to be IN the Promise.all
  // above, coupling the whole character/gun template to two extra FBX loads that have nothing to
  // do with it — any failure there (or even just being slow) took down guns/hands entirely,
  // exactly the "game was fine before today" report. Sights are a cosmetic attachment; loading
  // them can never be allowed to block or break the base character/gun template again. Own
  // isolated try/catch — on failure, guns simply build without a mounted sight (mountSight
  // already no-ops safely if the sight template isn't ready, see below) instead of the entire
  // player disappearing.
  try {
    await preloadSights();
  } catch (err) {
    console.error('sight model load failed — guns will render without sight attachments:', err);
  }
  const gunObjs = rest.slice(0, gunIds.length);
  const hairs = rest.slice(gunIds.length, gunIds.length + HAIR_FILES.length);
  const clips = new Map();
  for (const clip of animGltf.animations) clips.set(clip.name, clip);
  const guns = new Map();
  gunIds.forEach((id, i) => guns.set(id, normalizeGun(gunObjs[i], GUN_FIT[id], id)));
  setupDressAssets({
    chars: { male: maleGltf.scene, female: femaleGltf.scene },
    hairGltfs: Object.fromEntries(HAIR_FILES.map((f, i) => [f, hairs[i]])),
    skinTextures: { male: maleSkin, female: femaleSkin },
  });
  template = { scenes: { male: maleGltf.scene, female: femaleGltf.scene }, clips, guns };
  readyCallbacks.splice(0).forEach((fn) => fn());
}
// Fired once at module load, same pattern as audio.js's sound preloading — by the time a player
// gets through auth + the dashboard + actually joins a room, this (a ~20MB one-time local fetch)
// is essentially always finished. Every consumer below still guards against the rare case it
// isn't, rather than assuming.
//
// Real bug found via a user report ("sometimes on start or on refresh the gun and hand
// disappear"): loadTemplate() fires ~15 requests in ONE Promise.all (2 character glTFs, 1
// animation glb, 2 skin textures, 4 gun FBXs, 6 hair glTFs) — Promise.all rejects the INSTANT any
// single one does, and the old code just swallowed that into a console.error with zero retry,
// permanently leaving templateReady false (so rebuild() no-ops forever, see its own comment) for
// the rest of that page's life. A flaky connection dropping even one of those 15 parallel
// requests was enough to break the viewmodel/remote figures entirely until a lucky reload. Now
// retries the WHOLE batch up to 3 times with a short backoff before actually giving up.
// Attempt cap raised 3 -> 6 (and reflected below in operators.js's own retry) after a live
// report of the exact same "gun/hand invisible at match start" symptom recurring while testing
// over a real mobile connection (the Android app) — a short, fixed retry window that's plenty
// forgiving on a stable desktop/LAN connection can still exhaust itself on a phone's flakier,
// slower network before the fetch ever succeeds. Backoff is unchanged (attempt*1500ms), so this
// only extends the total window (up to ~9s longer), not how eagerly it retries.
async function loadTemplateWithRetry(attempt = 1) {
  try {
    await loadTemplate();
  } catch (err) {
    console.error(`character/weapon model load failed (attempt ${attempt}/6):`, err);
    if (attempt >= 6) return;
    await new Promise((r) => setTimeout(r, attempt * 1500));
    return loadTemplateWithRetry(attempt + 1);
  }
}
loadTemplateWithRetry();

export function isCharacterTemplateReady() { return !!template; }
export function onCharacterTemplateReady(fn) { onceReady(fn); }
// Exposed so the dashboard preview widget (preview.js) can play a named clip on its own
// standalone figure — same clip library every in-game remote figure draws from.
export function getCharacterAnimationClip(name) { return template ? template.clips.get(name) || null : null; }
// Same lookup, but from a specific FIGURE's own clip source — needed for operator figures, whose
// retargeted clips live on that operator's own template, not the shared Quaternius one.
export function getFigureAnimationClip(fig, name) { return fig && fig.clipsSource ? fig.clipsSource.get(name) || null : null; }

// Builds one player's figure by cloning the shared template — SkeletonUtils' `clone` (not a
// plain Object3D.clone) is required for a skinned/rigged mesh, since a naive clone leaves the
// skeleton bound to the ORIGINAL shared bones, which would make every cloned player move
// together. Exported so the dashboard's Play/Character preview widget (preview.js) can build
// the exact same figure a real remote player uses. Returns null if the template hasn't finished
// loading yet — callers (createRemote below, preview.js) handle that via onCharacterTemplateReady.
// Builds the aim-anchor + attaches all 4 held-gun instances — shared by both body types (Quaternius
// "Custom" and the operator/Mixamo bodies), since neither piece cares which skeleton it's sitting on
// beyond the bone OBJECTS it's handed. `boneNames`, if given, maps this function's internal logical
// keys (spine_03, upperarm_r, ...) to the real bone names to look up on `model` — omitted for the
// Quaternius bodies, whose real names already match those keys directly.
function attachAimAndGuns(model, boneNames) {
  // Operator bodies are height-normalized via model.scale (a small fraction, ~0.01 — their raw FBX
  // arrives at real-world centimeters, so bringing a ~175-220 unit tall model down to our ~1.82 game
  // units needs a real scale, unlike the Quaternius bodies whose geometry is already authored at
  // game scale and never gets model.scale touched at all). Every fixed constant below (AIM_POS,
  // GUN_IN_HAND_OFFSET) was tuned assuming "1 local unit = 1 game unit", which model.scale breaks
  // for anything parented under `model` — found two real symptoms of this: the aim target ended up
  // ~1.4 units from the shoulder (physically unreachable for a ~0.55-long arm, visible as the IK
  // maxing out with the hand nowhere near the gun) and the held gun itself rendered ~100x too small
  // (measured directly: 0.0085 units long instead of the intended 0.84). `worldScale` compensates
  // both: position constants get divided by it before use, and every held gun/prop gets its own
  // scale multiplied by its inverse, canceling the inherited shrink so it renders at its actual
  // fitted size regardless of which body it's attached to. 1 for the Quaternius bodies (their
  // model.scale is never touched), so this is a no-op there.
  const worldScale = model.scale.x;
  const bones = {};
  for (const n of ['spine_01', 'spine_02', 'spine_03', 'upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l', 'hand_l', 'neck_01', 'Head', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r', 'pelvis']) bones[n] = model.getObjectByName(boneNames ? boneNames[n] : n);
  // Real bug found here via live debugging (not just a style nit): matrixWorld on a freshly built/
  // cloned Object3D tree defaults to identity until updateMatrixWorld() actually runs once — so
  // without this call, every getWorldQuaternion() below would read garbage identity-derived values
  // instead of the real bind pose, which is exactly what was happening (confirmed by instrumenting
  // the live dashboard preview: an earlier "corrected head" attempt came back as a near-180°
  // rotation, nothing like a small forward-lean fix).
  model.updateMatrixWorld(true);
  // Crouch upper-body fix (see updateFigure): user's explicit direction after two failed attempts at
  // correcting just the head — "dont bend the upper part when crouching just the below half keep the
  // upper body straight." Captured here, once, before any clip ever plays: the bind-pose LOCAL
  // rotation of every upper-body joint from the hips up (spine_01/02/03, neck_01, Head) — reset to
  // these every frame while crouching so the whole upper body (torso, shoulders, neck, head, and by
  // extension the gun riding the chest) stays in its natural standing orientation; only the legs
  // (thigh/calf/foot, untouched here) actually do the crouching, dropping the character's height.
  const upperBodyBindQ = {};
  for (const n of ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head']) upperBodyBindQ[n] = bones[n] && bones[n].quaternion.clone();
  // The pelvis's own bind-pose LOCAL Y (its neutral standing height). Not currently read anywhere —
  // an early attempt at the crouch ground-clamp in updateFigure used this to force the hip down to a
  // fixed fraction of it, which over-corrected (pushed feet below ground, see updateFigure's own
  // history comment on the crouch clamp for the full story); replaced with a measured-foot-vs-ground
  // approach that doesn't need this. Left captured since it's cheap and may be useful again.
  const pelvisBindLocalY = bones.pelvis ? bones.pelvis.position.y : null;

  // Aim anchor: a group whose ORIENTATION is fixed relative to the character (forward, or along
  // the body when prone) and whose POSITION follows the chest bone (see updateFigure). Parenting
  // it to the chest bone outright made the barrel point at the floor whenever a clip pitched the
  // torso forward (the crouch).
  const aim = new THREE.Group();
  let aimStand = null, aimProne = null, spineBindQ = null;
  if (bones.spine_03) {
    model.updateMatrixWorld(true);
    const spineBind = model.worldToLocal(bones.spine_03.getWorldPosition(new THREE.Vector3()));
    const mk = (pos, forward, upHint) => {
      const f = forward.clone().normalize(), up = upHint.clone();
      up.addScaledVector(f, -up.dot(f)).normalize();
      return {
        quat: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(f, up, new THREE.Vector3().crossVectors(f, up))),
        offset: pos.clone().sub(spineBind),
      };
    };
    aimStand = mk(AIM_POS.clone().divideScalar(worldScale), AIM_FORWARD, new THREE.Vector3(0, 1, 0));
    aimProne = mk(AIM_POS_PRONE.clone().divideScalar(worldScale), AIM_FORWARD_PRONE, AIM_UP_PRONE);
    spineBindQ = model.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(bones.spine_03.getWorldQuaternion(new THREE.Quaternion()));
    aim.quaternion.copy(aimStand.quat);
    aim.position.copy(AIM_POS);
    model.add(aim);
  }

  // One clone of each weapon, swapped by visibility. Rifles/pistol ride the aim anchor and are
  // held by the solved arms; the knife is a one-handed grip on the right hand bone instead.
  const heldGuns = new Map();
  for (const [weaponId, gunTemplateObj] of template.guns) {
    const inst = gunTemplateObj.clone(true); // rigid prop, not skinned — plain deep clone is correct
    inst.visible = false;
    inst.scale.setScalar(1 / worldScale); // cancel the inherited body scale so the gun keeps its real fitted size
    // Real bug, found from a live report ("the knife has disappeared from gameplay") and confirmed
    // by directly inspecting a live figure: the knife rendered with perfectly healthy data (real
    // geometry, correct material, visible=true, correctly parented to hand_r) yet never actually
    // drew — its mesh had frustumCulled left at THREE's default `true`. The knife (unlike the
    // rifles/pistol, which ride `aim` — a plain anchor manually repositioned each frame) is a
    // child of an actual ANIMATED BONE deep inside the skinned hierarchy (hand_r), the same kind
    // of object buildCharacterFigure's own comment already flags as needing frustumCulled=false
    // ("bounding info on a skinned mesh is computed from the BIND pose — once real animation moves
    // the skeleton away from that pose, the stale bounds can clip a fully on-screen [object] out
    // of view") — that reasoning was only ever applied to the actual SkinnedMesh body parts, never
    // to a rigid prop riding a bone, which turns out to need it just as much. Applied to every
    // held prop here, not just the knife, since any future one-handed weapon riding hand_r the
    // same way would hit the identical bug.
    inst.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
    if (GRIPS[weaponId]) aim.add(inst);
    else if (bones.hand_r) {
      inst.quaternion.copy(GUN_IN_HAND_QUAT);
      inst.position.copy(GUN_IN_HAND_OFFSET.clone().divideScalar(worldScale));
      bones.hand_r.add(inst);
    }
    heldGuns.set(weaponId, inst);
  }
  return { bones, aim, aimStand, aimProne, spineBindQ, heldGuns, upperBodyBindQ, pelvisBindLocalY };
}

export function buildCharacterFigure(id, name, appearanceIn) {
  const appearance = appearanceIn ? sanitizeAppearance(appearanceIn) : guestAppearance(id);
  if (appearance.mode === 'operator') return buildOperatorFigure(appearance);
  if (!template) return null;
  const charId = appearance.character;
  const model = cloneSkinned(template.scenes[charId]);
  // The model faces +Z; this game's forward is -Z (movement.js, the old figure's gun offset), so
  // the yaw applied to the outer group would otherwise turn every remote player to face backwards.
  model.rotation.y = Math.PI;
  // Prone lays the figure flat by rotating -90° about X — done on THIS group, never on `root`
  // itself, because root's OWN rotation.y is independently driven every frame by wherever the
  // player is aiming (see updateRemotePlayers). Combining a yaw rotation and the flatten rotation
  // on the SAME object via Euler angles doesn't act like two independent rotations — changing
  // root.rotation.y while root.rotation.x was also set made a prone figure visibly tilt in and out
  // of the ground as the player's aim direction changed (confirmed by testing: rotating yaw while
  // X-rotated pulls the "flat" plane itself out of true-horizontal, since three.js composes Euler
  // components on one object in a fixed order, not as separately-axised rotations). Putting the
  // flatten on its own child group makes root.rotation.y a pure yaw spin and poseGroup.rotation.x a
  // pure flatten, each independent of the other with no shared-object Euler interaction at all.
  const poseGroup = new THREE.Group();
  poseGroup.add(model);
  const root = new THREE.Group();
  root.add(poseGroup);

  let bodyMesh = null, bodyMaterial = null;
  const eyebrowMaterials = [];
  model.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      if (obj.material.name === BODY_MATERIAL[charId]) {
        obj.material = obj.material.clone(); // per-instance, so tinting one player never affects another
        bodyMaterial = obj.material; bodyMesh = obj;
      } else if (obj.material.name.startsWith('MI_Hair')) {
        obj.material = obj.material.clone();
        eyebrowMaterials.push(obj.material);
      }
    }
    // Bounding info on a skinned mesh is computed from the BIND pose — once real animation moves
    // the skeleton away from that pose, the stale bounds can clip a fully on-screen figure out
    // of view. Cheap to just never frustum-cull these (a handful of low-poly figures, not
    // thousands), same tradeoff every other moving character in this engine already makes.
    if (obj.isSkinnedMesh) obj.frustumCulled = false;
  });

  const rig = attachAimAndGuns(model);
  const { bones, aim, aimStand, aimProne, spineBindQ, heldGuns, upperBodyBindQ, pelvisBindLocalY } = rig;

  const mixer = new THREE.AnimationMixer(model);

  const fig = { root, poseGroup, model, mixer, heldGuns, bones, aim, aimStand, aimProne, spineBindQ, upperBodyBindQ, pelvisBindLocalY, weaponId: 0, prone: false, crouch: false,
    charId, bodyMesh, bodyMaterial, eyebrowMaterials, dressMeshes: [], isOperator: false, clipsSource: template.clips };
  dressFigure(fig, appearance);
  return fig;
}

// Builds a figure from one of the 8 predefined named "Operators" (operators.js) instead of the
// Quaternius closet bodies — a totally different asset (own skeleton, "mixamorig"-prefixed bone
// names, retargeted onto our animation library rather than sharing it directly, see retarget.js).
// Returns the SAME `fig` shape buildCharacterFigure produces for a Custom body — same `bones` keys
// (populated via QUAT_TO_MIXAMO instead of by literal name), same aim/heldGuns/mixer wiring (built
// by the exact shared attachAimAndGuns() helper) — so every piece of code downstream of this
// (updateFigure/poseArms/solveArm/restrictToArms, the first-person rig, remote-figure animation)
// works on an operator figure with zero changes, the same way it already didn't care which of the
// two Quaternius bodies (male/female) it was handed.
function buildOperatorFigure(appearance) {
  const opId = appearance.operator;
  const loaded = getLoadedOperator(opId);
  if (!loaded) {
    // Not loaded yet: kick off the (lazy, per-id — these are ~5-60MB each, not worth eager-loading
    // all 8 for players who never touch Operators mode) load in the background and let the caller
    // retry, same "return null, try again next tick" contract buildCharacterFigure already has
    // while the Quaternius template itself is still loading. loadOperator now retries on its own
    // (see its own comment — a live report traced to exactly this gap: no retry meant one flaky
    // fetch over a real network permanently left a player's gun/hands invisible), but the retries
    // still take real time and can still ultimately fail — .catch() here just logs instead of
    // leaving an unhandled rejection; the player already has a "no rig this tick" empty-handed
    // fallback via the null return, same as the ordinary still-loading case.
    if (template) loadOperator(opId, () => cloneSkinned(template.scenes.male), template.clips).then(() => {
      retryPendingCreates();
      for (const fn of operatorReadyCallbacks) fn();
    }).catch((err) => {
      console.error(`giving up on operator "${opId}" after retries — gun/hands will stay empty for anyone using it this session:`, err);
    });
    return null;
  }
  const model = cloneSkinned(loaded.model);
  model.rotation.y = Math.PI; // same "+Z model-forward vs -Z game-forward" correction as the Quaternius bodies
  const poseGroup = new THREE.Group(); // prone flatten lives here, never on root — see the Custom-body build above for why
  poseGroup.add(model);
  const root = new THREE.Group();
  root.add(poseGroup);

  let bodyMesh = null;
  const allMeshes = [];
  model.traverse((obj) => {
    if (obj.isSkinnedMesh) { allMeshes.push(obj); obj.frustumCulled = false; if (obj.name === loaded.bodyMesh.name) bodyMesh = obj; }
  });
  const rig = attachAimAndGuns(model, QUAT_TO_MIXAMO);
  const { bones, aim, aimStand, aimProne, spineBindQ, heldGuns, upperBodyBindQ, pelvisBindLocalY } = rig;
  const mixer = new THREE.AnimationMixer(model);

  const fig = { root, poseGroup, model, mixer, heldGuns, bones, aim, aimStand, aimProne, spineBindQ, upperBodyBindQ, pelvisBindLocalY, weaponId: 0, prone: false, crouch: false,
    charId: opId, bodyMesh, bodyMaterial: null, eyebrowMaterials: [], dressMeshes: allMeshes.filter((m) => m !== bodyMesh),
    isOperator: true, operatorId: opId, garmentMeshNames: loaded.garmentMeshNames, clipsSource: loaded.clips };
  applyStripClothes(fig, appearance);
  return fig;
}
// The strip-clothes toggle: hides just the garment mesh(es) this specific operator actually has as
// separate pieces (canStripClothes/GARMENT_MESHES in operators.js) — a no-op for every other
// operator, whose clothes are fused into one body mesh with nothing to hide (flagged in the UI
// rather than silently pretending this works everywhere).
function applyStripClothes(fig, appearance) {
  if (!fig.isOperator) return;
  const hide = !!appearance.stripClothes;
  for (const m of fig.dressMeshes) if (fig.garmentMeshNames.includes(m.name)) m.visible = !hide;
}

export function redressFigure(fig, appearance) {
  if (fig.isOperator) applyStripClothes(fig, sanitizeAppearance(appearance));
  else dressFigure(fig, appearance);
}

export function setFigureWeapon(fig, weaponId) {
  fig.weaponId = weaponId;
  for (const [id, obj] of fig.heldGuns) obj.visible = id === weaponId;
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();
// Rotates `bone` (in place, world-space) so the direction from it to `childPos` becomes `newDir`.
function aimBone(bone, childPos, newDir) {
  const bp = bone.getWorldPosition(new THREE.Vector3());
  const cur = childPos.clone().sub(bp).normalize();
  _q.setFromUnitVectors(cur, newDir);
  bone.getWorldQuaternion(_q2);
  _q2.premultiply(_q);
  if (bone.parent) { bone.parent.getWorldQuaternion(_q); bone.quaternion.copy(_q.invert().multiply(_q2)); }
  else bone.quaternion.copy(_q2);
  bone.updateMatrixWorld(true);
}
function setBoneWorldQuat(bone, q) {
  bone.parent.getWorldQuaternion(_q);
  bone.quaternion.copy(_q.invert().multiply(q));
  bone.updateMatrixWorld(true);
}

// Two-bone IK: bends shoulder->elbow->wrist so the wrist lands on `target`, elbow pushed toward
// `poleDir` (world). Bone lengths come from the live pose, so it works over any animation.
function solveArm(fig, side, target, poleDir, handQuat) {
  const upper = fig.bones[`upperarm_${side}`], lower = fig.bones[`lowerarm_${side}`], hand = fig.bones[`hand_${side}`];
  if (!upper || !lower || !hand) return;
  const A = upper.getWorldPosition(new THREE.Vector3());
  const B = lower.getWorldPosition(new THREE.Vector3());
  const C = hand.getWorldPosition(new THREE.Vector3());
  const l1 = B.distanceTo(A), l2 = C.distanceTo(B);
  const toT = target.clone().sub(A);
  const dist = Math.min(Math.max(toT.length(), Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  const dir = toT.normalize();
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const perp = poleDir.clone().addScaledVector(dir, -poleDir.dot(dir)).normalize();
  const elbow = A.clone().addScaledVector(dir, cosA * l1).addScaledVector(perp, sinA * l1);
  aimBone(upper, B, elbow.clone().sub(A).normalize());
  const wristNow = hand.getWorldPosition(new THREE.Vector3());
  const elbowNow = lower.getWorldPosition(new THREE.Vector3());
  aimBone(lower, wristNow, A.clone().addScaledVector(dir, dist).sub(elbowNow).normalize());
  setBoneWorldQuat(hand, handQuat);
}

const _vFoot = new THREE.Vector3(), _vFoot2 = new THREE.Vector3(); // scratch, reused every frame by the Operator ground clamp below — avoid allocating per figure per frame

// Per-frame: advance the animation (legs/torso), then pose both arms around the equipped gun.
export function updateFigure(fig, dt) {
  fig.mixer.update(dt);
  // Crouch upper-body fix, third attempt this round — both prior attempts corrected the HEAD alone
  // (first a local-only nudge, then a full world-space level-pin) and both were wrong in different
  // ways: the local nudge still let the head droop with the torso's own lean (still read as "looking
  // down"), and the world pin fixed that but forced an anatomically extreme neck counter-rotation
  // during a deep crouch that collapsed the neck/shoulder GPU skin blend ("the neck sank into the
  // shoulders" — a real user report on real hardware, not reproduced by this project's own headless/
  // SwiftShader render tests). User's own direction after both failures: don't try to counter-rotate
  // the head at all — stop the crouch clip's forward lean from ever reaching the upper body in the
  // first place, and let only the legs do the crouching.
  //
  // Every upper-body joint from the hips up (spine_01/02/03, neck_01, Head) is reset to its bind-pose
  // LOCAL rotation each frame while crouching — the torso, shoulders, neck and head all stay in their
  // natural standing orientation; the character's height still drops because the LEGS (thigh/calf/
  // foot, untouched here) are the ones actually bent by the crouch clip. This is a much safer class of
  // fix than either head-only attempt: every corrected joint is pinned to its own neutral bind value
  // (never asked to counter-rotate relative to a neighboring bone that's doing something wild), so no
  // joint's local delta from its neighbor can blow up the way the world-pin's did — there's no
  // "extreme" rotation being requested anywhere, just "don't move" on five joints. Originally
  // scoped to crouch only — prone was assumed to already use a straight pose (A_TPose) with
  // nothing to correct. A live screenshot proved that assumption wrong: prone's own head still
  // ended up pitched sharply down into the ground (chin tucked, not the "looking forward along
  // the ground" a real prone stance reads as) — same class of "clip carries residual tilt away
  // from bind pose" issue as crouch had, just not caught before because nobody had rendered it
  // yet. Same fix, same reasoning, now covers both stances.
  if ((fig.crouch || fig.prone) && fig.upperBodyBindQ) {
    for (const n of ['spine_01', 'spine_02', 'spine_03', 'neck_01', 'Head']) {
      if (fig.bones[n] && fig.upperBodyBindQ[n]) fig.bones[n].quaternion.copy(fig.upperBodyBindQ[n]);
    }
  }
  // Crouch ground clamp — ONE mechanism for both body types (history below; the short version is
  // two earlier, body-specific attempts both turned out incomplete or unsafe, so this replaces
  // both rather than sitting alongside them).
  //
  // Round 1 (Custom only): the stock Crouch_Idle_Loop clip bakes in a lopsided stance — the right
  // foot sits ~8cm above the left/above its own standing height for the whole idle hold (measured:
  // world-space foot Y sampled across the whole ~2.9s clip, essentially flat the whole time). Fixed
  // by mirroring the left leg's local rotation onto the right each frame while idle-crouching —
  // closed most but not all of the gap (a baked pelvis roll a leg-only mirror can't fully cancel).
  //
  // Round 2 (Operator only): applying that SAME mirror to an Operator (mixamorig, retargeted)
  // collapsed the whole figure into a twisted heap — its left leg was never verified correctly
  // grounded to begin with, so mirroring it doubled down on whatever was already wrong. Replaced
  // with an Operator-only fix instead: retarget.js's hip POSITION track barely lowers the hip at
  // all during Crouch_Fwd_Loop (measured: hip stayed near standing height, unlike the same source
  // clip played un-retargeted on a Custom body, which grounds correctly) — fixed by measuring the
  // actual lowest foot each frame and shifting the model down by exactly that gap.
  //
  // Round 3 (this one): a live report that Custom STILL floats while crouch-WALKING (Round 1 only
  // ever covered Custom's IDLE clip — Crouch_Fwd_Loop was never actually measured or fixed for
  // Custom at all) made clear the ground-truth foot-clamp from round 2 isn't Operator-specific
  // logic, it's just the correct fix, full stop — a measured "is the lowest foot above the real
  // ground" check doesn't care whose rig produced the pose. Replacing BOTH round 1 and round 2's
  // separate, body-specific patches with this one check for everyone: idle or moving, Custom or
  // Operator. This is also strictly safer than round 1's mirror ever was — a leg-rotation mirror
  // could theoretically produce a broken pose on a rig it wasn't tested against (exactly what
  // happened in round 2); a foot-vs-ground height check has no such failure mode, it only ever
  // asks "is the lowest point above zero," which is body-shape-agnostic by construction.
  if (!fig.fp) {
    // `!fig.fp` matters: buildFirstPersonRig seats the first-person rig's OWN model.position to a
    // fixed, deliberately non-zero value once at build time (FP_SHOULDER_MID minus the shoulder
    // midpoint, to line the arms up with the camera-space anchor) — forcing it back to 0 here every
    // frame would silently undo that positioning for a player's own first-person view. This clamp
    // only makes sense for a THIRD-PERSON figure (remote players, previews).
    //
    // Always re-baseline to 0 first, every frame — this correction has to be stateless (recomputed
    // fresh each frame from a known zero point) rather than an accumulating `-=`, otherwise a
    // correction applied while crouched would silently persist as a leftover offset once the
    // player stands back up (model.position isn't touched by the mixer, so nothing else would ever
    // reset it), sinking a standing figure into the ground.
    // Corrects on `poseGroup.position`, not `model.position` — poseGroup is what actually carries
    // the prone flatten rotation (poseGroup.rotation.x, set in animateRemoteFigure), and a position
    // set on it is expressed in ITS PARENT's (root's) frame, evaluated BEFORE that rotation applies.
    // So `.y` here always means real vertical displacement, standing, crouching, or flattened prone
    // alike — no need to track which local axis happens to point "up" for a given pose (the old
    // prone-only version of this got that wrong exactly once — mid-crossfade — and then cached the
    // bad value forever; this fixes both problems by not caching anything and not caring about axes).
    fig.poseGroup.position.y = 0;
    if (fig.prone) {
      fig.poseGroup.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(fig.model);
      const gap = box.min.y - fig.root.position.y - 0.02; // 0.02 = small ground clearance, matches the old prone-only version's own constant
      fig.poseGroup.position.y = -gap;
    } else if (fig.crouch && fig.bones.foot_l && fig.bones.foot_r) {
      fig.model.updateMatrixWorld(true);
      const groundY = fig.root.position.y;
      const footLY = fig.bones.foot_l.getWorldPosition(_vFoot).y;
      const footRY = fig.bones.foot_r.getWorldPosition(_vFoot2).y;
      const gap = Math.min(footLY, footRY) - groundY;
      if (gap > 0.01) fig.poseGroup.position.y = -gap;
    }
  }
  const grips = GRIPS[fig.weaponId];
  if (!grips || !fig.bones.spine_03) return;
  fig.model.updateMatrixWorld(true);
  // Position: chest position + the mounting offset swung by how far the torso has leaned from its
  // bind pose (so a crouch's forward pitch carries the gun down and out in front of the body
  // instead of leaving it at head height). Orientation stays fixed to model-forward.
  const spineQ = fig.model.getWorldQuaternion(_q).invert().multiply(fig.bones.spine_03.getWorldQuaternion(_q2));
  const lean = spineQ.multiply(fig.spineBindQ.clone().invert());
  const cfg = fig.prone ? fig.aimProne : fig.aimStand;
  fig.aim.quaternion.copy(cfg.quat);
  fig.aim.position.copy(fig.model.worldToLocal(fig.bones.spine_03.getWorldPosition(new THREE.Vector3()))).add(cfg.offset.clone().applyQuaternion(lean));
  poseArms(fig, grips, fig.prone ? ELBOW_POLE_PRONE : ELBOW_POLE);
}

// Solves both arms onto the grip points of the gun riding `fig.aim` (whose transform the caller has
// already set). Shared by the world figures (updateFigure) and the first-person rig below.
function poseArms(fig, grips, pole, extra) {
  fig.aim.updateMatrixWorld(true);
  const gunM = fig.aim.matrixWorld;
  const gunQ = fig.aim.getWorldQuaternion(new THREE.Quaternion());
  const toWorld = (v) => v.clone().applyMatrix4(gunM);
  const modelQ = fig.model.getWorldQuaternion(new THREE.Quaternion());

  // right hand: orientation from the measured hand<->gun relation; wrist = grip - offset in hand space
  const qR = gunQ.clone().multiply(GUN_IN_HAND_QUAT_INV);
  const wristR = toWorld(grips.right).sub(GUN_IN_HAND_OFFSET.clone().applyQuaternion(qR));
  solveArm(fig, 'r', wristR, pole.r.clone().applyQuaternion(modelQ), qR);

  if (!grips.left) {
    // One-handed weapon (knife) in the first-person rig: park the free arm out of frame.
    if (grips.parkLeft) solveArm(fig, 'l', toWorldParent(fig, grips.parkLeft), pole.l.clone().applyQuaternion(modelQ), qR);
    return;
  }
  // left hand: palm up under the gun (hand +X = palm normal for the left hand, +Y = fingers),
  // fingers along the barrel
  const gx = new THREE.Vector3(1, 0, 0).applyQuaternion(gunQ), gy = new THREE.Vector3(0, 1, 0).applyQuaternion(gunQ);
  const qL = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(gy, gx, new THREE.Vector3().crossVectors(gy, gx)));
  // extra.leftGrip: a different grip point in GUN space (the hand follows a moving part, e.g. the pump);
  // extra.leftWrist: a wrist position in CAMERA space (the hand has left the gun altogether, e.g. reloading).
  const wristL = extra && extra.leftWrist
    ? toWorldParent(fig, extra.leftWrist)
    : toWorld(extra && extra.leftGrip ? extra.leftGrip : grips.left).addScaledVector(gx, -PALM_OFFSET).addScaledVector(gy, -0.035);
  solveArm(fig, 'l', wristL, pole.l.clone().applyQuaternion(modelQ), qL);
}
// A point given in the rig root's own space (camera space, for the first-person rig) -> world.
function toWorldParent(fig, v) { return v.clone().applyMatrix4(fig.root.matrixWorld); }

// ---------- First-person rig ----------
// The local player's view of their own arms + weapon. It's the same dressed character (so skin tone,
// sleeves and gloves match what everyone else sees) with everything but the arms removed, parented to
// the camera, and posed by the exact same two-arm IK the world figures use — the gun is simply moved
// around in camera space (viewmodel.js does the sway / recoil / reload motion) and the arms follow it.
const FP_ARM_BONE = /^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_/;
// Same idea for operator (mixamorig) skeletons — a completely different naming scheme, so the
// Quaternius regex above matches nothing on them (which would leave a first-person operator's
// arms entirely invisible — every triangle gets excluded — rather than merely mis-cut). Prefix
// matching on 'Hand' alone already covers every finger sub-bone too (mixamorigLeftHandThumb1 etc
// literally starts with mixamorigLeftHand), same as the Quaternius pattern covering thumb_01_l etc.
const FP_ARM_BONE_MIXAMO = /^mixamorig(Left|Right)(Shoulder|Arm|ForeArm|Hand)/;
const FP_SHOULDER_MID = new THREE.Vector3(0, -0.29, -0.10); // where the shoulder line sits, in camera space
const FP_BASE_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 2, 0)); // gun +X (barrel) -> camera -Z, sights up
const armGeoCache = new WeakMap();
// A copy of a skinned mesh's geometry keeping only the triangles that sit on the arm/hand bones.
function armsOnlyGeometry(orig, skeleton, armRegex) {
  const cached = armGeoCache.get(orig);
  if (cached) return cached;
  const isArm = skeleton.bones.map((b) => armRegex.test(b.name));
  const si = orig.attributes.skinIndex, sw = orig.attributes.skinWeight, n = si.count;
  const arm = new Float32Array(n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) if (isArm[si.getComponent(i, k)]) arm[i] += sw.getComponent(i, k);
  // Some operator FBX meshes arrive non-indexed (no shared vertices between triangles), unlike the
  // Quaternius glTF bodies which always have an index buffer — fall back to a synthetic 0..n-1
  // index (one "triangle" per 3 consecutive vertices) so this works on either.
  const src = orig.index ? orig.index.array : Array.from({ length: n }, (_, i) => i), keep = [];
  // Real bug, found from a live report ("hands invisible") and only reproduced on an Operator
  // whose body mesh actually has more than one material (Frank: 2, most others: 1 — which is
  // exactly why this never showed up for Custom bodies or most Operators): a multi-material mesh
  // needs `geometry.groups` to tell WebGL which index range belongs to which material, and this
  // function was building a brand-new index array without carrying any groups over at all — for
  // a single-material mesh that's a silent no-op (nothing reads groups), but for a multi-material
  // one, three.js draws nothing for any material index that has no group, which for this rebuilt
  // geometry was ALL of them, i.e. the whole mesh renders zero triangles despite geometry, skin
  // weights, texture and bone matrices all being individually fine (confirmed by direct testing:
  // forcing a single-material override made it render immediately). Fixed by walking each
  // original group's own triangle range through the same arm filter and re-deriving its
  // start/count against the NEW index — filtering preserves each group's internal triangle order,
  // so its surviving triangles stay contiguous in `keep`, which is what makes this a straight
  // per-group re-count rather than needing to interleave/sort anything.
  const origGroups = orig.groups && orig.groups.length ? orig.groups : [{ start: 0, count: src.length, materialIndex: 0 }];
  const groups = [];
  for (const grp of origGroups) {
    const groupStart = keep.length;
    for (let t = grp.start; t < grp.start + grp.count; t += 3) {
      if (arm[src[t]] >= 0.5 && arm[src[t + 1]] >= 0.5 && arm[src[t + 2]] >= 0.5) keep.push(src[t], src[t + 1], src[t + 2]);
    }
    if (keep.length > groupStart) groups.push({ start: groupStart, count: keep.length - groupStart, materialIndex: grp.materialIndex });
  }
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(orig.attributes)) g.setAttribute(name, orig.attributes[name]);
  g.setIndex(keep);
  for (const grp of groups) g.addGroup(grp.start, grp.count, grp.materialIndex);
  armGeoCache.set(orig, g);
  return g;
}
function restrictToArms(fig) {
  const skeleton = fig.bodyMesh.skeleton;
  const armRegex = fig.isOperator ? FP_ARM_BONE_MIXAMO : FP_ARM_BONE;
  const keepMeshes = new Set([fig.bodyMesh, ...fig.dressMeshes]);
  for (const mesh of keepMeshes) {
    mesh.userData.origGeometry ||= mesh.geometry;
    mesh.geometry = armsOnlyGeometry(mesh.userData.origGeometry, skeleton, armRegex);
    mesh.visible = mesh.geometry.index.count > 0; // hair / hats / trousers have no arm triangles at all
  }
  const guns = [...fig.heldGuns.values()];
  const insideGun = (o) => { for (let p = o; p; p = p.parent) if (guns.includes(p)) return true; return false; }; // the knife rides the hand bone, inside the model
  fig.model.traverse((o) => { if (o.isMesh && !keepMeshes.has(o) && !insideGun(o)) o.visible = false; }); // eyes, brows, teeth...
}
export function buildFirstPersonRig(appearance) {
  const fig = buildCharacterFigure(0, 'fp', appearance);
  if (!fig || !fig.aim || !fig.bones.upperarm_r) return null;
  fig.fp = true;
  fig.root.add(fig.aim); // anchor lives in camera space, not on the model
  restrictToArms(fig);
  const idle = fig.clipsSource.get('Idle_Loop');
  if (idle) fig.mixer.clipAction(idle).play();
  fig.mixer.update(0); // evaluates the rest pose (curled fingers) ONCE; the IK only ever rewrites these six bones,
  // so each frame just restores their local rotations (see updateFirstPersonRig) instead of re-evaluating the animation.
  fig.fpRest = ['upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l', 'hand_l'].map((n) => [fig.bones[n], fig.bones[n].quaternion.clone()]);
  fig.root.updateMatrixWorld(true);
  const mid = fig.bones.upperarm_r.getWorldPosition(new THREE.Vector3()).add(fig.bones.upperarm_l.getWorldPosition(new THREE.Vector3())).multiplyScalar(0.5);
  fig.model.position.copy(FP_SHOULDER_MID).sub(mid); // seat the MODEL (the anchor stays in pure camera space)
  setFigureWeapon(fig, 0);
  return fig;
}
const FP_KNIFE_GRIPS = { right: new THREE.Vector3(0, 0, 0), left: null, parkLeft: new THREE.Vector3(-0.2, -0.45, 0.45) };
const FP_GRENADE_GRIPS = { right: new THREE.Vector3(0, 0, 0), left: null, parkLeft: FP_KNIFE_GRIPS.parkLeft };
export const FP_GRENADE_ID = 4; // pseudo weapon id for the grenade prop (real weapons are 0..3)
// Adds a prop (e.g. the grenade) to the first-person rig under a pseudo weapon id, held by the right hand.
export function attachFirstPersonProp(fig, id, obj) { obj.visible = false; fig.aim.add(obj); fig.heldGuns.set(id, obj); }
// `pos` = where the gun's grip point sits in camera space; `euler` = extra rotation of the gun about
// that point (camera space). `leftTarget` (optional, camera space) is where the free left hand goes for
// one-handed props (the pin-pull); it is ignored for two-handed guns. The caller must have set fig.root's
// parent transform to the camera's.
export function updateFirstPersonRig(fig, weaponId, pos, euler, leftTarget, opts) {
  if (fig.weaponId !== weaponId) setFigureWeapon(fig, weaponId);
  const lt = leftTarget || null, lg = opts?.leftGrip || null, lw = opts?.leftWrist || null;
  // The arms are solved RELATIVE to the camera, so turning the camera never invalidates them: when the
  // pose is exactly what it was last frame, the bones already hold the right answer — skip the IK
  // (the common case: standing still and looking around).
  const sig = [weaponId, pos.x, pos.y, pos.z, euler.x, euler.y, euler.z, lt ? lt.x : 0, lt ? lt.y : 0, lt ? lt.z : 0, lg ? lg.x : 0, lg ? lg.y : 0, lg ? lg.z : 0, lw ? lw.x : 0, lw ? lw.y : 0, lw ? lw.z : 0, lt ? 1 : 0, lg ? 1 : 0, lw ? 1 : 0];
  const last = fig.fpSig;
  if (last && last.length === sig.length && last.every((v, i) => v === sig[i])) return;
  fig.fpSig = sig;
  for (const [bone, q] of fig.fpRest) bone.quaternion.copy(q); // back to the rest pose first so the IK never accumulates twist
  fig.aim.position.copy(pos);
  fig.aim.quaternion.setFromEuler(euler).multiply(FP_BASE_Q);
  fig.root.updateMatrixWorld(true);
  let grips = weaponId === FP_GRENADE_ID ? FP_GRENADE_GRIPS : (GRIPS[weaponId] || FP_KNIFE_GRIPS);
  if (lt && !grips.left) grips = { ...grips, parkLeft: lt };
  poseArms(fig, grips, ELBOW_POLE, { leftGrip: lg, leftWrist: lw });
}
// The support-hand grip point of a two-handed gun, in gun space (for building offsets from it).
export function getGunGrip(weaponId, hand) { const g = GRIPS[weaponId]; return g ? g[hand].clone() : null; }

// ---- Moving gun parts (slide / pump / magazine) ----
// A part is a mesh inside the gun's own hierarchy, so it is offset in the mesh's parent's local units; these
// helpers convert an offset given in GUN space (metres at gun scale 1: +X barrel, +Y up, +Z right) into that.
export function gunPart(fig, weaponId, name) {
  const key = `${weaponId}:${name}`;
  fig.fpParts ||= new Map();
  if (fig.fpParts.has(key)) return fig.fpParts.get(key);
  const inst = fig.heldGuns.get(weaponId);
  const mesh = inst && inst.getObjectByName(`GunPart_${name}`);
  let out = null;
  if (mesh) {
    const obj = mesh.parent, holder = obj.parent;
    obj.updateMatrix(); holder.updateMatrix(); mesh.updateMatrix();
    const M = new THREE.Matrix4().multiplyMatrices(holder.matrix, obj.matrix); // obj-local -> gun space
    const inv3 = new THREE.Matrix3().setFromMatrix4(M.clone().invert());
    const centerLocal = partCenters.get(mesh);
    out = {
      mesh, base: mesh.position.clone(),
      axX: new THREE.Vector3(1, 0, 0).applyMatrix3(inv3), axY: new THREE.Vector3(0, 1, 0).applyMatrix3(inv3), axZ: new THREE.Vector3(0, 0, 1).applyMatrix3(inv3),
      center: centerLocal ? centerLocal.clone().applyMatrix4(mesh.matrix).applyMatrix4(M) : new THREE.Vector3(), // where the part sits, in gun space
    };
  }
  fig.fpParts.set(key, out);
  return out;
}
export function setPartOffset(fig, weaponId, name, x, y = 0, z = 0) {
  const p = gunPart(fig, weaponId, name); if (!p) return false;
  p.mesh.position.copy(p.base).addScaledVector(p.axX, x).addScaledVector(p.axY, y).addScaledVector(p.axZ, z);
  return true;
}
export function setPartVisible(fig, weaponId, name, v) { const p = gunPart(fig, weaponId, name); if (p) p.mesh.visible = v; }
// Clones a part's mesh (for a falling magazine etc.) — returns { mesh, center } with the mesh's world transform
// matching the part right now, or null.
export function cloneGunPartWorld(fig, weaponId, name) {
  const p = gunPart(fig, weaponId, name); if (!p) return null;
  p.mesh.updateWorldMatrix(true, false);
  const m = p.mesh.clone(); m.visible = true;
  return { mesh: m, worldMatrix: p.mesh.matrixWorld.clone() };
}
// Recolours / re-dresses the rig after the closet changes (the restriction has to be redone since
// dressFigure rebuilds the cloth meshes).
export function redressFirstPersonRig(fig, appearance) {
  if (fig.isOperator) applyStripClothes(fig, sanitizeAppearance(appearance));
  else dressFigure(fig, appearance);
  restrictToArms(fig);
  fig.fpSig = null;
}
// Where the muzzle sits along the gun, in the gun's own space (barrel = +X from the grip point).
export function getMuzzleAlongBarrel(weaponId) { const f = GUN_FIT[weaponId]; return f ? f.length * (1 - f.grip) : 0; }

const remotePlayers = new Map(); // id -> see createRemote below for the full shape

// World position of the muzzle of another player's gun (for their muzzle flash), or null if unknown.
export function getRemoteGunMuzzle(playerId, weaponId) {
  const rp = remotePlayers.get(playerId), inst = rp && rp.fig.heldGuns.get(weaponId);
  if (!inst || !GRIPS[weaponId]) return null;
  inst.updateWorldMatrix(true, false);
  return inst.localToWorld(new THREE.Vector3(getMuzzleAlongBarrel(weaponId), 0.01, 0));
}

// Drops every remote figure — used when a reconnect hands us a fresh, authoritative player list.
export function clearRemotes() { for (const id of [...remotePlayers.keys()]) removeRemote(id); }

export function hasRemote(id) { return remotePlayers.has(id); }

const pendingCreates = [];
// What each remote player looks like, learned from the server's `joined` / `playerJoined` messages
// (appearance is chosen before a match and never changes mid-match, so it isn't repeated in every
// 20Hz state tick). Anyone we haven't heard an appearance for gets a deterministic guest look.
const appearances = new Map();
export function setRemoteAppearance(id, appearance) { if (appearance) appearances.set(id, sanitizeAppearance(appearance)); }
export function createRemote(id, name, pos) {
  if (remotePlayers.has(id)) return;
  // Null covers two different "not ready yet" cases with one retry path: the Quaternius template
  // itself still loading (as before), or — new — an Operator body that hasn't finished its own
  // (lazy, per-id) load yet even though the template is long ready.
  const fig = buildCharacterFigure(id, name, appearances.get(id));
  if (!fig) { if (!pendingCreates.some((a) => a[0] === id)) pendingCreates.push([id, name, pos]); return; }
  fig.root.position.set(pos[0], pos[1] || 0, pos[2]);
  state.scene.add(fig.root);
  remotePlayers.set(id, {
    id, mesh: fig.root, fig, mixer: fig.mixer,
    weapon: 0,
    targetPos: new THREE.Vector3(pos[0], pos[1] || 0, pos[2]), targetRotY: 0,
    moving: false, crouch: false, prone: false, sprint: false,
    currentAction: null, currentAnimName: null,
  });
}
export function retryPendingCreates() { for (const args of pendingCreates.splice(0)) createRemote(...args); }

// Real bug found from a live report ("hands/gun invisible after join/refresh"): when the LOCAL
// player's own appearance is an Operator that hasn't finished its lazy per-id load yet,
// buildFirstPersonRig() (below) returns null exactly like buildCharacterFigure does for a remote
// player in the same situation — but remote players get retried automatically once the operator
// finishes loading (pendingCreates/retryPendingCreates, above); the local first-person rig had no
// equivalent hook at all, so if the operator lost that race even once, the player's own hands and
// gun stayed permanently empty for the rest of that page's life (matches "sometimes on join, and
// reliably after a refresh/rejoin" — a fresh page has to reload the operator from scratch every
// time, so it's much more likely to still be loading exactly when the rig first tries to build).
// viewmodel.js subscribes here and retries its own rebuild whenever any operator finishes loading,
// the same "fire and let every interested listener recheck" shape as onCharacterTemplateReady.
const operatorReadyCallbacks = [];
export function onOperatorReady(fn) { operatorReadyCallbacks.push(fn); }
onceReady(retryPendingCreates);

export function removeRemote(id) {
  const rp = remotePlayers.get(id);
  if (!rp) return;
  state.scene.remove(rp.mesh);
  remotePlayers.delete(id);
  appearances.delete(id);
  setRemoteFootstepMode(id, null, null); // don't leave a loop orphaned if they disconnect mid-stride
}

// Applies one incoming per-player `state` update to its remote figure — the local player's own
// entry is handled by the caller (it needs setHealth from death.js, not this module), so this
// is only ever called for p.id !== localId.
export function syncRemotePlayer(p) {
  let rp = remotePlayers.get(p.id);
  if (!rp) {
    createRemote(p.id, `Player${p.id}`, p.pos);
    rp = remotePlayers.get(p.id);
    if (!rp) return; // character/weapon models still loading — the next state tick (~50ms) retries
  }
  rp.targetPos.set(p.pos[0], p.pos[1] || 0, p.pos[2]);
  rp.targetRotY = p.rot[0];
  rp.mesh.visible = p.alive;
  rp.crouch = !!p.crouch;
  rp.prone = !!p.prone;
  rp.moving = !!p.moving;
  rp.sprint = !!p.sprint;
  rp.weapon = p.weapon;
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

const ANIM_FADE_SEC = 0.25;
// Real animation clips (Quaternius Universal Animation Library) now drive stance, replacing the
// old hand-coded leg/arm pivot rotation. No dedicated prone clip exists in the pack, so prone
// still uses the earlier "rotate the whole figure flat" trick — just now layered on top of a
// real crouch POSE instead of a standing one, so a downed player reads as crouched-and-tipped-
// over rather than a stiff mannequin toppled sideways.
function pickAnimName(rp) {
  // No prone clip exists, so a prone player is laid flat by the rig rotation below, using the pack's
  // T-pose as the base — verified by rendering: Idle_Loop's own natural knee bend/weight shift folds
  // into a curled, fetal-looking shape once rotated flat (confirmed both Idle AND a Crouch pose do
  // this — it's the bent knees specifically, not which of those two was picked). A_TPose's straight
  // legs/spine stay a clean straight line when laid down; the arms are overridden by the prone arm-IK
  // regardless of which clip is playing, so the T-pose's own arms-out shape never actually shows.
  if (rp.prone) return 'A_TPose';
  if (rp.crouch) return rp.moving ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop';
  if (rp.moving) return rp.sprint ? 'Sprint_Loop' : 'Walk_Loop';
  return 'Idle_Loop';
}

function setRemoteAnim(rp, name) {
  if (rp.currentAnimName === name) return;
  const clip = rp.fig.clipsSource.get(name);
  if (!clip) return;
  const action = rp.mixer.clipAction(clip);
  action.reset().fadeIn(ANIM_FADE_SEC).play();
  if (rp.currentAction && rp.currentAction !== action) rp.currentAction.fadeOut(ANIM_FADE_SEC);
  rp.currentAction = action;
  rp.currentAnimName = name;
}

function animateRemoteFigure(rp, dt) {
  setRemoteAnim(rp, pickAnimName(rp));
  setFigureWeapon(rp.fig, rp.weapon);
  rp.fig.prone = rp.prone;
  rp.fig.crouch = rp.crouch;
  rp.fig.moving = rp.moving;
  updateFigure(rp.fig, dt);

  const lerpT = Math.min(1, dt * 8);
  const targetRotX = rp.prone ? -Math.PI / 2 : 0;
  // The flatten rotation lives on poseGroup, never on rp.mesh (root) itself — root.rotation.y is
  // independently driven every frame by wherever this player is aiming (below, in
  // updateRemotePlayers). Putting both rotations on the same object doesn't compose as two
  // independent rotations: three.js resolves an object's rotation as one fixed-order Euler
  // sequence, so changing root.rotation.y while root.rotation.x was also nonzero visibly tilted a
  // prone figure in and out of the ground as the player's own aim direction changed. Two separate
  // objects, each with exactly one rotated axis, avoids that Euler interaction entirely.
  rp.fig.poseGroup.rotation.x += (targetRotX - rp.fig.poseGroup.rotation.x) * lerpT;
  // Ground-clamp for prone used to live here as a one-time-cached model.position.Z offset,
  // measured the first time a figure went prone. Real bug (live screenshot: an Operator floating
  // well off the ground while prone): that one-time measurement could land mid-crossfade (the
  // 0.25s blend from whatever clip was playing into A_TPose isn't necessarily done yet the very
  // first frame `rp.prone` goes true), baking in a wrong offset that then stayed cached forever
  // for that figure. Replaced with the same continuous, every-frame ground clamp updateFigure now
  // applies for crouch — see that function's own comment — extended to cover prone too and moved
  // onto `poseGroup.position` instead of `model.position`, since poseGroup is what actually carries
  // the prone rotation: a position set on poseGroup is expressed in ITS PARENT's (root's) frame,
  // before that rotation is applied, so `.y` means real vertical displacement regardless of whether
  // the figure is standing, crouching, or rotated flat — no more needing to track which local axis
  // happens to point "up" for a given pose.
}

// Called once per frame from the bootstrap's animate() — lerps every remote figure toward its
// latest network position/rotation, drives its animation, and keeps any active footstep loop's
// panner tracking the (lerped, so visually smooth) position.
export function updateRemotePlayers(dt) {
  for (const rp of remotePlayers.values()) {
    rp.mesh.position.lerp(rp.targetPos, Math.min(1, dt * 10));
    let dr = rp.targetRotY - rp.mesh.rotation.y;
    dr = Math.atan2(Math.sin(dr), Math.cos(dr));
    // Real bug, found from a live report: a prone player's hit-capsule (see rayProneBodyDist,
    // server/index.js) is oriented by their exact CURRENT yaw, with no smoothing — the server
    // always uses the true, instant value. This rotation lerp, though, smooths what an OBSERVER
    // actually SEES over ~100ms (dt*10 has a ~100ms time constant) — while a prone player spins
    // their view around, the visible body measurably lags behind where the real hit-capsule
    // already is, since standing/crouching hitboxes don't care about facing at all, only prone's
    // new capsule does. Sped up specifically for rotation (position lag doesn't have this
    // problem — the old point-cylinder never cared about facing) so what's visually shown
    // catches up to the server's own instant truth much faster, cutting the divergence window
    // roughly in half without making a fast-turning figure look like it's snapping.
    rp.mesh.rotation.y += dr * Math.min(1, dt * 22);
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
