// A small standalone three.js scene showing the player's character (AKM in hand, tinted with
// their chosen Character-tab color) — used on both the dashboard's Play pane (an "operator
// card" style showcase) and the Character pane (live color preview while picking). One shared
// scene/renderer/figure reused across both rather than two separate instances: the <canvas>
// element itself is reparented into whichever pane is currently active (mountPreviewInto), which
// keeps a single WebGL context and a single render loop instead of juggling two.
import * as THREE from 'three';
import { buildCharacterFigure, onCharacterTemplateReady, getFigureAnimationClip, setFigureWeapon, updateFigure, redressFigure } from './characters.js';

let scene, camera, renderer, canvas, figure, currentAction = null;
let figureReadyQueued = false;
let rafId = null;
let lastT = 0;
// The character/weapon models load asynchronously (see characters.js) — an appearance set before
// they're ready (e.g. loadProfile() firing while the page is still warming up) is remembered
// here and applied the instant the figure actually exists, instead of being silently dropped.
let currentAppearance = null;

// ---- interactive view state (drag / pinch / wheel / buttons) ----
const CAM_TARGET_Y = 0.9;
const VIEW_DEFAULT = { yaw: Math.PI, camH: 1.1, zoom: 4.3 }; // yaw PI = facing the camera (the model's forward is -Z)
let yaw = VIEW_DEFAULT.yaw, yawVel = 0, camH = VIEW_DEFAULT.camH, zoom = VIEW_DEFAULT.zoom;
let dragging = false;
const pointers = new Map(); // pointerId -> {x, y}; two of them = a pinch
let pinchDist = 0, lastTap = 0;
let previewWeapon = 0;       // 0 AKM, 1 Shotgun, 2 Glock, 3 Knife
let previewPose = 'Idle_Loop';
const POSES = [['Idle_Loop', 'Idle'], ['Walk_Loop', 'Walk'], ['Sprint_Loop', 'Run'], ['Crouch_Idle_Loop', 'Crouch']];
const WEAPON_CHIPS = [[0, 'AKM'], [1, 'Shotgun'], [2, 'Pistol'], [3, 'Knife']];
let toolbar = null;

function ensureScene() {
  if (renderer) return;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 20);
  camera.position.set(0, 1.1, 4.3);
  camera.lookAt(0, 0.9, 0);

  scene.add(new THREE.HemisphereLight(0xfff2d0, 0x151209, 1.15));
  const key = new THREE.DirectionalLight(0xffe8c0, 1.5);
  key.position.set(2.2, 4, 2.6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb8ff, 0.5);
  rim.position.set(-2.5, 2, -2);
  scene.add(rim);

  canvas = document.createElement('canvas');
  canvas.className = 'charPreviewCanvas';
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  bindControls(canvas);
  onCharacterTemplateReady(() => { figureReadyQueued = true; buildFigure(); });
}

function buildFigure() {
  if (figure) { scene.remove(figure.root); figure = null; }
  const fig = buildCharacterFigure(0, 'You', currentAppearance);
  if (!fig) {
    // An Operator body (unlike the Quaternius template) loads lazily per-id, so this can genuinely
    // still be null right after picking one — poll briefly rather than leaving the card empty.
    setTimeout(() => { if (!figure) buildFigure(); }, 250);
    return;
  }
  setFigureWeapon(fig, previewWeapon);
  scene.add(fig.root);
  figure = fig;
  currentAction = null;
  applyPose(false);
}

// Moves the (already-initialized) canvas into a new container, resizing the renderer/camera to
// match that container's own box — the two host slots (Play/Character panes) aren't the same
// size, so this has to happen on every mount, not just once.
export function mountPreviewInto(container) {
  ensureScene();
  if (canvas.parentElement !== container) container.appendChild(canvas);
  if (!toolbar) buildToolbar();
  if (toolbar.parentElement !== container) container.appendChild(toolbar);
  resizePreview();
}

