import * as THREE from 'three';
import { FLOOR, getMapLayout, MAPS, DEFAULT_MAP } from '/shared/gameData.js';
import { state } from './state.js';
import { isTouchDevice } from './touchDetect.js';

const gameContainer = document.getElementById('gameContainer');

const textureLoader = new THREE.TextureLoader();
const photoTexCache = {};
export function loadPhotoTexture(url) {
  if (!photoTexCache[url]) photoTexCache[url] = textureLoader.load(url);
  return photoTexCache[url];
}

// A painted horizon wrapped around the whole arena, same trick as a matte painting: draw one
// illustrated skyline on canvas — bright midday sky, drifting clouds, a hazy downtown skyline —
// and wrap it around a big cylinder, instead of the flat single-color background. It never has
// to hold up to being viewed close, because at this radius it never is.
function buildHorizonTexture(theme) {
  const dusk = theme === 'dusk';
  const W = 2048, H = 560;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.62);
  if (dusk) {
    sky.addColorStop(0.0, '#241f16'); sky.addColorStop(0.45, '#5a4423');
    sky.addColorStop(0.78, '#9c7233'); sky.addColorStop(1.0, '#d3a24c');
  } else {
    sky.addColorStop(0.0, '#3f8fe0'); sky.addColorStop(0.55, '#8fc3f0');
    sky.addColorStop(0.85, '#cfe6f5'); sky.addColorStop(1.0, '#eaf3f5');
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  if (dusk) {
    // sparse haze motes instead of a bright sun/clouds — a dying-light warzone mood
    ctx.fillStyle = 'rgba(255,225,190,0.3)';
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * W, y = Math.random() * H * 0.35;
      ctx.fillRect(x, y, Math.random() < 0.15 ? 2 : 1, Math.random() < 0.15 ? 2 : 1);
    }
  } else {
    // sun disc, high and bright, with a soft glow — the actual light comes from the
    // directional light, this is just the visible anchor for "the sun is up"
    const sunX = W * 0.24, sunY = H * 0.16;
    const sunGlow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 130);
    sunGlow.addColorStop(0, 'rgba(255,252,230,1)');
    sunGlow.addColorStop(0.25, 'rgba(255,248,210,0.85)');
    sunGlow.addColorStop(1, 'rgba(255,248,210,0)');
    ctx.fillStyle = sunGlow;
    ctx.fillRect(sunX - 130, sunY - 130, 260, 260);
    ctx.fillStyle = '#fffdf2';
    ctx.beginPath(); ctx.arc(sunX, sunY, 34, 0, Math.PI * 2); ctx.fill();

    function cloud(cx, cy, scale) {
      const puffs = [[0, 0, 1], [0.9, 0.1, 0.75], [-0.9, 0.15, 0.7], [0.35, -0.3, 0.65], [-0.4, -0.25, 0.6]];
      for (const [dx, dy, s] of puffs) {
        const r = 60 * scale * s;
        const x = cx + dx * 90 * scale, y = cy + dy * 40 * scale;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.7, 'rgba(255,255,255,0.75)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    for (let i = 0; i < 7; i++) {
      cloud(Math.random() * W, H * 0.1 + Math.random() * H * 0.28, 0.6 + Math.random() * 0.9);
    }
  }

  if (dusk) {
    // Ruins horizon: jagged lava-mountain hills with glowing branching cracks, not a city
    // skyline — same "pin start/end height" trick so the 360 wrap has no seam, ported from
    // the volcanic-horizon technique in the sibling ~/a/games/ascend project.
    function lavaRidge(baseY, amp, segs, top, bottom) {
      const ys = [baseY];
      let y = baseY;
      for (let i = 1; i < segs; i++) {
        y += (Math.random() - 0.5) * amp;
        y = Math.max(baseY - amp * 2.2, Math.min(baseY + amp * 0.6, y));
        ys.push(y);
      }
      ys.push(baseY);
      const tail = Math.min(4, segs - 1);
      for (let k = 0; k < tail; k++) {
        const idx = segs - tail + k, t = (k + 1) / (tail + 1);
        ys[idx] = ys[idx] * (1 - t) + baseY * t;
      }
      const step = W / segs;
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i <= segs; i++) {
        ctx.lineTo(i * step, ys[i]);
        if (Math.random() < 0.45 && i < segs) ctx.lineTo(i * step + step * 0.5, ys[i] - amp * (0.4 + Math.random() * 0.9));
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, baseY - amp * 2, 0, H);
      g.addColorStop(0, top); g.addColorStop(1, bottom);
      ctx.fillStyle = g;
      ctx.fill();
    }
    function lavaCrack(x0, y0, len, angle, width) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,140,40,0.9)';
      ctx.shadowColor = 'rgba(255,120,30,0.9)';
      ctx.shadowBlur = 12;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      (function branch(x, y, a, len, depth) {
        const segs = 4 + Math.floor(Math.random() * 4);
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let s = 0; s < segs; s++) {
          a += (Math.random() - 0.5) * 1.3;
          const stepLen = (len / segs) * (0.7 + Math.random() * 0.6);
          x += Math.cos(a) * stepLen; y += Math.sin(a) * stepLen;
          ctx.lineTo(x, y);
          if (depth > 0 && Math.random() < 0.35 && s < segs - 1) {
            branch(x, y, a + (Math.random() < 0.5 ? -1 : 1) * 0.8, len * 0.5, depth - 1);
          }
        }
        ctx.stroke();
      })(x0, y0, angle, len, 1);
      ctx.restore();
    }
    lavaRidge(H * 0.5, 40, 16, '#1c0906', '#120502');
    lavaRidge(H * 0.58, 62, 12, '#0d0402', '#050201');
    for (let i = 0; i < 9; i++) {
      const x0 = (i + 0.5) * (W / 9) + (Math.random() - 0.5) * 60;
      lavaCrack(x0, H * 0.5 + Math.random() * 40, 70 + Math.random() * 60, Math.PI / 2 - 0.2 + Math.random() * 0.4, 2 + Math.random() * 1.5);
    }
  } else {
    // hazy downtown skyline — pinned to match height at x=0 and x=W so the 360 wrap has no seam
    function skyline(baseY, segs, colorFar) {
      const step = W / segs;
      ctx.fillStyle = colorFar;
      let prevH = 40 + Math.random() * 60;
      const firstH = prevH;
      for (let i = 0; i < segs; i++) {
        const isLast = i === segs - 1;
        const bh = isLast ? firstH : 40 + Math.random() * 130;
        const bw = step * (0.55 + Math.random() * 0.4);
        const bx = i * step + (step - bw) / 2;
        ctx.fillRect(bx, baseY - bh, bw, bh);
        // a damaged/jagged roofline on some buildings, keeping the "ruins" identity
        if (Math.random() < 0.4) {
          ctx.beginPath();
          ctx.moveTo(bx, baseY - bh);
          ctx.lineTo(bx + bw * 0.3, baseY - bh - 16 - Math.random() * 20);
          ctx.lineTo(bx + bw * 0.6, baseY - bh + 8);
          ctx.lineTo(bx + bw, baseY - bh);
          ctx.closePath();
          ctx.fill();
        }
        prevH = bh;
      }
    }
    skyline(H * 0.62, 22, 'rgba(120,140,160,0.55)'); // far, hazier
    skyline(H * 0.64, 16, 'rgba(90,105,120,0.75)'); // near, clearer
  }

  const baseGrad = ctx.createLinearGradient(0, H * 0.9, 0, H);
  if (dusk) { baseGrad.addColorStop(0, 'rgba(10,8,5,0)'); baseGrad.addColorStop(1, 'rgba(8,6,4,1)'); }
  else { baseGrad.addColorStop(0, 'rgba(60,68,74,0)'); baseGrad.addColorStop(1, 'rgba(50,58,64,1)'); }
  ctx.fillStyle = baseGrad;
  ctx.fillRect(0, H * 0.9, W, H * 0.1);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.x = 3;
  return tex;
}

