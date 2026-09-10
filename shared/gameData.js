// Shared between server (Node ESM) and client (browser ES module) — pure data, no platform APIs.

// magSize/reserveMax/caliber are null for melee (unlimited, no ammo UI). pickupAmount is how
// much reserve ammo a single ammo crate for that weapon grants. `caliber` is the display name
// used in pickup toasts/logs ("+120 7.62mm picked"), not the gun name. `pump: true` marks the
// shotgun's fire-then-pump two-stage sound/cooldown.
// icon/image are UI hints for the weapon card: `image` (a real background-removed photo under
// /images) takes priority over the `icon` emoji fallback. `ammoImage` is a *separate* photo
// used as a small texture/label on the in-world 3D ammo pickup box (not a flat sprite — it
// stays real box geometry, the photo just decorates one face), null where no photo exists yet.
// `reloadTime` (ms, null for melee) is how long a full reload takes — standard shooter-game
// values: rifle mag change ~2.4s, pump-action shotgun tube reload ~3s (slower), pistol ~1.6s.
export const WEAPONS = [
  { id: 0, name: 'AKM',     icon: '🔫', image: 'akm.png',    ammoImage: 'ammo_762.png', type: 'ranged', damage: 16, fireInterval: 110, range: 70,  auto: true,  pump: false, magSize: 30, reserveMax: 180, pickupAmount: 120, caliber: '7.62mm', reloadTime: 2400 },
  { id: 1, name: 'Shotgun', icon: '💥', image: 'shotgun.png', ammoImage: 'ammo_12ga.png', type: 'ranged', damage: 60, fireInterval: 850, range: 28,  auto: false, pump: true,  magSize: 6,  reserveMax: 30,  pickupAmount: 18,  caliber: '12ga', reloadTime: 3000 },
  { id: 2, name: 'Glock',   icon: '🔫', image: 'glock.png',  ammoImage: 'ammo_9mm.png', type: 'ranged', damage: 14, fireInterval: 230, range: 50,  auto: false, pump: false, magSize: 12, reserveMax: 72,  pickupAmount: 60,  caliber: '9mm', reloadTime: 1600 },
  { id: 3, name: 'Combat Knife', icon: '🔪', image: null,    ammoImage: null,          type: 'melee',  damage: 55, fireInterval: 450, range: 3.2, auto: false, pump: false, magSize: null, reserveMax: null, pickupAmount: 0, caliber: null, reloadTime: null },
];

export const MAX_HEALTH = 100;
export const RESPAWN_MS = 3000;
export const MAX_PLAYERS_PER_ROOM = 10;

export const STAND_EYE_HEIGHT = 1.7;
export const CROUCH_EYE_HEIGHT = 1.15;
export const PRONE_EYE_HEIGHT = 0.45;
export const STAND_HEAD_OFFSET = 1.5;
export const CROUCH_HEAD_OFFSET = 1.0;
export const PRONE_HEAD_OFFSET = 0.35;
export const PLAYER_RADIUS = 0.4;
export const PRONE_SPEED = 1.4;

// The four corner points used to sit exactly at the center of the tower-stump obstacles
// below (x:+-28, z:+-28, 4x4 footprint) — every spawn there dropped a player inside solid
// geometry. Pulled 3.2 units off both axes so they land just beside the stump instead of in it.
export const SPAWN_POINTS = [
  [-24.8, 0, -24.8], [24.8, 0, -24.8], [-24.8, 0, 24.8], [24.8, 0, 24.8],
  [0, 0, -30], [0, 0, 30], [-30, 0, 0], [30, 0, 0],
  // --- extension (open ground/alley only — clear of every house's footprint, and of the
  // mansion's x:[-13,13] z:[87,109] footprint further south) ---
  [0, 0, 46], [-30, 0, 75], [30, 0, 72], [-18, 0, 95], [18, 0, 95], [0, 0, 116],
];

// Server prefers a spawn at least this far (world units) from every currently-alive player
// before falling back to "whichever spawn is farthest from everyone" — see randomSpawn().
export const SPAWN_SAFE_DIST = 9;

