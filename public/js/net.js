// WebSocket connection + outbound message helpers. Deliberately imports ONLY state.js — never
// a feature module — so every feature module can import sendMsg/sendState from here with zero
// circular-import risk. The inbound message DISPATCH (the big handleMessage switch) is NOT
// here: it needs to call into nearly every other module, so it lives in the bootstrap
// (client.js), which is the one file allowed to import everything. connectWebSocket takes the
// dispatcher as a callback instead of importing it, which is what keeps this file's import
// graph terminating at state.js alone.
import { state } from './state.js';

let ws = null;

export function connectWebSocket(onOpen, onMessage) {
  ws = new WebSocket(`ws://${location.host}`);
  ws.addEventListener('open', onOpen);
  ws.addEventListener('message', (ev) => onMessage(JSON.parse(ev.data)));
}

export function sendMsg(obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

let netTimer = 0;
// pos[1] is the player's standing SURFACE height (0 on plain ground, floorY on a building's
// upper platform) — not eye height/jump — so server-side hit detection (which builds each
// target's hit-cylinder up from pos[1]) is correct for players on an elevated floor too.
export function sendState(dt, currentWeapon) {
  netTimer += dt;
  if (netTimer < 0.066) return;
  netTimer = 0;
  sendMsg({
    type: 'state',
    pos: [state.playerX, state.currentGroundY, state.playerZ],
    rot: [state.yaw, state.pitch],
    weapon: currentWeapon,
    crouch: state.isCrouched,
    prone: state.isProne,
    moving: state.isMoving,
    sprint: state.isSprinting,
  });
}
