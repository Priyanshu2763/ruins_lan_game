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
