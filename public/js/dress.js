// Skin tone, hair and clothing for the rigged characters.
//
// Clothes aren't separate models: each garment is a COPY of the body mesh bound to the same
// skeleton (so it deforms with every animation), inflated a hair along its normals so it sits
// on top of the skin, and cut down to the part of the body it covers using each vertex's skin
// weights ("how much does this vertex belong to the thigh/spine/upper-arm bones") plus, where a
// garment ends partway along a limb (short sleeves, boot shafts, shorts), how far along that
// bone the vertex sits. Hair comes from the pack's own hair meshes, re-pointed at this
// character's skeleton by bone NAME. This module imports only three + the shared catalog, so
// characters.js can depend on it without a cycle.
import * as THREE from 'three';
import { SLOTS, guestAppearance, sanitizeAppearance } from '/shared/appearance.js';

export const BODY_MATERIAL = { male: 'MI_Superhero_Male', female: 'MI_Superhero_Female' };

// The body albedo has skin baked in at a fixed medium tan, so tinting it can never reach pale or
// very dark skin. The neutral maps (see public/models/character/T_Skin_*_Neutral.png) keep only
// the detail (shading, veins, the dark briefs) around an average of sRGB 0.75; multiplying the
// tone in and dividing this back out makes the AVERAGE albedo equal the chosen tone.
const SKIN_NEUTRAL_LIN = 0.5225;
const HAIR_TEXTURE_LIN = 0.275; // the hair textures are neutral gray averaging ~sRGB 0.56

const HAIR_FILES = {
  buzzed: { male: 'Hair_Buzzed', female: 'Hair_BuzzedFemale' },
  parted: { male: 'Hair_SimpleParted', female: 'Hair_SimpleParted' },
  long: { male: 'Hair_Long', female: 'Hair_Long' },
  buns: { male: 'Hair_Buns', female: 'Hair_Buns' },
  beard: { male: 'Hair_Beard', female: 'Hair_Beard' },
};

const TORSO = ['spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r'];
const FINGER = /^(hand|thumb|index|middle|ring|pinky)_/;
// Each region: which bones (names or a regex), optionally only part of the way along the bone
// toward its child (`along` 0..1), optionally only above a bind-pose height (`minY`).
const ITEMS = {
  tank: { inflate: 0.006, regions: [{ bones: ['spine_01', 'spine_02', 'spine_03'] }, { bones: ['clavicle_l', 'clavicle_r'], along: [-1, 0.6] }] },
  tee: { inflate: 0.007, regions: [{ bones: TORSO }, { bones: ['upperarm_l', 'upperarm_r'], along: [-1, 0.55] }] },
  longsleeve: { inflate: 0.008, regions: [{ bones: TORSO }, { bones: ['upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r'] }] },
  camojacket: { inflate: 0.009, camo: true, regions: [{ bones: TORSO }, { bones: ['upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r'] }] },
  shorts: { inflate: 0.007, regions: [{ bones: ['pelvis'] }, { bones: ['thigh_l', 'thigh_r'], along: [-1, 0.55] }] },
  pants: { inflate: 0.007, regions: [{ bones: ['pelvis'] }, { bones: ['thigh_l', 'thigh_r', 'calf_l', 'calf_r'] }] },
  camopants: { inflate: 0.009, camo: true, regions: [{ bones: ['pelvis'] }, { bones: ['thigh_l', 'thigh_r', 'calf_l', 'calf_r'] }] },
  sneakers: { inflate: 0.008, regions: [{ bones: ['foot_l', 'foot_r', 'ball_l', 'ball_r'] }] },
  boots: { inflate: 0.011, regions: [{ bones: ['foot_l', 'foot_r', 'ball_l', 'ball_r'] }, { bones: ['calf_l', 'calf_r'], along: [0.5, 1] }] },
  gloves: { inflate: 0.005, regions: [{ bones: FINGER }] },
  beanie: { inflate: 0.012, regions: [{ bones: ['Head'], minY: 1.72 }] },
  helmet: { inflate: 0.026, regions: [{ bones: ['Head'], minY: 1.69 }] },
};
// slot -> which appearance field holds the color
const COLOR_FIELD = { top: 'topColor', bottom: 'bottomColor', shoes: 'shoesColor', gloves: 'glovesColor', head: 'headColor' };
// the bone a limb bone points toward, used to measure "how far along the limb" a vertex is
const CHILD = { clavicle_l: 'upperarm_l', clavicle_r: 'upperarm_r', upperarm_l: 'lowerarm_l', lowerarm_l: 'hand_l', upperarm_r: 'lowerarm_r', lowerarm_r: 'hand_r', thigh_l: 'calf_l', calf_l: 'foot_l', thigh_r: 'calf_r', calf_r: 'foot_r' };