export const GRENADE_COOLDOWN_MS = 4000;
export const GRENADE_FUSE_MS = 1600;
export const GRENADE_THROW_SPEED = 16;
export const GRENADE_BLAST_RADIUS = 8;
export const GRENADE_LETHAL_RADIUS = 3; // inside this, a grenade is a guaranteed one-shot kill
export const GRENADE_MAX_DAMAGE = 95;
// Ranged hits landing in the top slice of a target's hit-cylinder (head height, already
// stance-aware) do extra damage; melee/grenade ignore this. Body/arms/legs stay uniform.
export const HEADSHOT_MULTIPLIER = 2.5;
export const HEADSHOT_ZONE_FRAC = 0.82; // top 18% of the hit-cylinder height counts as head
export const GRENADE_RADIUS = 0.15; // ground-contact/physics size of the thrown grenade
export const GRENADE_START_COUNT = 3; // carried grenades, refilled on respawn
export const GRENADE_MAX_CARRY = 6;
export const GRENADE_PICKUP_AMOUNT = 2;
export const GRENADE_ICON = '💣';
export const GRENADE_IMAGE = 'grenade.png';
export const GRENADE_VISUAL_RADIUS = 0.13; // close to the physics radius now — a real small
// grenade-sized object (photo-textured, see client.js), not an oversized glowing ball. A
// point light still gives it away at range without the mesh itself being huge.

// Both maps share the same visual theme AND the same core arena + extension geometry — only
// wall/building color differs per theme (mud-yellow Ruins vs concrete-gray City), plus each
// theme gets one exclusive extra prop type (grass patches in Ruins, low bunkers in City). See
// getMapLayout() below. This keeps the "choose a map" feature cheap (one shared blueprint)
// while still giving each theme a distinct feel, per an explicit user request to diverge from
// the earlier "identical layout for every map" decision.
export const MAPS = {
  city:  { name: 'City',  theme: 'day' },
  ruins: { name: 'Ruins', theme: 'dusk' },
};
export const DEFAULT_MAP = 'city';

// The playable world is no longer a plain -40..40 square — it's a square core arena (unchanged)
// plus a doubled-length extension appended to the south (+Z) through the core's existing south
// wall gap, i.e. |_| -> |_|_|. Explicit min/max per axis (not a symmetric radius) because the
// extension only grows one direction. Used for the FLOOR mesh, the out-of-bounds/fall check,
// and the minimap's world-to-screen mapping — update all three together if this ever changes.
export const MAP_BOUNDS = { minX: -40, maxX: 40, minZ: -40, maxZ: 120 };

// Pickup spawn spots, spread through the lanes/plaza clear of obstacles, plus a second batch
// in the extension (including a couple placed deliberately inside building ground floors and
// on the upper platforms, to give players a reason to actually go in/up). Each tick the server
// assigns a random type (ammo for a random weapon, or a health pack) to any empty spot.
export const PICKUP_POINTS = [
  [-18, 0, -18], [18, 0, -18], [-18, 0, 18], [18, 0, 18],
  [-9, 0, 0], [9, 0, 0], [0, 0, -9], [0, 0, 9],
  [-26, 0, 0], [26, 0, 0], [0, 0, -26], [0, 0, 26],
  // --- extension: a couple placed just inside a house's ground floor, a couple up on a roof
  // (y matters for nothing gameplay-wise — collection is x/z distance only — but keeps this
  // list honest about where these actually sit; y:3.0 == wallH, the roof floor's height), the
  // rest in the open alleys/field ---
  [-32, 0, 55], [0, 0, 55], [-16, 3.0, 58], [16, 3.0, 58],
  [3, 0, 50], [0, 0, 82], [0, 0, 116],
];
export const PICKUP_RADIUS = 1.3; // collection distance
export const PICKUP_RESPAWN_MS = 18000;
export const HEALTH_PICKUP_AMOUNT = 999; // heals straight to MAX_HEALTH (capped there)

// Ground plane (rendered separately, not a collidable obstacle) — spans the full doubled
// world (MAP_BOUNDS): x -40..40 (w:80), z -40..120 (d:160, centered at z:40).
export const FLOOR = { x: 0, y: -0.25, z: 40, w: 80, h: 0.5, d: 160, color: 0x5b5b4f };

