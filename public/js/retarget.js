// Retargets our existing Quaternius animation clips (Idle_Loop, Walk_Loop, Sprint_Loop,
// Crouch_Idle_Loop) onto the "mixamorig"-skeleton operator characters (operators.js) — a
// completely different rig (different bone names AND different local bind-rotation conventions
// per bone, confirmed by comparing bind quaternions directly: Quaternius's upperarm_r sits at a
// ~90° local rotation from identity while mixamorig's RightArm sits near identity, so a naive
// "copy the track's local quaternion onto the same-named target bone" retarget would be wrong).
//
// Method: bind-pose delta retargeting (the standard technique, convention-independent). For each
// mapped bone, at each sampled frame: measure how far the SOURCE bone has rotated away from its
// own bind pose IN WORLD SPACE, then apply that same world-space rotation delta to the TARGET
// bone's bind pose, then convert back to the target's local space via its (freshly recomputed,
// parent-first) parent world rotation. This only assumes both rigs are in a comparable real-world
// T-pose at rest — true here since both were exported as T-pose — never that their per-bone local
// axes match, which they don't.
import * as THREE from 'three';

// Quaternius bone name -> mixamorig bone name. Built from a full 1:1 inspection of both skeletons
// (both are UE-mannequin-derived hierarchies with the same joint COUNT and topology, just different
// naming — this is a complete map, not a "close enough" subset: every animated Quaternius bone
// except `root` — which has no mixamorig equivalent since Hips IS that rig's root, and dropping it
// is a no-op since our looping clips carry no net root motion — has a target here).
export const QUAT_TO_MIXAMO = {
  pelvis: 'mixamorigHips', spine_01: 'mixamorigSpine', spine_02: 'mixamorigSpine1', spine_03: 'mixamorigSpine2',
  neck_01: 'mixamorigNeck', Head: 'mixamorigHead',
  clavicle_l: 'mixamorigLeftShoulder', upperarm_l: 'mixamorigLeftArm', lowerarm_l: 'mixamorigLeftForeArm', hand_l: 'mixamorigLeftHand',
  clavicle_r: 'mixamorigRightShoulder', upperarm_r: 'mixamorigRightArm', lowerarm_r: 'mixamorigRightForeArm', hand_r: 'mixamorigRightHand',
  thigh_l: 'mixamorigLeftUpLeg', calf_l: 'mixamorigLeftLeg', foot_l: 'mixamorigLeftFoot', ball_l: 'mixamorigLeftToeBase', ball_leaf_l: 'mixamorigLeftToe_End',
  thigh_r: 'mixamorigRightUpLeg', calf_r: 'mixamorigRightLeg', foot_r: 'mixamorigRightFoot', ball_r: 'mixamorigRightToeBase', ball_leaf_r: 'mixamorigRightToe_End',
};
for (const side of ['l', 'r']) {
  const M = side === 'l' ? 'Left' : 'Right';
  for (const [q, m] of [['index', 'Index'], ['middle', 'Middle'], ['pinky', 'Pinky'], ['ring', 'Ring'], ['thumb', 'Thumb']]) {
    for (let i = 1; i <= 3; i++) QUAT_TO_MIXAMO[`${q}_0${i}_${side}`] = `mixamorig${M}Hand${m}${i}`;
    QUAT_TO_MIXAMO[`${q}_04_leaf_${side}`] = `mixamorig${M}Hand${m}4`;
  }
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3();

// Retargets one clip onto one operator model. `srcModel` must be an UNPLAYED, fresh instance of the
// Quaternius body (its OWN bind pose is measured first) — never the shared template, since evaluating
// the clip on it moves its bones. `dstModel` is the operator's loaded (bind-pose) model.
export function retargetClip(clip, srcModel, dstModel, fps = 24) {
  srcModel.updateMatrixWorld(true);
  const pairs = Object.entries(QUAT_TO_MIXAMO)
    .map(([sName, dName]) => ({ sName, dName, sBone: srcModel.getObjectByName(sName), dBone: dstModel.getObjectByName(dName) }))
    .filter((p) => p.sBone && p.dBone);
  if (!pairs.length) return null;
  // Bind-pose world quaternions, both sides, measured once before any animation runs.
  for (const p of pairs) { p.sBindWorld = p.sBone.getWorldQuaternion(new THREE.Quaternion()); p.dBindWorld = p.dBone.getWorldQuaternion(new THREE.Quaternion()); p.dBindWorldInv = p.dBindWorld.clone().invert(); }
  const hips = pairs.find((p) => p.sName === 'pelvis');
  const hipsBindPos = hips ? hips.sBone.getWorldPosition(new THREE.Vector3()) : null;
  const dstHipsBindPos = hips ? hips.dBone.getWorldPosition(new THREE.Vector3()) : null;
  const dstHipsBindLocalPos = hips ? hips.dBone.position.clone() : null;
  // Sort by depth (parent before child) so each target bone's parent has already been resolved for
  // this frame when we need it to convert a world quaternion back to a local one.
  pairs.sort((a, b) => depthOf(a.dBone) - depthOf(b.dBone));
  const parentOf = new Map(pairs.map((p) => [p.dBone, p.dBone.parent]));
  const worldResult = new Map(); // dBone -> THREE.Quaternion, this frame

  // NOT paused: `AnimationAction._update` forces its own deltaTime to 0 whenever `paused` is true,
  // and mixer.setTime() ultimately routes through that same per-action update — so a paused action
  // ignores setTime() too and stays frozen at whatever pose it had the instant play() ran (found by
  // directly sampling a retargeted clip's own baked bone quaternions at several `t`s and seeing them
  // come back byte-identical: every clip for every operator was really only ever capturing ONE
  // static pose, repeated for the whole duration — the "walk cycle" that appeared to work in an
  // earlier render was actually 4 DIFFERENT clips each frozen at its own characteristic pose, which
  // happened to look like a walk cycle case coincidentally, not real per-frame motion). This mixer
  // is private to this one retargetClip() call and nothing else ever drives it, so there was never
  // anything to guard against by pausing it in the first place.
  const mixer = new THREE.AnimationMixer(srcModel);
  const action = mixer.clipAction(clip);
  action.play();

  const n = Math.max(2, Math.round(clip.duration * fps));
  const times = [], quatTracks = new Map(pairs.map((p) => [p.dName, []]));
  const hipsPos = [];
  for (let i = 0; i < n; i++) {
    const t = (clip.duration * i) / (n - 1);
    times.push(t);
    mixer.setTime(t);
    srcModel.updateMatrixWorld(true);
    worldResult.clear();
    for (const p of pairs) {
      const sWorld = p.sBone.getWorldQuaternion(_q); // how the source bone actually sits in world space right now
      const delta = sWorld.multiply(p.sBindWorld.clone().invert()); // rotation AWAY from source bind, in world space
      const dWorldTarget = delta.multiply(p.dBindWorld); // same world-space delta, applied to the target's own bind
      worldResult.set(p.dBone, dWorldTarget.clone());
      // The parent might be another mapped bone (use this frame's freshly computed value) or the
      // model's own (static) armature root / an unmapped ancestor — either way, its real current world
      // quaternion is what local-space conversion needs; falling back to identity would silently be
      // wrong if the FBX's root node carries any import coordinate-correction rotation.
      const parent = parentOf.get(p.dBone);
      const parentWorld = worldResult.get(parent) || parent.getWorldQuaternion(_q2);
      const local = parentWorld.clone().invert().multiply(dWorldTarget);
      quatTracks.get(p.dName).push(local.x, local.y, local.z, local.w);
    }
    if (hips) {
      const sPos = hips.sBone.getWorldPosition(_v).sub(hipsBindPos); // displacement from bind, in world units (cm, Quaternius scale)
      // scale by the target's own hip height so a shorter/taller operator doesn't sink into or float above the floor
      const scale = dstHipsBindPos.y / (hipsBindPos.y || 1);
      hipsPos.push(dstHipsBindLocalPos.x + sPos.x * scale, dstHipsBindLocalPos.y + sPos.y * scale, dstHipsBindLocalPos.z + sPos.z * scale);
    }
  }
  mixer.stopAllAction();
  const tracks = [...quatTracks.entries()].map(([name, values]) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values));
  if (hips) tracks.push(new THREE.VectorKeyframeTrack(`${hips.dName}.position`, times, hipsPos));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}
function depthOf(o) { let d = 0; for (let p = o; p && p.isBone; p = p.parent) d++; return d; }