function buildHorizon(theme) {
  const tex = buildHorizonTexture(theme);
  const geo = new THREE.CylinderGeometry(170, 170, 240, 32, 1, true);
  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, 30, 0);
  state.scene.add(mesh);

  // Ruins ("dusk") only — the cylinder is deliberately open-ended (no top cap), so looking
  // straight up past its rim (world y=150) falls through to the bare flat scene.background
  // color with zero painted detail, reading as a literal hole dead-center overhead against an
  // otherwise fully-painted sunset/lava sky. City's flat blue zenith already looks correct as
  // real skies ARE just uniform blue overhead, so this stays scoped to dusk — City's rendering
  // is completely untouched. Solid disc, not a texture: cheap, and the color is an exact match
  // to the horizon texture's own top-edge pixel (buildHorizonTexture's sky gradient, offset 0)
  // so it meets the cylinder's rim with no visible seam.
  if (theme === 'dusk') {
    // A flat single-color disc here (the first attempt at this fix) still read as an obvious
    // hard-edged "different patch" — no gradient, no fog treatment, nothing tying it visually
    // to the rest of the painted sky, so it looked like a hole even though it was technically
    // covered. Real fix: a radial-gradient texture, same painted-canvas technique as every
    // other sky/wall texture in this file, so the cap actually continues the horizon's own
    // color instead of standing apart from it.
    const capSize = 256;
    const capCanvas = document.createElement('canvas');
    capCanvas.width = capSize; capCanvas.height = capSize;
    const capCtx = capCanvas.getContext('2d');
    const capGrad = capCtx.createRadialGradient(capSize / 2, capSize / 2, 0, capSize / 2, capSize / 2, capSize / 2);
    capGrad.addColorStop(0, '#1c150d'); // zenith -- a touch deeper than the rim, a real dusk sky keeps darkening overhead
    capGrad.addColorStop(1, '#241f16'); // rim edge -- exact match to the horizon texture's own top-edge color (see buildHorizonTexture's sky gradient, offset 0), so the seam is invisible
    capCtx.fillStyle = capGrad;
    capCtx.fillRect(0, 0, capSize, capSize);
    const capTex = new THREE.CanvasTexture(capCanvas);
    const capGeo = new THREE.CircleGeometry(172, 32); // slightly past the cylinder's own 170 radius, so there's no sliver gap right at the rim
    const capMat = new THREE.MeshBasicMaterial({ map: capTex, side: THREE.DoubleSide, fog: false, depthWrite: false });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.rotation.x = Math.PI / 2; // flat, facing down toward the camera below
    cap.position.set(0, 150, 0); // cylinder's own top: mesh.position.y(30) + height/2(120)
    state.scene.add(cap);
  }
}