// --- Ruined-house generator: shared by both maps' extension (same geometry, different color) ---
// Two real rooms, one stacked directly on the other (the SAME x/z footprint, matching the
// reference photos and the user's own description) — a genuine 2-story house, not an offset
// "roof deck". Both floors get door/window gaps you can actually walk or shoot through
// (wallSide's gapLen mechanic — a real punched-through hole, no wall there at all, not just a
// texture). A real exterior staircase (see buildRampSteps in client.js for the visible mesh)
// runs up the OUTSIDE of one wall, in its own footprint entirely separate from the building's,
// so climbing it is never ambiguous.
//
// Two stacked floors sharing one footprint can't be told apart by position alone — a flat
// heightmap has exactly one height per (x,z), but here two heights legitimately apply at the
// same spot depending on whether you walked up the stairs or not. So which floor you're on is
// tracked as STATE (client.js's `standingPlatformIndex`), not inferred from x/z: walking onto
// the stair's footprint always gives you the stair's own interpolated height and, on reaching
// its top edge, marks you "on" that house's platform (its floor now overrides ground height for
// as long as you stay within its footprint); reaching the stair's bottom edge — or stepping
// outside the platform's footprint some other way, e.g. through a window — clears that and you
// drop back to ground height. See surfaceHeightAt in client.js for the actual state machine.
function wallRoom({ x, z, w, d, wallT, y, height, color, gaps }) {
  const walls = [];
  for (const side of ['north', 'south', 'east', 'west']) {
    walls.push(...wallSide({ side, x, z, w, d, wallT, y, height, color, gapLen: gaps[side] || 0 }));
  }
  return walls;
}
function wallSide({ side, x, z, w, d, wallT, y, height, color, gapLen }) {
  const hw = w / 2, hd = d / 2;
  const along = (side === 'north' || side === 'south') ? w : d;
  const cx = side === 'west' ? x - hw + wallT / 2 : side === 'east' ? x + hw - wallT / 2 : x;
  const cz = side === 'north' ? z - hd + wallT / 2 : side === 'south' ? z + hd - wallT / 2 : z;
  const axisIsX = side === 'north' || side === 'south';
  if (!gapLen) {
    return [axisIsX ? { x: cx, y, z: cz, w: along, h: height, d: wallT, color } : { x: cx, y, z: cz, w: wallT, h: height, d: along, color }];
  }
  const segLen = (along - gapLen) / 2;
  if (segLen < 0.6) return []; // gap swallows the whole wall — nothing left to draw
  const offset = segLen / 2 + gapLen / 2;
  return [-1, 1].map((sign) => axisIsX
    ? { x: cx + sign * offset, y, z: cz, w: segLen, h: height, d: wallT, color }
    : { x: cx, y, z: cz + sign * offset, w: wallT, h: height, d: segLen, color });
}

// Small debris at the foot of each wall — grounded (y near 0), so no risk of it reading as
// floating regardless of which side ended up with the crack gap this house.
function baseRubble({ x, z, size, color }) {
  const h = size / 2;
  return [
    { x: x - h - 0.8, y: 0.2, z: z + h * 0.3, w: 1.0, h: 0.4, d: 0.8, color },
    { x: x + h * 0.6, y: 0.2, z: z + h + 0.6, w: 1.2, h: 0.35, d: 0.9, color },
  ];
}