// The pack authored each hair mesh for ONE of the two bodies. The male head sits ~4.4cm higher (and a
// touch further forward at the back) than the female one — measured from the two buzz-cut meshes,
// which share topology vertex-for-vertex. A style used on the other body has to be shifted by that
// offset or it sits low: the scalp pokes out bald through the top and the fringe lands on the
// forehead (exactly what Long/Buns did on the male body).
const HAIR_NATIVE = { Hair_Buzzed: 'male', Hair_SimpleParted: 'male', Hair_Beard: 'male', Hair_BuzzedFemale: 'female', Hair_Long: 'female', Hair_Buns: 'female' };
const MALE_HEAD_OVER_FEMALE = new THREE.Vector3(0, 0.0441, 0.0045);

const assets = { chars: {}, hair: {}, skinTex: {} }; // filled by setupDressAssets

// Called once from characters.js after the models have loaded.
export function setupDressAssets({ chars, hairGltfs, skinTextures }) {
  for (const [id, scene] of Object.entries(chars)) {
    let body = null;
    scene.traverse((o) => { if (o.isSkinnedMesh && o.material?.name === BODY_MATERIAL[id]) body = o; });
    assets.chars[id] = { id, body, itemGeo: new Map(), hairGeo: new Map() };
  }
  for (const [file, gltf] of Object.entries(hairGltfs)) {
    let mesh = null;
    gltf.scene.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
    assets.hair[file] = mesh;
  }
  assets.skinTex = skinTextures;
}

function bodyWorldData(charAsset) {
  if (charAsset.world) return charAsset.world;
  const body = charAsset.body;
  body.updateMatrixWorld(true);
  const pos = body.geometry.attributes.position, n = pos.count;
  const bindM = body.bindMatrix;
  const w = new Float32Array(n * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(bindM); w[i * 3] = v.x; w[i * 3 + 1] = v.y; w[i * 3 + 2] = v.z; }
  const bonePos = body.skeleton.bones.map((_, i) => new THREE.Vector3().setFromMatrixPosition(body.skeleton.boneInverses[i].clone().invert()));
  charAsset.world = { w, bonePos };
  return charAsset.world;
}

