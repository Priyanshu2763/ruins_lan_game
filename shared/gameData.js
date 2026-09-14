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
function makeRuinHouse({ x, z, size = 10, wallH = 3.0, upperWallH = 2.6, wallT = 0.7, crackSide = 'south', stairSide = 'east', hasRoof = false, color, poster }) {
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
  // Optional poster on the upper floor's north (front) wall — unlike the ground floor, the
  // upper wall has NO gaps.north (only stairSide/crackSide get gaps up there, see upperWalls
  // above), so it's solid flat wall the full width, right above the doorway — exactly where
  // the user marked it on a screenshot. Flush against the outer face, offset out 0.02 to avoid
  // z-fighting with the wall's own surface, facing north (rotY 180°) toward an approaching
  // player, same convention as the mansion's banners/ivy.
  if (poster) {
    decor.push({
      x, y: floorY + upperWallH / 2, z: z - hd - wallT / 2 - 0.02,
      w: poster.w, h: poster.h, rotY: Math.PI, img: poster.img,
    });
  }
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
  { x: -32, z: 58, crackSide: 'south', poster: { img: 'monalisa.png', w: 2.44, h: 2.3 } },
  { x: -16, z: 58, crackSide: 'west', poster: { img: 'bsdk.png', w: 3.03, h: 2.0 } },
  { x: 0,   z: 58, crackSide: 'south', hasRoof: true, poster: { img: 'melody.png', w: 2.44, h: 2.3 } }, // the one fully-covered house
  { x: 16,  z: 58, crackSide: 'west', poster: { img: 'baigan.png', w: 2.89, h: 2.2 } },
  { x: 32,  z: 58, crackSide: 'south', poster: { img: 'bulla.png', w: 3.28, h: 1.8 } },
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

// One exterior staircase, climbing along X (for a wall that runs east-west, unlike every
// house stair which climbs along Z alongside a north-south wall) — same closed-except-the-
// climbing-face logic: an outer long wall (the far side, away from the building) plus a "back"
// wall blocking approach to the high end from beyond it, mirroring makeRuinHouse's stairs
// exactly, just with the axes swapped. Returns a ramp (axis:'x') and its barrier walls. Unlike
// the house stairs, the building's own wall at the high end does NOT need a matching gap —
// the platform-priority fix in surfaceHeightAt (client.js) already snaps a climbing player to
// full height as soon as their climb state triggers, well before they'd reach that wall, so
// it can stay fully solid and still get crossed via height alone.
function makeMansionStair({ climbLow, climbHigh, outerZ, stairWidth, toY, color }) {
  const stairZ = outerZ + stairWidth / 2;
  const dir = climbHigh > climbLow ? 1 : -1;
  const climbCenter = (climbLow + climbHigh) / 2, climbSpan = Math.abs(climbHigh - climbLow);
  const ramp = { x: climbCenter, z: stairZ, w: climbSpan, d: stairWidth, fromY: 0, toY, axis: 'x', reverse: dir < 0 };
  const barrierH = 4.5, barrierT = 0.3;
  const outerWall = { x: climbCenter, y: barrierH / 2, z: stairZ + stairWidth / 2 + barrierT / 2, w: climbSpan, h: barrierH, d: barrierT, color };
  const backX = climbHigh + dir * (0.45 + barrierT / 2);
  const backWall = { x: backX, y: barrierH / 2, z: stairZ, w: barrierT, h: barrierH, d: stairWidth + barrierT * 2, color };
  return { ramp, walls: [outerWall, backWall] };
}

// A short diagonal cover wall — this engine only supports axis-aligned collision boxes (no
// rotated hitboxes, see the mansion's ajar door for the same constraint), so a true 45°-rotated
// wall isn't possible. Instead this builds a chain of small square blocks stepped along the
// requested line, close enough together that consecutive blocks overlap (no seams a bullet or
// a player could slip through) — reads as a blocky diagonal barrier, which actually matches a
// brick-built wall's own chunky material better than a single smooth rotated slab would.
// `coverH` is deliberately short — tall enough that a CROUCHED player's hit-cylinder
// (CROUCH_HEAD_OFFSET + the 0.2 hitbox margin server-side, see handleAttack) is fully behind
// it, but well under a standing player's, so standing behind it still exposes you (a real
// height tradeoff, not just a prop). One block along the chain (`gunHoleIndex`) is built as a
// low block plus a separate cap instead of one solid block, leaving a real horizontal gap
// between them at roughly crouch eye height — an actual hole a crouched player can fire and
// see through, not just a shorter section of wall.
function makeDiagonalCoverWall({ x1, z1, x2, z2, blockSize = 1.4, spacing = 1.0, coverH = 1.3, gunHoleIndex, color }) {
  const dx = x2 - x1, dz = z2 - z1;
  const len = Math.hypot(dx, dz);
  const steps = Math.max(2, Math.round(len / spacing) + 1);
  const holeIdx = gunHoleIndex != null ? gunHoleIndex : Math.floor(steps / 2);
  const segments = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const cx = x1 + dx * t, cz = z1 + dz * t;
    if (i === holeIdx) {
      const lowH = 0.75, gapH = 0.35, capH = coverH - lowH - gapH;
      segments.push({ x: cx, y: lowH / 2, z: cz, w: blockSize, h: lowH, d: blockSize, color });
      segments.push({ x: cx, y: coverH - capH / 2, z: cz, w: blockSize, h: capH, d: blockSize, color });
    } else {
      segments.push({ x: cx, y: coverH / 2, z: cz, w: blockSize, h: coverH, d: blockSize, color });
    }
  }
  return segments;
}