// `crackSide` (south/east/west — north is always the open entrance) gets a real punched-through
// gap on BOTH floors, not just texture — an actual second way in/out, on the ground floor AND
// through the parapet up top. Non-crack sides stay fully solid on both floors.
// `stairSide` must be 'east' or 'west' (the stair math only handles those two — kept simple
// on purpose since every house in RUIN_HOUSES below uses the same side anyway, spaced so
// neighbors' stairs never reach toward each other). `crackSide` is the second punched-through
// wall (south/east/west, never north — north is always the door — and never equal to
// stairSide, so the stair's own wall stays solid and structural).
function makeRuinHouse({ x, z, size = 10, wallH = 3.0, upperWallH = 2.6, wallT = 0.7, crackSide = 'south', stairSide = 'east', hasRoof = false, color }) {
  const w = size, d = size, hw = w / 2, hd = d / 2;
  const floorY = wallH; // upper floor rests directly on top of the ground floor's walls — no seam

  // The ground wall on stairSide ALSO needs a gap, not just the upper floor's — otherwise it's
  // a fully solid wall (0 to wallH) sitting right where the stairs climb past it, and since
  // you're below wallH for virtually the entire climb, that solid wall blocks any sideways
  // movement toward the doorway until you're at almost the exact last pixel of full height.
  // That's the actual "invisible wall, can't get in" — not a height/state bug, a plain missing
  // gap. A second opening near the stair base is harmless (it just leads into the ground floor
  // like any other gap would).
  const groundWalls = wallRoom({
    x, z, w, d, wallT, y: wallH / 2, height: wallH, color,
    // stairSide DOES get a ground-floor gap too (not just the upper floor's). Tried removing
    // it on the theory that the ramp's early state trigger (standingPlatformIndex, flips "on"
    // at 70% up the climb) would already clear this wall by the time anyone got near it — that
    // turned out to be wrong: a player who turns toward the doorway right as they trigger
    // (realistic — nobody waits for exactly 100% height before turning) is only at ~70% of
    // floorY, and 70% < wallH, so a gapless wall still blocks them. Verified this with a
    // frame-by-frame simulation before reverting it back — real block, not a hunch. Yes, this
    // technically means someone could enter the ground floor via door/crack, walk to this same
    // gap, and stand at (near-)full height without having climbed — a minor exploit, but this
    // is a LAN party game with no anti-cheat by design (see the project's own earlier design
    // notes), and it's a much smaller problem than the stairs not reliably working at all.
    gaps: { north: size * 0.38, [crackSide]: size * 0.42, [stairSide]: size * 0.4 },
  });
  const upperWalls = wallRoom({
    x, z, w, d, wallT, y: floorY + upperWallH / 2, height: upperWallH, color,
    // the stairSide gap is the landing you step off the stairs through; the crack continues
    // up as a window on this floor too — "kill enemies via the window holes"
    gaps: { [stairSide]: size * 0.4, [crackSide]: size * 0.32 },
  });
  // A real ceiling over the 1st floor — collidable (blocks bullets/grenades raining in from
  // above too, not just a visual cap), not walkable (no platform entry added for its top
  // surface — this roof isn't meant to be climbed onto, just to cover the room beneath it).
  const roof = hasRoof ? [{ x, y: floorY + upperWallH + 0.15, z, w, d, h: 0.3, color }] : [];

  const platform = { x, y: floorY, z, w, d, h: 0.25, color };

  // The staircase sits OUTSIDE the building entirely (its own footprint, offset past the
  // stairSide wall) — climbing it is a straightforward, unambiguous position-based ramp. It
  // must reach full height (floorY) exactly at the stairSide wall gap's z-center (z, same as
  // the building's own center — wallSide/wallRoom always center a gap on its wall) and its
  // inner edge must exactly meet the platform's edge (x + hw, no gap) — otherwise you reach
  // the top of the stairs and there's a dead zone between "still on the ramp" and "now on the
  // platform" where neither claims you and you fall right back down at the threshold. Runs
  // from the building's far (south) edge, where there's open ground to approach from, up to
  // that gap.
  const stairWidth = 2.6, stairDepth = size / 2;
  const sign = stairSide === 'east' ? 1 : -1;
  const ramp = {
    x: x + sign * (hw + stairWidth / 2), z: z + hd - stairDepth / 2,
    w: stairWidth, d: stairDepth, fromY: 0, toY: floorY, axis: 'z', reverse: true,
  };
  // Real full-height walls, not a jumpable low rail (that caused its own problem — its
  // collision box necessarily overlaps a strip of the ramp's own walkable width once
  // PLAYER_RADIUS padding is added, and a player drifting toward that edge while climbing
  // would get pinched between the step geometry and the rail). Only the front (south, open
  // ground you approach from) stays open:
  // - OUTER side wall: blocks walking straight in from the open field next to the stairs.
  // - "Back" cap wall: blocks approaching the ramp's high (near-platform) end from outside —
  //   the ramp is just a rectangle with no memory of how you got there, so without this,
  //   stepping onto it from due north (skirting around from open ground past where it tops
  //   out) puts you at near-full height instantly, no climbing at all.
  // Neither wall touches the INNER (building-facing) edge of the ramp's footprint — that's
  // deliberate, not an oversight: the building's own wall there has the real door/crack gaps
  // (must stay exactly as-is), and the back cap specifically is shifted off-center toward the
  // OUTER side so its footprint doesn't reach that inner edge at all — if it did, being so
  // close to the doorway's own z-position, it would plug part of the doorway gap itself. A
  // player could in principle still sneak in by hugging tight along the building's own wall
  // (which already blocks most of that approach with a solid segment north of the gap) — a
  // much narrower, easy-to-fix-later exploit than "walk straight up to the stairs from
  // anywhere", which was the actual complaint.
  const barrierH = 4.0, barrierT = 0.3;
  const rampMinZ = ramp.z - stairDepth / 2; // the ramp's own north edge
  const rampMaxZ = ramp.z + stairDepth / 2; // the ramp's own south (front) edge
  const stairSideWall = {
    x: ramp.x + sign * (stairWidth / 2 + barrierT / 2), y: barrierH / 2, z: ramp.z,
    w: barrierT, h: barrierH, d: stairDepth, color,
  };
  // Pulled in as tight as it can safely go: collidesAt pads every obstacle by PLAYER_RADIUS
  // (0.4), and this wall's padded reach must stay strictly on the far side of rampMinZ or it
  // blocks the ramp's own last stretch of climbing (z approaching rampMinZ is still legitimate
  // ramp territory, full height reached exactly there) — 0.4 padding + a hair of margin is the
  // real floor on how close this can get without doing that; any tighter and normal floating-
  // point movement would occasionally clip it while still legitimately climbing.
  const backInnerX = ramp.x - sign * 0.8, backOuterX = ramp.x + sign * 1.6;
  const stairBackWall = {
    x: (backInnerX + backOuterX) / 2, y: barrierH / 2, z: rampMinZ - 0.45 - barrierT / 2,
    w: Math.abs(backOuterX - backInnerX), h: barrierH, d: barrierT, color,
  };
  // Inner (building-facing) wall along the stairs — covers only the LOWER stretch of the
  // climb (from the front/ground end up to where the doorway gap in the real building wall
  // begins), explicitly, rather than relying on that wall's own solid segment there by
  // implication. Stops exactly at the doorway's edge — must not eat into "the small gap from
  // where we get out" (the actual doorway, z < that edge) or it walls off the exit itself.
  const doorGapEdge = z + (size * 0.4) / 2; // matches the stairSide gap's own half-length in groundWalls
  const stairInnerWall = {
    x: ramp.x - sign * (stairWidth / 2 + barrierT / 2), y: barrierH / 2, z: (doorGapEdge + rampMaxZ) / 2,
    w: barrierT, h: barrierH, d: rampMaxZ - doorGapEdge, color,
  };

  const decor = baseRubble({ x, z, size, color });
  return { walls: [...groundWalls, ...upperWalls, ...roof, stairSideWall, stairBackWall, stairInnerWall], platform, ramp, decor };
}

