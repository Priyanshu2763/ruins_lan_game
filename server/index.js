import express from 'express';
import compression from 'compression';
import { WebSocketServer } from 'ws';
import http from 'http';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { pool } from './db.js';
import { sanitizeAppearance } from '../shared/appearance.js';
import {
  WEAPONS, MAX_HEALTH, RESPAWN_MS, MAX_PLAYERS_PER_ROOM, SPAWN_POINTS, SPAWN_SAFE_DIST,
  PRONE_HEAD_OFFSET, HEAD_CENTER_Y, HEAD_HALF, CROUCH_SCALE_Y, PLAYER_RADIUS, getMapLayout,
  GRENADE_COOLDOWN_MS, GRENADE_FUSE_MS, GRENADE_THROW_SPEED, GRENADE_BLAST_RADIUS,
  GRENADE_MAX_DAMAGE, GRENADE_RADIUS, GRENADE_LETHAL_RADIUS, GRENADE_PICKUP_AMOUNT,
  MAPS, DEFAULT_MAP, PICKUP_POINTS, PICKUP_RADIUS, PICKUP_RESPAWN_MS,
  HEADSHOT_MULTIPLIER,
} from '../shared/gameData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const RECONNECT_GRACE_MS = Number(process.env.WRECKVEIL_GRACE_MS) || 30000; // how long a dropped player's slot is held before they're removed (env override is for tests)
const HEARTBEAT_MS = 10000;       // ping cadence; a socket that misses one full cycle is cut
const CHAT_MAX_LEN = 200, CHAT_HISTORY = 40, CHAT_COOLDOWN_MS = 400;

