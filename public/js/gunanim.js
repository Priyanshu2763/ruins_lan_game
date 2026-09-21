// Per-gun fire and reload animation for the first-person viewmodel. The gun's real parts are moved (Glock
// slide, shotgun pump, AKM magazine — see splitGunParts in characters.js); where a gun has no such part
// (the AKM's charging handle, the Glock's magazine, shotgun shells) a small prop stands in.
//
// Everything is expressed in GUN space: metres at gun scale 1, +X barrel (forward), +Y up, +Z right. The
// reload timelines are timed to the moments in the three recorded reload clips (measured from their
// waveforms): AKM mag release 0.26s / seat 1.74s+2.07s / bolt 3.16s+3.33s; Glock mag out 0.24s / in 1.1-1.3s /
// slide 1.9s+2.19s; shotgun 4 shells ~1.0-2.35s / pump 2.82s+3.05s.
import * as THREE from 'three';
import { gunPart, setPartOffset, setPartVisible, cloneGunPartWorld, getGunGrip, getMuzzleAlongBarrel } from './characters.js';
import { spawnCasing, spawnSmoke, dropProp, buildShellMesh } from './weaponfx.js';

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const ease = (p) => p * p * (3 - 2 * p);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const lerp3 = (a, b, k, out) => out.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);

// port = where spent brass leaves the gun; flash/kick tuning per weapon
export const GUN_CFG = {
  0: { kind: 'rifle', port: V(0.098, 0.044, 0.02), kick: { z: 0.035, pitch: 0.055, decay: 14 }, flash: { size: 0.17, dur: 0.05, light: 2.2, smoke: 0.6, smokeSize: 0.07, smokeCount: 1 }, handleRest: V(0.095, 0.052, 0.03), handleTravel: 0.075 },
  1: { kind: 'shell', port: V(0.117, 0.03, 0.018), kick: { z: 0.10, pitch: 0.20, decay: 5.5 }, flash: { size: 0.36, dur: 0.09, light: 3.6, smoke: 1, smokeSize: 0.16, smokeCount: 3 }, pumpTravel: 0.09 },
  2: { kind: 'pistol', port: V(0.066, 0.034, 0.013), kick: { z: 0.04, pitch: 0.17, decay: 11 }, flash: { size: 0.12, dur: 0.04, light: 1.3, smoke: 0.4, smokeSize: 0.05, smokeCount: 1 }, slideTravel: 0.045 },
};