function makeMansion({ x, z, w = 26, d = 22, wallH = 6.0, wallT = 0.9, color, doorColor }) {
  const hw = w / 2, hd = d / 2;
  const doorGapW = 6, crackW = w * 0.3;

  // Computed once and shared by the roof, the rooftop platform, and both stairs' climb target
  // — a climbing player needs to land EXACTLY at/above the roof's own top surface, and
  // computing that same value two different ways (even arithmetically equivalent ones, like
  // (wallH+0.15)+0.15 vs wallH+0.3) can differ by a floating-point epsilon. That's a real bug
  // this hit: the platform handed back 6.3, the roof's true top computed out to
  // 6.300000000000001, and "is my height below the roof's underside" came out true by that
  // sliver — blocked by a ceiling a climbing player was already standing flush against. The
  // +0.01 on the platform/stairs isn't just belt-and-suspenders either — it's real margin
  // above the roof's surface, not reliance on bit-identical equality staying that way forever.
  const roofTopY = wallH + 0.3;
  const climbTargetY = roofTopY + 0.01;

  // Two stairs climb the OUTSIDE of the south wall, one from each side, up to the rooftop —
  // same "only the front/climbing face is open, everything else is a wall" idea as the house
  // stairs. The south wall itself stays fully solid (see the big comment further down) —
  // crossing it relies on height, not a literal opening.
  const stairWidth = 3, climbSpan = 6;
  // Outer edge = ground level (0), inner (center-ward) edge = full height — for BOTH stairs,
  // so they climb TOWARD each other and meet near the middle (a "/|\" silhouette), not both
  // climbing the same direction. Got this backwards the first time: passed the east stair's
  // numerically-smaller x-bound as climbLow and larger as climbHigh without checking which end
  // that actually put the "ground" (0-height) side on — it put it near the CENTER instead of
  // the outer edge, so both stairs climbed the same way instead of mirroring.
  const westOuterX = -hw + 3, westInnerX = westOuterX + climbSpan;
  const eastOuterX = hw - 3, eastInnerX = eastOuterX - climbSpan;
  const southOuterZ = z + hd;
  const westStair = makeMansionStair({ climbLow: westOuterX, climbHigh: westInnerX, outerZ: southOuterZ, stairWidth, toY: climbTargetY, color });
  const eastStair = makeMansionStair({ climbLow: eastOuterX, climbHigh: eastInnerX, outerZ: southOuterZ, stairWidth, toY: climbTargetY, color });

  // The south wall stays FULLY SOLID — no gaps. This used to need one per stair so a
  // still-climbing player crossing it wouldn't get blocked by a wall taller than their
  // current height, but that's no longer true: the platform-priority fix (surfaceHeightAt,
  // client.js) already snaps a climbing player to full height the MOMENT their climb state
  // triggers, and that trigger fires while they're still on the stair itself, well before
  // they'd ever reach the wall — so by the time anyone actually gets to this wall, they're
  // already tall enough to clear it via the same "wall only blocks below its own height" seam
  // used everywhere else in this project, no literal opening required. A player who hasn't
  // climbed yet and tries to just walk into this wall is correctly, solidly blocked.
  // Interior partitions — the ground floor was one big empty hall (deliberately left that way
  // when the shell went in, waiting on a follow-up spec). These are real walls, same as every
  // other wall in the game (full collision — block players/bullets/grenades, not decoration),
  // laid out as a few offset spines per the user's own sketch rather than a tidy room grid: two
  // spines joined into an L on the west side, a third spine staggered off to the east (not
  // aligned with the L's open end — a real gap between them, not a doorway), plus a short stub
  // for one more nook. Every spine's far end is left open rather than touching another wall,
  // so nothing here can trap a player, and none of them reach into the door gap (x:[-3,3] at
  // the north wall), either crack gap (z:[94.1,101.9] at the east/west walls), or a corner
  // tower's footprint — checked against the exact numbers, not eyeballed.
  const interior = [
    { x: -5, y: wallH / 2, z: 97, w: wallT, h: wallH, d: 12, color }, // west spine (N-S)
    { x: -0.5, y: wallH / 2, z: 103, w: 9, h: wallH, d: wallT, color }, // joins its south end, runs east
    { x: 7, y: wallH / 2, z: 99.5, w: wallT, h: wallH, d: 13, color }, // staggered east spine (N-S)
    { x: 7.75, y: wallH / 2, z: 106, w: 1.5, h: wallH, d: wallT, color }, // short stub off its south end
  ];

  // Corner hideout, not a lone wall in the open — two full-height "back" walls forming a real
  // L, closing off a pocket, with the low diagonal cover-with-gun-hole (see
  // makeDiagonalCoverWall) hugging ONLY the corner end (backA's near end), not stretched across
  // the whole opening. Two earlier layouts both looked fine by eye but failed a real
  // grid-scanned walk test (sampling collidesAt across the whole area, not just a few points):
  // stretching the diagonal to reach toward backB left a gap that measured positive at the
  // block centers but was still sealed once PLAYER_RADIUS padding was added on both sides — a
  // ~2.2-unit-wide padded footprint per block doesn't leave room for a person between two
  // block positions spaced only 1 unit apart. Fix: don't try to thread a gap AT ALL — the
  // diagonal only spans the top third of the opening (near backA), and everything south/west
  // of it is genuinely untouched floor, not a narrow gap between two placed things. Verified
  // this time with a full grid scan of the region (every 0.5 units, not sample points): the
  // interior pocket (~4x2.5, plenty for one player) and its entrance are contiguous and clear.
  const cornerBackA = { x: 3, y: wallH / 2, z: 96, w: wallT, h: wallH, d: 6, color }; // N-S, z:[93,99]
  const cornerBackB = { x: 0.5, y: wallH / 2, z: 99, w: 5, h: wallH, d: wallT, color }; // E-W, x:[-2,3], joins backA at (3,99)
  const cornerCover = makeDiagonalCoverWall({ x1: 2.5, z1: 93.3, x2: 1.3, z2: 94.7, gunHoleIndex: 1, color });

  const walls = [
    ...wallSide({ side: 'north', x, z, w, d, wallT, y: wallH / 2, height: wallH, color, gapLen: doorGapW }),
    ...wallSide({ side: 'south', x, z, w, d, wallT, y: wallH / 2, height: wallH, color }),
    ...wallSide({ side: 'east', x, z, w, d, wallT, y: wallH / 2, height: wallH, color, gapLen: crackW }),
    ...wallSide({ side: 'west', x, z, w, d, wallT, y: wallH / 2, height: wallH, color, gapLen: crackW }),
    ...westStair.walls, ...eastStair.walls, ...interior, cornerBackA, cornerBackB, ...cornerCover,
  ];

  const towerSize = 3.4, towerH = wallH + 2.6;
  const towerOffsetX = hw - towerSize / 2, towerOffsetZ = hd - towerSize / 2;
  const towers = [
    { x: x - towerOffsetX, z: z - towerOffsetZ }, { x: x + towerOffsetX, z: z - towerOffsetZ },
    { x: x - towerOffsetX, z: z + towerOffsetZ }, { x: x + towerOffsetX, z: z + towerOffsetZ },
  ].map((t) => ({ x: t.x, y: towerH / 2, z: t.z, w: towerSize, h: towerH, d: towerSize, color }));

  // The main roof slab only ever covered the building's own footprint (up to the south wall,
  // z:[87,109]) — but the WALKABLE area (the platform below) deliberately extends south of
  // that, past the wall, to reach both stairs' tops. That gap between "where the visible roof
  // ends" and "where the stairs begin" was a real hole: nothing solid was there at all, just
  // empty air over the (invisible) extended platform — you could walk it (fine) but a grenade
  // thrown up through it would sail right through into the room below (not fine), and there
  // was nothing to look at underfoot up there either.
  //
  // Two DIFFERENT fixes for two different spots, not one slab stretched over both:
  // - Between the stairs (the open center strip, x:[-4,4]): nothing else is visible there at
  //   all, so a real VISIBLE slab is added, flush against the main roof's own south edge.
  // - Directly over each stair's own climb path: the sloped/stepped stair mesh
  //   (buildRampSteps) is ALREADY the visible geometry there — rendering a second, flat slab
  //   on top of those angled steps is what looked broken (a flat ceiling hovering just above
  //   the visible stairs, reading as a floating duplicate). So over the stairs, only an
  //   INVISIBLE collision box is added (renderAs:'invisible') — grenades/bullets still can't
  //   pass through that space, but nothing extra is drawn over the stair mesh itself.
  // Both are safe against ceiling-clip because the climb-state trigger was moved to 60% (see
  // surfaceHeightAt, client.js): a climbing body's head starts clipping a ceiling at this
  // height at ~66.6% of the climb (computed from PLAYER_HEIGHT), and the OLD 70% trigger fired
  // after that point — a real stuck-in-place window. With the earlier trigger, height is
  // already snapped to full well before the climb ever reaches the danger zone.
  const roofExtD = 5; // south of the original wall edge, comfortably past both stairs' outer ends
  const roofExtZ = z + hd + roofExtD / 2;
  const roof = [
    { x, y: roofTopY - 0.15, z, w, d, h: 0.3, color },
    { x, y: roofTopY - 0.15, z: z + hd + 1.5, w: 8, h: 0.3, d: 3, color }, // visible, center only
  ];
  const stairCeilings = [westStair, eastStair].map((s) => ({
    x: s.ramp.x, y: roofTopY - 0.15, z: roofExtZ, w: s.ramp.w, h: 0.3, d: roofExtD, color, renderAs: 'invisible',
  }));
  // The rooftop walkway a climbing player actually stands on. Its footprint is inset from the
  // walls at the north/east/west (so it reads as a walkway behind the parapet) but EXTENDS
  // south, past the south wall's own position, to overlap both stairs' high ends — this is
  // what lets the "climb near the wall, height already ~full, then step north across it"
  // handoff work without needing the south wall's stair gaps to also stay open at every
  // height (same seam trick used everywhere else: a wall only blocks while the player's
  // height is below its own, and it doesn't matter that the wall "gap" here is really just
  // the platform already claiming that ground before the player would need to cross it).
  // renderAs:'invisible' — the existing `roof` above already IS the rooftop's visible top
  // surface (and its own collision blocks bullets/grenades from passing through it from any
  // angle, same as before); this entry exists purely so surfaceHeightAt/rampHeightAt have
  // something to hand back once a climbing player's/grenade's state says they're "on" it —
  // rendering it too would just double up an already-visible slab.
  const platform = { x, y: climbTargetY, z: z + 2, w: w - 4, d: d + 6, h: 0.25, color, renderAs: 'invisible' };

  // Both door panels are real collision — walking (or throwing a grenade) straight
  // through the visible wood was the actual bug, not intended "dummy" behavior. The shut
  // panel is already axis-aligned (rotY 0), so it can just BE a wall entry directly. The ajar
  // panel is rotated for its look, and this engine's collision is axis-aligned boxes only (no
  // rotated hitboxes) — so its visible mesh stays a decor entry (still rendered rotated) and a
  // SEPARATE invisible box, sized to the rotated panel's actual axis-aligned footprint
  // (w·|cosθ| + d·|sinθ| and vice versa — the standard AABB of a rotated rectangle), goes in
  // `walls` instead. `renderAs: 'invisible'` piggybacks on the same tag client.js already uses
  // to skip drums/tires in the generic box-render pass, so this collision box never draws.
  // Shut door covers the west half of the opening. Ajar door is swung most of the way open
  // (80°, not a shallow 60°) and hinged toward the east edge, so its footprint sits close
  // against the east side rather than a big diagonal slab across the middle — the earlier
  // 60°-open, doorway-centered version left barely a 1-unit passable sliver once both panels'
  // (necessarily axis-aligned, since this engine has no rotated collision) bounding boxes were
  // accounted for. This leaves a comfortable clear middle instead.
  const northWallZ = z - hd + wallT / 2;
  const panelW = doorGapW / 2 - 0.25, panelH = wallH * 0.8, doorY = panelH / 2, panelD = 0.15;
  const shutDoor = { x: x - doorGapW / 4, y: doorY, z: northWallZ, w: panelW, h: panelH, d: panelD, color: doorColor };
  const ajarX = x + doorGapW / 2 - 0.4, ajarZ = northWallZ + panelW / 2, ajarRotY = 1.4;
  const ajarVisual = { x: ajarX, y: doorY, z: ajarZ, w: panelW, h: panelH, d: panelD, rotY: ajarRotY, color: doorColor };
  const ajarCollisionW = panelW * Math.abs(Math.cos(ajarRotY)) + panelD * Math.abs(Math.sin(ajarRotY));
  const ajarCollisionD = panelW * Math.abs(Math.sin(ajarRotY)) + panelD * Math.abs(Math.cos(ajarRotY));
  const ajarCollision = { x: ajarX, y: doorY, z: ajarZ, w: ajarCollisionW, h: panelH, d: ajarCollisionD, color: doorColor, renderAs: 'invisible' };

  // Meme poster on the corner hideout's back wall (cornerBackA), facing into the pocket — flush
  // against its west face (x = 3 - wallT/2 = 2.55), offset out by 0.02 to avoid z-fighting with
  // the wall's own surface. rotY = -90° points the plane's front face west, toward whoever is
  // standing in the pocket looking east at it (material is double-sided anyway, so this is
  // belt-and-suspenders, not load-bearing). Sized to the image's own ~1.03:1 aspect ratio.
  const memePoster = { x: 2.53, y: 2.0, z: 96, w: 2.07, h: 2.0, rotY: -Math.PI / 2, img: 'meme_modi.png' };

  // Red banners flanking the front door, plus climbing ivy further out on the same wall face —
  // the entrance read as too plain/flat (a big blank crack-textured wall either side of the
  // door). Both hang on the wall's OUTER (north) face, just in front of it (outerFaceZ - 0.02,
  // avoids z-fighting), facing north (rotY = 180°) so an approaching player sees them head-on.
  // Positioned outside the door gap (x:[-3,3]) and well clear of both corner towers (x:±11.3).
  const outerFaceZ = z - hd - wallT / 2 - 0.02;
  const banners = [-4.2, 4.2].map((bx) => ({
    x: bx, y: 3.6, z: outerFaceZ, w: 1.45, h: 3.2, rotY: Math.PI, type: 'banner',
  }));
  const ivy = [
    { x: -10, h: 4.5 }, { x: -6.5, h: 3.8 }, { x: 6.5, h: 4.2 }, { x: 10, h: 4.0 },
  ].map((v) => ({
    x: v.x, y: v.h / 2, z: outerFaceZ, w: v.h * 0.25, h: v.h, rotY: Math.PI, type: 'ivy',
  }));

  // Big centered poster on the south wall's OUTER face, in the open corridor between the two
  // back stairs (x:[-4,4], the same "center strip" the visible roof extension covers — see
  // batch 20/21) — dead center of that gap (x=0), sized large relative to the ~8-unit-wide
  // opening. This is the SOUTH wall, so it's the mirror image of the door banners/ivy above:
  // the exterior face is the +z side here (`z + hd + wallT/2`, not `z - hd - wallT/2`), and the
  // plane needs NO rotation (rotY 0, PlaneGeometry's default +Z-facing normal already points
  // toward someone standing in the stairs corridor looking north at the wall).
  const stairsGapPoster = {
    x: 0, y: 3, z: z + hd + wallT / 2 + 0.02, w: 3.375, h: 4.5, img: 'jaldi_hato.png',
  };

  return {
    walls: [...walls, ...towers, shutDoor, ajarCollision, ...stairCeilings],
    decor: [...buildCrenellations({ x, z, w, d, wallH, color }), ajarVisual, memePoster, ...banners, ...ivy, stairsGapPoster],
    roof,
    platform,
    ramps: [westStair.ramp, eastStair.ramp],
  };
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
    // ramps[i] <-> platforms[i] must stay index-matched (see client.js's standingPlatformIndex)
    // — the mansion's platform is duplicated once per its ramp (its two stairs share the one
    // rooftop) so that correspondence holds for every ramp, houses' and mansion's alike.
    platforms: [...houses.map((h) => h.platform), mansion.platform, mansion.platform],
    ramps: [...houses.map((h) => h.ramp), ...mansion.ramps],
    decor: [...houses.flatMap((h) => h.decor), ...mansion.decor, ...ARENA_POSTERS],
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

// Meme posters scattered across the ORIGINAL core arena's walls (OBSTACLES_BASE above) — the
// part of the map that existed before the southward doubling/extension. Spread across 6
// different structures (4 different perimeter-wall segments, 2 opposite corner tower stumps)
// rather than clustered, each mounted flush against that structure's INWARD (arena-facing)
// face — offset out 0.02 to avoid z-fighting — so it's visible to a player actually standing
// in the arena, not the unreachable outside of the perimeter wall. `rotY` is picked from each
// wall's own facing direction, same convention as the mansion's banners/ivy (0 = faces +Z,
// π = faces -Z, π/2 = faces +X, -π/2 = faces -X). Each sized to its own image's real aspect
// ratio (checked via PIL, not guessed) and kept within that wall's own height range with a
// visible margin on both sides.
const ARENA_POSTERS = [
  // west perimeter wall, north segment (x:-33,z:-14,h:3) — faces east into the arena
  { x: -31.98, y: 1.5, z: -14, w: 2.79, h: 2.2, rotY: Math.PI / 2, img: 'aap_kon.png' },
  // east perimeter wall, south segment (x:33,z:14,h:3) — faces west into the arena
  { x: 31.98, y: 1.5, z: 14, w: 3.31, h: 2.0, rotY: -Math.PI / 2, img: 'abe_saale.png' },
  // north perimeter wall, west segment (x:-14,z:-33,h:2.8) — faces south into the arena
  { x: -14, y: 1.4, z: -31.98, w: 1.57, h: 2.4, rotY: 0, img: 'depression.png' },
  // south perimeter wall, east segment (x:14,z:33,h:2.8) — faces north into the arena
  { x: 14, y: 1.4, z: 31.98, w: 2.91, h: 2.2, rotY: Math.PI, img: 'e_lo_angur_khao.png' },
  // NW corner tower stump (x:-28,z:-28,h:2.5), east face — faces the central plaza
  { x: -25.98, y: 1.25, z: -28, w: 1.97, h: 2.0, rotY: Math.PI / 2, img: 'hum_pe_to_h_hi_9.png' },
  // SE corner tower stump (x:28,z:28,h:2.5), west face — faces the central plaza
  { x: 25.98, y: 1.25, z: 28, w: 3.21, h: 1.8, rotY: -Math.PI / 2, img: 'jaldi_bol.png' },
];