// Five houses clustered right where the extension begins (fixed, hand-placed coordinates —
// not Math.random(), so the layout is reproducible and guaranteed alley-width/no-overlap —
// but varied enough in position and crack side to read as organic, matching the reference
// photos' "cluster of houses" look). Gaps between neighbors run 4-7 units — tight enough to
// be real alleys, wide enough to walk/fight through.
// Uniform 16-unit spacing (6-unit clear gap between adjacent 10-wide houses) and every stair
// on the east side, all facing the same way — verified by hand that a house's east-side stair
// (extends ~2.75 units past its own east wall) never reaches the 3.25-unit-clearer west wall
// of the house 16 units over, and the rightmost house's stair still lands inside MAP_BOUNDS.
const RUIN_HOUSES = [
  { x: -32, z: 58, crackSide: 'south' },
  { x: -16, z: 58, crackSide: 'west' },
  { x: 0,   z: 58, crackSide: 'south', hasRoof: true }, // the one fully-covered house
  { x: 16,  z: 58, crackSide: 'west' },
  { x: 32,  z: 58, crackSide: 'south' },
];

// --- The mansion: a big haveli/castle-style centerpiece for the empty field south of the
// house row. Exterior only for now (corner towers + a crenellated parapet for the grand
// silhouette, two decorative door panels — one shut, one ajar — at the center entrance) — the
// interior is deliberately left as one big empty hall (no internal walls) per an explicit
// instruction to hold off on interior layout until told otherwise. North wall (the approach
// side, facing back toward the house row) gets the wide center double-door opening; east and
// west each get one plain punched-through gap ("half the wall broken", not a door); south
// stays fully solid — no entrance was asked for there.
function buildCrenellations({ x, z, w, d, wallH, color }) {
  const merlonW = 1.3, merlonH = 0.8, merlonD = 0.4, period = merlonW + 1.0;
  const chunks = [];
  for (const wallZ of [z - d / 2, z + d / 2]) {
    const count = Math.floor(w / period);
    const startX = x - (count * period) / 2;
    for (let i = 0; i < count; i++) {
      chunks.push({ x: startX + period * i + merlonW / 2, y: wallH + merlonH / 2, z: wallZ, w: merlonW, h: merlonH, d: merlonD, color });
    }
  }
  for (const wallX of [x - w / 2, x + w / 2]) {
    const count = Math.floor(d / period);
    const startZ = z - (count * period) / 2;
    for (let i = 0; i < count; i++) {
      chunks.push({ x: wallX, y: wallH + merlonH / 2, z: startZ + period * i + merlonW / 2, w: merlonD, h: merlonH, d: merlonW, color });
    }
  }
  return chunks;
}