export function resizePreview() {
  if (!renderer || !canvas.parentElement) return;
  const w = canvas.parentElement.clientWidth || 200;
  const h = canvas.parentElement.clientHeight || 260;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// Live closet preview: swapping BODY (male/female) needs a different rig, so that rebuilds the
// figure; everything else (skin, hair, clothes, colors) just redresses the existing one.
export function setPreviewAppearance(app) {
  // A rebuild (not just a redress) is needed whenever the underlying MODEL changes: Custom's own
  // male/female swap (as before), switching between Custom and Operators, or picking a different
  // Operator — each of those is a genuinely different mesh/skeleton, not a re-tintable variant of
  // the current one.
  const prev = currentAppearance;
  const modelChanged = prev && (prev.mode !== app.mode || (prev.mode === 'custom' ? prev.character !== app.character : prev.operator !== app.operator));
  currentAppearance = app;
  if (!figure || modelChanged) { if (scene && figureReadyQueued) buildFigure(); return; }
  redressFigure(figure, app);
}

// Crossfades the figure to the selected animation clip.
function applyPose(fade = true) {
  if (!figure) return;
  figure.crouch = previewPose === 'Crouch_Idle_Loop'; // see characters.js's updateFigure — levels the head instead of staring at the ground
  const clip = getFigureAnimationClip(figure, previewPose);
  if (!clip) return;
  const next = figure.mixer.clipAction(clip);
  if (currentAction === next) return;
  next.reset().play();
  if (currentAction && fade) next.crossFadeFrom(currentAction, 0.25, false);
  else if (currentAction) currentAction.stop();
  currentAction = next;
}

function resetView() { yaw = VIEW_DEFAULT.yaw; yawVel = 0; camH = VIEW_DEFAULT.camH; zoom = VIEW_DEFAULT.zoom; }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Mouse / touch / pen all arrive as pointer events, so one code path covers every device:
// one pointer drags (horizontal = spin the character, vertical = tilt the camera), two pointers pinch to
// zoom, the wheel zooms, a double-click / double-tap resets. Releasing a fast drag keeps spinning briefly.
function bindControls(c) {
  c.style.touchAction = 'none'; // the browser must not scroll/zoom the page while a finger is on the model
  c.style.cursor = 'grab';
  let lastX = 0, lastT = 0;
  c.addEventListener('pointerdown', (e) => {
    c.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragging = true; yawVel = 0; c.style.cursor = 'grabbing';
    lastX = e.clientX; lastT = performance.now();
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y); }
    const now = performance.now();
    if (pointers.size === 1 && now - lastTap < 320) { resetView(); lastTap = 0; } else lastTap = now;
  });
  c.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId); if (!p) return;
    if (pointers.size >= 2) {
      p.x = e.clientX; p.y = e.clientY;
      const [a, b] = [...pointers.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) zoom = clamp(zoom * (pinchDist / d), 2.4, 6.4);
      pinchDist = d; return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    yaw += dx * 0.012;
    camH = clamp(camH + dy * 0.006, 0.3, 2.0);
    const now = performance.now(), dtm = Math.max(1, now - lastT);
    yawVel = clamp((dx * 0.012) / (dtm / 1000), -9, 9); lastT = now; lastX = e.clientX;
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) { dragging = false; c.style.cursor = 'grab'; if (performance.now() - lastT > 90) yawVel = 0; }
  };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  c.addEventListener('wheel', (e) => { e.preventDefault(); zoom = clamp(zoom + e.deltaY * 0.0028, 2.4, 6.4); }, { passive: false });
}

// Small overlay: pose + weapon chips, turn / reset / save-image buttons, and a hint line. The canvas is
// shared between the Play and Character panes, so the toolbar moves with it (mountPreviewInto).
function buildToolbar() {
  toolbar = document.createElement('div');
  toolbar.className = 'pvBar';
  const chip = (label, title, on) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'pvChip'; b.textContent = label; b.title = title; b.addEventListener('click', on); return b; };
  const top = document.createElement('div'); top.className = 'pvRow pvTop';
  const poseBtns = POSES.map(([clip, label]) => chip(label, `Pose: ${label}`, () => { previewPose = clip; applyPose(); refresh(); }));
  poseBtns.forEach((b) => top.appendChild(b));
  const mid = document.createElement('div'); mid.className = 'pvRow pvSide';
  const wBtns = WEAPON_CHIPS.map(([id, label]) => chip(label, `Hold: ${label}`, () => { previewWeapon = id; if (figure) setFigureWeapon(figure, id); refresh(); }));
  wBtns.forEach((b) => mid.appendChild(b));
  const bottom = document.createElement('div'); bottom.className = 'pvRow pvBottom';
  bottom.append(
    chip('⟲', 'Turn left', () => { yaw += Math.PI / 6; }),
    chip('⟳', 'Turn right', () => { yaw -= Math.PI / 6; }),
    chip('Reset', 'Reset view (or double-click / double-tap the model)', resetView),
    chip('📷', 'Save a picture of your character', savePicture),
  );
  const hint = document.createElement('div'); hint.className = 'pvHint'; hint.textContent = 'Drag to rotate · pinch / scroll to zoom';
  toolbar.append(top, mid, bottom, hint);
  function refresh() {
    poseBtns.forEach((b, i) => b.classList.toggle('on', POSES[i][0] === previewPose));
    wBtns.forEach((b, i) => b.classList.toggle('on', WEAPON_CHIPS[i][0] === previewWeapon));
  }
  refresh();
}

// Renders one frame and downloads it as a transparent PNG.
function savePicture() {
  if (!renderer) return;
  renderer.render(scene, camera);
  const a = document.createElement('a');
  a.download = 'wreckveil-character.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
}

let __frameCount = 0;
window.__pvDebug = () => ({ frameCount: __frameCount, rafId, hasFigure: !!figure, dragging, yaw, yawVel, camH });
function tick(t) {
  __frameCount++;
  rafId = requestAnimationFrame(tick);
  const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
  lastT = t;
  if (!dragging && yawVel !== 0) { // let go of a fling: coast to a stop
    yaw += yawVel * dt;
    yawVel *= Math.pow(0.04, dt);
    if (Math.abs(yawVel) < 0.02) yawVel = 0;
  }
  camera.position.set(0, camH, zoom);
  camera.lookAt(0, CAM_TARGET_Y, 0);
  if (figure) {
    try { updateFigure(figure, dt); } catch (e) { window.__lastPvError = e.message + '\n' + e.stack; console.error('PREVIEW updateFigure crash:', e.message, e.stack); }
    figure.root.rotation.y = yaw;
  }
  if (renderer && canvas.parentElement) { try { renderer.render(scene, camera); } catch (e) { window.__lastPvError = 'RENDER: ' + e.message + '\n' + e.stack; console.error('PREVIEW render crash:', e.message, e.stack); } }
}

export function startPreviewLoop() {
  ensureScene();
  if (rafId != null) return;
  lastT = 0;
  rafId = requestAnimationFrame(tick);
}

export function stopPreviewLoop() {
  if (rafId != null) cancelAnimationFrame(rafId);
  rafId = null;
}