// A shared concrete-crack-and-graffiti texture applied (with a per-obstacle color tint) to
// every wall — replaces the old flat single-color materials, which is a big part of why
// everything read as dull. One texture, many tinted materials: cheap to share.
// Decorative-only thick grass tufts (Ruins extension) — purely visual cover, not a collision
// or line-of-sight system (bullets shouldn't be stopped by grass); it just breaks up the
// ground clutter enough that a prone player actually blends in a bit. One InstancedMesh per
// patch (a handful of randomly placed/rotated thin cone "blades") keeps this cheap.
// Real photo (grass.png, background-removed) on crossed alpha-tested planes — a classic
// cheap-but-convincing "3D grass clump" technique, two perpendicular cards per clump so it
// reads from most angles, not just face-on. Denser/bigger than a first pass at this would be —
// "thick enough to actually hide a prone player in", not a light dusting of blades.
// grass.png's own background-removal crop wasn't tight — the blades only occupy the middle
// ~67% of the image vertically (rows 34-270 of 335), leaving a real ~19% fully-transparent
// margin below them (and ~10% above). alphaTest discards that margin so it never draws, but
// the PLANE's geometric bottom edge (where it used to be seated at ground level) sat a fifth of
// the plane's height BELOW where the actual visible blades start — every clump floated with a
// real gap underneath, not a rendering illusion (measured directly off the PNG's alpha
// channel, not eyeballed: 64px transparent margin / 335px tall / 0.95 plane height).
const GRASS_BOTTOM_MARGIN_Y = (64 / 335) * 0.95;
function buildGrassPatches(patches) {
  const grassTex = loadPhotoTexture('/images/grass.png');
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.9 });
  const planeGeo = new THREE.PlaneGeometry(1.4, 0.95);
  const dummy = new THREE.Object3D();
  for (const patch of patches) {
    // Dense enough that adjacent clumps' foliage actually overlaps — a prone player (very low
    // silhouette) should have no clean sightline through it from most angles, not just "some
    // grass nearby". A sparse scatter with visible gaps of bare dirt doesn't hide anyone.
    const clumps = Math.round(patch.r * patch.r * 1.8);
    const mesh = new THREE.InstancedMesh(planeGeo, grassMat, clumps * 2);
    let i = 0;
    for (let c = 0; c < clumps; c++) {
      const ang = Math.random() * Math.PI * 2;
      const dist = Math.sqrt(Math.random()) * patch.r; // sqrt so density stays even out to the edge, not center-biased
      const cx = patch.x + Math.cos(ang) * dist, cz = patch.z + Math.sin(ang) * dist;
      const s = 1.1 + Math.random() * 0.8;
      const baseRot = Math.random() * Math.PI;
      for (const rot of [baseRot, baseRot + Math.PI / 2]) {
        dummy.position.set(cx, (0.475 - GRASS_BOTTOM_MARGIN_Y) * s, cz);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.set(s, s, s);
        dummy.updateMatrix();
        mesh.setMatrixAt(i++, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    state.scene.add(mesh);
  }
}

// Rusted drums (real photo on the barrel's side, a plain dark cap top/bottom — the photo is a
// single angled shot, not a seamless wrap, so it goes where it reads best) and stacked tires
// (plain dark rubber tori — no photo needed, a procedural ring already reads fine as a tire).
// Sized to actually block a crouching/prone silhouette, not just decorate the ground.
function buildPropMeshes(drums, tires) {
  if (drums.length) {
    const drumTex = loadPhotoTexture('/images/drum.png');
    const sideMat = new THREE.MeshStandardMaterial({ map: drumTex, roughness: 0.6, metalness: 0.4 });
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2e2a24, roughness: 0.7, metalness: 0.3 });
    const geo = new THREE.CylinderGeometry(0.47, 0.47, 1.15, 14);
    for (const d of drums) {
      const mesh = new THREE.Mesh(geo, [sideMat, capMat, capMat]);
      mesh.position.set(d.x, 0.575, d.z); // half the mesh height — sits flush on the ground
      state.scene.add(mesh);
    }
  }
  if (tires.length) {
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });
    const ringGeo = new THREE.TorusGeometry(0.42, 0.16, 8, 16);
    const step = 0.16 * 2; // 2x tube radius — rings sit flush, no gap or overlap between them
    for (const t of tires) {
      for (let i = 0; i < 4; i++) {
        const ring = new THREE.Mesh(ringGeo, tireMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(t.x, 0.16 + i * step, t.z); // bottom ring's underside sits at y=0
        state.scene.add(ring);
      }
    }
  }
}