// Geometry for one garment on one body: the body's own attributes plus a per-vertex `clothW`
// (how much of this vertex the garment covers), keeping only triangles the garment touches.
const EDGE_ALONG = 0.22; // ramp width, as a fraction of the bone length
const EDGE_Y = 0.03;     // ramp width for height cuts, in world units
const ramp = (x) => Math.min(1, Math.max(0, x + 0.5));
function itemGeometry(charAsset, itemId) {
  const cached = charAsset.itemGeo.get(itemId);
  if (cached) return cached;
  const item = ITEMS[itemId];
  const body = charAsset.body, geo = body.geometry, skel = body.skeleton;
  const { w, bonePos } = bodyWorldData(charAsset);
  const boneIdx = new Map(skel.bones.map((b, i) => [b.name, i]));
  const regions = item.regions.map((r) => {
    const set = new Set(r.bones instanceof RegExp ? [] : r.bones.map((n) => boneIdx.get(n)).filter((i) => i != null));
    if (r.bones instanceof RegExp) skel.bones.forEach((b, i) => { if (r.bones.test(b.name)) set.add(i); });
    return { set, along: r.along, minY: r.minY };
  });
  const si = geo.attributes.skinIndex, sw = geo.attributes.skinWeight, n = geo.attributes.position.count;
  const mask = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = 0; k < 4; k++) {
      const wt = sw.getComponent(i, k);
      if (wt <= 0) continue;
      const bi = si.getComponent(i, k);
      for (const r of regions) {
        if (!r.set.has(bi)) continue;
        // Hard in/out per vertex would make the cut follow the mesh's triangle edges (a jagged
        // staircase along a hem or waistline). A short linear ramp across the boundary makes the
        // interpolated value cross 0.5 exactly ON the boundary, so the fragment-shader discard
        // cuts a clean straight line through the triangles instead.
        let c = 1;
        if (r.minY != null) c *= ramp((w[i * 3 + 1] - r.minY) / EDGE_Y);
        if (r.along) {
          const child = CHILD[skel.bones[bi].name] && boneIdx.get(CHILD[skel.bones[bi].name]);
          if (child == null) continue;
          const a = bonePos[bi], d = bonePos[child].clone().sub(a);
          const t = (new THREE.Vector3(w[i * 3], w[i * 3 + 1], w[i * 3 + 2]).sub(a)).dot(d) / d.lengthSq();
          c *= ramp((t - r.along[0]) / EDGE_ALONG) * ramp((r.along[1] - t) / EDGE_ALONG);
        }
        if (c <= 0) continue;
        m += wt * c;
        break;
      }
    }
    mask[i] = m;
  }
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) if (geo.attributes[name]) g.setAttribute(name, geo.attributes[name]);
  g.setAttribute('clothW', new THREE.BufferAttribute(mask, 1));
  // Inflation direction: vertices duplicated along a UV seam share a position but not a normal, so
  // pushing each out along its OWN normal pries the seam open and skin shows through as a thin slit
  // (visible along the sleeve hems). Averaging the normals of coincident vertices moves both halves
  // the same way, so the seam stays closed.
  const nrm = geo.attributes.normal, key = (i) => `${Math.round(w[i * 3] * 1e4)},${Math.round(w[i * 3 + 1] * 1e4)},${Math.round(w[i * 3 + 2] * 1e4)}`;
  const acc = new Map();
  for (let i = 0; i < n; i++) {
    const k = key(i); let a = acc.get(k);
    if (!a) { a = [0, 0, 0]; acc.set(k, a); }
    a[0] += nrm.getX(i); a[1] += nrm.getY(i); a[2] += nrm.getZ(i);
  }
  const inflN = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const a = acc.get(key(i)), l = Math.hypot(a[0], a[1], a[2]) || 1; inflN[i * 3] = a[0] / l; inflN[i * 3 + 1] = a[1] / l; inflN[i * 3 + 2] = a[2] / l; }
  g.setAttribute('inflN', new THREE.BufferAttribute(inflN, 3));
  const src = geo.index.array, keep = [];
  for (let t = 0; t < src.length; t += 3) {
    if (Math.max(mask[src[t]], mask[src[t + 1]], mask[src[t + 2]]) >= 0.5) keep.push(src[t], src[t + 1], src[t + 2]);
  }
  g.setIndex(keep);
  charAsset.itemGeo.set(itemId, g);
  return g;
}

// Hair geometry re-pointed at this character's skeleton: the pack's hair meshes carry their own
// copy of the rig, so their skinIndex values refer to THAT skeleton's bone order — remap by name.
function hairGeometry(charAsset, file) {
  const key = file;
  const cached = charAsset.hairGeo.get(key);
  if (cached) return cached;
  const src = assets.hair[file];
  if (!src) return null;
  const idx = new Map(charAsset.body.skeleton.bones.map((b, i) => [b.name, i]));
  const map = src.skeleton.bones.map((b) => idx.get(b.name) ?? 0);
  const si = src.geometry.attributes.skinIndex, out = new Uint16Array(si.count * 4);
  for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) out[i * 4 + k] = map[si.getComponent(i, k)];
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv', 'skinWeight']) if (src.geometry.attributes[name]) g.setAttribute(name, src.geometry.attributes[name]);
  const native = HAIR_NATIVE[file];
  if (native && native !== charAsset.id) {
    const sign = native === 'female' ? 1 : -1; // female-authored on a male head goes up, male-authored on a female head goes down
    const pos = src.geometry.attributes.position.clone();
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) + sign * MALE_HEAD_OVER_FEMALE.x, pos.getY(i) + sign * MALE_HEAD_OVER_FEMALE.y, pos.getZ(i) + sign * MALE_HEAD_OVER_FEMALE.z);
    g.setAttribute('position', pos);
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(out, 4));
  g.setIndex(src.geometry.index);
  charAsset.hairGeo.set(key, g);
  return g;
}

