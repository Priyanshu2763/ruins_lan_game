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
  3: { length: 0.3, grip: 0.1, slim: 1 },
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
  const gunObjs = rest.slice(0, gunIds.length), hairs = rest.slice(gunIds.length);
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
loadTemplate().catch((err) => console.error('character/weapon model load failed:', err));

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
  for (const n of ['spine_03', 'upperarm_r', 'lowerarm_r', 'hand_r', 'upperarm_l', 'lowerarm_l', 'hand_l', 'neck_01', 'Head']) bones[n] = model.getObjectByName(boneNames ? boneNames[n] : n);
  // Bind-pose (pre-animation) local rotations of the neck/head, captured once here before any clip
  // ever plays — used to re-level a crouching figure's head (see updateFigure): several stock crouch
  // clips bake in a pronounced downward tilt at the neck/head specifically (on top of whatever the
  // torso itself leans), which reads as "looking at the ground" rather than a tactical crouch
  // scanning forward. Resetting neck+head to their bind rotation each frame removes exactly that
  // extra tilt while still following the torso's own lean (since world orientation = parent's
  // CURRENT world orientation × this bind-pose local rotation, not a fully fixed world pose).
  const headBindQ = { neck_01: bones.neck_01 && bones.neck_01.quaternion.clone(), Head: bones.Head && bones.Head.quaternion.clone(),
    // WORLD-space bind rotation of the head, captured once here — used to pin a crouching head level
    // regardless of the torso's own forward lean (a bind-LOCAL reset alone still inherits whatever
    // the spine/neck are currently doing, so a crouch clip with a real forward torso lean still read
    // as "looking down" even after that — rendered and compared before/after, this is what actually
    // fixed it, not just a smaller nudge in the same direction).
    HeadWorld: bones.Head && bones.Head.getWorldQuaternion(new THREE.Quaternion()) };

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
    if (GRIPS[weaponId]) aim.add(inst);
    else if (bones.hand_r) {
      inst.quaternion.copy(GUN_IN_HAND_QUAT);
      inst.position.copy(GUN_IN_HAND_OFFSET.clone().divideScalar(worldScale));
      bones.hand_r.add(inst);
    }
    heldGuns.set(weaponId, inst);
  }
  return { bones, aim, aimStand, aimProne, spineBindQ, heldGuns, headBindQ };
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
  const { bones, aim, aimStand, aimProne, spineBindQ, heldGuns, headBindQ } = rig;

  const mixer = new THREE.AnimationMixer(model);

  const fig = { root, poseGroup, model, mixer, heldGuns, bones, aim, aimStand, aimProne, spineBindQ, headBindQ, weaponId: 0, prone: false, crouch: false,
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
    // while the Quaternius template itself is still loading.
    if (template) loadOperator(opId, () => cloneSkinned(template.scenes.male), template.clips).then(retryPendingCreates);
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
  const { bones, aim, aimStand, aimProne, spineBindQ, heldGuns, headBindQ } = rig;
  const mixer = new THREE.AnimationMixer(model);

  const fig = { root, poseGroup, model, mixer, heldGuns, bones, aim, aimStand, aimProne, spineBindQ, headBindQ, weaponId: 0, prone: false, crouch: false,
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

// Per-frame: advance the animation (legs/torso), then pose both arms around the equipped gun.
export function updateFigure(fig, dt) {
  fig.mixer.update(dt);
  // Crouch look-forward fix: several stock crouch clips bake a pronounced extra downward tilt into
  // the neck/head specifically (found by rendering the pose directly and measuring it — not just a
  // style choice, it reads as staring at the ground). Resetting neck+head to their BIND-pose local
  // rotation removes exactly that extra tilt while still following the torso's own current lean
  // (world orientation is the parent's CURRENT world rotation × this fixed local one, so a crouched
  // torso still carries the head down somewhat — just not further hunched by the neck/head joints
  // on top of that). Scoped to crouch only — walk/idle/sprint were never part of this complaint, and
  // prone has its own separate straight-body pose (see pickAnimName) that doesn't need this.
  if (fig.crouch && !fig.prone && fig.headBindQ) {
    if (fig.bones.neck_01 && fig.headBindQ.neck_01) fig.bones.neck_01.quaternion.copy(fig.headBindQ.neck_01);
    // Head: not just reset to its BIND-LOCAL rotation (that still inherits whatever the spine/neck
    // are currently doing, so it wasn't enough on its own — rendered and confirmed the head still
    // visibly pitched down with the torso's own forward crouch lean) — pinned to its bind-pose WORLD
    // rotation instead, so it reads as level/forward regardless of how far the torso leans.
    if (fig.bones.Head && fig.headBindQ.HeadWorld && fig.bones.Head.parent) {
      fig.bones.Head.parent.updateMatrixWorld(true);
      const parentWorldQ = fig.bones.Head.parent.getWorldQuaternion(_q);
      fig.bones.Head.quaternion.copy(parentWorldQ.invert().multiply(fig.headBindQ.HeadWorld));
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
  for (let t = 0; t < src.length; t += 3) if (arm[src[t]] >= 0.5 && arm[src[t + 1]] >= 0.5 && arm[src[t + 2]] >= 0.5) keep.push(src[t], src[t + 1], src[t + 2]);
  const g = new THREE.BufferGeometry();
  for (const name of Object.keys(orig.attributes)) g.setAttribute(name, orig.attributes[name]);
  g.setIndex(keep);
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
  // Ground-clamp: rotating a standing pose flat around the FEET doesn't actually guarantee the
  // resulting horizontal body sits exactly at ground level (found by rendering it: the head measured
  // ~2cm BELOW y=0, a real clip-through-the-floor bug, not just a rounding nicety). Measured once per
  // figure the first time it goes prone (the pose held while prone is fixed — A_TPose, see
  // pickAnimName — so the shape doesn't change frame to frame, no need to remeasure every frame) via
  // the figure's own actual bounding box rather than a guessed constant, so it stays correct for
  // every body/proportions, Custom or Operator alike. Applied on model.position.Z, not .y: once
  // poseGroup is rotated -90° about X, ITS local Z axis is what now points along world Y (checked by
  // hand: rotating the local basis vector (0,0,1) by Rx(-90°) lands on world (0,1,0)) — model.position
  // is expressed in poseGroup's own local frame, so that's the axis a "move it up in the real world"
  // offset has to go on.
  if (rp.prone) {
    if (rp.fig.proneGroundOffset === undefined) {
      const savedRotX = rp.fig.poseGroup.rotation.x;
      rp.fig.poseGroup.rotation.x = -Math.PI / 2; // measure against the pose's FINAL rotated state, not wherever the lerp currently sits
      rp.fig.poseGroup.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(rp.fig.model);
      rp.fig.proneGroundOffset = -box.min.y + 0.02;
      rp.fig.poseGroup.rotation.x = savedRotX;
    }
    rp.fig.model.position.z += (rp.fig.proneGroundOffset - rp.fig.model.position.z) * lerpT;
  } else if (rp.fig.model.position.z !== 0) {
    rp.fig.model.position.z += (0 - rp.fig.model.position.z) * lerpT;
    if (Math.abs(rp.fig.model.position.z) < 0.001) rp.fig.model.position.z = 0;
  }
}

// Called once per frame from the bootstrap's animate() — lerps every remote figure toward its
// latest network position/rotation, drives its animation, and keeps any active footstep loop's
// panner tracking the (lerped, so visually smooth) position.
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