// A real visible staircase — solid ascending blocks (each filled from the ground up to its own
// tread height, like a poured concrete/packed-earth ramp) rather than floating individual
// treads, so there's never a visible gap between the ground floor and the roof it leads to.
// Purely visual: the actual walkable height along here comes from surfaceHeightAt/ACTIVE_RAMPS,
// these meshes are not collision obstacles (they'd otherwise block the very ramp they dress up).
function buildRampSteps(ramps, color) {
  const steps = 12;
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  for (const ramp of ramps) {
    const isX = ramp.axis === 'x';
    const half = (isX ? ramp.w : ramp.d) / 2;
    const stepDepth = (half * 2) / steps;
    for (let i = 0; i < steps; i++) {
      const t = (i + 1) / steps; // far edge of this step — matches surfaceHeightAt's value there
      const local = (i + 0.5) * stepDepth; // 0 at the ramp's low edge
      const pos = ramp.reverse ? (isX ? ramp.x : ramp.z) + half - local : (isX ? ramp.x : ramp.z) - half + local;
      const topY = ramp.fromY + (ramp.toY - ramp.fromY) * t;
      const h = Math.max(0.15, topY);
      const geo = isX
        ? new THREE.BoxGeometry(stepDepth * 0.96, h, ramp.d * 0.92)
        : new THREE.BoxGeometry(ramp.w * 0.92, h, stepDepth * 0.96);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(isX ? pos : ramp.x, h / 2, isX ? ramp.z : pos);
      state.scene.add(mesh);
    }
  }
}