function clothMaterial(item, colorHex) {
  const mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.85, metalness: 0.02 });
  mat.userData.uInflate = { value: item.inflate };
  mat.userData.uCamo = { value: item.camo ? 1 : 0 };
  mat.customProgramCacheKey = () => 'wreckveil-cloth';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uInflate = mat.userData.uInflate;
    shader.uniforms.uCamo = mat.userData.uCamo;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float clothW; attribute vec3 inflN; varying float vClothW; varying vec3 vRest; uniform float uInflate;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += inflN * uInflate; vClothW = clothW; vRest = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vClothW; varying vec3 vRest; uniform float uCamo;
float hsh(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hsh(i),hsh(i+vec3(1,0,0)),f.x), mix(hsh(i+vec3(0,1,0)),hsh(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(hsh(i+vec3(0,0,1)),hsh(i+vec3(1,0,1)),f.x), mix(hsh(i+vec3(0,1,1)),hsh(i+vec3(1,1,1)),f.x), f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
if (vClothW < 0.5) discard;
if (uCamo > 0.5) { float a = vnoise(vRest*9.0), b = vnoise(vRest*9.0+13.7); float m = step(0.52,a) + step(0.6,b);
  diffuseColor.rgb *= (m < 0.5 ? 1.0 : (m < 1.5 ? 0.62 : 0.34)); }`);
  };
  return mat;
}

function setTint(material, hex, texLinear) {
  material.color.set(hex).multiplyScalar(1 / texLinear);
}

// (Re)dresses a figure. `fig` needs: model (root of the cloned rig), bodyMesh, charId, bodyMaterial,
// eyebrowMaterials, and a dressMeshes array this function owns.
export function dressFigure(fig, appearance) {
  const app = sanitizeAppearance(appearance);
  const charAsset = assets.chars[fig.charId];
  for (const m of fig.dressMeshes) { m.parent?.remove(m); m.material.dispose(); }
  fig.dressMeshes.length = 0;

  const tex = assets.skinTex[fig.charId];
  if (tex) fig.bodyMaterial.map = tex;
  setTint(fig.bodyMaterial, app.skin, SKIN_NEUTRAL_LIN);
  fig.bodyMaterial.needsUpdate = true;
  for (const m of fig.eyebrowMaterials) setTint(m, app.hairColor, HAIR_TEXTURE_LIN);

  const attach = (mesh) => {
    mesh.frustumCulled = false;
    mesh.position.copy(fig.bodyMesh.position); mesh.quaternion.copy(fig.bodyMesh.quaternion); mesh.scale.copy(fig.bodyMesh.scale);
    fig.bodyMesh.parent.add(mesh);
    mesh.bind(fig.bodyMesh.skeleton, fig.bodyMesh.bindMatrix);
    fig.dressMeshes.push(mesh);
  };
  for (const slot of Object.keys(COLOR_FIELD)) {
    const id = app[slot];
    if (id === 'none' || !ITEMS[id]) continue;
    attach(new THREE.SkinnedMesh(itemGeometry(charAsset, id), clothMaterial(ITEMS[id], app[COLOR_FIELD[slot]])));
  }
  for (const [slot, color] of [['hair', app.hairColor], ['beard', app.hairColor]]) {
    const id = app[slot];
    const file = id !== 'none' && HAIR_FILES[id]?.[fig.charId];
    if (!file) continue;
    const geo = hairGeometry(charAsset, file);
    const srcMesh = assets.hair[file];
    if (!geo || !srcMesh) continue;
    const mat = srcMesh.material.clone();
    setTint(mat, color, HAIR_TEXTURE_LIN);
    attach(new THREE.SkinnedMesh(geo, mat));
  }
}

export { SLOTS, guestAppearance, sanitizeAppearance };