function makeMansion({ x, z, w = 26, d = 22, wallH = 6.0, wallT = 0.9, color, doorColor }) {
  const hw = w / 2, hd = d / 2;
  const doorGapW = 6, crackW = w * 0.3;
  const walls = [
    ...wallSide({ side: 'north', x, z, w, d, wallT, y: wallH / 2, height: wallH, color, gapLen: doorGapW }),
    ...wallSide({ side: 'south', x, z, w, d, wallT, y: wallH / 2, height: wallH, color }), // no gap — solid
    ...wallSide({ side: 'east', x, z, w, d, wallT, y: wallH / 2, height: wallH, color, gapLen: crackW }),
    ...wallSide({ side: 'west', x, z, w, d, wallT, y: wallH / 2, height: wallH, color, gapLen: crackW }),
  ];

  const towerSize = 3.4, towerH = wallH + 2.6;
  const towerOffsetX = hw - towerSize / 2, towerOffsetZ = hd - towerSize / 2;
  const towers = [
    { x: x - towerOffsetX, z: z - towerOffsetZ }, { x: x + towerOffsetX, z: z - towerOffsetZ },
    { x: x - towerOffsetX, z: z + towerOffsetZ }, { x: x + towerOffsetX, z: z + towerOffsetZ },
  ].map((t) => ({ x: t.x, y: towerH / 2, z: t.z, w: towerSize, h: towerH, d: towerSize, color }));

  const roof = [{ x, y: wallH + 0.15, z, w, d, h: 0.3, color }];

  // Two decorative door panels in the doorway — neither is collidable (the actual passage is
  // the wall gap itself, same as every other opening in this game); they're just dressing.
  // Left half: shut and "locked"-looking but you walk straight through it (a dummy). Right
  // half: rendered swung open at an angle, sitting just inside the opening.
  const northWallZ = z - hd + wallT / 2;
  const panelW = doorGapW / 2 - 0.25, panelH = wallH * 0.8, doorY = panelH / 2;
  const doorDecor = [
    { x: x - doorGapW / 4, y: doorY, z: northWallZ, w: panelW, h: panelH, d: 0.15, rotY: 0, color: doorColor },
    { x: x + doorGapW / 4 - 0.4, y: doorY, z: northWallZ + 0.7, w: panelW, h: panelH, d: 0.15, rotY: 1.05, color: doorColor },
  ];

  return { walls: [...walls, ...towers], decor: [...buildCrenellations({ x, z, w, d, wallH, color }), ...doorDecor], roof };
}
const MANSION = { x: 0, z: 98, w: 26, d: 22 };

// Low cover in the alley gaps between houses — sandbag-tan for Ruins, concrete-gray for City
// (recolored with the rest of the extension, see getMapLayout).
// All prop spots below sit at z>=68 or z<=50 — clear of the house row (z 53..63) AND every
// house's east-side stair (which reaches to z 54..62 in the gap toward its eastern neighbor) —
// deliberately conservative after the last pass placed a couple of these close enough to a
// stair to matter.
const EXTENSION_BUNKERS = [
  { x: -24, y: 0.65, z: 70, w: 3, h: 1.3, d: 2 },
  { x: -8,  y: 0.65, z: 73, w: 2, h: 1.3, d: 3 },
  { x: 8,   y: 0.65, z: 71, w: 3, h: 1.3, d: 2 },
  { x: 24,  y: 0.65, z: 74, w: 2, h: 1.3, d: 3 },
];

