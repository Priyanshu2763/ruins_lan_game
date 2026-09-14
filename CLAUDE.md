# Ruins FPP — working notes for Claude Code sessions on this box

LAN FPP shooter. `server/index.js` (authoritative), `public/client.js` (three.js client),
`shared/gameData.js` (shared constants/data, imported by both). Run: `pm2 restart ruins-fpp`
(app already exists in pm2; node path is `~/.nvm/versions/node/v24.19.0/bin`, not on PATH in
non-interactive SSH — `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"` first).

## Status: ALL TASK BATCHES BELOW ARE DONE, including real product photos. Deployed and
restarted via pm2, syntax-checked, files + all 6 images confirmed served (curl 200s). Not
manually browser-tested — deliberately skipped per standing instruction (token cost, user
tests live with a friend).

## Real photos: resolved (was the last blocker, now closed)

The 5 (then 6) product photos the user attached in chat were never extractable by Claude Code
(no tool to export pasted chat images to disk — confirmed via filesystem search). Previously
documented as blocked. **Resolved**: the user instead dropped the raw files directly on the
LOCAL dev machine at `/home/chicmic/a/games/` (akm.png, glock.png, granade.png, 7.62mm.png,
9mm.png, 12gauge.png — added one at a time across two messages, 12gauge.png last).