function buildWallTexture() {
  const S = 512;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);
  // subtle concrete mottling (this texture multiplies the material's tint color, so stay near-white)
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 6 + Math.random() * 26;
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // crack network
  ctx.strokeStyle = 'rgba(20,18,16,0.55)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    let x = Math.random() * S, y = Math.random() * S, a = Math.random() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(x, y);
    const segs = 5 + Math.floor(Math.random() * 5);
    for (let s = 0; s < segs; s++) {
      a += (Math.random() - 0.5) * 1.4;
      x += Math.cos(a) * (14 + Math.random() * 18);
      y += Math.sin(a) * (14 + Math.random() * 18);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // graffiti tags — simple bold spray-paint-style scribbles/shapes in a couple of accent colors
  const tagColors = ['#ff3b6e', '#3bd6ff', '#ffd23b', '#7dff3b'];
  for (let i = 0; i < 3; i++) {
    const color = tagColors[Math.floor(Math.random() * tagColors.length)];
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 6 + Math.random() * 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const ox = 40 + Math.random() * (S - 200), oy = 60 + Math.random() * (S - 220);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.quadraticCurveTo(ox + 40, oy - 30, ox + 90, oy + 10);
    ctx.quadraticCurveTo(ox + 130, oy + 40, ox + 170, oy - 10);
    ctx.stroke();
    // a couple of accent dots/stars near the tag
    for (let k = 0; k < 2; k++) {
      ctx.beginPath();
      ctx.arc(ox + Math.random() * 160, oy + 40 + Math.random() * 40, 5 + Math.random() * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.6, 1.2);
  return tex;
}

// Weathered mud-brick, for the Ruins extension houses (and the whole Ruins map, for
// consistency) — brick coursing instead of graffiti, a heavier crack network, warm
// tan/ochre mottling, matching the reference photos of a real crumbled adobe ruin.
function buildMudTexture() {
  const S = 512;
  const c = document.createElement('canvas'); c.width = S; c.height = S;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e4cfa0';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 8 + Math.random() * 30;
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(90,60,30,0.10)' : 'rgba(255,240,200,0.14)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // faint brick coursing — staggered horizontal rows, like sun-baked mud blocks
  ctx.strokeStyle = 'rgba(80,55,30,0.25)';
  ctx.lineWidth = 2;
  const rowH = 34;
  for (let row = 0, y = 10; y < S; y += rowH, row++) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke();
    const offset = row % 2 === 0 ? 0 : 55;
    for (let x = offset; x < S; x += 110) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + rowH); ctx.stroke();
    }
  }
  // heavier crack network than the concrete texture — this is a real ruin, not just weathered
  ctx.strokeStyle = 'rgba(35,24,14,0.6)';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    let x = Math.random() * S, y = Math.random() * S, a = Math.random() * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(x, y);
    const segs = 5 + Math.floor(Math.random() * 6);
    for (let s = 0; s < segs; s++) {
      a += (Math.random() - 0.5) * 1.6;
      x += Math.cos(a) * (12 + Math.random() * 20);
      y += Math.sin(a) * (12 + Math.random() * 20);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1.6, 1.2);
  return tex;
}