// Barrels and stacked tires — collidable (real, if minor, cover), but rendered as their own
// mesh shape (see client.js) instead of the generic textured box every other obstacle uses,
// hence `renderAs`. Shared by both themes: a rusted drum or a tire stack reads fine in either
// a ruined town or a modern city alley.
// Kept clear of the mansion's x:[-13,13] z:[87,109] footprint (with margin) below.
const EXTENSION_DRUMS = [
  { x: -30, z: 50 }, { x: -6, z: 50 }, { x: 20, z: 50 },
  { x: -16, z: 85 }, { x: 20, z: 86 }, { x: -34, z: 95 }, { x: 20, z: 110 },
];
const EXTENSION_TIRE_STACKS = [
  { x: -25, z: 78 }, { x: 2, z: 80 }, { x: 28, z: 76 }, { x: 20, z: 98 },
];

// Decorative-only thick-grass patches (no collision — bullets shouldn't be stopped by grass,
// this pairs with prone to blend into ground clutter, not a hard LOS-blocking mechanic). Fewer,
// bigger, denser patches than the first pass — "thick enough to actually hide in", not a light
// dusting. {x,z,r} — r is the patch's rough radius, see buildGrassPatches in client.js.
const EXTENSION_GRASS = [
  { x: -25, z: 85, r: 4 }, { x: 22, z: 88, r: 4.5 }, { x: -22, z: 103, r: 4 }, { x: 25, z: 100, r: 3.5 },
];

// Single source of truth for a map's full layout: the unchanging core arena (OBSTACLES_BASE)
// plus the shared extension blueprint recolored per theme. `walls` feeds collision + rendering
// + bullet/grenade raycasts; `platforms`/`ramps` are used only for the player's standing height
// (see surfaceHeightAt in client.js) but are ALSO folded into the physics obstacle list
// server-side so shots/grenades can't pass through a floor slab; `decor`/`grass` are purely
// visual, client-only, never collidable.
export function getMapLayout(mapKey) {
  const color = mapKey === 'ruins' ? 0xb08d4a : 0x8a8d8f; // mud-yellow vs concrete-gray
  const bunkerColor = mapKey === 'ruins' ? 0x9c8256 : 0x7a7d7a;
  const mansionColor = mapKey === 'ruins' ? 0xc9a06a : 0xa8a49c; // richer sandstone vs pale stone
  const doorColor = 0x4a3320;

  const houses = RUIN_HOUSES.map((h) => makeRuinHouse({ ...h, color }));
  const mansion = makeMansion({ ...MANSION, color: mansionColor, doorColor });
  const bunkers = EXTENSION_BUNKERS.map((b) => ({ ...b, color: bunkerColor }));
  // Sized for actual cover, not a garnish — a barrel/tire stack you can crouch behind, not a
  // knee-high prop. h/w/d here are the COLLISION box (matches the real mesh size in client.js).
  const drums = EXTENSION_DRUMS.map((p) => ({ x: p.x, y: 0.6, z: p.z, w: 0.95, h: 1.2, d: 0.95, color: 0x4a4038, renderAs: 'drum' }));
  const tires = EXTENSION_TIRE_STACKS.map((p) => ({ x: p.x, y: 0.55, z: p.z, w: 1.1, h: 1.1, d: 1.1, color: 0x1c1c1c, renderAs: 'tire' }));

  return {
    walls: [...OBSTACLES_BASE, ...houses.flatMap((h) => h.walls), ...mansion.walls, ...mansion.roof, ...bunkers, ...drums, ...tires],
    platforms: houses.map((h) => h.platform),
    ramps: houses.map((h) => h.ramp),
    decor: [...houses.flatMap((h) => h.decor), ...mansion.decor],
    grass: EXTENSION_GRASS,
  };
}