const app = express();
// Every JS module, the HTML shell, and every API/WS-adjacent JSON response were being served
// completely uncompressed (confirmed directly: curl with Accept-Encoding: gzip still got back a
// raw Content-Length with no Content-Encoding at all) — real, free bandwidth/latency on every
// single page load. Only compresses text-ish content; already-compressed binary formats (images,
// audio, FBX/GLB models) are explicitly skipped — gzipping an already-DEFLATE'd PNG or a binary
// model file burns CPU for near-zero size benefit, sometimes even growing it slightly.
const COMPRESSIBLE_EXT = /\.(js|mjs|cjs|css|html|json|svg|txt|map)$/i;
app.use(compression({
  filter: (req, res) => {
    if (COMPRESSIBLE_EXT.test(req.path)) return true;
    return compression.filter(req, res); // falls back to content-type sniffing for API JSON responses etc, which have no file extension
  },
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/vendor/three', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'build')));
// GLTFLoader/FBXLoader/SkeletonUtils etc. — not part of the core 'three' package export, but
// shipped inside the same npm package under examples/jsm. Served as its own tree (not copied
// into public/) so its many internal relative imports (loaders -> ../libs/fflate.module.js,
// ../curves/NURBSCurve.js, etc.) keep resolving correctly; their own `from 'three'` imports
// resolve via the page's existing import map regardless of which path loaded them.
app.use('/vendor/three-examples', express.static(path.join(__dirname, '..', 'node_modules', 'three', 'examples', 'jsm')));
app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

// ---------- Auth + profile/customization: Postgres-backed (see server/db.js, server/db/schema.sql) ----------
// Not meant to be bulletproof (this is a LAN party game, not a bank) but real per-account
// passwords ARE checked, salted+hashed with scrypt (Node's built-in crypto, no extra dependency
// needed) rather than stored in plaintext. No server-side sessions/tokens — same trust model as
// before the DB migration: the browser's remembered username (localStorage) is trusted for
// repeat visits, the real password check happens once at login/register time against the real
// stored hash.
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function isValidUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9_]{3,20}$/.test(u);
}
function isValidPassword(p) {
  return typeof p === 'string' && p.length >= 4 && p.length <= 128;
}
function isValidHexColor(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
}

async function getUserByUsername(username) {
  const { rows } = await pool.query('SELECT id, username, password_salt, password_hash, created_at FROM users WHERE username = $1', [username]);
  return rows[0] || null;
}

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!isValidUsername(username) || !isValidPassword(password)) {
    return res.status(400).json({ ok: false, error: 'Invalid username or password.' });
  }
  try {
    const existing = await getUserByUsername(username);
    if (existing) {
      return res.status(409).json({ ok: false, error: 'That username is already taken.' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    const { rows } = await pool.query(
      'INSERT INTO users (username, password_salt, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [username, salt, hash]
    );
    const userId = rows[0].id;
    await pool.query('INSERT INTO player_stats (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    await pool.query('INSERT INTO player_customization (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    res.json({ ok: true });
  } catch (err) {
    console.error('register failed:', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!isValidUsername(username) || !isValidPassword(password)) {
    return res.status(400).json({ ok: false, error: 'Invalid username or password.' });
  }
  try {
    const user = await getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ ok: false, error: 'No account with that username.' });
    }
    const hash = hashPassword(password, user.password_salt);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(user.password_hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ ok: false, error: 'Wrong password.' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('login failed:', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

// Profile: stats + customization in one call, for the dashboard's Profile/Character tabs.
app.get('/api/profile', async (req, res) => {
  const username = req.query.username;
  if (!isValidUsername(username)) return res.status(400).json({ ok: false, error: 'Invalid username.' });
  try {
    const user = await getUserByUsername(username);
    if (!user) return res.status(404).json({ ok: false, error: 'No such account.' });
    const [statsRes, custRes] = await Promise.all([
      pool.query('SELECT kills, deaths, matches_played, wins FROM player_stats WHERE user_id = $1', [user.id]),
      pool.query('SELECT appearance FROM player_customization WHERE user_id = $1', [user.id]),
    ]);
    const stats = statsRes.rows[0] || { kills: 0, deaths: 0, matches_played: 0, wins: 0 };
    const cust = custRes.rows[0] || {};
    res.json({
      ok: true,
      username: user.username,
      kills: stats.kills,
      deaths: stats.deaths,
      matchesPlayed: stats.matches_played,
      wins: stats.wins,
      memberSince: user.created_at,
      appearance: sanitizeAppearance(cust.appearance),
    });
  } catch (err) {
    console.error('profile fetch failed:', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
});

app.post('/api/customization', async (req, res) => {
  const { username, appearance } = req.body || {};
  if (!isValidUsername(username) || !appearance || typeof appearance !== 'object') {
    return res.status(400).json({ ok: false, error: 'Invalid customization data.' });
  }
  const clean = sanitizeAppearance(appearance);
  try {
    const user = await getUserByUsername(username);
    if (!user) return res.status(404).json({ ok: false, error: 'No such account.' });
    await pool.query(
      `INSERT INTO player_customization (user_id, appearance, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET appearance = $2, updated_at = now()`,
      [user.id, JSON.stringify(clean)]
    );
    res.json({ ok: true, appearance: clean });
  } catch (err) {
    console.error('customization save failed:', err);
    res.status(500).json({ ok: false, error: 'Server error.' });
  }
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
  const active = [...room.players.values()].map((p) => ({ id: p.id, name: p.name, kills: p.kills, deaths: p.deaths, dc: !!p.disconnected }));
  const left = room.leftStats ? [...room.leftStats.values()] : [];
  return [...active, ...left].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
}

function broadcastLeaderboard(room) {
  broadcastRoom(room, { type: 'leaderboard', list: leaderboardOf(room) });
}

function endMatch(room) {
  if (!rooms.has(room.id)) return; // room already emptied out and got cleaned up
  room.ended = true; // reconnecting players get the final scoreboard replayed (see 'reconnect')
  broadcastRoom(room, { type: 'matchEnded', list: leaderboardOf(room) });
  // Win credit: the top-kills CURRENTLY-CONNECTED player only (not leaderboardOf's merged
  // active+disconnected list — a player who already left shouldn't collect a win for a match
  // they weren't around to finish), and only if they actually scored a kill (an empty/instant
  // match crediting a 0-kill "winner" would be a meaningless stat). accountId-linked only, same
  // as every other persisted stat in this file.
  let top = null;
  for (const p of room.players.values()) {
    if (p.accountId && (!top || p.kills > top.kills)) top = p;
  }
  if (top && top.kills > 0) {
    pool.query('UPDATE player_stats SET wins = wins + 1, updated_at = now() WHERE user_id = $1', [top.accountId])
      .catch((err) => console.error('win persist failed:', err));
  }
}

function respawn(target, room) {
  if (!rooms.has(room.id) || !room.players.has(target.id)) return;
  target.health = MAX_HEALTH;
  target.alive = true;
  target.pos = randomSpawn(room);
  broadcastRoom(room, { type: 'respawn', id: target.id, pos: target.pos, health: target.health });
}

function applyDamage(shooter, target, dmg, room, weaponName) {
  // Single choke point: a player whose connection dropped (slot held for the reconnect grace period) can
  // never be damaged, whatever the source. The callers below also skip them, this makes it airtight.
  if (target.disconnected) return;
  target.health = Math.max(0, target.health - dmg);
  // `weapon` lets the target's own client tell a grenade hit apart from a bullet/melee one —
  // used for the ear-ringing effect, which should only play for someone actually caught in a
  // blast, not every hit.
  broadcastRoom(room, { type: 'hit', shooterId: shooter.id, targetId: target.id, health: target.health, weapon: weaponName || null });
  if (target.health <= 0 && target.alive) {
    target.alive = false;
    if (shooter.id !== target.id) shooter.kills += 1; // a self-frag is a death, not a kill credit
    target.deaths += 1;
    // Persisted, live, per event rather than reconciled at match end — simplest way to avoid
    // double-counting across reconnects/rejoin-by-name (batch 4's reclaim only touches the
    // room-local kills/deaths fields, not the DB row). Fire-and-forget: a lost DB write here
    // just means one kill/death doesn't show up on the Profile tab, not a game-breaking issue.
    if (shooter.id !== target.id && shooter.accountId) {
      pool.query('UPDATE player_stats SET kills = kills + 1, updated_at = now() WHERE user_id = $1', [shooter.accountId])
        .catch((err) => console.error('kill persist failed:', err));
    }
    if (target.accountId) {
      pool.query('UPDATE player_stats SET deaths = deaths + 1, updated_at = now() WHERE user_id = $1', [target.accountId])
        .catch((err) => console.error('death persist failed:', err));
    }
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
  if (!target.alive || target.disconnected) return; // same rule: a held slot is untouchable
  target.health = 0;
  target.alive = false;
  target.deaths += 1;
  if (target.accountId) {
    pool.query('UPDATE player_stats SET deaths = deaths + 1, updated_at = now() WHERE user_id = $1', [target.accountId])
      .catch((err) => console.error('death persist failed:', err));
  }
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
// The real head band (world-Y, relative to feet), matching what buildCharacterFigure/
// animateRemoteFigure (client.js) actually renders — NOT an independently-tuned offset, so it
// can't drift away from the visual model again. Standing/crouch: the head is the top of the
// model, uniformly squashed by CROUCH_SCALE_Y while crouched (matches the whole figure's
// mesh.scale.y). Prone: the whole figure is rotated -90 about X (lying flat) — that turns the
// head's old Z-thickness into its new Y-extent, collapsing it to a thin band right at ground
// level instead of "the top of the model". Torso/legs collapse into effectively the same band
// once prone (their own Z-thickness is similar), so Y alone can't separate head from body while
// prone — headshots there use this exact thin band rather than a fraction of the overall
// (much taller, deliberately generous) prone hit-cylinder.
function headBandFor(other) {
  if (other.prone) return [0, HEAD_HALF * 2];
  const scale = other.crouch ? CROUCH_SCALE_Y : 1;
  return [(HEAD_CENTER_Y - HEAD_HALF) * scale, (HEAD_CENTER_Y + HEAD_HALF) * scale];
}

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
      if (!player.alive || player.disconnected) continue;
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
  let bestHeadYMin = 0, bestHeadYMax = 0;
  for (const other of room.players.values()) {
    if (other.id === player.id || !other.alive || other.disconnected) continue; // a dropped player is untouchable while their slot is held
    const [headYMin, headYMax] = headBandFor(other);
    const yMin = other.pos[1];
    // Standing/crouch: the head band's own top IS the top of the model, so the overall
    // hit-cylinder should reach exactly that high — anything above it used to be a pure whiff
    // even though the visible head model reached higher (the bug the user reported). Prone
    // collapses head and torso into the same thin band (see headBandFor), so the overall
    // hit-cylinder keeps its own separate, deliberately generous PRONE_HEAD_OFFSET-based
    // height for torso/legs coverage instead of shrinking down to just the head band.
    const yMax = other.pos[1] + (other.prone ? PRONE_HEAD_OFFSET + 0.2 : headYMax);
    const dist = rayCylinderDist(origin, d, other.pos[0], other.pos[2], hitRadius, yMin, yMax);
    // a hit only counts if it's closer than any wall in the way — that's what stops shots
    // from passing straight through obstacles to whoever's standing behind them.
    if (dist <= wallDist && dist < bestDist) {
      best = other;
      bestDist = dist;
      bestHeadYMin = other.pos[1] + headYMin;
      bestHeadYMax = other.pos[1] + headYMax;
    }
  }
  if (best) {
    let dmg = weapon.damage;
    // Distance falloff (only the Shotgun defines these fields, see gameData.js) — full damage
    // inside the point-blank kill zone, tapering linearly toward falloffMinDamage by max range,
    // so it can't double as a sniper just by still having reach.
    if (weapon.falloffStart != null && bestDist > weapon.falloffStart) {
      const t = Math.min(1, (bestDist - weapon.falloffStart) / (weapon.falloffEnd - weapon.falloffStart));
      dmg = weapon.damage - (weapon.damage - weapon.falloffMinDamage) * t;
    }
    // Headshot detection now applies to every weapon type, melee included — an aimed knife
    // strike to the head is a real one-shot kill (round(55*2.5)=138, past MAX_HEALTH=100),
    // same mechanism every ranged weapon already used.
    const impactY = origin[1] + d[1] * bestDist;
    if (impactY >= bestHeadYMin && impactY <= bestHeadYMax) dmg *= HEADSHOT_MULTIPLIER;
    applyDamage(player, best, Math.round(dmg), room, weapon.name);
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
  // Broadcast the explosion itself BEFORE resolving per-player damage below — this used to run
  // the other way around (damage loop first, `grenadeExploded` only after), so every affected
  // player's `hit` message — and the ear-ring it triggers client-side — arrived and played
  // before the explosion's own visual/sound ever did. WebSocket delivers in send order, so
  // send order IS playback order here; the explosion needs to go out first for its sound to
  // land before the ring that's supposed to follow it.
  broadcastRoom(room, { type: 'grenadeExploded', pos: grenade.pos });
  // no thrower exclusion here on purpose — a grenade you're standing too close to when it
  // goes off hurts you too, same as everyone else in the blast.
  for (const p of room.players.values()) {
    if (!p.alive || p.disconnected) continue;
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
}

// A thrown grenade used to fly straight through every wall — the physics tick below only ever
// checked the ground plane. This resolves a sphere-vs-AABB collision against every obstacle:
// find the closest point on the box to the grenade center, and if that's within the collision
// radius, push the grenade back out along that direction and reflect its velocity across it
// (with energy loss), i.e. an actual bounce off the wall/corner instead of passing through.
// Impact bookkeeping for the bounce SOUND (clients play a clink/knock at the impact point): the physics
// below only READS what it already computes and notes the hardest hit of the tick on the grenade — it
// never changes a position or velocity. `surface` is 'ground' for anything facing up (floor, stairs,
// the top of a wall) and 'wall' otherwise.
function noteGrenadeImpact(g, surface, speed) {
  if (!g.impact || speed > g.impact.speed) g.impact = { surface, speed };
}
const GRENADE_BOUNCE_MIN_SPEED = 2.5;   // slower than this is rolling/settling, not a bounce worth a sound
const GRENADE_BOUNCE_MIN_GAP_MS = 150;  // and no more than one bounce sound per grenade per 150 ms
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
      noteGrenadeImpact(g, ny > 0.7 ? 'ground' : 'wall', -vDotN);
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
          if (Math.abs(g.vel[1]) > 1) { noteGrenadeImpact(g, 'ground', Math.abs(g.vel[1])); g.vel[1] *= -0.35; g.vel[0] *= 0.7; g.vel[2] *= 0.7; }
          else { g.vel[0] = 0; g.vel[1] = 0; g.vel[2] = 0; }
        }
      }
      if (g.impact) {
        if (g.impact.speed >= GRENADE_BOUNCE_MIN_SPEED && now - (g.lastBounceAt || 0) >= GRENADE_BOUNCE_MIN_GAP_MS) {
          g.lastBounceAt = now;
          broadcastRoom(room, { type: 'grenadeBounce', id: g.id, pos: [g.pos[0], g.pos[1], g.pos[2]], surface: g.impact.surface, speed: Math.round(g.impact.speed * 10) / 10 });
        }
        g.impact = null;
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
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.roomId = null;

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'hello') {
      ws.name = String(msg.name || 'Player').slice(0, 16);
      if (msg.appearance && typeof msg.appearance === 'object') ws.appearance = sanitizeAppearance(msg.appearance);
      // Stored synchronously — the actual DB lookup happens inline inside joinRoom(), awaited
      // right before the player object is created. An async lookup fired here instead (and
      // merely hoped to finish in time) lost this race in practice every single time: the real
      // client sends 'hello' immediately followed by 'createRoom'/'joinRoom' with zero delay,
      // so the DB round-trip never won against the very next synchronous message.
      ws.authUsername = isValidUsername(msg.username) ? msg.username : null;
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
      const room = { id: makeRoomId(), name: String(msg.roomName || 'Ruins Match').slice(0, 24), map, memeMode, players: new Map(), leftStats: new Map(), chat: [] };
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
      // durationSec === 0 (or missing) means no time limit — matchEndsAt stays null and the
      // client just doesn't show a countdown. Otherwise the match auto-ends and every client
      // gets kicked to the final scoreboard when the timer set at room creation runs out.
      // Seconds now, not whole minutes only — the create-room time field grew a seconds digit
      // (`step="1"` on the input, client.js's parseDurationSec), so this needs real second
      // precision, not `msg.durationMin` rounded down. 10800s = the same 180-minute ceiling as
      // before, just expressed in the new unit.
      const durationSec = Math.max(0, Math.min(10800, Number(msg.durationSec) || 0));
      if (durationSec > 0) {
        room.matchEndsAt = Date.now() + durationSec * 1000;
        room.matchEndTimer = setTimeout(() => endMatch(room), durationSec * 1000);
      }
      initPickups(room);
      rooms.set(room.id, room);
      await joinRoom(ws, room);
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
      await joinRoom(ws, room);
      broadcastRoomList();
      return;
    }

    if (msg.type === 'reconnect') {
      const room = rooms.get(String(msg.roomId || ''));
      const player = room && typeof msg.token === 'string' ? [...room.players.values()].find((p) => p.token === msg.token) : null;
      if (!player) { send(ws, { type: 'reconnectFailed', reason: room ? 'expired' : 'roomGone' }); return; }
      if (player.authUsername && ws.authUsername && player.authUsername !== ws.authUsername) { send(ws, { type: 'reconnectFailed', reason: 'forbidden' }); return; }
      const old = player.ws;
      player.ws = ws; ws.id = player.id; ws.roomId = room.id; ws.name = player.name;
      if (old && old !== ws) { try { old.close(); } catch { /* already gone */ } } // second tab / half-dead socket: the newest connection wins
      if (player.graceTimer) { clearTimeout(player.graceTimer); player.graceTimer = null; }
      const wasDisconnected = player.disconnected;
      player.disconnected = false;
      sendJoined(ws, room, player, { reconnected: true });
      if (room.ended) send(ws, { type: 'matchEnded', list: leaderboardOf(room) });
      if (wasDisconnected) {
        systemChat(room, `${player.name} reconnected`);
        broadcastRoom(room, { type: 'playerStatus', id: player.id, status: 'reconnected' });
        broadcastLeaderboard(room);
      }
      return;
    }

    // The player was asked "rejoin your match?" after a refresh and said no: take them out of that
    // room for good. Unlike a normal leave, their kills/deaths are DROPPED rather than banked on the
    // room's scoreboard (and so can't be reclaimed by name if they ever join that room again).
    if (msg.type === 'abandon') {
      const room = rooms.get(String(msg.roomId || ''));
      const player = room && typeof msg.token === 'string' ? [...room.players.values()].find((p) => p.token === msg.token) : null;
      if (player && !(player.authUsername && ws.authUsername && player.authUsername !== ws.authUsername)) {
        removePlayer(room, player, { clearStats: true });
      }
      send(ws, { type: 'abandoned' }); // same answer whether or not the slot still existed — the client just moves on
      return;
    }

    const room = rooms.get(ws.roomId);
    if (!room) return;
    const player = room.players.get(ws.id);
    if (!player) return;

    if (msg.type === 'leave') { // deliberate quit: no grace period, free the slot now
      ws.roomId = null;
      removePlayer(room, player);
      return;
    }

    if (msg.type === 'chat') {
      const text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN);
      const now = Date.now();
      if (!text || now - (player.lastChatAt || 0) < CHAT_COOLDOWN_MS) return;
      player.lastChatAt = now;
      pushChat(room, { id: player.id, name: player.name, text });
      return;
    }

    if (msg.type === 'state') {
      if (Array.isArray(msg.pos)) player.pos = msg.pos;
      if (Array.isArray(msg.rot)) player.rot = msg.rot;
      if (Number.isInteger(msg.weapon)) player.weapon = msg.weapon;
      player.crouch = !!msg.crouch;
      player.prone = !!msg.prone;
      player.moving = !!msg.moving;
      player.sprint = !!msg.sprint; // lets other clients tell running footsteps from walking ones
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
    // A socket that was already replaced (the player reconnected on a newer one) closing late
    // must not touch the player it no longer owns.
    if (!player || player.ws !== ws) return;
    if (room.ended) { removePlayer(room, player); return; }
    // Hold the slot instead of deleting it: a network blip, a refresh or a laptop sleep should
    // come back into the same match with the same health/position/stats. Untouchable and
    // flagged offline meanwhile; removePlayer() runs if they don't return in time.
    player.disconnected = true;
    player.moving = false; player.sprint = false;
    systemChat(room, `${player.name} lost connection — holding their spot for ${RECONNECT_GRACE_MS / 1000}s`);
    broadcastRoom(room, { type: 'playerStatus', id: player.id, status: 'disconnected' });
    broadcastLeaderboard(room);
    player.graceTimer = setTimeout(() => {
      if (room.players.get(player.id) === player && player.disconnected) removePlayer(room, player);
    }, RECONNECT_GRACE_MS);
  });
});

// ---------- Chat ----------
function pushChat(room, entry) {
  entry.t = Date.now();
  room.chat.push(entry);
  if (room.chat.length > CHAT_HISTORY) room.chat.shift();
  broadcastRoom(room, { type: 'chat', ...entry });
}
function systemChat(room, text) { pushChat(room, { system: true, text }); }

// The one place a player actually leaves a room (voluntary leave, grace period expiring, a
// refresh that never came back): banks their stats for the scoreboard, tells everyone, and
// deletes the room once it's empty.
function removePlayer(room, player, { clearStats = false } = {}) {
  if (player.graceTimer) clearTimeout(player.graceTimer);
  if (room.leftStats && !clearStats) {
    room.leftStats.set(player.id, { id: player.id, name: player.name, kills: player.kills, deaths: player.deaths });
  }
  room.players.delete(player.id);
  broadcastRoom(room, { type: 'playerLeft', id: player.id });
  systemChat(room, `${player.name} left the match`);
  if (room.players.size === 0) {
    if (room.matchEndTimer) clearTimeout(room.matchEndTimer);
    rooms.delete(room.id);
  } else {
    broadcastLeaderboard(room);
  }
  broadcastRoomList();
}

// Everything a client needs to (re)enter a match. `you` is the server's record of the joining
// player — on a reconnect it's what lets the client resume exactly where it was (health,
// position, stats) instead of starting over.
function sendJoined(ws, room, player, extra = {}) {
  send(ws, {
    type: 'joined',
    roomId: room.id,
    roomName: room.name,
    map: room.map,
    memeMode: room.memeMode !== false,
    matchEndsAt: room.matchEndsAt || null,
    playerId: player.id,
    sessionToken: player.token,
    weapons: WEAPONS,
    you: { health: player.health, alive: player.alive, pos: player.pos, weapon: player.weapon, kills: player.kills, deaths: player.deaths },
    chat: room.chat,
    players: [...room.players.values()].map((p) => ({
      id: p.id, name: p.name, pos: p.pos, rot: p.rot, weapon: p.weapon, health: p.health, alive: p.alive,
      crouch: p.crouch, prone: p.prone, moving: p.moving, sprint: p.sprint, appearance: p.appearance,
    })),
    ...extra,
  });
}

async function joinRoom(ws, room) {
  ws.roomId = room.id;
  const name = ws.name || `Player${ws.id}`;
  // Resolved HERE, awaited, right before the player object is built — not fired-and-hoped-for
  // back in the 'hello' handler. Fixed a real bug: the client sends 'hello' immediately followed
  // by 'createRoom'/'joinRoom' with zero delay, so an async lookup started in 'hello' never won
  // that race against the very next message in practice (confirmed with a live two-client test
  // before landing this fix — matches_played stayed 0 every time under the old approach).
  let accountId = null;
  if (ws.authUsername) {
    try {
      const user = await getUserByUsername(ws.authUsername);
      if (user) accountId = user.id;
    } catch (err) {
      console.error('joinRoom account lookup failed:', err);
    }
  }
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
    accountId,
    appearance: ws.appearance || null,
    token: crypto.randomBytes(16).toString('hex'), // secret that lets this player's next socket reclaim this slot
    authUsername: ws.authUsername || null,
    disconnected: false,
    graceTimer: null,
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

  // Persisted stat: "a match played" is counted the moment you actually join a room, once per
  // connection (a ws only ever joins one room in its lifetime) — no double-count risk. Kills/
  // deaths persist separately, live, from applyDamage.
  if (player.accountId) {
    pool.query(
      `INSERT INTO player_stats (user_id, matches_played) VALUES ($1, 1)
       ON CONFLICT (user_id) DO UPDATE SET matches_played = player_stats.matches_played + 1, updated_at = now()`,
      [player.accountId]
    ).catch((err) => console.error('matches_played persist failed:', err));
  }

  sendJoined(ws, room, player);
  broadcastRoom(room, { type: 'playerJoined', player: { id: player.id, name: player.name, appearance: player.appearance } }, player.id);
  systemChat(room, `${player.name} joined the match`);
  broadcastLeaderboard(room);
}

// Snapshot tick: broadcast live positions/health at 20Hz.
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size === 0) continue;
    checkPickups(room);
    const players = [...room.players.values()].map((p) => ({
      id: p.id, pos: p.pos, rot: p.rot, weapon: p.weapon, health: p.health, alive: p.alive,
      crouch: p.crouch, prone: p.prone, moving: p.moving, sprint: p.sprint,
    }));
    const grenades = (room.grenades || []).map((g) => ({ id: g.id, pos: g.pos }));
    const pickups = (room.pickups || []).filter((p) => p.active).map((p) => ({ idx: p.idx, pos: p.pos, type: p.type, weaponId: p.weaponId }));
    broadcastRoom(room, { type: 'state', players, grenades, pickups });
  }
}, 50);

// A connection that dies silently (unplugged cable, sleeping laptop) never fires 'close' on its
// own for minutes — without this the 30s grace period wouldn't even START until the OS gave up.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

server.listen(PORT, () => {
  const nets = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  console.log(`\nWreckveil server running.`);
  console.log(`  Local:  http://localhost:${PORT}`);
  for (const addr of addrs) console.log(`  LAN:    http://${addr}:${PORT}`);
  console.log(`\nShare the LAN address with friends on the same network/WiFi.\n`);
});