// Heraldic banner, hand-drawn (not a downloaded photo — there's no clean royalty-free source
// for "castle banner PNG with a transparent point cut into the bottom", and the actual visual
// reference used to get the proportions/details right was real banner photos: alternating
// vertical fold-shading bands (cloth isn't flat-lit), a gold trim border + top rod pocket, a
// simple gold emblem, and — the detail a flat colored box would have missed — the cloth
// tapering to a single point at the bottom rather than a hard rectangular edge, which is what
// actually reads as "banner" instead of "red sign".
function buildBannerTexture() {
  const W = 160, H = 352;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const bandW = W / 6;
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#7a1010' : '#8c1616';
    ctx.fillRect(i * bandW, 0, bandW + 1, H);
  }
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, 'rgba(0,0,0,0.28)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.08)');
  grad.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#c9a13a';
  ctx.lineWidth = 6;
  ctx.strokeRect(4, 4, W - 8, H - 8);
  ctx.fillStyle = '#c9a13a';
  ctx.fillRect(0, 0, W, 26); // rod pocket
  ctx.beginPath(); ctx.arc(W / 2, 108, 32, 0, Math.PI * 2);
  ctx.strokeStyle = '#c9a13a'; ctx.lineWidth = 5; ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(W / 2, 88); ctx.lineTo(W / 2 + 17, 108); ctx.lineTo(W / 2, 128); ctx.lineTo(W / 2 - 17, 108);
  ctx.closePath(); ctx.fillStyle = '#c9a13a'; ctx.fill();
  // taper the bottom to a single point (real banner shape) by cutting away both bottom corners
  ctx.globalCompositeOperation = 'destination-out';
  const notchTopY = H * 0.78;
  ctx.beginPath(); ctx.moveTo(0, notchTopY); ctx.lineTo(0, H); ctx.lineTo(W / 2, H); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(W, notchTopY); ctx.lineTo(W, H); ctx.lineTo(W / 2, H); ctx.closePath(); ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  return new THREE.CanvasTexture(c);
}

