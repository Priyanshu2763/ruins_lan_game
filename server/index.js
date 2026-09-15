import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  WEAPONS, MAX_HEALTH, RESPAWN_MS, MAX_PLAYERS_PER_ROOM, SPAWN_POINTS, SPAWN_SAFE_DIST,
  STAND_HEAD_OFFSET, CROUCH_HEAD_OFFSET, PRONE_HEAD_OFFSET, PLAYER_RADIUS, getMapLayout,
  GRENADE_COOLDOWN_MS, GRENADE_FUSE_MS, GRENADE_THROW_SPEED, GRENADE_BLAST_RADIUS,
  GRENADE_MAX_DAMAGE, GRENADE_RADIUS, GRENADE_LETHAL_RADIUS, GRENADE_PICKUP_AMOUNT,
  MAPS, DEFAULT_MAP, PICKUP_POINTS, PICKUP_RADIUS, PICKUP_RESPAWN_MS,
  HEADSHOT_MULTIPLIER, HEADSHOT_ZONE_FRAC,
} from '../shared/gameData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'build')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

// ---------- Auth: simple username/password accounts, stored in a local JSON file ----------
// Not meant to be bulletproof (this is a LAN party game, not a bank) but real per-account
// passwords ARE checked, salted+hashed with scrypt (Node's built-in crypto, no extra
// dependency needed) rather than stored in plaintext. users.json is gitignored — it's local
// account data, not something that belongs in the repo.
const USERS_FILE = path.join(__dirname, 'users.json');
let users = {};
try {
  users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
} catch {
  users = {};
}
function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function isValidUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9_]{3,20}$/.test(u);
}
function isValidPassword(p) {
  return typeof p === 'string' && p.length >= 4 && p.length <= 128;
}

app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!isValidUsername(username) || !isValidPassword(password)) {
    return res.status(400).json({ ok: false, error: 'Invalid username or password.' });
  }
  if (users[username]) {
    return res.status(409).json({ ok: false, error: 'That username is already taken.' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  users[username] = { salt, hash: hashPassword(password, salt) };
  saveUsers();
  res.json({ ok: true });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!isValidUsername(username) || !isValidPassword(password)) {
    return res.status(400).json({ ok: false, error: 'Invalid username or password.' });
  }
  const user = users[username];
  if (!user) {
    return res.status(401).json({ ok: false, error: 'No account with that username.' });
  }
  const hash = hashPassword(password, user.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ ok: false, error: 'Wrong password.' });
  }
  res.json({ ok: true });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/** rooms: id -> { id, name, players: Map(id -> player) } */
const rooms = new Map();
let nextPlayerId = 1;

function makeRoomId() {
  return Math.random().toString(36).slice(2, 7).toUpperCase();
}

// Picks a spawn point that keeps its distance from every currently-alive player in the room,
// instead of a flat random pick — that was how two players could spawn on top of each other.
// Falls back to whichever point is farthest from everyone if the room's too crowded for any
// point to be fully clear.
function randomSpawn(room) {
  if (!room || room.players.size === 0) {
    return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  }
  const occupied = [...room.players.values()].filter((p) => p.alive).map((p) => p.pos);
  if (occupied.length === 0) {
    return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
  }
  const dist2D = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
  const safe = SPAWN_POINTS.filter((sp) => occupied.every((op) => dist2D(sp, op) >= SPAWN_SAFE_DIST));
  if (safe.length > 0) return safe[Math.floor(Math.random() * safe.length)];
  let best = SPAWN_POINTS[0];
  let bestMinDist = -Infinity;
  for (const sp of SPAWN_POINTS) {
    const minDist = Math.min(...occupied.map((op) => dist2D(sp, op)));
    if (minDist > bestMinDist) { bestMinDist = minDist; best = sp; }
  }
  return best;
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastRoom(room, msg, exceptId = null) {
  const data = JSON.stringify(msg);
  for (const p of room.players.values()) {
    if (p.id === exceptId) continue;
    if (p.ws.readyState === p.ws.OPEN) p.ws.send(data);
  }
}

function roomSummary(room) {
  return { id: room.id, name: room.name, count: room.players.size, max: MAX_PLAYERS_PER_ROOM, map: room.map };
}

function broadcastRoomList() {
  const list = [...rooms.values()].map(roomSummary);
  const data = JSON.stringify({ type: 'rooms', rooms: list });
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN && !client.roomId) client.send(data);
  }
}