// All obstacles are axis-aligned boxes: {x,y,z} = center, {w,h,d} = size, color = hex.
// These double as collision volumes (expanded by player radius) on the client. This is just
// the original core arena now — see getMapLayout() for the full per-map layout including the
// extension built around it.
const OBSTACLES_BASE = [
  // --- outer broken perimeter wall (gaps at cardinal midpoints for lane entries) ---
  { x: -33, y: 1.5, z: -14, w: 2, h: 3, d: 16, color: 0x8a7c66 },
  { x: -33, y: 1.5, z: 14,  w: 2, h: 3, d: 16, color: 0x8a7c66 },
  { x: 33,  y: 1.5, z: -14, w: 2, h: 3, d: 16, color: 0x8a7c66 },
  { x: 33,  y: 1.5, z: 14,  w: 2, h: 3, d: 16, color: 0x8a7c66 },
  { x: -14, y: 1.4, z: -33, w: 16, h: 2.8, d: 2, color: 0x8a7c66 },
  { x: 14,  y: 1.4, z: -33, w: 16, h: 2.8, d: 2, color: 0x8a7c66 },
  { x: -14, y: 1.4, z: 33,  w: 16, h: 2.8, d: 2, color: 0x8a7c66 },
  { x: 14,  y: 1.4, z: 33,  w: 16, h: 2.8, d: 2, color: 0x8a7c66 },

  // --- three-lane divider walls (left / mid / right corridors) ---
  { x: -12, y: 1.25, z: -8,  w: 1.2, h: 2.5, d: 14, color: 0x746753 },
  { x: -12, y: 1.25, z: 12,  w: 1.2, h: 2.5, d: 14, color: 0x746753 },
  { x: 12,  y: 1.25, z: -8,  w: 1.2, h: 2.5, d: 14, color: 0x746753 },
  { x: 12,  y: 1.25, z: 12,  w: 1.2, h: 2.5, d: 14, color: 0x746753 },

  // --- central plaza: 4 corner pillars, open middle for risk/reward ---
  { x: -5, y: 1.75, z: -5, w: 1.6, h: 3.5, d: 1.6, color: 0x9c8f77 },
  { x: 5,  y: 1.75, z: -5, w: 1.6, h: 3.5, d: 1.6, color: 0x9c8f77 },
  { x: -5, y: 1.75, z: 5,  w: 1.6, h: 3.5, d: 1.6, color: 0x9c8f77 },
  { x: 5,  y: 1.75, z: 5,  w: 1.6, h: 3.5, d: 1.6, color: 0x9c8f77 },

  // --- scattered rubble cover in side lanes ---
  // Raised from ~1.0 to 1.65: at the old height, crouch eye (1.15) still saw clean over the
  // top, so ducking behind "cover" did nothing. 1.65 sits just above crouch and just under
  // standing (1.7) — crouch actually hides you now, standing barely peeks over.
  { x: -22, y: 0.825, z: -4,  w: 3, h: 1.65, d: 2.4, color: 0x6b6152 },
  { x: -20, y: 0.825, z: 10,  w: 2.4, h: 1.65, d: 3, color: 0x6b6152 },
  { x: 22,  y: 0.825, z: -10, w: 3, h: 1.65, d: 2.4, color: 0x6b6152 },
  { x: 20,  y: 0.825, z: 4,   w: 2.4, h: 1.65, d: 3, color: 0x6b6152 },
  { x: -6,  y: 0.825, z: -20, w: 4, h: 1.65, d: 2, color: 0x6b6152 },
  { x: 6,   y: 0.825, z: 20,  w: 4, h: 1.65, d: 2, color: 0x6b6152 },

  // --- broken tower stumps near corner spawns (cover + landmark silhouettes) ---
  { x: -28, y: 1.25, z: -28, w: 4, h: 2.5, d: 4, color: 0x81745f },
  { x: 28,  y: 1.25, z: -28, w: 4, h: 2.5, d: 4, color: 0x81745f },
  { x: -28, y: 1.25, z: 28,  w: 4, h: 2.5, d: 4, color: 0x81745f },
  { x: 28,  y: 1.25, z: 28,  w: 4, h: 2.5, d: 4, color: 0x81745f },

  // --- extra mid-lane cover to break long sightlines ---
  { x: 0, y: 0.825, z: -12, w: 3, h: 1.65, d: 1.5, color: 0x746753 },
  { x: 0, y: 0.825, z: 12,  w: 3, h: 1.65, d: 1.5, color: 0x746753 },
];
