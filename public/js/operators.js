// "Operators": the 8 predefined named characters (Mixamo — different skeleton than our Quaternius
// "Custom" bodies, "mixamorig"-prefixed bone names) selectable as an alternative to the Custom
// closet system. They keep their own original clothes (each is one hand-authored outfit, not
// modular like our closet); `stripClothes` hides the separate garment mesh(es) WHERE the source
// model actually has them as distinct pieces (checked per-operator, see GARMENT_MESHES) — for the
// others the whole character is one fused body+clothes mesh with nothing to strip, so the toggle is
// a real no-op there today, flagged in the UI rather than silently pretending to work. This file
// depends only on three.js + retarget.js — never on characters.js — so characters.js can import
// this one-directionally with no cycle; whatever this needs FROM the Quaternius template (a source
// body to retarget clips FROM) is passed in as arguments, not imported.
import * as THREE from 'three';
import { FBXLoader } from '/vendor/three-examples/loaders/FBXLoader.js';
import { retargetClip } from './retarget.js';
import { OPERATORS, CAN_STRIP_CLOTHES } from '/shared/appearance.js';
export { OPERATORS };
const OPERATOR_IDS = new Set(OPERATORS.map((o) => o.id));
export function isOperatorId(id) { return OPERATOR_IDS.has(id); }

// Mesh NAMES that are real separate garment pieces on top of the body, per operator — found by
// inspecting each FBX's own skinned-mesh list. Every operator not listed here is one fused
// body+clothes mesh with nothing separable (confirmed: meshes.length === 1 for all of them).
const GARMENT_MESHES = {
  neo: ['Tops', 'Bottoms', 'Shoes'],
  katniss: ['Erika_Archer_Clothes_Mesh'],
};
export function canStripClothes(id) { return CAN_STRIP_CLOTHES.has(id); }

const CLIP_NAMES = ['Idle_Loop', 'Walk_Loop', 'Sprint_Loop', 'Crouch_Idle_Loop', 'Crouch_Fwd_Loop'];
const TARGET_HEIGHT = 1.82; // matches the Quaternius bodies (see characters.js) so the same world scale/camera height applies

const fbxLoader = new FBXLoader();
const templates = new Map(); // id -> { model, clips: Map<name, AnimationClip>, garmentMeshNames }
const loading = new Map();

// Merges an operator's duplicate per-mesh bone hierarchies (a real quirk of these files — each
// skinned mesh arrived with its OWN full copy of the skeleton rather than sharing one, confirmed by
// traversing the raw scene graph and finding e.g. 3 separate "mixamorigHips" root bones) into ONE
// shared skeleton, the same skinIndex-remap technique already used for hair in dress.js. Without
// this, animating "the" mixamorigHips only moves whichever duplicate the mixer happened to bind to,
// leaving the other meshes frozen in their bind pose — and leaves duplicate-named bones in the tree
// that a later getObjectByName() could grab by mistake.
function mergeSkeletons(root) {
  const meshes = []; root.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  if (meshes.length <= 1) return;
  meshes.sort((a, b) => b.skeleton.bones.length - a.skeleton.bones.length);
  const primary = meshes[0].skeleton;
  const indexByName = new Map(primary.bones.map((b, i) => [b.name, i]));
  for (const mesh of meshes) {
    if (mesh.skeleton === primary) continue;
    const remap = mesh.skeleton.bones.map((b) => indexByName.get(b.name));
    if (remap.some((i) => i === undefined)) continue; // a name this skeleton has that the primary doesn't — skip rather than corrupt
    const si = mesh.geometry.attributes.skinIndex;
    for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) si.setComponent(i, k, remap[si.getComponent(i, k)]);
    si.needsUpdate = true;
    mesh.bind(primary, mesh.matrixWorld);
  }
  const roots = new Set();
  root.traverse((o) => { if (o.isBone && !(o.parent && o.parent.isBone)) roots.add(o); });
  let keep = primary.bones[0]; while (keep.parent && keep.parent.isBone) keep = keep.parent;
  for (const rt of roots) if (rt !== keep && rt.parent) rt.parent.remove(rt); // drops the whole orphaned duplicate chain in one call
}

// `makeSrcModel` = a factory returning a FRESH, unplayed clone of the Quaternius male body each
// call — retargetClip scrubs whatever model it's given through the whole clip via an internal
// mixer, so reusing one instance across multiple clips would leave it posed at the END of the
// previous clip instead of true bind pose, corrupting every retarget after the first. `srcClips`
// = Map<name, AnimationClip> from that same (already-loaded) template. Both supplied by
// characters.js so this module never has to import it.
export async function loadOperator(id, makeSrcModel, srcClips) {
  if (templates.has(id)) return templates.get(id);
  if (loading.has(id)) return loading.get(id);
  const p = (async () => {
    const model = await fbxLoader.loadAsync(`/models/operators/${id}.fbx`);
    mergeSkeletons(model);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const s = TARGET_HEIGHT / size.y;
    model.scale.setScalar(s);
    model.position.y -= box.min.y * s; // feet at y=0, matching how the Quaternius bodies are set up
    model.updateMatrixWorld(true);
    const clips = new Map();
    for (const name of CLIP_NAMES) {
      const src = srcClips.get(name);
      const rt = src && retargetClip(src, makeSrcModel(), model);
      if (rt) clips.set(name, rt);
    }
    let bodyMesh = null, maxVerts = -1; const allMeshes = [];
    model.traverse((o) => { if (o.isSkinnedMesh) { allMeshes.push(o); o.frustumCulled = false; const n = o.geometry.attributes.position.count; if (n > maxVerts) { maxVerts = n; bodyMesh = o; } } });
    const garmentNames = new Set(GARMENT_MESHES[id] || []);
    const garmentMeshNames = allMeshes.filter((m) => garmentNames.has(m.name)).map((m) => m.name);
    const t = { model, clips, bodyMesh, allMeshes, garmentMeshNames };
    templates.set(id, t);
    return t;
  })();
  loading.set(id, p);
  return p;
}
export function getLoadedOperator(id) { return templates.get(id) || null; }