// Room-scoped leaderboard: stats for everyone who has played in THIS room, including players
// who've since disconnected — a room's own scoreboard, not just "whoever's currently online".
// (Previously a player's kills/deaths vanished from the board the instant they left.)
function leaderboardOf(room) {
  const active = [...room.players.values()].map((p) => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths }));
  const left = room.leftStats ? [...room.leftStats.values()] : [];
  return [...active, ...left].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
}

function broadcastLeaderboard(room) {
  broadcastRoom(room, { type: 'leaderboard', list: leaderboardOf(room) });
}

function endMatch(room) {
  if (!rooms.has(room.id)) return; // room already emptied out and got cleaned up
  broadcastRoom(room, { type: 'matchEnded', list: leaderboardOf(room) });
}

function respawn(target, room) {
  if (!rooms.has(room.id) || !room.players.has(target.id)) return;
  target.health = MAX_HEALTH;
  target.alive = true;
  target.pos = randomSpawn(room);
  broadcastRoom(room, { type: 'respawn', id: target.id, pos: target.pos, health: target.health });
}

function applyDamage(shooter, target, dmg, room, weaponName) {
  target.health = Math.max(0, target.health - dmg);
  broadcastRoom(room, { type: 'hit', shooterId: shooter.id, targetId: target.id, health: target.health });
  if (target.health <= 0 && target.alive) {
    target.alive = false;
    if (shooter.id !== target.id) shooter.kills += 1; // a self-frag is a death, not a kill credit
    target.deaths += 1;
    broadcastRoom(room, {
      type: 'killed',
      killerId: shooter.id,
      victimId: target.id,
      killerName: shooter.name,
      victimName: target.name,
      weapon: weaponName || 'Unknown',
    });
    broadcastLeaderboard(room);
    setTimeout(() => respawn(target, room), RESPAWN_MS);
  }
}

// A death with no shooter — falling off the edge of the play area. Same respawn/leaderboard
// flow as a combat kill, just no killer credited; the client tells the kill feed apart via
// `killerId === null`.
function killByEnvironment(target, room, reason) {
  if (!target.alive) return;
  target.health = 0;
  target.alive = false;
  target.deaths += 1;
  broadcastRoom(room, {
    type: 'killed',
    killerId: null,
    victimId: target.id,
    killerName: null,
    victimName: target.name,
    weapon: reason,
  });
  broadcastLeaderboard(room);
  setTimeout(() => respawn(target, room), RESPAWN_MS);
}

function vecSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function vecLen(a) {
  return Math.hypot(a[0], a[1], a[2]);
}
function vecNorm(a) {
  const l = vecLen(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function vecDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// Distance along the normalized ray (origin, dir) to its nearest intersection with an
// axis-aligned box, or Infinity if it misses. Standard slab test.
function rayAABBDist(origin, dir, box) {
  const minX = box.x - box.w / 2, maxX = box.x + box.w / 2;
  const minY = box.y - box.h / 2, maxY = box.y + box.h / 2;
  const minZ = box.z - box.d / 2, maxZ = box.z + box.d / 2;
  let tmin = -Infinity, tmax = Infinity;
  const axes = [
    [origin[0], dir[0], minX, maxX],
    [origin[1], dir[1], minY, maxY],
    [origin[2], dir[2], minZ, maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return Infinity;
    } else {
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return Infinity;
    }
  }
  if (tmax < 0) return Infinity;
  return tmin >= 0 ? tmin : tmax;
}

// Distance along the ray to its nearest intersection with a vertical cylinder (a player's
// hitbox: fixed real-world radius, clamped to a feet-to-head Y range) — a proper hit volume,
// unlike the old angle-cone check whose effective hit width grew with range.
function rayCylinderDist(origin, dir, cx, cz, radius, yMin, yMax) {
  const ox = origin[0] - cx, oz = origin[2] - cz;
  const dx = dir[0], dz = dir[2];
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return Infinity;
  const b = 2 * (ox * dx + oz * dz);
  const c = ox * ox + oz * oz - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  let t = (-b - sq) / (2 * a);
  if (t < 0) t = (-b + sq) / (2 * a);
  if (t < 0) return Infinity;
  const y = origin[1] + dir[1] * t;
  if (y < yMin || y > yMax) return Infinity;
  return t;
}

// Nearest distance from `from` toward `to` at which a wall blocks line of sight, or Infinity
// if the path is clear. Shared by bullets (handleAttack) and grenade blast damage. `obstacles`
// is room.physicsObstacles — each room's own map layout, not a single shared global anymore.
function nearestObstacleDist(from, dir, obstacles) {
  let nearest = Infinity;
  for (const o of obstacles) {
    const dist = rayAABBDist(from, dir, o);
    if (dist < nearest) nearest = dist;
  }
  return nearest;
}

// ---------- Pickups: ammo (for a random weapon) and health, spawned at fixed map spots ----------
const RANGED_WEAPON_IDS = WEAPONS.filter((w) => w.type === 'ranged').map((w) => w.id);

function rollPickup(p) {
  const r = Math.random();
  if (r < 0.3) {
    p.type = 'health';
    p.weaponId = null;
  } else if (r < 0.45) {
    p.type = 'grenade';
    p.weaponId = null;
  } else {
    p.type = 'ammo';
    p.weaponId = RANGED_WEAPON_IDS[Math.floor(Math.random() * RANGED_WEAPON_IDS.length)];
  }
  p.active = true;
}

function initPickups(room) {
  room.pickups = PICKUP_POINTS.map((pos, idx) => {
    const p = { idx, pos, active: true, type: null, weaponId: null };
    rollPickup(p);
    return p;
  });
}

function checkPickups(room) {
  if (!room.pickups) return;
  for (const pickup of room.pickups) {
    if (!pickup.active) continue;
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const dx = player.pos[0] - pickup.pos[0], dz = player.pos[2] - pickup.pos[2];
      if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS) continue;

      if (pickup.type === 'health') {
        if (player.health >= MAX_HEALTH) continue; // stays on the ground until actually needed
        player.health = MAX_HEALTH;
        // deliberately its own message, not a reused 'hit' — a heal shouldn't trigger the
        // red damage-flash on the client the way a real hit does
        send(player.ws, { type: 'pickup', kind: 'health', health: player.health });
      } else if (pickup.type === 'grenade') {
        send(player.ws, { type: 'pickup', kind: 'grenade', amount: GRENADE_PICKUP_AMOUNT });
      } else {
        const weapon = WEAPONS.find((w) => w.id === pickup.weaponId);
        send(player.ws, { type: 'pickup', kind: 'ammo', weaponId: pickup.weaponId, weaponName: weapon.name, caliber: weapon.caliber, amount: weapon.pickupAmount });
      }
      pickup.active = false;
      setTimeout(() => { rollPickup(pickup); }, PICKUP_RESPAWN_MS);
      break; // one player takes it per tick, not every player standing in the same spot
    }
  }
}

function handleAttack(player, room, weaponIdx, origin, dir) {
  const weapon = WEAPONS[weaponIdx];
  if (!weapon || !player.alive) return;
  const now = Date.now();
  player.lastFire = player.lastFire || {};
  if (now - (player.lastFire[weaponIdx] || 0) < weapon.fireInterval) return;
  player.lastFire[weaponIdx] = now;

  // Broadcast to everyone else in the room so their client can play a positional gunshot sound
  // (see handleRemoteShot in client.js) — this is the ONLY reason this exists; hit resolution
  // below doesn't need it. Ranged only (melee has no recorded sound to spatialize), and never
  // sent back to the shooter — they already played their own sound locally the instant they
  // fired, no round-trip needed for that.
  if (weapon.type === 'ranged') {
    broadcastRoom(room, { type: 'shotFired', playerId: player.id, weapon: weaponIdx, pos: origin }, player.id);
  }

  const d = vecNorm(dir);
  const wallDist = Math.min(weapon.range, nearestObstacleDist(origin, d, room.physicsObstacles));
  const hitRadius = weapon.type === 'melee' ? PLAYER_RADIUS + 0.6 : PLAYER_RADIUS;

  let best = null;
  let bestDist = Infinity;
  let bestYMin = 0, bestYMax = 0;
  for (const other of room.players.values()) {
    if (other.id === player.id || !other.alive) continue;
    const headOffset = other.prone ? PRONE_HEAD_OFFSET : other.crouch ? CROUCH_HEAD_OFFSET : STAND_HEAD_OFFSET;
    const yMin = other.pos[1];
    const yMax = other.pos[1] + headOffset + 0.2;
    const dist = rayCylinderDist(origin, d, other.pos[0], other.pos[2], hitRadius, yMin, yMax);
    // a hit only counts if it's closer than any wall in the way — that's what stops shots
    // from passing straight through obstacles to whoever's standing behind them.
    if (dist <= wallDist && dist < bestDist) {
      best = other;
      bestDist = dist;
      bestYMin = yMin;
      bestYMax = yMax;
    }
  }
  if (best) {
    let dmg = weapon.damage;
    if (weapon.type !== 'melee') {
      const impactY = origin[1] + d[1] * bestDist;
      const headZoneStart = bestYMin + (bestYMax - bestYMin) * HEADSHOT_ZONE_FRAC;
      if (impactY >= headZoneStart) dmg = Math.round(weapon.damage * HEADSHOT_MULTIPLIER);
    }
    applyDamage(player, best, dmg, room, weapon.name);
  }
}