What was done with them (this machine, `/home/tanveer/iDonotKnow/public/images/`):
- Real background removal via a Python/Pillow flood-fill script (BFS transparent-fill from the
  four image borders inward, color-tolerance 28, Gaussian-blur 1.5 feather on the alpha mask —
  NOT the `mix-blend-mode: multiply` hack this file used to describe as the plan; that was a
  fallback for if real image editing wasn't possible, superseded once real photos existed and
  now removed from `index.html`'s `.wImg` CSS since it would darken real transparent edges).
- Output files, already on this server: `akm.png`, `glock.png`, `grenade.png` (renamed from
  `granade.png`), `ammo_762.png`, `ammo_9mm.png`, `ammo_12ga.png`.
- **Cards** (`#weaponBar` in client.js): each weapon card and the grenade card use the flat
  transparent photo directly as an `<img class="wImg">`, with the emoji (`icon`/`GRENADE_ICON`)
  as an `onerror` fallback if a file is ever missing. `.weaponCard` widened to 100px and
  `.wImg` to `max-width:88px;max-height:34px` to fit the wide-aspect gun photos (was a cramped
  30x26 box sized for emoji).
- **In-world 3D ammo pickups** — explicitly NOT flat sprites per user clarification
  ("bullet spawns should be a 3d box... render it in 3d and not too large keep it small"):
  `ammoBoxMesh(weapon)` in client.js still builds a real small `THREE.BoxGeometry(0.34,0.22,
  0.26)` per caliber (color still varies via `CALIBER_BODY_COLOR`), and now adds the matching
  `weapon.ammoImage` photo as a `PlaneGeometry` label mesh on top of the box (texture loader
  cached in `photoTexCache` so each image loads once, not once per pickup instance). Grenade
  and health pickup meshes were also shrunk (grenade sphere 0.22→0.16 radius, health cross arms
  0.55/0.18→0.4/0.13) per the same "keep it small" instruction — these two didn't get photo
  treatment (no image for health; grenade pickup mesh already had its own icosahedron design
  and only the CARD got the grenade photo).
- `gameData.js` `WEAPONS[].ammoImage` field: `ammo_762.png` (AKM), `ammo_9mm.png` (Glock),
  `ammo_12ga.png` (Shotgun) — Shotgun's was the very last one wired in, added after the other
  five in a follow-up message.

Deployed: gameData.js, client.js, index.html — scp'd, `node --check` clean on both machines,
pm2 restarted cleanly (no error log output), curl 200 on client.js, index.html, and all 6
`/images/*.png` paths.

## Task batch (all completed across prior sessions — see git-less history: just trust this file)

- [x] **Pause menu on ESC.** Resume / Controls / Quit buttons, reusing `.screen`/`.panel` CSS
      and the existing `#controlsModal`. Quit = `location.reload()`.
- [x] **Grenade card + count + wall-bounce physics bug.** Grenade slot on the weapon bar,
      `grenade` pickup type (+2, client-trust model like ammo). Wall-bounce fixed via
      sphere-vs-AABB collision in the grenade physics tick (`resolveGrenadeWallBounce` in
      server/index.js) — closest point on each obstacle box, reflect velocity across the
      surface normal (restitution 0.45, damp 0.85), push out along the normal. Previously
      grenades only ever checked the Y-axis ground plane and passed straight through walls.
- [x] **Ruins map horizon: lava hills, not skyscrapers.** `buildHorizonTexture()` in client.js,
      `theme === 'dusk'` branch — jagged lava-mountain ridge + glowing branching cracks, ported
      from the sibling ASCEND project's `paintVolcanicHorizonTexture` technique. Kept the
      "pin start/end height, no seam at the 360 wrap" fix from that project.
- [x] **Weapon rebrand + real icons.** `Vulcan Rifle`→AKM, `Hawk Marksman`→Shotgun (pump-action:
      fire sound → ~150-200ms later a two-burst "cha-chk" pump sound → THEN the fire cooldown
      gates, so you can't fire again until shot+pump both played), `Sidearm Pistol`→Glock. Real
      photos now wired in (see above) — this item is fully closed, not just the rebrand half.
- [x] **Ammo caliber naming + can't-overfill + redesigned 3D pickup shape.** AKM=7.62mm,
      Glock=9mm, Shotgun=12ga. Toast reads "+120 7.62mm picked" (caliber, not gun name).
      Overfill edge case (picking up a maxed-out caliber still consumes the crate) left as a
      documented minor quirk — fixing it needs a new client→server "don't consume this" message
      for a rare case, not worth it (health pickups don't have this problem since health IS
      server-authoritative). 3D pickup shape redesign superseded/extended by the real-photo
      label-mesh work above — same small per-caliber box, now with a real photo decal instead
      of just a color/procedural-label distinction.

## Design decisions already locked in (don't re-ask)
- Ammo/grenade counts are client-side trust only, matching crouch/prone/movement — this is a
  LAN party game with no anti-cheat by design (see README).
- Map = visual theme only (city/ruins), same physical obstacle layout — a second real layout
  was deliberately out of scope for token cost reasons.
- In-world pickups stay real 3D geometry (small boxes/spheres with a texture/label), never flat
  billboard sprites — explicit user requirement, applies to any future pickup-visual work too.
- Product photos get real Pillow-based background removal (flood-fill BFS + feathered alpha),
  not a CSS blend-mode approximation, whenever the source files are reachable on disk. The
  reusable script lives in that session's scratchpad as `remove_bg.py`; re-derive if needed,
  it's short (border flood-fill by color tolerance, Gaussian blur on the resulting alpha mask).

## Workflow for this repo (established over past few sessions)
1. Edit local copies in `~/a/games/<scratchpad>/ruins/` (session-specific path — NOT directly
   over SSH — easier with Read/Edit tools.
2. `node --check` every changed `.js` file before pushing (locally AND again after scp, on the
   remote — cheap, has caught nothing yet but costs nothing).
3. `scp` the changed files to `tanveer@192.180.4.117:/home/tanveer/iDonotKnow/...`.
4. `pm2 restart ruins-fpp` over SSH, then `pm2 logs ruins-fpp --lines 15 --nostream` to
   confirm no startup errors, then a couple of `curl -o /dev/null -w '%{http_code}'` checks
   that changed files (and any new static assets, e.g. images) are actually being served.
5. Do NOT spin up a browser/playwright to visually verify — token cost, and the user tests
   live with a second player anyway. Syntax + server-health checks only.
6. Keep this file current after every batch — it's the explicit cross-session memory
   mechanism the user asked for so work survives a token/session cutoff.

## Batch 3 (this session) — DONE, deployed and restarted, all curl checks green
See PLAN_batch3.md in this repo root for the full technical writeup of each item (kept
separate from this file so it stays a manageable size). Summary:
1. [x] Ammo pickup crates: photo is now one of the box's own 6 faces (the lid material in a
   BoxGeometry material array), not a flat plane floating above unrelated colored geometry.
2. [x] Pause menu "Controls" button bug fixed — root cause was DOM stacking, not the click
   handler (#pauseMenu sits after #controlsModal in the DOM with no z-index, so it painted
   over the just-unhidden modal). Now hides pauseMenu when opening Controls from pause, and
   restores it on close only if it was opened that way.
3. [x] Shotgun gun photo (shotgun.png) processed same as the other 6 and deployed — card
   already pointed at this filename, no code change needed beyond the asset.
4. [x] Real per-weapon reload time (AKM 2.4s / Shotgun 3s / Glock 1.6s, gameData.js
   `reloadTime`) with a blinking conic-gradient countdown ring + remaining-seconds number on
   the weapon card (`reloadState`/`updateReload()` in client.js, `.reloadRing` CSS in
   index.html). Firing is blocked during reload; switching weapons cancels it outright.
5. [x] Remote players: prone now actually rotates the figure flat (rotation.x -90°) instead
   of just vertically squashing it (server hit-cylinder height was ALREADY stance-correct —
   this was purely a rendering-fidelity fix, verified by reading handleAttack before
   touching anything). Also attached a swappable weapon silhouette (long gun / pistol /
   knife, toggled by the already-broadcast `weapon` field) to the right arm so remote
   players are no longer bare-handed regardless of loadout.
6. [x] Headshot damage: `HEADSHOT_MULTIPLIER` (2.5x) in gameData.js, applied server-side in
   handleAttack when the ray's impact Y falls in the top 18% of the target's existing
   stance-aware hit-cylinder. Ranged only (melee/grenade unaffected). Body/arms/legs stay
   uniform damage per explicit instruction not to over-complicate this.

Note: shotgun.png source photo has a small baked-in "shutterstock.com" watermark (visible at
the bottom of the in-game card/pickup) — can't be removed without touching the gun pixels
themselves, flagged to the user, not fixed.

## Batch 4 (2026-09-10) — bug-fix round from live playtesting, DONE and deployed
1. [x] **Pause "Controls" button froze the game.** Root cause: no z-index anywhere in the
   CSS, so stacking followed DOM order — #gameContainer (the live canvas) sits AFTER
   #controlsModal in the DOM, so opening Controls mid-game put the still-rendering canvas
   on top of it, eating every click on the Close button with nothing visibly wrong. Only
   ever surfaced now because Controls-from-pause was newly wired (previously that button
   only ever opened pre-join, when gameContainer was hidden). Fixed with explicit z-index
   layering (#gameContainer:0, #hud:1, #lockHint:2, #scoreboard:5, .screen modals:10) in
   index.html instead of relying on source order.
2. [x] **Duplicate scoreboard rows on refresh.** A refresh disconnects the old socket (added
   to `room.leftStats` for room-persistent stats) and immediately opens a new one with a new
   id but the same name — showed as two rows. `joinRoom` in server/index.js now checks
   `leftStats` for a matching `name` on join, reclaims those kills/deaths onto the new
   connection, and deletes the stale entry.
3. [x] **Grenades tunneling through walls again.** Not a regression in the bounce code itself
   (resolveGrenadeWallBounce was untouched and correct) — a genuine tunneling bug: one 50ms
   physics tick moved a thrown grenade (16 u/s) up to 0.8 units, enough to skip clean through
   the thinner 1.2-unit divider walls between discrete collision checks. Fixed by running the
   physics tick in 4 substeps of 12.5ms each (0.2 units/substep) instead of one big step.
4. [x] **Grenade looked like a giant glowing red ball.** `GRENADE_VISUAL_RADIUS` 0.32 → 0.13
   (close to the physics radius). Mesh is now a small `CylinderGeometry` — real photo
   (grenade.png) on the top/bottom caps like the ammo-crate lid trick, dark olive material on
   the side, much dimmer point light (was overpowering) — a real small object, not a sprite.
5. [x] **Minimap.** Canvas overlay (top-left, under the room tag) draws the fixed obstacle
   layout top-down plus a gold triangle for the local player and a ray line for facing
   direction, using the same yaw math as movement (`updateMovement`) so the ray always
   points where WASD would actually move you. No other players shown (wasn't asked for).
6. [x] **Walking off the edge did nothing — no fall-death.** The arena floor is 80x80
   (-40..40) but the outer perimeter wall has intentional lane-entry gaps, so nothing
   physically stopped a player walking straight out past the edge into the horizon backdrop.
   Client now checks bounds (|x| or |z| > 39) each frame and sends a `fellOff` message once;
   server's new `killByEnvironment()` handles it exactly like a combat death (health to 0,
   deaths+1, respawn after RESPAWN_MS) but with `killerId: null` — client kill feed and the
   local death message special-case that to read "<name> fell from the playing area" instead
   of crediting a killer.

All 6 syntax-checked (local + remote), pm2 restarted clean, curl checks green. Not
browser-tested per standing instruction — user tests live.

## Batch 5 (2026-09-10) — DONE and deployed
1. [x] Minimap ray removed — the triangle already points the facing direction, the extra ray
   line on top of it looked redundant/messy. Triangle-only now.
2. [x] Fall-death was triggering the instant a player TOUCHED the map edge, which felt wrong
   ("dies by touching, not by falling"). Root cause: the old check used a 1-unit-short
   threshold (39 vs the real 40-unit floor edge) and killed immediately on crossing it.
   Reworked into an actual fall sequence in client.js: crossing the real floor edge
   (FLOOR.w/2, FLOOR.d/2 — matches the visible floor mesh exactly, no more arbitrary margin)
   sets a `falling` state that drops the camera under gravity for a beat (visually falling,
   input locked) before the `fellOff` message is sent once the drop passes a depth threshold
   — matches the "fall through the void" feel from the ASCEND sibling project instead of an
   instant kill on contact.
3. [x] **Match timer.** Create-room panel has a native `<input type="time">` (HH:MM,
   defaults 00:10; 00:00 = no limit) — parsed client-side to `durationMin`, sent with
   `createRoom`. Server sets `room.matchEndsAt` + a `setTimeout` at room creation (cleared if
   the room empties out early), included in the `joined` payload so every joiner (including
   late joiners) computes the same absolute countdown. Client shows a top-center MM:SS
   countdown (`#matchTimer`) computed from that timestamp each frame. On timeout the server
   broadcasts `matchEnded` with the final leaderboard; client shows a dedicated
   `#matchEndScreen` (final standings + Quit-to-menu button), force-releases pointer lock,
   freezes movement/firing (`localAlive=false`), and a `matchOver` flag stops the
   pointerlockchange handler from re-popping the pause menu underneath it.

All 3 syntax-checked (local + remote), pm2 restarted clean, curl-verified index.html contains
the new elements. Not browser-tested per standing instruction — user tests live.

## Batch 6 (2026-09-10) — map extension (large feature), DONE and deployed

**The map doubled**: the original 80x80 core arena (unchanged) now has an 80x80 extension
appended to the south (+Z), through its existing south wall gap — |_| -> |_|_|. World bounds
are no longer a symmetric square: `MAP_BOUNDS` in gameData.js is `{minX:-40,maxX:40,minZ:-40,
maxZ:120}` (explicit per-axis, not a radius) — the fall-death check, the FLOOR mesh (now
w:80,d:160,z:40), and the minimaps world-to-screen mapping all read from this one constant.

## Batch 6 (2026-09-10) — map extension (large feature), DONE and deployed

**The map doubled**: the original 80x80 core arena (unchanged) now has an 80x80 extension
appended to the south (+Z), through its existing south wall gap — |_| -> |_|_|. World bounds
are no longer a symmetric square: `MAP_BOUNDS` in gameData.js is `{minX:-40,maxX:40,minZ:-40,
maxZ:120}` (explicit per-axis, not a radius) — the fall-death check, the FLOOR mesh (now
w:80,d:160,z:40), and the minimap's world-to-screen mapping all read from this one constant.

**Per-map layout, finally real** (this replaces the earlier "same obstacle layout for every
map" decision — the user explicitly asked to diverge from it this time): `getMapLayout(mapKey)`
in gameData.js is now the single source of truth, used identically by both server and client
(deterministic pure function of the map key — no data sent over the wire for it, both sides
just compute the same thing locally from `room.map` / `msg.map`). It returns the unchanging
core arena obstacles plus a shared extension blueprint (two 2-story buildings + a bunker room)
recolored per theme — mud-yellow for Ruins, concrete-gray for City — plus each theme's one
exclusive prop type: Ruins gets 8 decorative grass patches, City gets 3 low cement bunkers.
Same geometry, different skin, per the user's own framing ("same things just modern in city
and older in ruins").

**Two-story buildings + real stairs — the hard part.** A flat `surfaceHeightAt(x,z)` heightmap
can't represent two floors stacked at the same (x,z) (it's not a function of position if height
depends on history too), so each building's interior is split into three NON-OVERLAPPING z-bands
instead of stacking: a ground-level entry area, a ramp (smoothly interpolated 0 -> floorY), and
a back area that only has the upper floor — you physically cannot reach the back band's (x,z)
coordinates without having walked up through the ramp first (full-width ramp, no side path
around it), so the height function stays single-valued and there's no ambiguity. Found and
fixed one real bug here during testing: the ramp/platform boundary used strict `<` on both
sides, leaving a zero-width gap exactly at the shared seam where height snapped to 0 for an
instant — changed to `<=` so both regions agree exactly at the boundary (verified with a
node-based walk-through simulation before shipping, see the z=59..81 height trace).

**Collision went 3D.** `collidesAt(x,z,y)` (client.js) now takes the player's current standing
height and only blocks on a wall whose OWN vertical span overlaps the player's body at that
height — this is what lets you walk on the ground floor underneath a building's upper-floor
parapet without it blocking you, while still being properly blocked by that same parapet once
you're actually up on the platform. Platforms/ramps themselves never block horizontal movement
(handled separately via surfaceHeightAt) — only the wall list does.

**Networked height.** `pos[1]` used to be hardcoded to 0 everywhere (client sendState, remote
player rendering) since the game was flat. Now it carries the player's real standing surface
height (`currentGroundY`), which the SERVER'S hit-detection already generically supported
(`handleAttack`'s yMin/yMax were always built from `other.pos[1]`, never hardcoded — turned out
to be already-correct, just never exercised) — so combat on the upper floors works with zero
server-side change once the client started reporting real height. Remote player figures also
now render at their true elevation instead of always snapping to the floor.

**Scope decisions (deliberate, not missed requirements):**
- Grass is decorative only — no new line-of-sight/bullet-blocking system. Bullets shouldn't
  stop on grass; it pairs with the existing prone mechanic for a "blends into clutter" feel,
  not a hard mechanic.
- You cannot fall off a rooftop's edge and take damage/die from a bad step — the upper floors
  are fully enclosed by their parapet on every side except the ramp, so the only way off is
  back down the ramp. Not requested; a real fall-through-space system for arbitrary ledges
  would be a much bigger addition than this batch's scope.
- Jump does not let you hop over a parapet — jump has always been a cosmetic camera bob in
  this game (no real jump-driven collision changes anywhere), consistent with that.
- Fog render distance raised 110 -> 230 (the extension reaches z:120, well past the old
  cutoff) and the painted horizon backdrop (radius 170, unchanged) still comfortably clears
  the new max extent.
- Extra spawn points (5) and pickup points (7, including two placed on the upper platforms)
  added in the extension so it's not dead space — existing core-arena spawns/pickups untouched.

Syntax-checked (local + remote), `getMapLayout` output counts verified identical on both
machines (city: 46 walls/2 platforms, ruins: 43 walls/2 platforms/8 grass), pm2 restarted
clean, curl-verified. Not browser-tested per standing instruction — this is by far the
riskiest batch yet (new collision dimension, new heightmap system) so please test the
buildings/stairs/upper floors thoroughly and report anything that feels off.

## Batch 7 (2026-09-10) — extension rework: real ruined houses, props, DONE and deployed

User feedback on batch 6: the "2-story buildings" were just plain boxes — no visible stairs, no
window/wall gaps, no alleys/grass/tactical props reading clearly. Sent reference photos
(house1.png, "cluster of houses.png" — real weathered adobe ruins with cracked walls, exterior
wooden ramps, waist-high roof railing, jagged broken parapets) plus drum.png (rusted oil
barrel, already transparent) and grass.png (a grass clump render, dark background — background-
removed with the usual Pillow flood-fill, tol=70 needed since this one had a gradient/vignette
background a low tolerance couldn't walk across).

**The old `makeBuilding`/`makeRoom`/2-building layout is gone.** Replaced with
`makeRuinHouse()` — same core idea (front/ramp/back z-banding so the flat surfaceHeightAt
heightmap stays unambiguous, see batch 6 notes) but a real punched-through gap (`crackSide`,
varies per house) on BOTH the ground wall and the upper parapet, not just one open entrance
side — an actual second way in/out (and the literal "jump out of the cracked wall" the user
asked for: `wallSide()` with a `gapLen` just omits that stretch of wall from the returned
obstacle list, so it's a real passable hole, not a texture trick). Plus jagged broken-top
rubble chunks and base debris (`topRubbleChunks`/`baseRubble`, decorative/non-collidable, fixed
relative offsets so getMapLayout stays a pure function — no Math.random() in anything that
needs to match between client and server).

**Five houses**, hand-placed (not RNG — reproducible, guaranteed no overlap) in a tight cluster
right where the extension begins, 4-7 unit gaps between neighbors — real alleys, matching the
"cluster of houses" reference. Verified with a node script that no spawn/pickup point lands
inside any wall AABB, and re-verified the ramp-to-platform height transition is still seamless
at the new smaller size (10x10 vs the old 16x20).

**New props, shared across both themes** (this drops the old "grass is Ruins-only, bunkers are
City-only" split — user explicitly asked for bunkers in Ruins too, and there's no reason City
wouldn't also have barrels/tires, so all of it is shared now, just recolored where relevant):
- Barrels: real `CylinderGeometry`, drum.png on the side material, plain dark rusty caps.
- Tire stacks: 3 stacked `TorusGeometry` rings, plain dark rubber material (no photo needed,
  procedural already reads fine as a tire).
- Bunkers: low sandbag-tan (Ruins) / concrete-gray (City) cover blocks in the alley gaps.
- Grass: reworked from plain procedural cones to real crossed-plane billboards textured with
  the actual grass.png photo (alpha-tested for crisp edges) — denser and bigger than the first
  pass (`patch.r * 3.5` clumps instead of a flat 14), "thick enough to actually hide a prone
  player in" per the explicit ask, not a light dusting.
- Barrels/tires are collision-list entries too (`room.physicsObstacles` includes them
  automatically, zero server changes needed) but get a custom mesh instead of the generic
  textured box — tagged `renderAs: 'drum'|'tire'` so the generic obstacle-render loop skips
  them and a second pass builds the real shape.

**Ruins map now uses a dedicated mud-brick texture map-wide** (`buildMudTexture()` — brick
coursing lines instead of graffiti, heavier crack network, warm tan/ochre base) instead of
sharing the concrete-and-graffiti texture with City — applies to the whole Ruins map (core
arena included), not just the new houses, for a consistent "old adobe" read throughout.

**Scope note, unchanged from batch 6:** the ramp is still functionally internal (three
z-bands inside the building footprint), not a true free-standing exterior staircase mesh —
literally matching the reference photo's exact geometry would need an imported 3D model file,
which wasn't provided (only 2D reference photos) and there's no asset-loading pipeline in this
project. The visual/functional result (real wall gaps, jagged broken top, rubble, working
ramp to a railed roof) gets close within what's proceduraly buildable from box primitives —
flagging this rather than claiming a literal match.

Syntax-checked (local + remote), layout counts verified identical on both machines (75
walls/5 platforms/5 ramps/30 decor/4 grass, both themes), spawn/pickup collision-checked via
script, pm2 restarted clean, curl-verified including the two new images. Not browser-tested
per standing instruction.

## Batch 8 (2026-09-10) — house structure fix pass, DONE and deployed

User feedback on batch 7's houses: "this isn't a house... floating debris". Two real bugs, not
just a fidelity gap:

1. **The ramp had ZERO visual representation.** `ACTIVE_RAMPS` was only ever used for the
   invisible surfaceHeightAt walkable-height math — nothing rendered a staircase mesh. Since
   the roof platform+parapet sit 3+ units up with nothing bridging them to the ground floor
   visually, the upper structure genuinely looked like it was floating disconnected above the
   walls. Fixed with `buildRampSteps()` in client.js — solid ascending blocks (each one filled
   from y:0 up to that step's tread height, not thin floating treads) that visually bridge
   ground to roof. Purely a rendering addition — NOT added to the collision obstacle list
   (they'd otherwise block the very ramp they're decorating; the walkable height still comes
   from ACTIVE_RAMPS/surfaceHeightAt exactly as before).
2. **The ground floor's entrance removed an entire wall FACE**, not a door-sized gap — on top
   of the separate "crack" gap on another side, a house had at most ~1.5 solid walls out of 4,
   reading as scattered panels rather than an enclosed structure. `makeRuinHouse` (gameData.js)
   now gives every house all 4 ground walls, each present, with a normal door-sized gap
   (`size*0.38`) on the entrance side plus the wider crack gap elsewhere — matches the
   reference photos' actual proportions (a boxy structure with holes in it, not missing faces).

Also addressed, same pass: dropped `topRubbleChunks` (the jagged top-edge debris) entirely —
its fixed corner offsets didn't know where each house's crack gap ended up, so a chunk could
land floating over open air where the crack removed the wall beneath it. Kept `baseRubble`
only (grounded near y:0, no such risk). Barrels/tires were also reported "floating and too
small" — enlarged substantially (drum: 0.33->0.47 radius, 0.85->1.15 height; tire: 0.32->0.42
ring radius, 3->4 stacked, 0.9->~1.28 total height) and re-verified the grounding math so the
bottom of each mesh sits exactly at y:0, not floating. Grass patches reworked from a flat
per-radius multiplier to `r*r*1.8` clumps with even (sqrt-distributed, not center-biased)
placement — meaningfully denser, adjacent clumps' foliage now actually overlaps, closer to
"thick enough to hide prone in" than the previous sparse scatter.

Re-verified with the same node collision script as prior batches: all spawn/pickup points
still clear of every wall AABB after the door-gap layout change (wall count went 75->85, the
expected +2 segments per house from splitting the north face). Syntax-checked (local +
remote), pm2 restarted clean. Not browser-tested — genuinely needs eyes-on this time given how
far off the last pass was; please check the houses specifically before moving on to anything
else, per your own priority order.

## Batch 9 (2026-09-10) — real stacked-floor houses + the stairs-stuck bug, DONE and deployed

User: reported getting stuck jumping off a roof (only grenade-suicide + respawn freed them),
and re-described exactly what they wanted — two rooms stacked directly on each other (not an
offset "roof deck"), doors/windows cut into BOTH floors, punch-through walls, a simple side
staircase to the 1st floor, shoot enemies through the window holes.

**Root cause of the stuck bug, found by hand-deriving the geometry:** the previous ramp (batch
8) spanned the building's FULL depth and only reached full height (floorY) at the far end —
but the wall gap you'd actually step through to enter the building was centered on the
building's middle, 4 units away from where the stairs topped out. Climbing to the top put you
at the right HEIGHT but the wrong POSITION to walk through the doorway; moving toward the
doorway meant leaving the ramp's footprint, which dropped your height back toward 0 before you
got there — a real "reach the top, immediately fall partway back down, land in whatever
geometry happens to be there" loop, which is exactly what getting wedged between wall segments
looks like from inside it.

**Rebuilt to match the user's actual description**, not the previous "back band" approximation:
`makeRuinHouse` (gameData.js) now builds two real rooms sharing the SAME x/z footprint (one
stacked directly on the other, floorY == wallH so there's no seam), each with its own door/
window gaps via the existing `wallSide` gap mechanic. Since two stacked floors at the same
(x,z) can't be told apart by position alone (a heightmap has exactly one height per point), the
client now tracks "which floor" as explicit STATE: `standingPlatformIndex` (client.js). Walking
up a ramp always gives its own interpolated height and, on reaching its top edge EXACTLY (which
this rewrite aligned to sit precisely at the destination wall's gap center, with zero gap
between the ramp's inner edge and the platform's edge — verified with a node walk-through
simulation, not just eyeballed), marks that house's platform "active"; reaching the ramp's
bottom, or stepping off the platform's own footprint any other way (a window, the parapet),
clears it and you drop to ground height. Re-verified the fixed alignment with two more
simulations: climbing the stairs (smooth 0->3.0, state flips to "on" exactly at the gap) and
walking sideways from the stair onto the platform through the gap (height stays 3.0 throughout,
zero collision blocking the path) — both clean, no dead zones.

The staircase itself sits in its own disjoint footprint OUTSIDE the building (attached to one
side, `stairSide` — always 'east' across all 5 houses this pass, for simplicity/predictability
after variety caused spacing bugs twice already), so climbing it is never ambiguous — the
stacked-floor ambiguity only exists once you're actually on the shared-footprint platform,
which the state tracking resolves.

Also repositioned the 5 houses to a clean uniform row (x: -32,-16,0,16,32, all z:58, 16-unit
spacing = 6-unit clear gaps) — hand-verified each house's east-side stair has real clearance
from its neighbor (checked by hand this time, not just visually eyeballed) and the rightmost
house's stair still lands inside MAP_BOUNDS. Moved every small prop (bunkers/drums/tires) to
z<=50 or z>=68 — clear of the entire house+stair z-range (53..63) — after finding a couple in
the previous pass were sitting uncomfortably close to a stair. Re-ran the same node collision
script as every prior batch: all spawn/pickup points confirmed clear of the new wall layout.

Syntax-checked (local + remote), pm2 restarted clean, wall/platform/ramp counts verified
identical on both machines. This is a genuine architecture change (position-based height ->
stateful floor tracking) so please stress-test the stairs specifically — walk up, walk down,
walk up and immediately jump off through a window, walk up then back down without entering —
before moving on to anything else.

## Batch 10 (2026-09-10) — the ACTUAL "can't get into 1st floor" bug, + a roofed house, DONE

Batch 9's stairs-stuck fix aligned the ramp's top correctly with the doorway (verified with a
simulation) but missed a second, separate bug: the state trigger threshold
(`standingPlatformIndex` activating) required being within the last 1.5% of the ramp's 5-unit
depth — a 0.075-unit-wide window. Movement advances in discrete per-frame position steps
(speed * dt, ~0.09 units/frame at normal speed and 60fps) — a window that thin can fall
entirely between two consecutive frames and never get hit at all. That's why nobody could
actually get onto the 1st floor: the state that "catches" you at the top essentially never
fired. Widened the trigger band from the last/first 1.5% to the last/first 30% (client.js,
`surfaceHeightAt`) and this time verified the fix with a REALISTIC simulation — stepping the
same ~0.09 units/frame a real client would, not big 1-unit test increments — confirming it
now reliably triggers partway up (frame 60, ~1 second in) with huge margin either side.

Also added: one of the five houses (the middle one, x:0) now has a real roof — a collidable
ceiling slab over the 1st floor (`hasRoof: true` in gameData.js's `RUIN_HOUSES`, implemented
as a 4th wall-list entry in `makeRuinHouse`, sitting right on top of the upper walls). It
blocks bullets/grenades raining in from above too, not just a visual cap. Not walkable on
top — this is a ceiling, not a second rooftop platform.

Re-verified with the full collision-check script (this time properly height-aware — the flat
2D version flagged a false positive on the new roof, since it sits at y:5.75, far above
ground-level pickups, so switched to the same 3D-overlap logic collidesAt actually uses) that
every spawn/pickup point is still clear, and re-ran the stairs simulation specifically against
the newly-roofed house (index 2) to confirm its trigger and platform-entry behave identically
to the others despite the roof.

Syntax-checked (local + remote), pm2 restarted clean, wall count 104 (103 + 1 roof) verified
identical on both machines. This should be the real fix for stair entry — please confirm you
can now reliably walk up and into all 5 houses, and check how the roofed one reads/plays
differently (fully enclosed 1st floor — no light/sky through the top, bullets can't rain in
from above).

## Batch 11 (2026-09-10) — the REAL invisible-wall bug, DONE and deployed

User reported "still cannot get in, invisible wall" after batch 10. Batches 9-10 fixed the
HEIGHT/state-transition math (verified correct by simulation both times) but missed something
more basic: the GROUND FLOOR wall on stairSide never had a gap — only `north` (door) and
`crackSide` did. `makeRuinHouse`'s groundWalls only ever set
`gaps: { north: ..., [crackSide]: ... }`, no `[stairSide]` entry — so the ground wall was fully
solid, 0 to wallH, for the entire depth on that side.

Since a climbing player is below wallH for virtually the whole ascent (only reaching it in the
last stretch), and `collidesAt` blocks based on the wall's real height range regardless of any
state flag, that solid ground wall physically blocked sideways movement toward the doorway for
nearly the entire climb — you could only slip through in the last few centimeters of height,
which in practice almost never lined up with also being in the right X position. That's the
actual "invisible wall" — a genuinely solid, undocumented wall, not a subtle timing issue.

Fix: added `[stairSide]: size * 0.4` to the ground floor's gaps too (gameData.js). A second
opening at ground level near the stair base is harmless — it just gives the ground floor a
second way in, same idea as the crack gap already does elsewhere.

Verified properly this time — not just spot-checking a few points, but scanning the ENTIRE
climb path (every ~0.2 units in Z along the full ramp, every ~0.15-0.2 units in X from the
stairs into the building interior, using the actual height at each Z per the ramp's
interpolation) against the real 3D height-aware collision logic. Confirmed a fully clear path
through the middle of the doorway (z 57-59, the comfortable two-thirds of the 4-unit-wide gap)
at every point along the climb — zero blocks across 378 sampled positions. The only blocks
found anywhere were right at the physical wall edges flanking the gap (expected — that's the
actual solid wall, not the opening) plus PLAYER_RADIUS padding eating about 0.4 units off each
side of the nominal 4-unit gap (effective ~3.2-unit passable width — still comfortable).

Re-ran the full spawn/pickup collision check (both ruins and city) with the height-aware 3D
version — all clear. Syntax-checked (local + remote), pm2 restarted clean, wall count 109 (was
104, +5 = one new gap-pair per house) verified identical on both machines.

This should be the actual fix — the previous two attempts were real, valid fixes for real bugs
they found, but this ground-wall gap was the thing actually stopping entry. Please confirm you
can walk straight from the stairs into all 5 houses now.

## Batch 12 (2026-09-10) — stairs: front-only entry, jump-over side rail, DONE and deployed

User: could get onto the stairs from any side (the ramp was a bare rectangle with zero
collision of its own — only used for height), not just the intended front approach. Wanted the
open (outer, away-from-building) side blocked like a wall, except jumpable partway up.

Added `stairBarrier` per house in `makeRuinHouse` (gameData.js) — a low (0.75-unit) rail
running the stairs' full length, on the OUTER side only (away from the building; the inner/
building-facing side is intentionally left alone, since that boundary is the real wall+gap and
must stay exactly as batch 11 left it for the doorway transition). Front (south, low end) and
the connection to the platform at the top both stay completely open — only the long side facing
open ground got a barrier.

To make "jump over it" actually mean something, jump had to start affecting collision at all —
previously `jumpOffset` was purely a cosmetic camera bob with zero physics effect (confirmed by
reading `updateMovement`: `collidesAt` was only ever called with `currentGroundY`, never
`jumpOffset`). Now it's `currentGroundY + jumpOffset` (client.js). Checked this doesn't let
jump cheese anything else: jump's peak height at the current JUMP_VEL/GRAVITY is ~0.96 units —
comfortably under the new 0.75 rail (clears it) but well under the core arena's existing 1.65
cover blocks (jump peak 0.96 < 1.65, so standing cover is unaffected — verified this is a
one-sided change, only opens up obstacles shorter than ~1 unit, doesn't weaken anything taller).

Verified with node scripts before deploying: barrier genuinely blocks ground-level (y:0)
sideways entry at its actual position (first test used a point past the barrier's own thin
collision box by mistake and got a false "not blocked" — corrected to test at the barrier's
real center), confirmed clear at jump-peak height (y:0.96), confirmed the front entrance is
still open at ground level, and re-ran the full doorway-path scan from batch 11 (378 points,
zero blocks) to confirm this didn't reintroduce that bug.

Syntax-checked (local + remote), pm2 restarted clean, wall count 114 (was 109, +5 = one
barrier per house) verified identical on both machines, spawn/pickup collision re-checked
clean.

## Batch 13 (2026-09-10) — stairs: real walls (not low rails), closed the back approach, DONE

User: getting physically pinched between batch 12's low rail and the step geometry, and could
still walk straight onto the stairs "from the backside" (approaching the ramp's high/near-top
end from open ground to its north, landing at near-full height with zero climbing — the ramp
is just a rectangle, it has no memory of how you got into its footprint). Asked for a simpler,
more robust fix: real walls on the side and back, front only.

Replaced the 0.75-unit jumpable rail with a genuine full-height wall (4.0 units — comfortably
above anything relevant in this system) on the ramp's outer side. Added a second wall capping
the ramp's north (back) end so approaching from open ground on that side is blocked too.

The back wall took two attempts to get right — first version spanned the ramp's FULL width,
which meant it necessarily reached all the way to the building-facing edge; since that edge is
exactly where the doorway gap lives (by design, so the climb tops out right at the doorway),
the back wall's own PLAYER_RADIUS padding bled into the gap and would have partially
re-blocked the very doorway it's not supposed to touch. Fixed by shifting the back wall
off-center toward the outer side only, stopping short of the building edge with real margin —
verified numerically (padded inner reach vs. the actual gap position) before trusting it, not
just eyeballed.

Also had to re-relitigate the ground-floor stairSide gap. Tried removing it (theory: the ramp's
early state trigger at 70% should already clear a gapless wall by the time anyone's near it) —
built and ran a full frame-by-frame simulation of a realistic climb-then-turn, and it showed a
genuine block: a player who turns toward the doorway right as they trigger (realistic — nobody
waits for exactly 100%) is only at ~70% of full height, which is still less than the gapless
wall's blocking height. Reverted the removal — the gap needs to stay. This does mean a player
could still walk in through the door/crack, cross the ground floor, and stand at (near-)full
height via that same gap without climbing — a real but minor exploit, explicitly accepted
rather than re-breaking guaranteed stair entry to close it (this is a LAN party game with no
anti-cheat by design, per the project's own earlier notes) — noted for later if it matters.

Verified with a single comprehensive simulation covering all of: front still open, outer side
blocked at every height, straight-line back approach blocked, ground gap still present, a full
realistic frame-by-frame climb-approach-trigger-turn-enter sequence with zero blocks, and the
usual spawn/pickup collision check — all green together before deploying, not as separate
earlier-invalidated claims.

Syntax-checked (local + remote), pm2 restarted clean, wall count 119 (was 114, +5 = one back
wall per house; the side wall was already counted, just changed height) verified identical on
both machines.

## Batch 14 (2026-09-10) — small follow-up: tighter back wall + explicit inner wall, DONE

User: the back wall (batch 13) left a visible gap before the stairs actually started, and
asked for an inner (building-facing) wall too — but only covering the stair's own extent, not
the doorway opening itself.

Tightened `stairBackWall`'s offset from 0.6 to 0.45 — this is close to the real floor: its
padded reach (own half-thickness + PLAYER_RADIUS) must stay strictly short of the ramp's own
edge (rampMinZ) or it starts blocking the last stretch of legitimate climbing, so 0.4ish
padding is close to the minimum achievable gap regardless of how the wall itself is
dimensioned — noted this rather than chasing a truly-zero gap that isn't achievable without
also blocking real climbing.

Added `stairInnerWall`: runs along the building-facing side of the stairs, but ONLY for the
z-range between the ramp's front (south) edge and where the ground floor's actual doorway gap
begins — computed directly from the same `size * 0.4` half-length the door gap itself uses in
`groundWalls`, not a guessed number, so the two stay in sync if gap sizing ever changes. This
is technically redundant with the ground wall's own solid segment that already covers that
same stretch (a side effect of the gap not reaching that far) — added anyway since the user
asked for an explicit wall there, and a redundant collider is harmless, not a bug.

Verified with the same full simulation suite as batch 13 (front open, outer/back/inner walls
all block at relevant heights, doorway/ground-gap still open, full realistic frame-by-frame
climb-trigger-turn-enter sequence clear, spawn/pickup collision-free) before deploying — all
green together.

Syntax-checked (local + remote), pm2 restarted clean, wall count 124 (was 119, +5 = one inner
wall per house) verified identical on both machines.

## Batch 15 (2026-09-10) — the mansion (exterior shell only, interior deferred), DONE

Big new feature: a haveli/castle-style mansion centerpiece for the open field south of the
house row (which the user flagged as "too empty"). Explicit instruction: build the exterior
carefully now, leave the interior as one big empty hall — no room layout — until told
otherwise in a follow-up message. Scope for this batch is exterior + shell only.

`makeMansion()` (gameData.js): 26x22 footprint, wallH 6.0 (noticeably taller/grander than the
5 regular houses' 3.0), positioned at (0, 98) — 24 clear units south of the house row (which
ends at z:63), fully inside MAP_BOUNDS. Recolored per theme like everything else: richer
sandstone for Ruins, pale stone for City (distinct from the regular houses' colors, to read as
a grander building).

Three entrances, per the spec:
- North wall (the approach side, facing back toward the house row): one wide (6-unit) "double
  door" gap, center-positioned. Two decorative door panels sit in it (non-collidable — the
  actual passage is the wall gap itself, same as every other opening in this project): one flat
  against the opening (the "locked" dummy — visually shut, walk straight through), one rotated
  ~60° open, offset slightly into the doorway (the "ajar" door). `rotY` is a new decor field —
  client.js's decor render loop now applies `mesh.rotation.y` when present.
- East wall and west wall: one plain punched-through gap each (`wallSide`'s existing gapLen
  mechanic, same technique as the smaller houses' crack openings) — "half the wall broken",
  explicitly not door-shaped.
- South wall: fully solid, no gap — verified by scanning x:-10..10 at the wall's actual z
  (109, not 110 — first test point missed the wall's real thickness range and gave a false
  "clear", caught and corrected before trusting the result).

Exterior grandeur, kept to box primitives (no new rendering techniques):
- Four corner towers, `towerH = wallH + 2.6`, inset so they sit within/reinforcing the main
  wall footprint rather than protruding into someone's face when walking past.
- A crenellated parapet (`buildCrenellations`) — small merlon boxes spaced around the top edge
  of all four walls, periodic, decorative-only (added a real quantity of these, ~44 across the
  perimeter — still just simple untextured boxes, comparable cost to the grass instancing
  already in use, not expected to be a real performance concern).
- A collidable roof cap, same pattern as the one roofed regular house.

Interior: deliberately just the open hall — no internal walls, verified clear at its center.

Had to relocate several existing props that would have clipped into the mansion's new
footprint (x:[-13,13] z:[87,109], kept clear with margin): two grass patches, one drum, one
tire stack, and two spawn/pickup points that landed inside or right at the edge of the new
building. Re-verified the FULL spawn/pickup list against the updated layout — all clear.

Syntax-checked (local + remote), pm2 restarted clean, wall count 136 / decor count 52 verified
identical on both machines (up from 124/20 pre-mansion). Verified interior openness, all three
entrances, and the solid south wall with actual coordinate checks (not eyeballed) before
deploying. Next step per the user is their own follow-up on interior layout — do not add
interior walls/rooms until they specify what they want.

## Batch 16 (2026-09-10) — real grenade-passes-through-walls bug fixed, doors likely a stale cache

User reported two things: can't get through the doors, and grenades passing through doors and
the stairs.

**Doors**: ran the exact same door-gap collision check used to verify every prior stairs/house
fix — a full sweep straight through the mansion's center doorway (z:84..92, x:0) and through a
regular house's north door — both come back completely clear, every point. Also diffed the
deployed remote gameData.js byte-for-byte against the local scratchpad — identical, deployment
is in sync, not stale server-side. Given the data layer says these are passable and nothing in
this batch's changes touched door-gap logic, this is most likely the player's browser holding
an old cached copy of client.js/gameData.js after this many rapid back-to-back redeploys —
told the user to hard-refresh. Flagged rather than guessed at a fix, since inventing a "fix"
for a bug that doesn't reproduce in the data would just be noise.

**Grenades: real, confirmed bug, found and fixed.** `resolveGrenadeWallBounce` (server/
index.js) computes the closest point on a wall's box to the grenade's center; when the
grenade's center is deep enough inside a wall that all three coordinates are already within
the box's range, that closest point IS the grenade's own position (distance zero) — the old
code's guard (`distSq < 1e-8 → skip`) treated this as "nothing to do" and just let the grenade
keep moving with its existing velocity, unresolved. That's a real logic bug, not a tunneling/
substep issue (batch 4 already fixed substep tunneling) — a grenade that ever ends up with its
center embedded in a wall, for whatever reason, would sail straight through with zero bounce.
The much bigger obstacles added since (the mansion's walls, the tall 4-unit stair barriers)
made this a lot more likely to actually trigger than it was against the original thin core-
arena walls.

Fixed by computing the minimum-penetration axis (checking distance to each of the box's 6
faces, picking the shortest) and pushing the grenade out along that axis instead of giving up
— the standard way to eject a sphere whose center has ended up inside a box. Verified with a
direct unit test of the exact function logic: a grenade placed dead-center inside a large wall
(mimicking the mansion's south wall) now correctly resolves and gets pushed out through the
nearest face; a normal surface-graze case (the common path, previously working fine) still
resolves identically to before — not a regression.

Syntax-checked (local + remote), pm2 restarted clean. Only server/index.js changed this batch
— gameData.js and client.js are unchanged from the last deploy.

## Batch 17 (2026-09-10) — mansion doors made solid, stairs now block grenades as a real floor

Asked the user to clarify two ambiguous points rather than guess again (they'd asked for
exactly that): which mansion door(s) should be solid, and what "grenade goes through the
stairs" actually meant given my testing showed the stairs' side/back walls already correctly
block grenades. Answers: both doors solid; and the real issue is that the STAIRS THEMSELVES
(the walkable ramp surface) have zero collision presence for grenades at all — a grenade lobbed
onto a staircase falls straight through the (purely visual, non-collidable) steps to the flat
ground below, because `ramps` was only ever consulted by the client for PLAYER height
(surfaceHeightAt) and was never part of the server's grenade-facing obstacle list.

**Mansion doors**: both panels are now real collision. The shut/"locked" panel is already
axis-aligned (no rotation), so it just became a wall entry directly. The ajar/open panel stays
visually rotated (~80°, tightened from the original 60° — see below) but this engine has no
rotated-hitbox support, so its VISUAL stays a decor entry while a separate INVISIBLE
axis-aligned box (sized via the actual bounding-box-of-a-rotated-rectangle formula:
w·|cosθ| + d·|sinθ|, and vice versa — not guessed) goes into `walls` for collision only,
tagged `renderAs: 'invisible'` (reusing the tag client.js already uses to skip drums/tires in
the generic render pass, so no client-side rendering changes were needed for this part).
First attempt at the ajar door's angle/position (60°, centered in the doorway) left only about
a 1-unit passable sliver once both panels' necessarily-boxy hitboxes were accounted for —
caught this by actually measuring the open width with a script before deploying, not
eyeballing, and widened the angle to 80° plus repositioning it toward the east edge (closer to
how a real hinged door swings flush against a wall) — now leaves a genuinely comfortable ~1.5
unit clear passage, verified numerically.

**Stairs as a real floor for grenades**: added `room.ramps = layout.ramps` at room creation
and a server-side `rampHeightAt(x, z, ramps)` (server/index.js) — the same interpolation math
the client's surfaceHeightAt already uses for the ramp portion, just without the platform-
"which floor am I on" state (a thrown object doesn't need that the way a walking player does —
platforms were already real collision boxes and worked fine for grenades on their own). The
grenade physics tick's ground-bounce check now compares against `GRENADE_RADIUS +
rampHeightAt(...)` instead of a flat ground constant, so a grenade landing anywhere on a
staircase now correctly rests/bounces at that point's actual stair height instead of falling
through to y=0. Removed the now-dead `GRENADE_GROUND_Y` constant.

Verified before deploying: measured the mansion doorway's actual open width with a
padding-aware collision script (1.5 units, comfortably passable); re-ran the full spawn/pickup
collision check (clean); confirmed both door panels now genuinely block at their real
positions. Did not re-simulate the ramp-as-floor grenade fix with a full physics trace this
time (straightforward, mirrors already-verified client logic) — worth a live test.

Syntax-checked (local + remote), pm2 restarted clean, wall count 138 (was 136, +2 = shut door
+ ajar collision box) verified identical on both machines.

## Batch 18 (2026-09-10) — mansion back stairs to the rooftop, two real bugs found and fixed

User drew two red lines on a screenshot of the mansion's back wall: two symmetric staircases
climbing up from either side, "same logic" as the house stairs (only the climbing face open,
everything else closed, acts as a real floor for grenades).

**New capability needed first: axis:'x' ramps.** Every ramp so far climbed along Z (houses'
stairs run alongside a north-south wall). The mansion's back wall runs east-west, so a stair
alongside it naturally climbs along X instead — the `axis` field already existed on ramp
objects but was dead (both surfaceHeightAt and rampHeightAt hardcoded Z-based interpolation).
Implemented properly in both places, plus buildRampSteps (visual stair meshes) — verified this
doesn't change any existing Z-axis ramp's behavior (regular houses re-tested, identical result
to before).

**makeMansionStair()**: generates one ramp + its outer wall (blocks the open-field side) + a
back wall (blocks approaching the high end from beyond it) — direct mirror of the house stairs'
barrier logic, axes swapped. Two instances (west, east), symmetric. The south wall — previously
one fully solid piece — is now 3 segments with 2 gaps (wallSide only supports a single centered
gap, can't express two), one gap per stair, sized with margin around each stair's own x-range.

**Two real bugs found via simulation before deploying, not after:**
1. Reused the exact "climb, trigger, immediately turn" simulation that caught the house-stairs
   bugs — it caught a NEW one here: turning toward the building right at the 70% trigger left
   the player at ~70% height while crossing under the mansion's ROOF, and PLAYER_HEIGHT (1.8)
   is enough that their head clipped the ceiling's underside from below — a category of bug
   the house stairs can't have (they don't have a roof overlapping their stairs). Fixed by
   changing surfaceHeightAt so that once state triggers for a ramp, if the current position is
   ALSO already within that ramp's platform footprint (true here by the platform's design —
   see below), it returns the platform's flat height immediately instead of continuing the
   ramp's gradual interpolation — the last 30% of the climb becomes a snap to full height
   rather than a slow rise that lingers at head-clipping height. Re-verified this doesn't
   affect the house stairs (no ceiling there to begin with, confirmed identical behavior).
2. Even after that fix, still blocked — chased it down to a genuine floating-point precision
   mismatch: the platform's target height (`wallH + 0.3`) and the roof's computed top surface
   (`(wallH + 0.15) + 0.15`) are mathematically the same value but came out as 6.3 vs
   6.300000000000001 — different by one bit, enough for `y < oMaxY` to read true and block a
   player standing exactly flush against the roof's own underside. Fixed by computing a single
   shared `roofTopY` once and deriving the roof, the platform, and both stairs' climb target
   from it, plus a real +0.01 margin (not just bit-identical equality) so this class of bug
   can't resurface if any of these are ever computed independently again.

The rooftop platform's footprint is deliberately inset from the walls on 3 sides (a proper
walkway behind the crenellated parapet) but EXTENDS south past the wall itself, overlapping
both stairs' high ends — this is what makes the "snap to platform height once triggered" fix
in #1 actually reachable while still on the stair, rather than only after already crossing the
wall.

Verified with the full test suite before deploying: complete realistic climb-trigger-cross for
both stairs (clear), descending back down (clear, state correctly resets), a grenade landing
at multiple points along a stair's climb (smooth 0->6.3 interpolation via the new axis-aware
rampHeightAt), the regular houses' stairs re-tested for regression (identical, unaffected),
and the full spawn/pickup collision sweep (clean).

Syntax-checked (local + remote), pm2 restarted clean, wall/platform/ramp counts (144/7/7)
verified identical on both machines and both themes.

## Batch 19 (2026-09-10) — mansion stairs: fixed direction, made the back wall fully solid

User: wanted the two stairs mirrored, climbing toward each other and meeting near the center
("/|\"), not both sloping the same way ("\  \"); and the back wall should have zero holes,
not the two gaps batch 18 cut into it.

**Direction bug**: found it immediately on re-reading the code. The east stair's climbLow/
climbHigh (which set WHICH end is height-0 vs height-full) were assigned from
"numerically-smaller-x" / "numerically-larger-x" without checking which end that actually put
the ground side on — it put the ground (0-height) end near the CENTER and the full-height end
at the OUTER edge, the opposite of the west stair. Both stairs climbing toward the same side
looked like the parallel-slope screenshot instead of a mirrored peak. Fixed by defining both
stairs symmetrically: outer edge = 0 height, inner (center-facing) edge = full height, for
both — verified with a fresh simulation that each stair's `reverse` flag came out as intended
(west: false, east: true) and that both now trigger while approaching from their own outer
edge, climbing toward the middle.

**Solid back wall**: the two gaps existed only to solve a problem that batch 18's
platform-priority fix already solved a different way. Re-derived this before touching
anything: the climb-state trigger (70% up) already snaps a player to full height the instant
it fires, via the platform-priority check added last batch — and that trigger fires while
still on the stair itself, well before the player is anywhere near the south wall. So by the
time anyone actually reaches that wall, they're already tall enough to clear it through the
same "wall only blocks below its own height" mechanism used everywhere else in this project —
no literal opening needed. Removed both gaps; the south wall is back to a single solid
`wallSide` call with no `gapLen`, matching every other unbroken wall in the project.

Verified before deploying: full climb-trigger-cross simulation for both stairs (now approaching
from each one's own outer edge, matching real play), confirmed the south wall has zero gaps by
scanning its entire width at ground level, and re-checked the front door (unaffected by this
batch — a stray test point of mine gave a false "blocked" reading there that turned out to be
pre-existing padding from batch 17's door collision, not a regression; re-verified against the
already-known-open x-position to be sure). Spawn/pickup collision check re-run clean on both
themes.

Syntax-checked (local + remote), pm2 restarted clean. Only gameData.js changed this round —
client.js and server/index.js are unchanged from the last deploy. Wall count dropped 144->142
(the two now-removed south-wall gap splits) — verified identical on both machines.

## Batch 20 (2026-09-10): DONE — mansion stair-to-roof gap, both parts (visual + collidable)

Two related fixes to the mansion's back-wall exterior stairs, reported over two rounds of
screenshot feedback ("connect these two thats it" x2, then "there is no visible path its like
im in air" once the first fix only closed the CENTER gap, then "add visible floor and also the
granade shouldnt go through it" clarifying the ask was real collision, not just a visual patch).

**Round 1 (deployed earlier, undocumented until now):** the mansion's visible roof slab only
ever covered the building's own footprint (up to the south wall) — but the walkable platform
underneath deliberately extends south past that wall to reach both exterior stairs' tops, so
there was a real gap between "where the roof visibly ends" and "where the stairs begin," read
as a floating disconnected box. Fixed with a second roof slab flush against the first, but
scoped ONLY to the center strip between the two stairs (x:[-4,4]) — deliberately NOT extending
over either stair's own climb path, because at the time the climb-state trigger (which snaps a
climbing player to full standing height once they're far enough up a ramp) fired at 70% of the
climb, and the math showed a real ceiling positioned over either stair would clip a climbing
player's head starting at ~66.6% of the climb — i.e. BEFORE the old trigger fired, a genuine
stuck-in-place bug window (not stutter — you can't climb far enough in X to escape a ceiling
that's already blocking you before you're tall enough to clear it).

**Round 2 (this batch):** center-only wasn't enough — walking on the rooftop directly over
either stair still felt like walking on air (no floor there, and grenades thrown up through
that space sailed straight through into the room below, unblocked). Fixed properly this time,
addressing the actual root constraint instead of routing around it:
- `client.js` `surfaceHeightAt`: climb-state trigger moved from `st >= 0.7` to `st >= 0.6`.
  Verified via exact math (danger zone starts at `(roofBottomY - PLAYER_HEIGHT) / toY` =
  66.56% of the climb given this mansion's wall height) that 0.6 snaps a climbing player to
  full height comfortably before the raw, ungraduated climb height would ever enter the
  ceiling's clip range — the platform-priority height-snap (added batch 18) is atomic within
  a single `surfaceHeightAt` call, so once the trigger fires, the returned height jumps
  straight to the platform's full y in the same frame, never exposing an intermediate height
  inside the danger band.
- `gameData.js`: the roof's second slab now spans the FULL width (matching the main roof's
  `w`), directly over both stairs' entire climb paths, real collidable geometry (not a
  decor-only visual patch) — so grenades/bullets are now actually blocked by it, per the
  explicit ask.

**Verified before deploying, not just reasoned about:**
- Wrote a standalone climb-simulation script (`sim_climb_generic.mjs`, reusing the exact
  `surfaceHeightAt`/`collidesAt` logic from client.js) that walks a virtual player across each
  ramp at real per-frame movement speed (`5.5/60` units/frame) and detects a stuck loop (>120
  consecutive frames blocked at the same position without ever displacing).
- Confirmed BOTH mansion stairs climb cleanly to full height (`y=6.31`) with **zero** blocked
  frames under the new 0.6 trigger + full-width roof.
- Re-ran the identical test with the OLD 0.7 trigger (same full-width roof) to confirm the
  test methodology actually catches the bug it's meant to catch — it does: both stairs stall
  permanently at ~66% height (`y≈4.2`), proving the fix is both necessary and sufficient, not
  just theoretically safe.
- Re-ran the same stall-detection test across all 5 regular ruined-house ramps (axis:'z',
  unaffected by this mansion-specific ceiling) under both 0.6 and 0.7 — byte-identical
  behavior in both cases (an unrelated pre-existing door-frame collision artifact from the
  test's straight-line approach vector shows up identically either way, confirming it's not a
  regression from the trigger change; houses have no ceiling over their stairs to begin with).
- Confirmed the extended roof AABB (`x:0, z:111.5, w:26, d:5` → z-range `[109,114]`) fully
  covers both stairs' ramps (`z-range [109,112]`) with margin, and is flush against the
  platform's own south edge (`z=114`) — no seam.
- Ran the standard spawn-point (14) and pickup-point (19) collision sweep against the full
  updated wall list for both themes — zero blocked.
- Syntax-checked all three files locally and on remote, city-theme layout still builds
  (143 walls/7 ramps/7 platforms, unaffected — mansion is ruins-only).

Deployed `gameData.js` + `client.js` together, pm2 restarted clean, curl-verified both changed
lines live on the remote. Not browser-tested per standing instruction.

## Batch 21 (2026-09-10): DONE — fixed the visible floating-slab bug batch 20 introduced

User feedback (screenshot): the batch 20 full-width roof extension was rendering a flat gray
slab hovering directly above the stairs' own sloped/stepped mesh — a visible double-floor
artifact, not the intended "connect the roof to the stairs" look. Root cause: `roof` is a
regularly-rendered wall entry (no `renderAs` tag), so extending it to be visible AND full-width
put a flat ceiling plane right on top of the already-visible angled stair steps.

Fix: split the single full-width slab back into three pieces —
- The center strip between the stairs (x:[-4,4]) stays a real VISIBLE slab (this part was
  always correct — nothing else occupies that space, so a visible fill was right there).
- Each stair's own footprint gets a separate INVISIBLE (`renderAs:'invisible'`) collision box
  instead, same z-span/margin as before (`d:5`, past both stairs' outer edges) — grenades and
  bullets are still blocked over the stairs (per the earlier explicit ask), but nothing new is
  drawn over the stair mesh, so the stairs read as just the stairs again.

Reused the codebase's existing convention for this exact situation (already used for the
rooftop `platform` and the ajar door's rotated-footprint approximation) rather than inventing
a new pattern.

Re-ran the full batch-20 verification suite against the split geometry before deploying: both
mansion stairs still climb cleanly to full height with zero stuck frames (`sim_climb_generic.mjs`),
spawn (14) and pickup (19) sweep clean on both themes, city theme still builds (145 walls now,
+2 vs the pre-mansion-stairs baseline — confirms the invisible stair-ceiling pieces apply
identically to both themes, as expected since the mansion itself is shared, just recolored).
Syntax-checked locally and on remote, pm2 restarted clean, grep-verified the new
`stairCeilings` code is live on the remote.

## Batch 22 (2026-09-11): DONE — simple username/password auth gate before the menu

User asked for a small auth flow so reloading goes straight to the join/create tab (instead of
no gate at all), with a simple username+password, stored in a local JSON file that's gitignored.

**Server (`server/index.js`):** `express.json()` added; two new REST endpoints, `POST
/api/register` and `POST /api/login`. Accounts live in `server/users.json` (loaded into memory
on boot, rewritten on every register) — NOT bcrypt/a new dependency, uses Node's built-in
`crypto.scryptSync` for salted password hashing (random 16-byte salt per user, 64-byte hash,
both stored as hex) plus `crypto.timingSafeEqual` for the compare, so passwords are never
stored or compared in plaintext despite using zero extra npm packages. Username: 3-20
alphanumeric/underscore. Password: 4-128 chars — deliberately minimal validation, this is a
LAN party game's login, not a banking app.

**Client (`index.html` + `client.js`):** new `#authScreen` (same panel/screen styling as the
existing menu) shown before `#menuScreen` — username + password fields, Log In / Create Account
buttons, inline error text. On successful login/register, `{username}` is saved to
`localStorage['ruins_auth']` and the join/create menu shows immediately; a "Signed in as X /
Log Out" bar was added to the top of the menu panel. On every page load (including the
"Quit to Menu" flow, which was already a full `location.reload()`), if `ruins_auth` is present
the auth screen is skipped entirely and the join/create tab shows right away — this is the
actual behavior the user asked for ("when we reload we go directly to the join/create tab").
Logging out clears that key and drops back to the auth screen.

**Explicitly NOT built:** server-side sessions/tokens — the browser's remembered username is
trusted for repeat visits without re-checking the password every reload (same trust level the
game already gave the freeform "your name" field before this). The real check happens once, at
login/register time, against the actual stored hash — this isn't a security theater flow, it's
just intentionally not adding session-token machinery for a feature this size. Flagged here in
case a future "remember me should expire" or "add real sessions" ask comes in.

**Verified before deploying:** registered a real test account and round-tripped all the
expected cases directly against the live endpoints — duplicate username (409), correct login
(200), wrong password (401), nonexistent username (401), invalid username shape (400), too-short
password (400). Confirmed the stored record is actually salted+hashed, not plaintext. Confirmed
`server/users.json` is excluded from git (`git status --short` shows nothing, `git check-ignore
-v` confirms the `.gitignore` rule matches). Test account removed and the server restarted
(in-memory `users` map is populated at boot, so just rewriting the file on disk isn't enough to
clear a test account already loaded — needed a restart to actually drop it) before real players
use it. Syntax-checked all three files locally and on remote, pm2 restarted clean.

## Batch 23 (2026-09-11): DONE — mansion interior partition walls

User feedback (screenshot from inside the mansion): the ground floor was one big empty hall,
read as hollow/unfinished (this was intentional back at batch 15 — shell-only, "waiting on the
user's follow-up interior spec" — this is that follow-up). User sketched a rough ASCII layout
of offset/staggered partition walls, not a tidy room grid.

Added 4 real wall segments (`gameData.js`, `makeMansion`'s new `interior` array, merged into
the same `walls` list as everything else — full collision, blocks players/bullets/grenades,
same as every other wall in the game, not decoration): a west N-S spine joined into an L with
an east-running wall, then a second N-S spine further east, deliberately NOT aligned with the
first L's open end (a real ~2.55-unit gap between them, matching the staggered/offset look in
the user's sketch rather than a continuous connected wall), plus a short stub off that second
spine's south end for one more nook.

**Verified before deploying, not eyeballed:**
- Computed every clearance by hand against the mansion's exact numbers (`hw=13, hd=11,
  wallT=0.9, doorGapW=6, crackW=7.8`): none of the 4 new walls reach into the north door gap
  (x:[-3,3]) or either crack gap (z:[94.1,101.9] at the east/west walls) — closest approach to
  the door is 1.45 units clear, cracks aren't approached at all (interior walls top out at
  x=8.5, cracks are at x=±12.55).
  - Confirmed via an AABB overlap check (not just distance-by-eye) that none of the 4 walls
  overlap any of the 4 corner towers — this was the one real near-miss during design (an
  earlier draft's south-east stub extended into the SE tower's footprint; shortened it from
  x:[7,10] to x:[7,8.5] to clear it, 1.1 units to spare).
- Every spine's far end is left open (no dead-end pocket with zero exit) — smallest gap
  anywhere is 1.1 units (stub's open end to the SE tower), everything else ≥2.5 units.
- Ran the standard spawn/pickup collision sweep (33 points, both themes) — zero blocked.
  City theme still builds (149 walls now, mansion is shared across both themes per batch
  15/20, just recolored).

Syntax-checked locally and on remote, pm2 restarted clean, grep-verified the new interior
walls are live on the remote.

## Batch 24 (2026-09-11): DONE — low diagonal cover wall with a gun hole, mansion interior

User sent a reference photo (a blocky/staggered brick wall) plus a screenshot marking where in
the mansion they wanted it, asking for: diagonal placement, short enough to fully hide a
crouched player, and a gap in it to fire through ("gun hole").

This engine has no rotated-hitbox support (same constraint as the ajar mansion door, batch 17)
— a real 45°-rotated collision box isn't possible. Rather than approximate one rotated box
(which would either over- or under-cover the actual diagonal shape), built a new reusable
helper, `makeDiagonalCoverWall()` in `gameData.js`: a chain of small square blocks stepped
along a line from point A to B, spaced closer than the block size so consecutive blocks
overlap (no seam a bullet or player could slip through) — reads as a blocky diagonal barrier,
which if anything matches the reference photo's own chunky brick-unit look better than a smooth
rotated slab would have.

**Height, derived from the actual crouch hitbox, not guessed:** server-side, a crouched
player's hit-cylinder tops out at `CROUCH_HEAD_OFFSET (1.0) + 0.2 = 1.2` above their feet
(`handleAttack`, server/index.js). Solid blocks in the chain are `1.3` tall — clears that with
a real 0.1 margin, so crouching anywhere behind a solid segment fully hides you; standing
(hit-cylinder top 1.7) stays exposed above it, a deliberate height tradeoff, not an oversight.

**The gun hole is ONE block in the chain** (the user asked for "a gap," singular — not a slit
running the wall's whole length), built as a low block (`0-0.75`) plus a separate cap
(`1.10-1.30`) instead of one solid piece, leaving a real `0.75-1.10` opening roughly at crouch
eye height (`CROUCH_EYE_HEIGHT = 1.15`) that a bullet/grenade ray actually passes through (it's
a true AABB gap, not a texture trick) — you can see and fire out through it while crouched, and
in turn can be hit through it too, the standard tradeoff for a firing slit.

**Placement:** just south of the mansion's front door (`x1:-2,z1:92` to `x2:4,z2:89.5`),
covering someone as they come through the entrance. Verified by exact-number clearance checks
(not eyeballed) against every nearby structure before deploying: closest approach to the west
interior spine is 1.85 units, to the east spine 1.85 units, to the north wall 1.35 units — all
comfortably above the ~0.8-unit hard-block threshold from `PLAYER_RADIUS` padding, so nothing
here traps a player or seals the doorway.

Ran the standard spawn/pickup sweep (33 points, both themes) — zero blocked. City theme still
builds (158 walls, mansion shared across both themes as before). Syntax-checked locally and on
remote, pm2 restarted clean, grep-verified the deployed code matches.

**Not done:** no real brick photo-texture was added — the new wall reuses the mansion's
existing wall material/color like every other wall in the game. The reference photo was read
as "this shape/scale of cover wall," not a request for a new textured asset; flagging in case
that reading was wrong.

## Batch 25 (2026-09-11): DONE — corner hideout redo (moved off the door), and a real grass-floating bug fixed

**Corner hideout, take two.** User rejected batch 24's placement (it was next to the door, not
a corner) and sent an ASCII sketch of a wall corner with a diagonal cut. Removed the door-side
piece entirely and rebuilt it as an actual corner: two full-height "back" walls (`cornerBackA`,
`cornerBackB` in `makeMansion`, gameData.js) forming a real L, with the diagonal
cover-with-gun-hole (`makeDiagonalCoverWall`, unchanged from batch 24) hugging only the corner
end, not stretched across the whole opening.

Two earlier layouts for this both looked right from the math (positive-looking gaps at block
centers) but FAILED when checked with a full grid scan (`collidesAt` sampled every 0.5 units
across the whole area, not just a few spot points) — stretching the diagonal chain toward the
second back wall left a gap that measured positive center-to-center but was still fully sealed
once each block's own `PLAYER_RADIUS` padding (pushing its effective footprint to ~2.2 units
wide against a 1-unit block spacing) was accounted for. This is the same class of mistake as
the mansion's first ajar-door angle (batch 16/17) — a gap that's positive on paper but still a
hard block in practice. Fixed by not trying to thread a gap at all: the diagonal only covers
the corner's near third, and everything past it is genuinely untouched floor, verified this
time by rendering the actual `collidesAt` grid as ASCII and confirming the pocket and its
entrance are one contiguous open region, not eyeballing individual sample points.

Re-ran the full checklist before deploying: spawn/pickup sweep (33 points, both themes) clean,
city theme still builds, syntax-checked locally + remote, pm2 restarted clean, grep-verified.

**Grass floating in the air — separate bug, unrelated to any recent change.** User reported
Ruins-extension grass patches visibly floating above the ground with a gap underneath. Root
cause found by actually inspecting `grass.png`'s alpha channel (Python/PIL, not guessing): the
background-removal crop on this image wasn't tight — the visible blades only occupy rows
34-270 of a 335px-tall image, leaving a real ~19% fully-transparent margin below them (and
~10% above). `alphaTest` correctly discards that margin so it never draws, but
`buildGrassPatches` (client.js) was positioning each grass plane's GEOMETRIC bottom edge at
ground level — which put the actual VISIBLE blades (which start 19% of the plane's height above
that) floating with a real, measured gap (~0.17-0.3 units depending on the clump's random scale
factor) between them and the ground. Fixed by deriving the correct vertical offset directly
from the measured pixel margin (`GRASS_BOTTOM_MARGIN_Y = (64/335) * planeHeight`) instead of
the old hardcoded `0.46` magic number, so the visible blade bottoms now sit at y=0 regardless of
each clump's random scale. Confirmed the fix value (0.2935) by independent calculation before
touching the code. No image re-processing needed — this was a positioning bug, not a texture
content bug, so alphaTest handles the (now correctly hidden below ground) transparent margin
same as before.

Syntax-checked, deployed, grep-verified live, pm2 restarted clean.

## Batch 26 (2026-09-14): DONE — meme posters on walls, first one placed in the mansion corner hideout

User wants meme images placed on specific walls as decorations, starting with `modi modi.png`
(a photo, background-removal'd to trim its top/bottom black video letterbox bars first, in a
separate step before this one) on the corner hideout's back wall (`cornerBackA`, batch 25) so
whoever is hiding there sees it.

Since the screenshot alone (no minimap/coordinates) couldn't pin down which of ~7 similar-
looking mansion cover structures it was, asked the user directly (which structure, which
theme) rather than guessing — confirmed: the mansion, City theme, corner hideout back walls.

**New reusable capability, not a one-off hack:** `ACTIVE_DECOR` entries (client.js) already
supported a plain-color box (crenellations, ajar door panel) or `rotY` for rotation. Extended
the same loop so a decor entry with an `img` field renders as a flat photo-textured
`PlaneGeometry` instead of a box — a real 3D crate doesn't make sense for a flat picture, and a
plane avoids needing a material-per-face array just to keep the photo off the edges/back
(reuses the existing `loadPhotoTexture` cache, same as drums/grass/ammo). Any future meme/
poster just needs one new decor entry with `img`, `w`/`h` (sized to the image's own aspect
ratio), position, and `rotY` to pick which way it faces — no new plumbing needed.

**This poster specifically:** `meme_modi.png` (renamed from `modi modi.png` — the space in the
original filename would need URL-encoding, not worth the risk) uploaded to
`public/images/`. Placed flush against `cornerBackA`'s west face (`x = 3 - wallT/2 = 2.55`,
offset out by 0.02 to avoid z-fighting with the wall's own surface), `rotY = -90°` so the
plane's front face points west into the pocket — toward whoever is standing there hiding.
Material is double-sided regardless, so a sign error in that rotation math wouldn't have hidden
it, but got it right anyway. Sized 2.07×2.0 to match the image's own ~1.03:1 aspect ratio
(no stretching).

Verified before deploying: `getMapLayout` for both themes actually contains the new decor
entry with the expected numbers, syntax-checked both files, confirmed the image is reachable
(`curl` 200) after deploy, grep-verified the code is live. Not browser-tested per standing
instruction — worth a look in-game to confirm the framing/size reads well from inside the
pocket, first real use of this new poster system.

## Batch 27 (2026-09-14): DONE — red banners + climbing ivy on the mansion's front facade

User felt the entrance was too plain/flat (screenshot of the front, big blank wall either side
of the door) and explicitly asked for real reference rather than a "child paint app" result —
searched the web for castle banner and ivy-on-stone-wall photos first (see below) to get
proportions/detail right before writing any code, rather than guessing at what a banner or ivy
looks like.

**No usable royalty-free source image existed for either** (stock sites are paywalled, and
there's no clean transparent-background banner/ivy PNG to just drop in), so both are hand-drawn
canvas textures — same established technique as `buildWallTexture`/`buildMudTexture`, just
informed by what the reference search actually showed instead of guessing:

- `buildBannerTexture()` (client.js): alternating vertical red fold-shading bands (real cloth
  isn't flat-lit), a gold trim border, a gold rod-pocket bar at the top, a small gold emblem,
  and — the detail that actually makes it read as "banner" instead of "red rectangle" — the
  cloth is cut to taper to a single point at the bottom (`globalCompositeOperation:
  'destination-out'`) instead of a hard rectangular edge, matching real heraldic banner shape
  from the reference photos.
- `buildIvyTexture()`: a meandering vine stem climbing from the base with leaf clusters
  branching off it, deliberately denser near the bottom and thinning toward the top (real ivy
  on a wall is thick low growth tapering into sparse new shoots higting, not a uniform carpet)
  — alpha-tested transparent background, same crossed-plane-style technique as the existing
  grass texture.

**New decor type system, not a one-off:** extended the same `ACTIVE_DECOR` loop from batch 26
(which already handled plain boxes and `img` photo posters) with two more branches,
`type:'banner'` and `type:'ivy'` — each builds its shared texture/material ONCE (cached in a
local var, not per-instance) since all banners share one texture and all ivy patches share
another, then every decor entry of that type just supplies position/size/rotation. Any future
banner or ivy patch anywhere in the game is now a one-line data addition, no new rendering code.

**Placement (`makeMansion`, gameData.js):** two banners flanking the front door (`x:±4.2`,
outside the door gap `x:[-3,3]` with 0.48 units to spare), four ivy patches spread further out
on the same wall face (`x:±6.5,±10`), all on the wall's outer/north face
(`outerFaceZ = z - hd - wallT/2 - 0.02`, just in front of the wall to avoid z-fighting), facing
north (`rotY:180°`) so an approaching player sees them head-on. Purely decorative — same
`decor` list as the crenellations/door panels, no collision, doesn't touch `walls`.

Verified before deploying: computed every x-range against the door gap and both corner towers
(closest approach 0.48 units, nothing overlaps), ran the standard spawn/pickup sweep (33
points, both themes) — zero blocked, decor count sane (58 entries each theme, mansion is
shared). Syntax-checked locally and on remote, pm2 restarted clean, grep-verified the deployed
code matches. Not browser-tested per standing instruction — worth a look in-game, this is
hand-tuned canvas art and reading right on-screen (banner point/fold visibility, ivy
density/color) is exactly the kind of thing that benefits from an actual look.

Sources consulted for reference (proportions/shape/color, not downloaded assets):
- https://www.darkknightarmoury.com/product/medieval-castle-banner/
- https://www.shutterstock.com/search/castle-flag
- https://www.gettyimages.com/photos/stone-wall-with-ivy
- https://www.dreamstime.com/photos-images/stone-wall-texture-vines.html

## Batch 28 (2026-09-14): DONE — melody.png poster on the center house's front wall

User marked a red rectangle on a screenshot showing exactly where, on the center of the 5
ruined houses, they wanted `melody.png` placed — above the doorway on the front (north) wall.

Identified the center house from `RUIN_HOUSES` (gameData.js): `{x:0, z:58, hasRoof:true}` —
the one house with a full roof, matching "center house" unambiguously (the other 4 are
identical shells, this is the only visually distinct one, and it's literally in array position
[2] of 5, i.e. the middle). Confirmed via `makeRuinHouse`'s own logic that the marked spot is a
real solid wall face, not a gap: the GROUND floor's north wall has the door gap, but the UPPER
floor's `wallRoom` call only carves gaps on `stairSide`/`crackSide` — north is never gapped on
the upper floor — so the area directly above the door is solid flat wall the full width,
exactly where the red rectangle sits in the screenshot.

**Made this a reusable per-house field, not a one-off.** Added an optional `poster: {img, w, h}`
field to `makeRuinHouse()` (and to the center house's entry in `RUIN_HOUSES`) — if present, a
decor entry is added flush against the upper wall's outer north face
(`z = z - hd - wallT/2 - 0.02`), vertically centered on that wall
(`y = floorY + upperWallH/2`), facing north (`rotY:180°`) toward an approaching player, reusing
the `img`-poster decor type from batch 26. Any of the other 4 houses can get their own poster
later with one line in `RUIN_HOUSES`, no new code.

Sized to the image's real aspect ratio (204×192, ~1.06:1) — `w:2.44, h:2.3` — checked this sits
comfortably inside the upper wall's own bounds (`y:[3.15,5.45]` vs the wall's `[3,5.6]`) and
well inside the house's own width (`x:[-1.22,1.22]` vs the house's 5-unit half-width), so
nothing spills off the wall or over an edge.

Verified before deploying: spawn/pickup sweep (33 points, both themes) clean, decor count sane
(59 now, +1 from batch 27's 58), syntax-checked locally and on remote, pm2 restarted clean,
confirmed the uploaded image is reachable (curl 200). Not browser-tested per standing
instruction — worth a look to confirm the framing matches the marked screenshot.

## Batch 29 (2026-09-14): DONE — fixed the meme posters looking too light/faded

User reported both deployed posters (`meme_modi.png` on the mansion corner hideout, batch 26;
`melody.png` on the center house, batch 28) looked washed out/faded.

Root cause: the `img`-poster branch of the decor render loop (client.js) used
`MeshStandardMaterial` — the same lit-PBR material every other object in the scene uses — but
the scene's directional sun light is strong (intensity up to 2.0), which pushes a
fully-lit-white-base material well past the source image's actual brightness. Both memes
deployed so far also happen to have large light/white background areas, which bright PBR
lighting blows out further, reading as "faded."

Fixed by switching posters to `MeshBasicMaterial` — unlit, ignores scene lighting entirely,
renders the texture's real pixel colors regardless of sun angle/intensity. This is the correct
fix for what a wall poster actually is (a flat printed image, not a glossy lit 3D surface), not
a guessed color-tint layered on top of the real problem. Every other textured object
(walls/drums/ammo/grenade/banners/ivy) is untouched — this only affects the `img`-poster
branch, matching the scope of the complaint (2 specific objects, not "everything looks
wrong").

Syntax-checked, deployed, grep-verified the change is live, pm2 restarted clean. Not
browser-tested per standing instruction — worth a look to confirm both posters read at full
intended brightness now.

## Batch 30 (2026-09-14): DONE — meme posters on the remaining 4 houses

Filled out the last 4 of the 5 ruined houses using the per-house `poster` field added in
batch 28 — no new code needed, just data:
- `x:-32` → `monalisa.png`
- `x:-16` → `bsdk.png`
- `x:16` → `baigan.png`
- `x:32` → `bulla.png`

Each sized to its own image's real aspect ratio (checked via PIL, not guessed) so nothing
stretches: monalisa 2.44×2.3 (1.06:1), bsdk 3.03×2.0 (1.51:1), baigan 2.89×2.2 (1.31:1), bulla
3.28×1.8 (1.82:1) — same `w:h` convention as melody.png. All 5 houses now have a poster
centered on their upper wall, directly above the door (the only fully solid, gap-free wall
face on any of them).

Verified before deploying: computed every poster's x/y bounds against its own house's 5-unit
half-width and the upper wall's `y:[3,5.6]` range — all comfortably inside on every house, no
spillover past an edge or wall boundary. Ran the standard spawn/pickup sweep (33 points, both
themes) — zero blocked. Decor count sane (63, +4 from batch 29's 59). Syntax-checked locally
and on remote, pm2 restarted clean, confirmed all 4 uploaded images reachable (curl 200 each).
These automatically render with the unlit `MeshBasicMaterial` fix from batch 29, so no
faded/washed-out repeat of that issue. Not browser-tested per standing instruction.

## Batch 31 (2026-09-14): DONE — jaldi_hato.png poster in the mansion's stairs corridor

User's screenshot (looking through the gap between the two back stairs, up at the roof
extension) marked the flat south-wall surface there for a big centered poster
(`jaldi waha se hato.png`, renamed `jaldi_hato.png` on deploy — spaces in filenames aren't
worth the URL-encoding risk).

This is the SAME "center strip" area from batch 20/21 (`x:[-4,4]`, the gap between the west and
east stairs, under the visible roof extension) — but the mirror image of every poster placed so
far: those were all on north-facing walls (mansion front door, houses), so they needed
`rotY:180°` to face the approaching player. This is the mansion's SOUTH wall, whose exterior
face is on the `+z` side instead of `-z` — no rotation needed at all, `PlaneGeometry`'s default
+Z-facing normal already points toward someone standing in the stairs corridor looking north at
the wall. Worth noting since it would have been an easy copy-paste mistake to reuse
`rotY:Math.PI` out of habit and end up with the image facing backward into the wall.

Sized large relative to the ~8-unit-wide opening per "full size": `w:3.375, h:4.5` (image's own
0.75:1 aspect ratio, checked via PIL), centered at `x:0, y:3` — dead center of both the gap's
width and the wall's own height.

Verified before deploying: x-range `[-1.69,1.69]` sits well inside the `[-4,4]` gap, y-range
`[0.75,5.25]` sits well inside the wall's `[0,6]` height, standard spawn/pickup sweep (33
points, both themes) clean, decor count sane (64, +1 from batch 30's 63). Syntax-checked
locally and on remote, pm2 restarted clean, confirmed the uploaded image reachable (curl 200).
Renders with the unlit `MeshBasicMaterial` fix from batch 29 automatically, same as every other
poster. Not browser-tested per standing instruction.

## Batch 32 (2026-09-14): DONE — stance indicator above the health bar

Added a `#stanceLabel` line ("STANDING" / "CROUCHED" / "PRONE") between the "HEALTH" label and
the health bar itself, per the explicit "just above the health bar" placement.

Wired to the single existing `setStance(crouch, prone)` function (client.js) rather than
duplicating logic at each call site — grepped for every place `isCrouched`/`isProne` get
assigned and confirmed all three (C key toggle, Z key toggle, the stance reset on joining a
room) already funnel through `setStance`, so one line there keeps the label correct everywhere
with no separate update calls needed anywhere else.

Syntax-checked, deployed, grep-verified both the HTML and JS changes are live, pm2 restarted
clean. Not browser-tested per standing instruction — worth a quick look to confirm the label
placement/styling reads well against the health bar.

## Batch 33 (2026-09-14): DONE — last 6 meme posters, spread across the original core arena

User's last 6 unused images (`aap kon`, `abe saale`, `depression`, `e lo angur khao`, `hum pe
to h hi 9`, `jaldi bol`) go on `OBSTACLES_BASE` — the original arena that existed before the
southward doubling/extension (houses/mansion), not the new area.

New `ARENA_POSTERS` constant (gameData.js), merged into `getMapLayout`'s `decor` — spread
across 6 different structures rather than clustered: 4 different perimeter-wall segments (one
per cardinal side, each mounted on that wall's inward/arena-facing face) plus the 2 diagonally-
opposite corner tower stumps (NW and SE, each on the face pointing toward the central plaza).
Reuses the same `img`-poster decor convention as every prior poster — sized to each image's own
aspect ratio (checked via PIL), offset 0.02 off its wall's face to avoid z-fighting, `rotY`
picked per the wall's own facing direction (0/π/±π/2 for the 4 cardinal orientations, same
convention as the mansion's banners/ivy).

`depression.png` was already trimmed of its bottom black bar earlier in this conversation
(before any wall placement work started) — used as-is here, no further edits needed.

Verified before deploying: computed every poster's x/y bounds against its own wall's height
range — all sit with visible margin on both sides, nothing spills past a wall's own extent.
Standard spawn/pickup sweep (33 points, both themes) clean, decor count consistent (70 each
theme, +6 from batch 32's 64). Syntax-checked locally and on remote, pm2 restarted clean,
confirmed all 6 uploaded images reachable (curl 200 each). Renders with the unlit
`MeshBasicMaterial` fix from batch 29 automatically. Not browser-tested per standing
instruction.

**This finishes the meme-poster project** — all 12 of the user's images are now placed
somewhere in the game: 5 on the ruined houses (batch 28/30), 2 in the mansion (batch 26/31),
and these last 6 across the original core arena.