// Climbing ivy, also hand-drawn against real reference (search: stone walls with mature ivy —
// dense, leafy growth low down, thinning out into bare vine higher up, not a uniform carpet of
// leaves top to bottom). A meandering stem climbs from the base with leaf clusters branching
// off it, clustered and thick near the bottom, sparser near the top — same alpha-tested
// crossed-plane technique already used for grass (see buildGrassPatches), just a taller/
// narrower texture and a climbing pattern instead of a ground clump.
function buildIvyTexture() {
  const W = 128, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const leafColors = ['rgba(40,90,35,0.92)', 'rgba(55,115,45,0.9)', 'rgba(75,130,55,0.85)'];
  let x = W / 2 + (Math.random() - 0.5) * 16, y = H;
  const climbTo = H * (0.15 + Math.random() * 0.15); // stops well short of the top — new growth, not a full carpet
  ctx.strokeStyle = 'rgba(58,42,24,0.85)';
  ctx.lineCap = 'round';
  while (y > climbTo) {
    const nx = Math.max(10, Math.min(W - 10, x + (Math.random() - 0.5) * 26));
    const ny = y - (14 + Math.random() * 14);
    ctx.lineWidth = 1.5 + (y / H) * 3.5; // thicker stem near the base
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
    const leafChance = 0.35 + 0.5 * (y / H); // denser leaf cover low down, per the reference photos
    if (Math.random() < leafChance) {
      const clusterCount = 2 + Math.floor(Math.random() * 3);
      for (let k = 0; k < clusterCount; k++) {
        const lx = nx + (Math.random() - 0.5) * 24, ly = ny + (Math.random() - 0.5) * 20;
        const lr = 6 + Math.random() * 8;
        ctx.fillStyle = leafColors[Math.floor(Math.random() * leafColors.length)];
        ctx.beginPath();
        ctx.ellipse(lx, ly, lr, lr * 0.65, Math.random() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    x = nx; y = ny;
  }
  return new THREE.CanvasTexture(c);
}

// Builds the whole 3D world exactly once per page load (the `sceneReady` guard) — the
// bootstrap's onJoined calls this, then separately gates the one-time viewmodel/trajectory
// init + render-loop start behind its own guard (see startGameLoopOnce in client.js), rather
// than this function reaching back into weapons.js/the bootstrap itself — keeps world.js's own
// import graph limited to state.js and gameData.js, no cycle risk.
export function initScene(mapKey, memeMode) {
  if (state.sceneReady) return;
  state.sceneReady = true;
  const theme = MAPS[mapKey]?.theme || MAPS[DEFAULT_MAP].theme;
  const dusk = theme === 'dusk';

  const layout = getMapLayout(mapKey, memeMode);
  state.ACTIVE_WALLS = layout.walls;
  state.ACTIVE_PLATFORMS = layout.platforms;
  state.ACTIVE_RAMPS = layout.ramps;
  state.ACTIVE_GRASS = layout.grass;
  state.ACTIVE_DECOR = layout.decor;

  state.scene = new THREE.Scene();
  state.scene.background = new THREE.Color(dusk ? 0x3a2c17 : 0x8fc3f0);
  // Far distance raised from 110 to 230 — the map's extension reaches z:120 now, well past the
  // old fog cutoff, which would have made the far half of it fade to nothing before you could
  // see it at all.
  state.scene.fog = new THREE.Fog(dusk ? 0x4a3826 : 0xbcdcf0, 45, 230);
  buildHorizon(theme);

  state.camera = new THREE.PerspectiveCamera(state.fov, window.innerWidth / window.innerHeight, 0.1, 500);
  state.yawObject = new THREE.Object3D();
  state.yawObject.add(state.camera);
  state.scene.add(state.yawObject);

  state.renderer = new THREE.WebGLRenderer({ antialias: false });
  state.renderer.setPixelRatio(1);
  state.renderer.setSize(window.innerWidth, window.innerHeight);
  // A little brighter on mobile specifically (phone screens are commonly viewed in brighter
  // ambient light / at lower backlight brightness than a monitor, and the request was explicit)
  // — toneMappingExposure is a single global multiplier on the whole rendered image, so this
  // doesn't need touching any of the per-theme light intensities below at all, and is a no-op on
  // desktop (default NoToneMapping otherwise, unchanged from before this).
  if (isTouchDevice()) {
    state.renderer.toneMapping = THREE.LinearToneMapping;
    state.renderer.toneMappingExposure = 1.18;
  }
  gameContainer.appendChild(state.renderer.domElement);

  // bright lighting either way — high sun for day, a warmer/lower-angled one for dusk — both
  // materially brighter than the original scene (a big chunk of why it read as dull/flat)
  const ambient = new THREE.HemisphereLight(dusk ? 0xd8a860 : 0xbfe0ff, dusk ? 0x4a3018 : 0x9a8f74, dusk ? 0.75 : 0.9);
  const sun = new THREE.DirectionalLight(dusk ? 0xffcf8a : 0xfffaf0, dusk ? 1.7 : 2.0);
  sun.position.set(35, dusk ? 45 : 85, 25);
  const fill = new THREE.DirectionalLight(dusk ? 0xffa860 : 0xcfe6ff, 0.5);
  fill.position.set(-30, 40, -20);
  state.scene.add(ambient, sun, fill);

  // Ruins gets a weathered mud-brick texture map-wide (not just the new houses) for a
  // consistent "old adobe ruin" read; City keeps the cracked-concrete-and-graffiti texture.
  const wallTex = dusk ? buildMudTexture() : buildWallTexture();
  const floorGeo = new THREE.BoxGeometry(FLOOR.w, FLOOR.h, FLOOR.d);
  const floorMat = new THREE.MeshStandardMaterial({ color: FLOOR.color, roughness: 0.85, metalness: 0.05 });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.position.set(FLOOR.x, FLOOR.y, FLOOR.z);
  state.scene.add(floorMesh);

  for (const o of [...state.ACTIVE_WALLS, ...state.ACTIVE_PLATFORMS]) {
    if (o.renderAs) continue; // drums/tires get their own mesh shape below, not a generic box
    const geo = new THREE.BoxGeometry(o.w, o.h, o.d);
    const mat = new THREE.MeshStandardMaterial({ map: wallTex, color: o.color, roughness: 0.7, metalness: 0.12 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(o.x, o.y, o.z);
    state.scene.add(mesh);
  }
  // Broken-parapet rubble, base debris, crenellations, decorative door panels — plain-tinted
  // boxes (no need for the full wall texture on tiny scattered chunks), non-collidable, purely
  // dressing. `rotY` (used by the mansion's door panels — one shut, one swung ajar) is optional.
  // `img` (a poster/meme flush against a wall) swaps the box for a flat photo-textured plane
  // instead — a real 3D crate doesn't make sense for a flat picture, and a plane avoids needing
  // a material-per-face array just to keep the photo off the edges/back. `type:'banner'`/
  // `type:'ivy'` are the same idea with a shared hand-drawn (canvas) texture built once and
  // reused across every instance of that type, instead of one CanvasTexture per entry.
  let bannerMat = null, ivyMat = null;
  for (const o of state.ACTIVE_DECOR) {
    let mesh;
    if (o.type === 'banner') {
      if (!bannerMat) bannerMat = new THREE.MeshStandardMaterial({ map: buildBannerTexture(), transparent: true, side: THREE.DoubleSide, roughness: 0.75 });
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), bannerMat);
    } else if (o.type === 'ivy') {
      if (!ivyMat) ivyMat = new THREE.MeshStandardMaterial({ map: buildIvyTexture(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9 });
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), ivyMat);
    } else if (o.img) {
      // Photo posters (memes) use an UNLIT material, not MeshStandardMaterial like everything
      // else here — these are flat printed/painted images, not glossy 3D surfaces that should
      // react to the scene's directional sun light, and that light is strong (intensity up to
      // 2.0) which was washing these out well past the source PNG's actual colors — especially
      // since both memes deployed so far have large light/white background areas that bright
      // PBR lighting blows out further. MeshBasicMaterial ignores scene lighting entirely and
      // just shows the texture's real pixel colors, which is what "looks faded" was asking to
      // fix — not a tint hack layered on top of the lighting problem.
      const tex = loadPhotoTexture(`/images/${o.img}`);
      const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.w, o.h), mat);
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), new THREE.MeshStandardMaterial({ color: o.color, roughness: 0.85 }));
    }
    mesh.position.set(o.x, o.y, o.z);
    if (o.rotY) mesh.rotation.y = o.rotY;
    state.scene.add(mesh);
  }
  buildPropMeshes(state.ACTIVE_WALLS.filter((o) => o.renderAs === 'drum'), state.ACTIVE_WALLS.filter((o) => o.renderAs === 'tire'));
  buildRampSteps(state.ACTIVE_RAMPS, dusk ? 0x9c7a3d : 0x6f7275);
  if (state.ACTIVE_GRASS.length) buildGrassPatches(state.ACTIVE_GRASS);

  state.clock = new THREE.Clock();
}

export function onResize() {
  if (!state.renderer) return;
  state.camera.aspect = window.innerWidth / window.innerHeight;
  state.camera.updateProjectionMatrix();
  state.renderer.setSize(window.innerWidth, window.innerHeight);
}

// Settings tab's FOV slider — live while in a match (camera exists), otherwise just updates
// state.fov, which initScene reads at camera-creation time for the next match joined.
export function setFov(v) {
  state.fov = v;
  if (state.camera) {
    state.camera.fov = v;
    state.camera.updateProjectionMatrix();
  }
}