// ---------- Grenades: server-simulated arc physics + AOE damage on explosion ----------
let nextGrenadeId = 1;
const GRENADE_GRAVITY = -20;
// A ramp has no collision box of its own — client.js's surfaceHeightAt is the only thing that
// knows a staircase has a height at all, and that's player-only. Without this, a grenade lobbed
// onto a staircase just keeps falling under gravity, right through the (purely visual, non-
// collidable) steps, down to flat ground level — "grenades fly through the stairs" instead
// of landing on them like a real floor. Same interpolation math as the client's ramp handling,
// just without the platform-hysteresis state (a thrown object doesn't need to remember which
// floor it's "on" the way a walking player does).
function rampHeightAt(x, z, ramps) {
  let h = 0;
  for (const s of ramps) {
    const hw = s.w / 2, hd = s.d / 2;
    if (Math.abs(x - s.x) > hw || Math.abs(z - s.z) > hd) continue;
    // axis:'x' ramps climb along X (a stair running alongside an east-west wall) instead of Z
    // — mirrors the same addition in client.js's surfaceHeightAt.
    const isX = s.axis === 'x';
    const half = isX ? hw : hd;
    const coord = isX ? x : z;
    const center = isX ? s.x : s.z;
    const t = Math.max(0, Math.min(1, (coord - (center - half)) / (half * 2)));
    const st = s.reverse ? 1 - t : t;
    h = Math.max(h, s.fromY + (s.toY - s.fromY) * st);
  }
  return h;
}

function throwGrenade(player, room, origin, dir) {
  if (!player.alive) return;
  const now = Date.now();
  if (now - (player.lastGrenade || 0) < GRENADE_COOLDOWN_MS) return;
  player.lastGrenade = now;

  const d = vecNorm(dir);
  room.grenades = room.grenades || [];
  room.grenades.push({
    id: nextGrenadeId++,
    throwerId: player.id,
    pos: [origin[0], origin[1], origin[2]],
    vel: [d[0] * GRENADE_THROW_SPEED, d[1] * GRENADE_THROW_SPEED + 4, d[2] * GRENADE_THROW_SPEED],
    born: now,
  });
}

function explodeGrenade(room, grenade) {
  // no thrower exclusion here on purpose — a grenade you're standing too close to when it
  // goes off hurts you too, same as everyone else in the blast.
  for (const p of room.players.values()) {
    if (!p.alive) continue;
    const toP = vecSub(p.pos, grenade.pos);
    const dist = vecLen(toP);
    if (dist > GRENADE_BLAST_RADIUS) continue;
    // line-of-sight: a wall between the blast and this player blocks the damage
    const d = vecNorm(toP);
    const wallDist = nearestObstacleDist(grenade.pos, d, room.physicsObstacles);
    if (wallDist < dist - 0.3) continue;
    // guaranteed one-shot kill inside the lethal radius; falls off to 0 out at the blast edge
    let dmg;
    if (dist <= GRENADE_LETHAL_RADIUS) {
      dmg = MAX_HEALTH;
    } else {
      const falloff = 1 - (dist - GRENADE_LETHAL_RADIUS) / (GRENADE_BLAST_RADIUS - GRENADE_LETHAL_RADIUS);
      dmg = Math.round(GRENADE_MAX_DAMAGE * Math.max(0, falloff));
    }
    if (dmg > 0) {
      // credit the thrower even if they've since died — but if they disconnected entirely,
      // fall back to an anonymous "Grenade" kill rather than crediting the victim with it
      const thrower = room.players.get(grenade.throwerId) || { id: -1, name: 'Grenade', kills: 0 };
      applyDamage(thrower, p, dmg, room, 'Grenade');
    }
  }
  broadcastRoom(room, { type: 'grenadeExploded', pos: grenade.pos });
}