export function createGunAnim() {
  let rig = null, inst = null, weaponId = 0, restScale = 1;
  let shotT = 99, kick = 0, empty = false;
  let rT = -1, rDur = 3.5, fired = {};
  let handle = null, fxMag = null, fxShell = null, akmMagCenter = V(0.06, -0.06, 0), tmpBox = null;
  const out = { dpos: new THREE.Vector3(), drot: new THREE.Euler(), leftGrip: null, flash: null, shot: null };
  const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
  const grip = new THREE.Vector3();

  function bind(newRig) {
    rig = newRig; inst = null;
    if (!rig) return;
    // stand-in props, attached to the gun instances so they follow gun scale / visibility
    const akm = rig.heldGuns.get(0);
    if (akm) {
      handle = new THREE.Group(); handle.name = 'FxHandle';
      const mat = new THREE.MeshStandardMaterial({ color: 0x25272a, metalness: 0.7, roughness: 0.4 });
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.026, 8), mat); shaft.rotation.x = Math.PI / 2; handle.add(shaft);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0072, 10, 8), mat); knob.position.z = 0.014; handle.add(knob);
      handle.position.copy(GUN_CFG[0].handleRest); akm.add(handle);
    }
    const glock = rig.heldGuns.get(2);
    if (glock) {
      fxMag = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.062, 0.016), new THREE.MeshStandardMaterial({ color: 0x1d1f21, metalness: 0.6, roughness: 0.45 }));
      fxMag.name = 'FxMag'; fxMag.visible = false; glock.add(fxMag);
    }
    const sg = rig.heldGuns.get(1);
    if (sg) { fxShell = buildShellMesh(); fxShell.name = 'FxShell'; fxShell.visible = false; sg.add(fxShell); }
    const m = gunPart(rig, 0, 'mag'); if (m) akmMagCenter = m.center.clone();
  }
  function setWeapon(id, scale) {
    if (id !== weaponId) { resetParts(); cancelReload(); weaponId = id; kick = 0; shotT = 99; }
    restScale = scale; inst = rig ? rig.heldGuns.get(id) : null;
  }
  function resetParts() {
    if (!rig) return;
    setPartOffset(rig, 0, 'mag', 0, 0, 0); setPartVisible(rig, 0, 'mag', true);
    setPartOffset(rig, 1, 'pump', 0);
    setPartOffset(rig, 2, 'slide', empty && weaponId === 2 ? -GUN_CFG[2].slideTravel : 0);
    if (handle) handle.position.copy(GUN_CFG[0].handleRest);
    if (fxMag) fxMag.visible = false; if (fxShell) fxShell.visible = false;
  }
  const gunToWorld = (p) => inst.localToWorld(p.clone());
  const gunDirToWorld = (d) => { inst.getWorldQuaternion(_q); return d.clone().applyQuaternion(_q); };

  // ---- firing ----
  function onShot(id, isEmptyAfter) {
    const c = GUN_CFG[id]; if (!c || !inst) return;
    shotT = 0; kick = 1;
    if (id === 2 && isEmptyAfter) empty = true;
    fired.eject = false; fired.smoke = false;
    out.shot = { id, muzzle: true };
  }
  // ejection + smoke happen a hair after the shot (once per shot)
  function shotEffects(id) {
    const c = GUN_CFG[id];
    if (!fired.smoke && shotT >= 0.004) {
      fired.smoke = true;
      const mz = gunToWorld(V(getMuzzle(id), 0.01, 0));
      if (Math.random() < c.flash.smoke) for (let i = 0; i < c.flash.smokeCount; i++) spawnSmoke(mz, gunDirToWorld(V(1, 0.1, 0)), c.flash.smokeSize);
    }
    // rifle / pistol brass leaves with the shot; the shotgun's shell comes out with the pump (below)
    if (!fired.eject && c.kind !== 'shell' && shotT >= 0.012) {
      fired.eject = true; ejectBrass(c.kind, c.port);
    }
  }
  function getMuzzle(id) { return getMuzzleAlongBarrel(id); }
  function ejectBrass(kind, port) {
    if (!inst) return;
    const pos = gunToWorld(port);
    const back = -0.3 + Math.random() * 0.3, up = 1.1 + Math.random() * 0.6, right = 1.9 + Math.random() * 0.8;
    const vel = gunDirToWorld(V(back, up, right));
    spawnCasing(kind, pos, vel);
  }

  // ---- reload ----
  function startReload(id, ms) {
    if (!rig || !GUN_CFG[id]) return;
    rT = 0; rDur = ms / 1000; fired = { eject: true, smoke: true };
  }
  function cancelReload() {
    if (rT < 0) return;
    rT = -1; fired = {};
    resetParts();
  }
  const isReloading = () => rT >= 0;
  function setEmpty(v, id) { if (id === 2) { empty = v; if (rT < 0 && rig) setPartOffset(rig, 2, 'slide', v ? -GUN_CFG[2].slideTravel : 0); } }

  function dropSpentMag() {
    if (weaponId === 0) {
      const c = cloneGunPartWorld(rig, 0, 'mag'); if (!c) return;
      c.worldMatrix.decompose(c.mesh.position, c.mesh.quaternion, c.mesh.scale);
      dropProp(c.mesh, gunDirToWorld(V(0.05, -0.8, 0.25)), V(2 + Math.random() * 2, 1.2, -2.2));
      setPartVisible(rig, 0, 'mag', false);
    } else if (weaponId === 2) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.062, 0.016), new THREE.MeshStandardMaterial({ color: 0x1d1f21, metalness: 0.6, roughness: 0.45 }));
      box.position.copy(gunToWorld(V(0.004, -0.03, 0))); inst.getWorldQuaternion(box.quaternion);
      dropProp(box, gunDirToWorld(V(0.05, -0.7, 0.2)), V(1.5 + Math.random() * 2, 0.8, -1.5));
    }
  }

  // Returns the pose modifiers for this frame.
  function update(dt) {
    out.dpos.set(0, 0, 0); out.drot.set(0, 0, 0); out.leftGrip = null; out.shot = null;
    if (!rig || !inst) return out;
    const c = GUN_CFG[weaponId];
    if (!c) return out;
    shotT += dt; kick = Math.max(0, kick - dt * c.kick.decay);
    // recoil: back toward the camera and pitched up
    out.dpos.z += kick * c.kick.z; out.dpos.y += kick * c.kick.z * 0.25; out.drot.x += kick * c.kick.pitch;
    if (shotT < 0.5) shotEffects(weaponId);

    const g0 = getGunGrip(weaponId, 'left');
    // ---- fire cycles (only while not reloading) ----
    if (rT < 0) {
      if (weaponId === 0 && handle) { // AKM: charging handle / bolt carrier reciprocates once per shot
        const f = shotT < 0.03 ? shotT / 0.03 : Math.max(0, 1 - (shotT - 0.03) / 0.055);
        handle.position.copy(c.handleRest); handle.position.x -= c.handleTravel * f;
      }
      if (weaponId === 1) { // Shotgun: pump (back 0.20-0.33s, forward 0.48-0.665s — matches the pump clip's two clacks)
        const back = ease(seg(shotT, 0.20, 0.33)), fwd = ease(seg(shotT, 0.48, 0.665));
        const f = back * (1 - fwd);
        setPartOffset(rig, 1, 'pump', -c.pumpTravel * f);
        out.leftGrip = grip.copy(g0); out.leftGrip.x -= c.pumpTravel * f;
        if (!fired.eject && shotT >= 0.33) { fired.eject = true; ejectBrass('shell', c.port); }
        if (f === 0 && shotT > 0.7) out.leftGrip = null;
      }
      if (weaponId === 2) { // Glock: slide back and forward (stays back on an empty magazine)
        const f = empty ? 1 : shotT < 0.02 ? shotT / 0.02 : Math.max(0, 1 - (shotT - 0.02) / 0.05);
        setPartOffset(rig, 2, 'slide', -c.slideTravel * f);
      }
      return out;
    }

    // ---- reload timelines ----
    rT += dt;
    const t = rT;
    if (weaponId === 0) reloadAkm(t, g0);
    else if (weaponId === 1) reloadShotgun(t, g0);
    else reloadGlock(t, g0);
    if (rT >= rDur) { rT = -1; resetParts(); fired = {}; }
    return out;
  }

  // ---- AKM ----
  function reloadAkm(t, g0) {
    const M = akmMagCenter, below = V(M.x, M.y - 0.10, M.z), belt = V(M.x - 0.04, M.y - 0.52, M.z - 0.20);
    const cant = ease(seg(t, 0, 0.35)) * (1 - ease(seg(t, 2.3, 2.9)));
    // lift the gun toward the eyes and roll it so the magazine well faces the player (otherwise the well is
    // below the bottom of the screen and the whole reload happens out of sight)
    out.dpos.x -= 0.075 * cant; out.dpos.y += 0.085 * cant; out.dpos.z += 0.02 * cant; out.drot.z += 0.85 * cant; out.drot.x += 0.50 * cant; out.drot.y -= 0.20 * cant;
    const hand = grip;
    if (t < 0.26) lerp3(g0, below, ease(seg(t, 0.02, 0.26)), hand);
    else if (t < 0.75) lerp3(below, belt, ease(seg(t, 0.26, 0.75)), hand);
    else if (t < 1.25) hand.copy(belt);
    else if (t < 1.55) lerp3(belt, below, ease(seg(t, 1.25, 1.55)), hand);
    else if (t < 1.735) lerp3(below, M, ease(seg(t, 1.55, 1.735)), hand);
    else if (t < 2.1) hand.copy(M);
    else lerp3(M, g0, ease(seg(t, 2.1, 2.7)), hand);
    out.leftGrip = hand;
    if (t >= 0.26 && !fired.drop) { fired.drop = true; dropSpentMag(); }
    // the fresh magazine rides in the hand, then seats into the well
    if (t >= 1.25 && t < 1.735) { setPartVisible(rig, 0, 'mag', true); setPartOffset(rig, 0, 'mag', hand.x - M.x, hand.y - M.y, hand.z - M.z); }
    else if (t >= 1.735) { setPartVisible(rig, 0, 'mag', true); setPartOffset(rig, 0, 'mag', 0, 0, 0); }
    if (t >= 1.735 && !fired.seat) { fired.seat = true; kick = Math.max(kick, 0.55); }
    if (t >= 2.07 && !fired.seat2) { fired.seat2 = true; kick = Math.max(kick, 0.3); }
    // charging handle: racked back at 3.16, released at 3.325
    if (handle) { const f = ease(seg(t, 3.08, 3.16)) * (1 - ease(seg(t, 3.24, 3.325))); handle.position.copy(GUN_CFG[0].handleRest); handle.position.x -= GUN_CFG[0].handleTravel * f; }
  }

  // ---- Glock ----
  function reloadGlock(t, g0) {
    const under = V(0.004, -0.10, 0), belt = V(-0.03, -0.42, -0.20), grab = V(0.012, 0.036, -0.022);
    const cant = ease(seg(t, 0, 0.25)) * (1 - ease(seg(t, 1.3, 1.6)));
    out.dpos.x -= 0.04 * cant; out.dpos.y += 0.085 * cant; out.dpos.z += 0.02 * cant; out.drot.z += 0.85 * cant; out.drot.x += 0.55 * cant; out.drot.y -= 0.20 * cant;
    const hand = grip;
    if (t < 0.24) lerp3(g0, under, ease(seg(t, 0.03, 0.24)), hand);
    else if (t < 0.65) lerp3(under, belt, ease(seg(t, 0.24, 0.65)), hand);
    else if (t < 0.8) hand.copy(belt);
    else if (t < 1.05) lerp3(belt, under, ease(seg(t, 0.8, 1.05)), hand);
    else if (t < 1.275) lerp3(under, V(0.004, -0.045, 0), ease(seg(t, 1.05, 1.275)), hand);
    else if (t < 1.55) lerp3(V(0.004, -0.045, 0), grab, ease(seg(t, 1.275, 1.55)), hand);
    else if (t < 1.9) hand.copy(grab);
    else lerp3(grab, g0, ease(seg(t, 2.05, 2.3)), hand);
    // slide: pulled back 1.6-1.9 (the hand grips it and moves with it), released forward at 2.19. On an empty
    // magazine the slide is already locked back, so the hand simply grabs it there and lets go.
    const slideBack = (empty ? 1 : ease(seg(t, 1.6, 1.9))) * (1 - ease(seg(t, 2.19, 2.25)));
    if (t >= 1.275 && t < 2.3) hand.x -= GUN_CFG[2].slideTravel * slideBack;
    out.leftGrip = hand;
    if (t >= 0.24 && !fired.drop) { fired.drop = true; dropSpentMag(); }
    // the fresh magazine: rises in the hand, slides up into the grip and disappears into the frame
    if (fxMag) {
      const inHand = t >= 0.8 && t < 1.275;
      fxMag.visible = inHand;
      if (inHand) fxMag.position.set(hand.x, hand.y + 0.06, hand.z);
    }
    setPartOffset(rig, 2, 'slide', -GUN_CFG[2].slideTravel * slideBack);
    if (t >= 2.19 && empty) empty = false; // released: the slide is forward and the gun is loaded
    if (t >= 2.19 && !fired.snap) { fired.snap = true; kick = Math.max(kick, 0.5); }
  }

  // ---- Shotgun ----
  function reloadShotgun(t, g0) {
    const port = V(0.11, -0.03, 0.0), belt = V(0.02, -0.46, -0.22);
    const cant = ease(seg(t, 0, 0.5)) * (1 - ease(seg(t, 2.6, 3.2)));
    out.dpos.x -= 0.06 * cant; out.dpos.y += 0.07 * cant; out.dpos.z += 0.02 * cant; out.drot.z += 0.80 * cant; out.drot.x += 0.45 * cant; out.drot.y -= 0.20 * cant;
    const hand = grip; let shellVisible = false;
    const T0 = [1.0, 1.45, 1.9, 2.35], PERIOD = 0.45;
    if (t < 0.75) lerp3(g0, belt, ease(seg(t, 0.15, 0.75)), hand);
    else if (t < T0[0] - PERIOD / 2) hand.copy(belt);
    else if (t < T0[3] + PERIOD / 2) {
      // ping-pong belt <-> loading port with period 0.45 s, reaching the port exactly at each insertion time
      const phase = (t - T0[0]) / PERIOD;
      lerp3(belt, port, 0.5 + 0.5 * Math.cos(phase * Math.PI * 2), hand);
      // a shell is in the hand while it travels belt -> port (the half cycle before each insertion)
      const frac = ((phase % 1) + 1) % 1;
      shellVisible = frac >= 0.5 && t <= T0[3];
    } else if (t < 2.75) lerp3(belt, g0, ease(seg(t, T0[3] + PERIOD / 2, 2.75)), hand);
    else hand.copy(g0);
    out.leftGrip = hand;
    if (fxShell) { fxShell.visible = shellVisible; if (shellVisible) fxShell.position.set(hand.x, hand.y + 0.03, hand.z + 0.02); }
    for (let i = 0; i < 4; i++) if (t >= T0[i] && !fired['s' + i]) { fired['s' + i] = true; kick = Math.max(kick, 0.18); }
    // closing pump: back at 2.82, forward at 3.05; the hand rides the fore-end
    const pf = ease(seg(t, 2.66, 2.82)) * (1 - ease(seg(t, 2.95, 3.05)));
    if (t >= 2.6) { setPartOffset(rig, 1, 'pump', -GUN_CFG[1].pumpTravel * pf); const h2 = grip.copy(g0); h2.x -= GUN_CFG[1].pumpTravel * pf; out.leftGrip = h2; }
  }

  return { bind, setWeapon, onShot, startReload, cancelReload, isReloading, setEmpty, update, gunToWorld: (p) => (inst ? gunToWorld(p) : p) };
}