// A thrown grenade used to fly straight through every wall — the physics tick below only ever
// checked the ground plane. This resolves a sphere-vs-AABB collision against every obstacle:
// find the closest point on the box to the grenade center, and if that's within the collision
// radius, push the grenade back out along that direction and reflect its velocity across it
// (with energy loss), i.e. an actual bounce off the wall/corner instead of passing through.
const GRENADE_WALL_MARGIN = 0.15;
function resolveGrenadeWallBounce(g, obstacles) {
  const r = GRENADE_RADIUS + GRENADE_WALL_MARGIN;
  for (const o of obstacles) {
    const minX = o.x - o.w / 2, maxX = o.x + o.w / 2;
    const minY = o.y - o.h / 2, maxY = o.y + o.h / 2;
    const minZ = o.z - o.d / 2, maxZ = o.z + o.d / 2;
    const cx = Math.max(minX, Math.min(g.pos[0], maxX));
    const cy = Math.max(minY, Math.min(g.pos[1], maxY));
    const cz = Math.max(minZ, Math.min(g.pos[2], maxZ));
    const dx = g.pos[0] - cx, dy = g.pos[1] - cy, dz = g.pos[2] - cz;
    const distSq = dx * dx + dy * dy + dz * dz;
    if (distSq >= r * r) continue;
    let nx, ny, nz, overlap;
    if (distSq < 1e-8) {
      // The grenade's center is INSIDE the box (all 3 coords already clamped to themselves,
      // so the "closest point" is its own position) — a real bug, not a rare edge case: this
      // used to just `continue` (skip resolving), which let a grenade that ever ended up here
      // sail straight through with no bounce at all — exactly "passes through walls/doors".
      // The bigger walls added since (the mansion, the tall stair barriers) made this far more
      // likely to actually happen. Push out along whichever axis has the LEAST penetration —
      // the standard way to eject a sphere whose center is already embedded in a box, rather
      // than just giving up.
      const penX = Math.min(g.pos[0] - minX, maxX - g.pos[0]);
      const penY = Math.min(g.pos[1] - minY, maxY - g.pos[1]);
      const penZ = Math.min(g.pos[2] - minZ, maxZ - g.pos[2]);
      if (penX <= penY && penX <= penZ) { nx = g.pos[0] - o.x >= 0 ? 1 : -1; ny = 0; nz = 0; overlap = penX + r; }
      else if (penY <= penZ) { nx = 0; ny = g.pos[1] - o.y >= 0 ? 1 : -1; nz = 0; overlap = penY + r; }
      else { nx = 0; ny = 0; nz = g.pos[2] - o.z >= 0 ? 1 : -1; overlap = penZ + r; }
    } else {
      const dist = Math.sqrt(distSq);
      nx = dx / dist; ny = dy / dist; nz = dz / dist;
      overlap = r - dist;
    }
    g.pos[0] += nx * overlap; g.pos[1] += ny * overlap; g.pos[2] += nz * overlap;
    const vDotN = g.vel[0] * nx + g.vel[1] * ny + g.vel[2] * nz;
    if (vDotN < 0) {
      const restitution = 0.45;
      g.vel[0] -= (1 + restitution) * vDotN * nx;
      g.vel[1] -= (1 + restitution) * vDotN * ny;
      g.vel[2] -= (1 + restitution) * vDotN * nz;
      g.vel[0] *= 0.85; g.vel[1] *= 0.85; g.vel[2] *= 0.85; // extra damping so it settles down
    }
  }
}

// 20Hz grenade physics: gravity arc, a soft bounce off walls and the ground, explode on fuse
// timeout. Run in several smaller substeps per tick, not one big 50ms step — at throw speed
// (16 units/s) a single 50ms step covers 0.8 units, enough to tunnel clean through some of the
// thinner divider walls (1.2 units) between one discrete collision check and the next. Four
// 12.5ms substeps keep each step's travel down to 0.2 units, well under any wall thickness.
const GRENADE_SUBSTEPS = 4;
setInterval(() => {
  const dt = 0.05 / GRENADE_SUBSTEPS;
  for (const room of rooms.values()) {
    if (!room.grenades || room.grenades.length === 0) continue;
    const now = Date.now();
    const remaining = [];
    for (const g of room.grenades) {
      for (let s = 0; s < GRENADE_SUBSTEPS; s++) {
        g.vel[1] += GRENADE_GRAVITY * dt;
        g.pos[0] += g.vel[0] * dt;
        g.pos[1] += g.vel[1] * dt;
        g.pos[2] += g.vel[2] * dt;
        resolveGrenadeWallBounce(g, room.physicsObstacles);
        const localGroundY = GRENADE_RADIUS + rampHeightAt(g.pos[0], g.pos[2], room.ramps);
        if (g.pos[1] <= localGroundY) {
          g.pos[1] = localGroundY;
          if (Math.abs(g.vel[1]) > 1) { g.vel[1] *= -0.35; g.vel[0] *= 0.7; g.vel[2] *= 0.7; }
          else { g.vel[0] = 0; g.vel[1] = 0; g.vel[2] = 0; }
        }
      }
      if (now - g.born >= GRENADE_FUSE_MS) {
        explodeGrenade(room, g);
      } else {
        remaining.push(g);
      }
    }
    room.grenades = remaining;
  }
}, 50);

wss.on('connection', (ws) => {
  ws.id = nextPlayerId++;
  ws.roomId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'hello') {
      ws.name = String(msg.name || 'Player').slice(0, 16);
      send(ws, { type: 'rooms', rooms: [...rooms.values()].map(roomSummary) });
      return;
    }

    if (msg.type === 'listRooms') {
      send(ws, { type: 'rooms', rooms: [...rooms.values()].map(roomSummary) });
      return;
    }

    if (msg.type === 'createRoom') {
      const map = MAPS[msg.map] ? msg.map : DEFAULT_MAP;
      // Only the client actually renders decor (posters/banners/ivy) — this is stored purely
      // to hand back to every joining client via the `joined` message so they all render the
      // same thing, not used in any server-side collision/physics call.
      const memeMode = msg.memeMode !== false;
      const room = { id: makeRoomId(), name: String(msg.roomName || 'Ruins Match').slice(0, 24), map, memeMode, players: new Map(), leftStats: new Map() };
      // Each room now gets its own map layout (the core arena + that theme's colored
      // extension) instead of a single shared global obstacle list — walls+platforms combined
      // is exactly what the raycasting functions (bullets, grenade LOS, grenade wall bounce)
      // need: any AABB that should stop a shot or bounce a grenade, floor slabs included.
      const layout = getMapLayout(map);
      room.walls = layout.walls;
      room.physicsObstacles = [...layout.walls, ...layout.platforms];
      room.ramps = layout.ramps; // stairs have no collision BOX of their own (only players'
      // client-side surfaceHeightAt knows their height) — grenades need their own awareness
      // of this or they just fall straight through a staircase to the ground below it, see
      // rampHeightAt below.
      // durationMin === 0 (or missing) means no time limit — matchEndsAt stays null and the
      // client just doesn't show a countdown. Otherwise the match auto-ends and every client
      // gets kicked to the final scoreboard when the timer set at room creation runs out.
      const durationMin = Math.max(0, Math.min(180, Number(msg.durationMin) || 0));
      if (durationMin > 0) {
        room.matchEndsAt = Date.now() + durationMin * 60000;
        room.matchEndTimer = setTimeout(() => endMatch(room), durationMin * 60000);
      }
      initPickups(room);
      rooms.set(room.id, room);
      joinRoom(ws, room);
      broadcastRoomList();
      return;
    }

    if (msg.type === 'joinRoom') {
      const room = rooms.get(msg.roomId);
      if (!room) {
        send(ws, { type: 'error', message: 'Room not found' });
        return;
      }
      if (room.players.size >= MAX_PLAYERS_PER_ROOM) {
        send(ws, { type: 'error', message: 'Room is full' });
        return;
      }
      joinRoom(ws, room);
      broadcastRoomList();
      return;
    }

    const room = rooms.get(ws.roomId);
    if (!room) return;
    const player = room.players.get(ws.id);
    if (!player) return;

    if (msg.type === 'state') {
      if (Array.isArray(msg.pos)) player.pos = msg.pos;
      if (Array.isArray(msg.rot)) player.rot = msg.rot;
      if (Number.isInteger(msg.weapon)) player.weapon = msg.weapon;
      player.crouch = !!msg.crouch;
      player.prone = !!msg.prone;
      player.moving = !!msg.moving;
      return;
    }

    if (msg.type === 'attack') {
      if (!Array.isArray(msg.origin) || !Array.isArray(msg.dir)) return;
      handleAttack(player, room, msg.weapon, msg.origin, msg.dir);
      return;
    }

    if (msg.type === 'throwGrenade') {
      if (!Array.isArray(msg.origin) || !Array.isArray(msg.dir)) return;
      throwGrenade(player, room, msg.origin, msg.dir);
      return;
    }

    if (msg.type === 'fellOff') {
      killByEnvironment(player, room, 'fell');
      return;
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomId);
    if (!room) return;
    const player = room.players.get(ws.id);
    if (player && room.leftStats) {
      room.leftStats.set(player.id, { id: player.id, name: player.name, kills: player.kills, deaths: player.deaths });
    }
    room.players.delete(ws.id);
    broadcastRoom(room, { type: 'playerLeft', id: ws.id });
    if (room.players.size === 0) {
      if (room.matchEndTimer) clearTimeout(room.matchEndTimer);
      rooms.delete(room.id);
    } else {
      broadcastLeaderboard(room);
    }
    broadcastRoomList();
  });
});

function joinRoom(ws, room) {
  ws.roomId = room.id;
  const name = ws.name || `Player${ws.id}`;
  // A page refresh disconnects the old socket (its stats land in leftStats) and immediately
  // opens a new one with a new id — without this, the same person shows up twice on the
  // scoreboard: one row via leftStats (their old id) and one fresh 0/0 row (their new id).
  // Reclaim by name: same room, same name = the same person continuing, not a new stranger.
  let priorKills = 0, priorDeaths = 0;
  if (room.leftStats) {
    for (const [oldId, stat] of room.leftStats) {
      if (stat.name === name) {
        priorKills = stat.kills; priorDeaths = stat.deaths;
        room.leftStats.delete(oldId);
        break;
      }
    }
  }
  const player = {
    id: ws.id,
    ws,
    name,
    pos: randomSpawn(room),
    rot: [0, 0],
    weapon: 0,
    health: MAX_HEALTH,
    alive: true,
    crouch: false,
    prone: false,
    moving: false,
    kills: priorKills,
    deaths: priorDeaths,
  };
  room.players.set(ws.id, player);

  send(ws, {
    type: 'joined',
    roomId: room.id,
    roomName: room.name,
    map: room.map,
    memeMode: room.memeMode !== false,
    matchEndsAt: room.matchEndsAt || null,
    playerId: player.id,
    weapons: WEAPONS,
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, pos: p.pos, rot: p.rot, weapon: p.weapon, health: p.health, alive: p.alive,
      crouch: p.crouch, prone: p.prone, moving: p.moving,
    })),
  });
  broadcastRoom(room, { type: 'playerJoined', player: { id: player.id, name: player.name } }, player.id);
  broadcastLeaderboard(room);
}

// Snapshot tick: broadcast live positions/health at 20Hz.
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size === 0) continue;
    checkPickups(room);
    const players = [...room.players.values()].map((p) => ({
      id: p.id, pos: p.pos, rot: p.rot, weapon: p.weapon, health: p.health, alive: p.alive,
      crouch: p.crouch, prone: p.prone, moving: p.moving,
    }));
    const grenades = (room.grenades || []).map((g) => ({ id: g.id, pos: g.pos }));
    const pickups = (room.pickups || []).filter((p) => p.active).map((p) => ({ idx: p.idx, pos: p.pos, type: p.type, weaponId: p.weaponId }));
    broadcastRoom(room, { type: 'state', players, grenades, pickups });
  }
}, 50);

server.listen(PORT, () => {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  console.log(`\nRuins FPP server running.`);
  console.log(`  Local:  http://localhost:${PORT}`);
  for (const addr of addrs) console.log(`  LAN:    http://${addr}:${PORT}`);
  console.log(`\nShare the LAN address with friends on the same network/WiFi.\n`);
});
