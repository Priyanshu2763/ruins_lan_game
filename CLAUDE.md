# Ruins FPP — batch 3 plan (in progress, save survives token cutoff)

Remote project: `tanveer@192.180.4.117:/home/tanveer/iDonotKnow`. Workflow as always: edit
scratchpad copies, `node --check`, scp, `pm2 restart ruins-fpp`, curl-verify, no browser test.

Investigated BEFORE writing this plan (so it's grounded, not guessed):
- Server hit-cylinder height (`handleAttack` in server/index.js) ALREADY scales with
  `other.crouch`/`other.prone` (line ~266) — hitbox height is correct server-side.
- `weapon` (currentWeapon index) IS already broadcast in the `state` message per player —
  available to use for a remote weapon-in-hand mesh, no protocol change needed.
- Pause "Controls" button: click handler is correctly wired (`pauseControlsBtn` →
  `controlsModal.hidden = false`) — the actual bug is DOM stacking. `#controlsModal` is
  defined BEFORE `#pauseMenu` in index.html; both are `position:fixed;inset:0` with no
  z-index, so later-in-DOM wins and `#pauseMenu` (still visible, not hidden) paints over
  the now-unhidden controls modal, hiding it and eating its clicks.
- `shotgun.png` (the actual gun photo, not ammo) is present at
  `/home/chicmic/a/games/shotgun.png` — `gameData.js` already points `image: 'shotgun.png'`
  for the Shotgun weapon, so once the file exists server-side + bg-removed, no code change
  needed, just process + deploy.
- No headshot/hit-location damage logic exists anywhere in `handleAttack`/`applyDamage` —
  confirmed via grep, not a "already there, ignore" case.

## 1. Ammo pickups: real 3D object from the photo, not a decal on a bare box
Current `ammoBoxMesh()` = a plain colored `BoxGeometry` with the product photo slapped on as a
flat `PlaneGeometry` label on the top face only — reads as a sticker, not a rendered object.
Fix: build a slab-shaped `BoxGeometry` sized to the image's own aspect ratio (thin depth, e.g.
~0.05-0.07), and put the photo texture on the two LARGE faces (front+back, materials[4]/[5] on
a box) via a material array, so the whole object IS the photographed box, viewed correctly
from any angle around it — not an unrelated colored crate with a photo glued on top. Side
faces get a plain color (sampled/approximated from the caliber, kept from `CALIBER_BODY_COLOR`)
so it still reads as a solid 3D object, not a flat card. Slight idle bob/rotation (already
exists via `animatePickups`) will now actually show the object's real geometry as it turns.

## 2. Fix: Controls button unresponsive from the pause menu
Root cause found above (DOM order/stacking). Fix: when `pauseControlsBtn` is clicked, also set
`pauseMenu.hidden = true` (don't just open controlsModal on top of it); track a flag
`controlsOpenedFromPause` so `closeControlsBtn`'s handler restores `pauseMenu.hidden = false`
afterward ONLY if that flag is set (the main-menu Controls button shouldn't re-show the pause
screen). Reset the flag each time it's consumed.

## 3. Shotgun gun photo
Same pipeline as the other 5 images: `remove_bg.py` on `/home/chicmic/a/games/shotgun.png` →
scp to `public/images/shotgun.png` on remote. No code change (gameData.js already wired).

## 4. Per-weapon reload time + circular countdown ring on the weapon card
- Add `reloadTime` (ms) to each ranged weapon in `gameData.js`, standard shooter-game values:
  AKM 2400, Shotgun 3000 (slower, pump-action tube reload), Glock 1600. Melee: none/N/A.
- Client `reload()`: instead of instantly refilling the mag, start a reload state
  (`reloading = true`, `reloadEndsAt = now + weapon.reloadTime`), block firing while active,
  set mag from reserve only when the timer completes (or is cancelled by a weapon switch —
  switching cancels the in-progress reload, no ammo change).
- UI: a circular progress ring overlaid on the active weapon's card icon (`conic-gradient`
  div is simplest — no SVG/canvas needed — update a `--pct` CSS custom property each frame
  while reloading) plus a remaining-seconds number in the middle, and a slow blink
  (CSS `animation: pulse`) on the ring while active, matching the reference screenshot (green
  ring + countdown digit) but themed to this game's gold/olive palette.

## 5. Remote player: real prone pose + visible held weapon
Two separate real issues, not one:
- **Visual prone is unconvincing.** `animateRemoteFigure()` currently just scales
  `mesh.scale.y` down to 0.32 for prone — squashes the figure into a short flattened block
  that still reads as "standing", not lying down (hitbox is already correctly small
  server-side, this is purely what the shooter SEES). Fix: when prone, rotate the whole
  figure group ~90° flat (lying forward) and drop it near ground level, instead of vertical
  squashing — a genuinely horizontal silhouette instead of a squished standing one. Crouch
  keeps the existing scale-down approach (that one reads fine — still upright, just shorter).
- **No weapon visible in remote hands.** Remote figures are bare-armed regardless of loadout.
  `weapon` (currentWeapon index) is already in every `state` broadcast — store `rp.weapon` on
  each remote player object (currently dropped on the floor, not read at all) and attach a
  small low-poly gun shape (a couple of boxes, not the detailed viewmodel — token/perf budget)
  to the right-arm pivot, swapping visibility per weapon id so an AKM/Shotgun/Glock/knife
  silhouette is distinguishable at a glance.

## 6. Headshot damage multiplier
`handleAttack` already knows the ray's hit distance via `rayCylinderDist`; compute the impact
point's Y (`origin.y + dir.y * dist`) and compare it against the top ~18% of that target's
current hit-cylinder (`yMin`..`yMax`, which is already stance-aware) to classify a headshot.
Add `HEADSHOT_MULTIPLIER = 2.5` to gameData.js, apply only for ranged (not melee/grenade) hits:
`dmg = isHead ? weapon.damage * HEADSHOT_MULTIPLIER : weapon.damage`. Body/arms/legs stay
identical damage per the user's explicit "don't complicate" instruction — only a head/not-head
split, no per-limb tuning.

## Execution order (cheapest/most isolated first, to bank progress early if tokens run out)
1. [ ] Shotgun photo (#3) — mechanical, already-solved pipeline.
2. [ ] Pause Controls bug (#2) — one small JS fix.
3. [ ] Headshot multiplier (#6) — self-contained server math, no UI.
4. [ ] Ammo 3D object redesign (#1) — client-only, one function.
5. [ ] Remote prone pose + held weapon (#5) — client-only, touches figure-building code.
6. [ ] Reload timers + ring UI (#4) — most surface area (gameData + client logic + CSS).

Deploy once at the end as one batch (scp all changed files together, one pm2 restart, one
round of curl checks) rather than per-item, to save round-trips/tokens.

## Status: DONE — deployed to remote 2026-09-09, all 6 items live, pm2 restarted clean,
curl checks green. Full completion notes mirrored onto the remote CLAUDE.md
(/home/tanveer/iDonotKnow/CLAUDE.md) since that's the canonical cross-session memory for
this project — this file is a local pointer/mirror of the same plan.

## Batch 4 (2026-09-10): DONE — pause/Controls freeze (z-index stacking bug), duplicate
scoreboard rows on refresh (rejoin-by-name stat reclaim), grenade wall-tunneling (substepped
physics), oversized grenade ball (real small photo-textured cylinder), minimap added, fall-off-
the-edge death added. Full details mirrored onto remote CLAUDE.md (canonical copy).

## Batch 5 (2026-09-10): DONE — removed redundant minimap ray, fall-death now a real fall
sequence off the exact floor edge (not instant on touch), match timer (HH:MM at room
creation, countdown HUD, auto end-of-match scoreboard + quit). Full details on remote CLAUDE.md.

## Batch 6 (2026-09-10): DONE — map doubled (|_| -> |_|_| extension to the south), per-map
building layout finally implemented (shared geometry, mud-yellow Ruins vs concrete-gray City,
plus Ruins-only grass / City-only bunkers), real two-story buildings with working stairs (new
3D-aware collision + surface-height system), minimap updated for the new asymmetric bounds.
Full technical writeup on remote CLAUDE.md (canonical copy) — this was the largest single
feature of the project so far, flagged there as needing extra-thorough testing.

## Batch 7 (2026-09-10): DONE — replaced the plain-box "2-story buildings" with real ruined
houses matching the user's reference photos (punched-through wall gaps you can actually jump
through, broken-parapet rubble, mud-brick texture for Ruins), added 5 of them clustered into
alleys, plus shared drum/tire/bunker/denser-photo-textured-grass props across both themes.
Full technical writeup on remote CLAUDE.md (canonical copy).

## Batch 8 (2026-09-10): DONE — fixed the actual bugs behind "not a house, floating debris":
ramp had no visual mesh at all (added real staircase steps), entrance removed a whole wall face
instead of a door gap (now all 4 walls present with proper door+crack gaps), removed risky
floating rubble, enlarged barrels/tires and fixed their grounding, denser overlapping grass.
Full writeup on remote CLAUDE.md.

## Batch 9 (2026-09-10): DONE — found and fixed the actual stuck-jumping-off-roof bug (stairs
topped out 4 units away from the doorway they were supposed to lead into), rebuilt houses as
real stacked rooms matching the user's description exactly (state-tracked floor instead of
position-based, since two stacked floors at the same x/z can't be told apart by position alone),
verified the fix with node walk-through simulations before deploying. Full writeup on remote.

## Batch 10 (2026-09-10): DONE — found the REAL can't-enter-1st-floor bug (state trigger
window was 0.075 units wide, thinner than one movement frame, so it essentially never fired),
widened it and verified with a realistic per-frame simulation this time. Added a roofed house
(middle one) as a real collidable ceiling. Full writeup on remote CLAUDE.md.

## Batch 11 (2026-09-10): DONE — found the REAL invisible wall: ground floor's stairSide wall
never had a gap at all (only north/door and crackSide did), so it was fully solid for the whole
climb height range. Added the missing gap, verified with a full-path collision scan (hundreds
of sample points, not spot checks) this time. Full writeup on remote CLAUDE.md.

## Batch 12 (2026-09-10): DONE — stairs now only mount from the front (added a low outer-side
rail, kept the building-facing side untouched since that's the doorway boundary), and jump now
actually affects collision (was purely cosmetic before) so hopping the rail partway up works —
verified this doesn't let jump clear the taller core-arena cover blocks. Full writeup on remote.

## Batch 13 (2026-09-10): DONE — replaced the pinch-prone low rail with a real full-height
wall, added a back wall closing the north approach (had to shift it off-center to avoid
plugging the doorway gap it sits near), reverted an over-eager removal of the ground-floor
stairs gap after a simulation proved it was still needed. Full writeup on remote CLAUDE.md.

## Batch 14 (2026-09-10): DONE — tightened the stairs' back wall gap to close to the real
minimum (bounded by PLAYER_RADIUS padding, can't fully zero it without blocking legitimate
climbing), added an explicit inner wall covering just the stair's own extent, not the doorway.
Full writeup on remote CLAUDE.md.

## Batch 15 (2026-09-10): DONE — added the mansion (haveli/castle centerpiece), exterior +
shell only per explicit instruction: 26x22, corner towers, crenellated parapet, double-door
front entrance (one dummy locked door, one ajar) plus two side wall-breaks, solid back wall,
interior left as one open hall — no rooms yet, waiting on the user's follow-up interior spec.
Full writeup on remote CLAUDE.md.

## Batch 16 (2026-09-10): DONE — found and fixed a real grenade collision bug (a grenade whose
center ended up embedded inside a wall was silently skipped instead of pushed out — now uses
minimum-penetration-axis ejection, verified with a unit test). Door complaint didn't reproduce
in a full data-layer sweep of both the mansion and a regular house's doorway — deployment
verified in sync with local, so most likely a stale browser cache on the user's end.

## Batch 17 (2026-09-10): DONE — mansion doors are real collision now (shut door as a direct
wall, ajar door as an invisible axis-aligned approximation since this engine has no rotated
hitboxes — had to widen its angle after measuring too-narrow a passage on the first attempt).
Stairs now act as a real floor for grenades (rampHeightAt on the server, mirrors client height
logic) instead of grenades falling straight through the visual-only steps. Full writeup on
remote CLAUDE.md.

## Batch 18 (2026-09-10): DONE — added the mansion's two back stairs (axis:'x' ramps, a new
capability the ramp system needed), found and fixed two real bugs before deploying: a climbing
player's head clipping the roof's underside while still at partial height, and a floating-point
precision mismatch (6.3 vs 6.300000000000001) causing a false block right at the roof's own
surface. Full writeup on remote CLAUDE.md.

## Batch 19 (2026-09-10): DONE — fixed the mansion's back stairs to climb toward each other
("/|\") instead of the same direction (a swapped climbLow/climbHigh bug on the east stair),
and made the back wall fully solid again — the gaps from batch 18 turned out unnecessary once
the platform-priority height fix already resolves the crossing problem they were added for.
Full writeup on remote CLAUDE.md.

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

## Batch 34 (2026-09-15): DONE — distinct per-weapon gunshot/reload sounds, and a Meme Mode toggle

Two unrelated asks in one batch.

**1. Weapon sounds.** Everything in this game's audio is synthesized with WebAudio, no asset
files (explicit design decision from early in the project) — there's no audio pipeline to drop
downloaded "stock" sound files into, so this was done by making the SYNTHESIS itself sound like
the real thing per weapon, rather than sourcing recordings. Flagging this reading clearly in
case real recorded audio files were actually wanted instead — that would need a new
asset-loading path (`<audio>`/decoded buffers), which doesn't exist yet.

Two real bugs found before fixing anything:
- AKM and Glock's firing sound was the exact same `noiseBurst`+`tone` call — `sfx.shoot(w)`
  only branched on `w.type === 'melee'` and `w.pump`, so every non-melee non-pump weapon (both
  rifle and pistol) fell through to one shared "generic gun" sound. Fixed by dispatching on
  `w.id` instead, with each weapon's sound shaped to its real character: AKM sharp crack + real
  mid-bass punch, Glock short/bright pop with almost no low end, Shotgun (already had its own
  branch) widened into a genuinely deep, dark boom.
- The shotgun's pump-action "cha-chk" (`sfx.pump()`) was two plain oscillator tones
  (`tone(950)` → `tone(600)`) — a clean two-note beep, which is exactly what reads as
  "cartoonish": real pump-action racking is pure percussive metal-on-metal contact with no
  clean pitch to it at all. Extended the shared `noiseBurst()` helper with an optional
  `filterType` param (defaults to the existing lowpass "thud" behavior, so every other call site
  is untouched) and used `'highpass'` for pump/reload mechanicals — keeps only the bright,
  metallic end of filtered noise, reading as a real clack instead of a synth note.
- Reload was also one generic sound for all three guns before this — now per-weapon: AKM
  (mag drop → mag in → bolt-release chunk), Shotgun (4 evenly-spaced shell-loading clacks across
  the reload, matching its tube-fed pump-action reload style), Glock (same idea as the rifle,
  tighter/quicker timing matching its shorter `reloadTime`).

**2. Meme Mode toggle.** A toggle on the Create Room panel (`index.html`) — green "ON" /
red "OFF" button, defaults ON — controls whether the 13 meme posters (5 houses, 2 mansion, 6
arena, see batches 26-31/33) render at all for that room.

Threaded through as a real per-room setting, not a client-only cosmetic flag (so everyone in
the room sees the same thing): `createRoom` message now carries `memeMode`; the room stores it
and echoes it back in the `joined` message; `getMapLayout(mapKey, memeMode = true)` filters the
final decor list down to `d => !d.img` when memes are off. `img` turned out to be the exact,
already-unique marker for "this is a meme photo poster" — every other decor entry
(crenellations, door panels, banners, ivy) uses `color` or `type` instead, so this filter needs
no new tagging and can't accidentally catch a non-meme decoration. Server-side collision/physics
is completely untouched — `getMapLayout`'s `walls`/`platforms`/`ramps` never depended on decor,
confirmed by checking every server call site uses only those three fields.

Verified before deploying: `getMapLayout('city', false)` returns exactly 0 poster entries (13
fewer than `true`/default), walls/ramps/platforms identical either way, spawn/pickup sweep
clean under memeMode:false too. Then a REAL end-to-end test, not just unit-level: a small `ws`
client script connecting to the live server, sending `createRoom` with `memeMode:false`,
confirming the `joined` reply actually carries `memeMode:false` back — and a second run with the
field omitted entirely, confirming it defaults to `true`. Syntax-checked all three touched files
(`gameData.js`, `client.js`, `server/index.js`) locally and on remote, pm2 restarted clean
(twice — once after deploying, once more after the two test rooms to clear them from the
in-memory room list). Not browser-tested per standing instruction — the gunshot/reload sound
character specifically is the kind of thing that benefits from an actual listen.

## Batch 35 (2026-09-15): DONE — real recorded gunshot/reload/grenade audio, replacing synthesis for those

User provided 9 real trimmed mp3 clips (`gun-sounds/` locally): akm-fire, akm-reload,
glock-fire, glock-reload, shotgun-fire, shotgunpump, shotgun-reload, grenade-clock,
grenade-explosion. This is a real architecture change — every sound in this game had been
100% WebAudio synthesis until now (explicit original design decision) — so a new audio-loading
path was added rather than reusing anything: `SOUND_FILES` (client.js) maps short keys to
`/sounds/*.mp3` URLs, each fetched + `decodeAudioData`'d into a cached `AudioBuffer` once at
page load; `playBuffer(key, {gain, loop})` spins up a fresh `BufferSource`+`GainNode` per play
(so the same clip can overlap itself — two grenades ticking at once, rapid glock taps — with no
extra bookkeeping) and returns the source so a looping one can be stopped early. Files uploaded
to `public/sounds/` on the remote (served automatically, same `express.static` mount as
`public/images/`).

**AKM needed different handling than Glock/Shotgun, and this was explicit in the ask:** Glock
and Shotgun fire semi-auto — one recording, one trigger pull, replayed fresh on every `fire()`
call, same as any other one-shot sfx. The AKM's clip (`akm-fire.mp3`, 2.14s) is a full
automatic-fire SPRAY, not a single shot — playing it fresh on every 110ms `fire()` tick would
stack a dozen overlapping copies within one burst. Instead it's started ONCE as a `loop:true`
BufferSource on mousedown (only when `w.id === 0`) and stopped on mouseup — `sfx.shoot()` does
nothing at all for the AKM now, the loop IS its firing sound. Added a single `stopAkmLoop()`
helper called from every path that should end it (mouseup, mag-empty, and — a real gap this
closed — switching weapons mid-hold via `setWeapon()`, which used to leave both the fire
interval AND now the spray loop running under whatever you switched to).

**Reload timing now comes from the actual clips, not a guessed value:** measured each reload
recording's exact length with `mutagen` (Python) — AKM 3480ms, Shotgun 3792ms, Glock 2351ms —
and set `reloadTime` in `gameData.js` to those exact numbers, replacing the old
guessed-at-typical-shooter-game values (2400/3000/1600). This is what makes the mechanical
reload lockout/UI ring duration actually line up with the sound instead of ending early or
leaving dead air.

**Grenade timing, the trickiest sync of the three:** the OLD ticking system played a short
synthesized beep every 0.3s for as long as any grenade was live — replaced entirely with a
ONE-SHOT play of the full `grenade-clock.mp3` (3.657s) the instant a grenade (yours or another
player's) first appears in `syncGrenades`, not a repeating cue. `GRENADE_FUSE_MS` (server-
authoritative — the actual detonation timer, `server/index.js`) was 1600ms; changed to 3657ms
to match the clip exactly, so the explosion (server-broadcast `grenadeExploded`, which already
fires the visual flash and `sfx.explosion()` together, already correctly simultaneous) lands
right as the ticking finishes rather than mid-tick or with a long silent gap after. Explosion
gain set to 2x per "it's too low."

**Verified before deploying:** every clip's exact duration measured via `mutagen`, not
eyeballed or guessed from listening. `node --check` on both touched files (`gameData.js`,
`client.js`). Confirmed `GRENADE_FUSE_MS` and all 3 `reloadTime`s read back correctly from a
fresh import. Confirmed map layout (walls/decor counts) unaffected — this batch only touches
weapon data + audio, no geometry. All 9 uploaded sound files reachable (curl 200 each) and the
deployed code's key pieces (`SOUND_FILES`, `playBuffer`, `akmLoopSource`/`stopAkmLoop`, the
updated `reloadTime`s and `GRENADE_FUSE_MS`) grep-confirmed live on the remote. pm2 restarted
clean. Not browser-tested per standing instruction — actual audio playback, timing feel, and
whether 2x explosion gain clips/distorts are exactly the kind of thing that needs a real
listen, flagging clearly rather than claiming confidence there.

## Batch 36 (2026-09-15): DONE — fixed AKM spray-loop leaking on an empty mag

User feedback: clicking an already-empty AKM repeatedly leaked a brief instance of the spray
loop sound instead of just the empty buzz.

Real bug, not a mishear: `fire()` already correctly handled an empty mag (plays `sfx.empty()`,
returns without firing) but the `mousedown` handler unconditionally started BOTH `fireIntervalId`
and the AKM's looping spray clip (`akmLoopSource`) regardless of what `fire()` had just done.
Clicking an empty AKM: `fire()` plays the empty buzz and returns, then the handler still kicked
off the loop anyway — it played for about one interval tick (~110ms, `fireInterval`) before the
NEXT `fire()` call (from the interval it also shouldn't have started) caught the still-empty mag
and stopped both. That ~110ms is exactly the "leaks... for an instance" the user described.

Fixed by checking ammo and gating both the interval and the loop on it. Important detail: the
check has to happen BEFORE `fire()` runs, not after — firing the LAST bullet legitimately drops
the mag to 0 inside `fire()` itself, and since the AKM's `sfx.shoot()` intentionally does
nothing (the loop IS its firing sound, see batch 35), checking ammo AFTER `fire()` would have
skipped starting the loop for that final shot and made it fire completely silently — a new bug
the naive fix would have introduced. Checked before, an empty mag correctly never starts either
the interval or the loop, and a mag with exactly one bullet left still gets its shot's sound
(loop starts, plays until the next tick discovers the mag is now empty and stops it via the
existing `stopAkmLoop()` call already inside `fire()`'s empty branch).

Verified with a standalone simulation replicating the exact state machine (not just read
through the code): empty-mag click → only the empty buzz, no loop start; last-bullet click →
shot fires, loop starts, next tick correctly empties and stops it; rapid spam-clicking on an
empty mag → empty buzz every time, zero leaks across 4 consecutive clicks. Syntax-checked,
deployed, grep-verified the fix is live, pm2 restarted clean.

## Batch 37 (2026-09-15): DONE — real 3D positional audio for remote gunfire + explosions, with wall occlusion

User asked (after a scoping discussion) for BGMI-style spatial audio: enemy gunfire/explosions
audible with real distance falloff and directional (left/right/front/back) panning, plus wall
muffling, done in an "optimized way."

**Confirmed gap before building anything:** grenade explosions were already broadcast
room-wide with a position, but gunfire from OTHER players wasn't audible AT ALL — the server
only ever broadcast a `hit` message when a shot actually connected, never "a shot was fired."
This needed a real new server event, not just client-side audio work.

**Server (`server/index.js`):** `handleAttack` now broadcasts `{type:'shotFired', playerId,
weapon, pos}` to every other player in the room (never echoed back to the shooter — they
already hear their own shot locally, no round-trip needed) right after the existing
per-weapon rate-limit check passes, so it's naturally throttled to real shots only. Ranged
weapons only (melee has no recorded sound to spatialize).

**Client (`client.js`) — new positional audio layer, additive, doesn't touch the LOCAL
player's own sounds (still flat/non-positional, correctly — your own gun is always right at
your ears):**
- `audioCtx.listener` (HRTF panning mode) is kept synced to the camera's live world position
  and facing direction every frame (`updateAudioListener()`, hooked into `animate()`).
- `isOccludedBetween(fromPos, toPos)`: a ray-segment-vs-AABB occlusion test against
  `ACTIVE_WALLS` — the SAME list that already blocks bullets, invisible collision-only pieces
  (mansion roof extensions etc.) included, so "behind a wall" here matches what actually blocks
  a shot rather than being a separate approximation. Verified against 6 known-geometry cases
  (opposite sides of a wall, same side, above the wall's height, outside its width, a segment
  that doesn't reach it, a diagonal path through it) before trusting it — all 6 came back
  correct.
- Occlusion doesn't just cut volume — it ALSO applies a heavy lowpass filter (always in the
  signal chain, params swapped rather than the graph rewired) since real walls absorb high
  frequencies far more than low ones; volume-only would read as "quieter", this reads as
  "muffled", which is the actual ask.
- `playPositionalOneShot`/`playPositionalLoopStart` wrap a `BufferSource` in a
  `PannerNode → BiquadFilterNode → GainNode` chain, `refDistance:10, maxDistance:120,
  rolloffFactor:1.2` tuned to the map's own scale.
- Glock/Shotgun remote shots are simple one-shot positional plays per `shotFired` message,
  matching their semi-auto nature. The AKM needed the same special handling as its LOCAL sound
  (batch 35/36): its clip is a continuous spray, not a single shot, and the server sends a
  fresh `shotFired` roughly every 110ms while a remote player holds the trigger — playing the
  full clip fresh each time would stack ~19 overlapping copies in a 2-second burst. Instead one
  looping source is started per shooter on their first shot, repositioned/re-occlusion-checked
  on each subsequent one, and a 220ms timeout (a bit longer than `fireInterval`) auto-stops it
  once shots stop arriving — this one mechanism transparently covers releasing the trigger,
  dying, or disconnecting, no separate cleanup needed for any of those.
- `spawnExplosion`/`sfx.explosion(pos)` now goes through the same positional path (2x gain
  preserved from batch 35) — explosions happen at a world position distinct from any player's
  current location (including the thrower, who may have moved off), so unlike gunfire this
  applies to ALL players uniformly, not just "everyone but the source."
- Deliberately left the grenade TICKING sound (`grenadeClock`) flat/global, not positional —
  the user's ask was specifically gunfire + explosions; making the tick distance-limited would
  be a gameplay-balance change (losing it as an always-audible warning), not just an audio
  quality one, so out of scope here without being asked.

**"Optimized way," specifically:** the occlusion test itself is O(wall count) (~150) per call,
negligible — the actual optimization is WHEN it runs: once per one-shot sound, and for the
AKM's loop, re-checked only on each incoming `shotFired` tick (~9/sec while held) rather than
every render frame (60/sec) or continuously.

**Verified before deploying, live against the running server, not just code review:** a
two-client `ws` test script — one creates a room and fires, a second joins the same room and
confirms it actually receives `shotFired` with the correct weapon/position; a second test
confirmed the shooter itself never gets an echo of its own shot. Both passed on the first try
against the real server. Occlusion math verified with 6 standalone geometry cases beforehand.
Syntax-checked all three files, pm2 restarted clean (twice — once after deploying, once more
after the test rooms to clear them). Not browser-tested per standing instruction — the actual
perceived panning/falloff/muffling character is exactly the kind of thing that needs a real
listen on headphones, which the user asked to do themselves.

## Batch 38 (2026-09-15): DONE — grenade ticking joins the positional audio system

Follow-up to batch 37. User asked directly why the ticking sound was left flat/global while
gunfire and explosions became positional. On reflection the original reasoning ("it's an
always-audible warning, changing that is a gameplay call") didn't actually hold up: a grenade
only threatens players within its own blast radius, so a full-volume tick heard from anywhere
on the map isn't a meaningful warning for players it can't reach — it's just noise. The players
who genuinely need to hear it are already well within `refDistance` (10 units), so making it
positional doesn't lose the warning where it matters, and fixes the actual inconsistency of
having one flat sound in an otherwise spatial audio system.

**Implementation, not just a flip of a flag:** a thrown grenade travels for its whole ~3.6s
fuse (arc + bounces, server-simulated), so a static position snapshot from the moment it's
thrown would be meaningfully wrong by the time it's sitting on the ground about to detonate —
this needed live position tracking, not a one-time position at start. Refactored the positional
audio helpers (`playPositionalOneShot`/`playPositionalLoopStart`) onto a shared
`startPositionalSource()` so both return the same trackable handle (`panner`, `filter`,
`gainNode`); `sfx.grenadeTick(pos)` now returns that handle, stored on the grenade's own
tracking object (`gm.tick` in `syncGrenades`) alongside its visual mesh. `animate()`'s existing
per-frame grenade-position lerp loop (already updating the visual mesh) now also pushes that
same live position into the tick's panner every frame — free-riding on a loop that already
runs, not new per-frame work — while the heavier occlusion raycast is throttled to ~180ms
(5-6 times/sec) rather than run on every frame, consistent with the "optimized way" instruction
from batch 37.

Renamed `updatePositionalLoop` → `updatePositionalTarget` since it's now shared by both the
AKM's remote spray loop (batch 37) and the grenade tick tracking — same "move the panner,
re-check occlusion" operation, same helper either way.

Verified before deploying: syntax-checked, grep-confirmed every piece (the renamed helper, the
`gm.tick` handle, the throttled occlusion check, the new `grenadeTick(pos)` signature) is live
on the remote, pm2 restarted clean. This completes the "gunfire, explosions, and now grenade
ticking all use real distance falloff + directional panning + wall occlusion" system requested
across batches 37-38 — ready for the user's own headphone test.

## Batch 39 (2026-09-15): DONE — wet/dry blend to soften the too-extreme HRTF panning

User feedback after testing: hard-left/right sounds were near-silent in the off ear — too
strict a separation, wanted a normalized floor (e.g. 100% near ear, ~30-40% off ear).

**Root cause (explained to the user before touching code):** every positional sound routed
through a single `PannerNode` with `panningModel:'HRTF'` and nothing else. HRTF is a real
binaural simulation (head-shadow + ear-shape filtering, not just amplitude panning) — for a
source directly to one side, near-total separation is what real ears actually do, so this
wasn't a bug, it's HRTF being faithful. But that's also why real shooters (including BGMI)
don't ship raw HRTF — they blend it with an always-centered copy for comfort.

**Fix — a proper wet/dry spatial blend, not a panner-parameter tweak** (`client.js`):
- `SPATIAL_WET = 0.68` / `SPATIAL_DRY = 0.34` — every positional sound now splits into two
  paths from the SAME `BufferSource` (fanned out via two `.connect()` calls, no duplicate
  source needed): a full-HRTF "wet" path at the real position, and a "dry" path panned via
  `equalpower` (chosen specifically because its centered case is a guaranteed, predictable
  50/50 split — HRTF's own frontal response isn't necessarily symmetric depending on the
  browser's HRTF dataset).
- The dry path's PannerNode is positioned along the LISTENER's own forward vector at the SAME
  distance as the real source (`dryPositionFor()`) — this reuses the browser's own correct
  'inverse' distance-falloff math for free (distance attenuation depends only on distance, not
  angle) instead of hand-rolling that formula a second time, while its angle reads as "dead
  ahead" so it lands centered.
- Both paths sum into one shared lowpass filter + gain node before the destination (WebAudio
  sums multiple connections into one node automatically) — occlusion is applied ONCE, post-mix,
  since a wall muffles the whole arriving sound, not just one of its two paths.
- The two panners need to move TOGETHER whenever a sound's source moves — `updatePositionalTarget`
  (used by the AKM's remote loop) and the grenade-tick per-frame tracking loop in `animate()`
  both now reposition wetPanner + recompute/reposition dryPanner in the same call.

**Verified before deploying, math not vibes:** computed the theoretical off-ear floor by hand
(equalpower center gives each ear `cos(π/4)≈0.707` of the dry contribution; conservative
worst-case HRTF assumes zero far-ear bleed) — `0.68·0 + 0.34·0.707` vs `0.68·1 + 0.34·0.707`
comes out to a ~26% floor even in that worst case; real HRTF's actual low-frequency head-
diffraction bleed is never quite zero, so the real, testable result should land at or above
that, in the 30-40% range the user asked for. Can't run real HRTF convolution outside a
browser to verify the exact number, so this is presented as reasoned/bounded, not guaranteed —
`SPATIAL_WET`/`SPATIAL_DRY` are named, isolated constants specifically so it's a one-line nudge
if the user's own test says it needs adjusting either direction.

Syntax-checked, deployed, grep-verified every renamed/new piece (`wetPanner`, `dryPanner`,
`dryPositionFor`, the two constants) is live on the remote, pm2 restarted clean. Not
browser-tested per standing instruction.

## Batch 40 (2026-09-15): DONE — redesigned the match-end (time-runs-out) screen

User asked for a big red "GAME OVER" that shrinks onto the screen, blood stains on the panel,
"sexy" animation, and audio from an existing `game-over.mp3` found in the repo (2.112s,
measured via mutagen).

Scope: only the timer-expiry match-end screen (`#matchEndScreen`), not per-death messaging —
matches "when the time runs out" specifically.

**No blood-stain image asset exists** (checked first) — built entirely from CSS: 4
`.bloodStain` blobs (radial-gradient fill, organic per-corner `border-radius` instead of a
perfect circle) plus 2 `.bloodDrip` elements (a gradient fading to transparent, animated height
growth for a "dripping down" look), positioned at the panel's corners with deliberately
negative offsets so they bleed PAST the panel's border rather than sitting inside it — that's
what reads as "stains on the board" instead of a decoration printed on it. Requires
`overflow: visible` on `#matchEndScreen .panel` specifically (the shared `.panel` class doesn't
have it) so the splats aren't clipped.

**"GAME OVER" entrance**: `#gameOverTitle` replaces the old plain "Match Over" `<h1>` — deep
red with a dark stroke + layered text-shadow (glow + drop-shadow, not a flat color), animated
via `@keyframes gameOverDrop`: starts at `scale(4.2)` and transparent, shrinks past its resting
size to `scale(0.92)`, overshoots slightly to `1.06`, settles at `1` — a real "big letters
shrink onto screen" motion with a bounce on the landing, not a linear fade. Blood splats are
staggered in with their own `animation-delay` (0.55s-0.9s) so they visibly follow the title's
landing rather than all popping in at once — a small choreography detail, not required but
what makes an entrance read as designed instead of just "several things appearing."

**Why no re-trigger logic was needed:** `matchEndScreen` goes from `hidden` (display:none, so
its CSS animations don't run at all while hidden) to visible exactly once per match — "Quit to
Menu" is already a full `location.reload()` — so unhiding it plays the animation fresh with no
extra JS needed to reset/restart it.

**Audio**: `game-over.mp3` added to the existing `SOUND_FILES`/buffer-cache system (batch 35),
played via the plain flat `playBuffer('gameOver')` in `onMatchEnded()` — not positional, this
is a UI/meta event with no world position, same treatment as pickup/hit-marker sounds. Also
added `stopAkmLoop()` to `onMatchEnded()` (it was already called on mouseup/empty-mag/weapon-
switch, but not here) — a stray AKM spray loop still playing under the dramatic game-over sound
would have undercut the moment the user specifically asked to land well.

Verified before deploying: HTML sanity-checked (exactly one `#gameOverTitle`, 4 `.bloodStain` +
2 `.bloodDrip` elements, balanced div tags — 43 opens/43 closes). Syntax-checked `client.js`,
uploaded `game-over.mp3` and confirmed it's reachable (curl 200), grep-verified every new piece
(the keyframes, the blood classes, `gameOver:` in `SOUND_FILES`, the `playBuffer`/`stopAkmLoop`
calls) is live on the remote, pm2 restarted clean. Not browser-tested per standing instruction
— the animation timing/feel and exact blood-splat placement are exactly the kind of thing that
benefits from an actual look, flagging clearly rather than claiming confidence there.

## Batch 41 (2026-09-15): DONE — seconds field on the create-room match-length input

User asked for a way to enter seconds, not just minutes, for match length.

Real fix, not just a label change — the old `<input type="time">` had no `step` attribute, so
browsers default it to minute granularity (`.value` reports "HH:MM", no seconds field shows in
the native picker at all). Added `step="1"` (`index.html`) — this alone makes the browser show
a seconds sub-field, AND switches the input's own `.value` format to "HH:MM:SS" once it does.

That format change meant the parsing/protocol had to follow, not just the input tag:
- `client.js`: `parseDurationMin()` → `parseDurationSec()`, regex extended with an optional
  `(?::(\d{2}))?` seconds group (kept optional so a blank/legacy "HH:MM" value — or a browser
  that reports one when seconds are exactly :00 — still parses correctly), returns total
  SECONDS instead of minutes.
- `createRoom` message field renamed `durationMin` → `durationSec` end-to-end (client send,
  server receive) — no backward-compat shim needed, both sides deploy together.
- `server/index.js`: was clamping/multiplying in whole minutes (`durationMin * 60000`); now
  clamps 0-10800 seconds (same 180-minute ceiling, just expressed in the new unit) and uses
  `durationSec * 1000` directly, so a 37-second match is genuinely 37 seconds, not rounded down
  to 0 minutes (which is what the old code would have done to any sub-minute value — before
  this, sub-minute precision wasn't just missing from the UI, it was impossible to actually
  configure at all).

Also updated the visible label from "Match length (HH:MM)" to "Match length (HH:MM:SS)" so the
picker's own new field isn't unexplained.

**Verified live, not just unit-tested:** a standalone `ws` client test created a real room with
`durationSec: 37` (deliberately not a round minute, to actually prove sub-minute precision
survives the full round trip) and confirmed the server's `joined` response reported
`matchEndsAt` within 27ms of exactly 37000ms out — genuine second-level precision, not silently
rounded. Also unit-tested `parseDurationSec` against 7 cases (whole minutes, sub-minute
seconds, the legacy no-seconds format, zero/no-limit, empty string) before deploying. Syntax-
checked both files, pm2 restarted clean (twice — once after deploying, once more to clear the
test room). Not browser-tested per standing instruction — the native time-picker's actual
seconds-field appearance/usability is worth a look.

## Batch 42 (2026-09-15): DONE — real blood-splatter photos replacing the CSS "balloons", stains on every button, table overflow fixed

Three fixes from one round of feedback on batch 40's game-over screen.

**1. Table overflowing the panel.** `#scoreboard table, #matchEndScreen table` had a flat
`width:480px` — fine for `#scoreboard` (sits directly in an unpadded full-screen flex
container) but `#matchEndScreen`'s copy sits inside a 480px `.panel` that ALSO has 28px of
padding per side (424px actually available), so the table was always going to spill past the
panel's edge. Changed to `max-width: min(92vw, 100%)` — keeps the scoreboard's existing size
unchanged while letting the match-end copy actually shrink to fit its real container.

**2. Blood stains looked like "balloons".** They were hand-built CSS radial-gradient blobs —
smooth and round, nothing like organic splatter. User provided two real reference photos;
processing them was more involved than the usual bg-removal pass:
- Both were flattened onto a baked-in gray/white checkerboard (not real alpha — `PIL` reported
  mode `RGB`, no transparency at all despite looking transparent in preview).
- A first pass (saturation-based alpha, even with un-blending the checker color out of the
  edges) left a persistent light gray/white "halo" ring around every droplet when tested
  against a dark background — traced this to the source art itself having a glossy white
  highlight rim baked into each drop (a real feature of the artwork, not an extraction
  artifact), which reads fine against clip-art white backgrounds but looks like a foreign gray
  smudge against this game's dark UI.
- Fixed with a duotone remap: every masked pixel's ORIGINAL color is discarded and replaced by
  a red-family gradient (dark dried-blood red → mid red → light pink-red) driven purely by that
  pixel's own luminance — so the "shine" is preserved as a lighter red highlight instead of a
  gray one. Verified by compositing onto black, a red button color, a green button color, and
  the gold `.btn-primary` color before trusting it — clean on all four, no halo anywhere.
- The match-end panel's 4 corner decorations (`.bloodStain.s1-s4`) now use real cropped
  fragments of these two photos (different `background-position`/size/rotation per corner, not
  just 4 copies of the same shot) instead of gradient blobs; the separate synthetic `.bloodDrip`
  elements were removed — the real photos already have drip detail baked in, no need to fake it
  twice.

**3. Stains on ALL buttons, not just the game-over screen.** New `decorateButtonsWithBlood()`
(client.js), runs once at load over every `<button>` in the static HTML (there's no dynamic
button creation in this UI, so a one-time pass is complete — confirmed by checking). For each
button: picks one of the two source images at random, a random crop window into it
(`background-position`, since these are big single-sheet splatter photos, not individual
pre-cut decals — a random crop samples a different-looking fragment each play), random size
(20-34px), random corner, random rotation — genuinely different-looking per button, using both
images. `mix-blend-mode: multiply` so it reads as a stain darkening the button's own material
rather than a sticker sitting on top of it, `pointer-events:none` so it never blocks clicks.

Verified before deploying: HTML div-balance check (41/41), syntax-checked `client.js`,
confirmed both processed PNGs reachable (curl 200 each), grep-verified the new function and
CSS class are live on the remote, pm2 restarted clean. Not browser-tested per standing
instruction — the actual random placement/crop variety across the full button set is worth a
look.

## Batch 43 (2026-09-15): DONE — fixed blood stains rendering as hard-edged rectangles, real drips, denser coverage

User screenshot showed batch 42's blood stains rendering as visible rectangular tiles, not
organic splatter shapes — a real bug, not a style complaint.

**Root cause:** the previous approach used `background-image` + `background-size` (a zoom
percentage) + `background-position` (a crop offset) on plain `<div>`s, meant to sample a
different-looking fragment of each large splatter sheet per stain. Downloaded and re-verified
the actual deployed PNGs first (confirmed proper RGBA alpha, clean duotone recolor, no
checkerboard) — the FILES were correct, so the bug was in the CSS crop math, which without a
real browser available to debug interactively wasn't worth trying to patch blind a second time.

**Fix: dropped the crop technique entirely.** Every stain (`.bloodStain` on the match-end
panel, `.btnBloodDecal` on buttons) is now a plain `<img>` element showing the WHOLE already-
good splatter photo — scaled via `width` (height auto, aspect ratio preserved, no distortion),
rotated and horizontally flipped via CSS `transform` for variety. An `<img>` respects its own
PNG alpha directly with zero cropping math to get wrong — this removes the entire class of bug
that produced the rectangles, rather than re-tuning percentages hoping to get lucky.

**Also addressed in the same pass, per the user's follow-up feedback:**
- **Denser coverage**: match-end panel went from 4 corner stains to 8 (corners + all 4 edge
  midpoints) plus a large low-opacity (`--op:0.28`) splat centered BEHIND the "GAME OVER" title
  text itself (`z-index` under the title, over the panel) — addressing the earlier "add it
  between the letters" ask that hadn't been done yet when the rendering bug took priority.
  Buttons went from 1 decal to 2 per button, corners chosen without replacement so the pair
  doesn't overlap.
- **Real dripping motion, not just a static stain**: brought back animated `.bloodDrip`
  elements (4 now, up from the 2 removed in batch 42) — a thin gradient bar that grows
  downward via `@keyframes bloodDripFall`, layered over a couple of the splats so it reads as
  blood actively running off them.

Verified before deploying: HTML div-balance check (41/41) plus a count of the new self-closed
`<img>` tags (9, matching the 9 `.bloodStain` instances — title + 8). Syntax-checked
`client.js`. Grep-confirmed the new `<img>`-based markup, the `createElement('img')` swap in
`decorateButtonsWithBlood()`, and the 4th drip element are all live on the remote. pm2 restarted
clean. Not browser-tested per standing instruction — given the LAST deploy's bug only became
visible via an actual screenshot, this one specifically needs a real look before trusting it
further; flagging that explicitly rather than claiming confidence this round.

**Still pending**: the user also sent a bloody handprint reference photo to place between the
GAME OVER letters specifically (a different, more literal element than the low-opacity splat
added here) — same as the two splatter photos, it arrived as inline chat content with no file
on disk; asked the user to save it to `/home/chicmic/a/games/` before that part can be done.

## Batch 44 (2026-09-15): DONE — real bloody handprint between the GAME OVER letters, via blend mode

User's third reference image, a bloody handprint with drip trails on a white background
(`blood-dripping.png`, saved to `/home/chicmic/a/games/`) — wanted it placed behind the "GAME
OVER" title specifically, background removed, composited via a real blend mode ("overlay like
blend options in photo editor apps"), not flat opacity.

**Processing**: same duotone-recolor pipeline validated in batch 42 (saturation-based alpha
mask + luminance-driven red gradient recolor, dark→mid→light) — this source had a plain white
background (not a checkerboard like the first two), so extraction was more straightforward,
but the same recoloring step still matters: it's what keeps the result clean rather than
leaving a gray/white halo from the source photo's own shading. Verified via the same dark/red
composite test as the other two before trusting it — clean silhouette, visible finger/palm
texture and drip trails, no watermark bleed-through from the stock-photo watermark visible in
the original.

**Blend mode — used `screen`, not literal `overlay`, and said so up front rather than silently
substituting.** Worked out why before touching CSS: `overlay`'s blend formula darkens hard
against any base color under 50% lightness, and this panel's background
(`rgba(20,18,14,0.9)`) is deep in that range — genuine Photoshop-style `overlay` would have
rendered the handprint almost invisible here, defeating the point. `mix-blend-mode: screen`
is the blend mode that actually stays visible against a near-black backdrop while still being
a real compositing blend rather than flat opacity — same spirit as what was asked
("blend options" plural, not a demand for that exact one), just the member of that family that
actually works on this background.

**Placement**: `.gameOverHandprint`, `z-index:1` vs the title's `z-index:2` — the letters
render on top of it, which is what makes it read as gripping/between the glyphs rather than a
decoration floating nearby. Sized/positioned to stay within the title's own vertical band; the
drip tips reach slightly into the subtitle's space by design (a deliberate "dripping past the
title" touch) but don't reach the scoreboard table — and even where they do overlap the
subtitle, `screen` blend naturally minimizes the darkest drip-tip pixels' visual weight against
the dark backdrop, so legibility isn't meaningfully affected.

Verified before deploying: div-balance check (41/41 unchanged), single clean reference to the
new element/image (grep count 2 — the CSS rule + the one `<img>`), confirmed the uploaded PNG
is reachable (curl 200), pm2 restarted clean. Not browser-tested per standing instruction — the
actual visual weight/legibility trade-off around the subtitle overlap is worth a real look.

## Batch 45 (2026-09-15): DONE — decluttered the game-over screen down to the handprint + one corner stain

Confirmed by the user's own screenshot: batch 43's `<img>`-based fix worked (real organic
splatter shapes, no more rectangles) and the handprint from batch 44 was reading correctly
behind the title — but 8 corner/edge splats plus 4 drips plus the handprint together was too
busy. User asked to drop everything except the handprint and the top-left stain.

Removed: `.bloodStain.s2` through `.s8` (7 of the 8 corner/edge splats) and all 4 `.bloodDrip`
elements — the drips were positioned relative to specific now-removed splats (mostly s2/s3),
so keeping them orphaned without their source stain would have looked disconnected; dropped
all of them rather than leaving mismatched leftovers. Kept: `.gameOverHandprint` (the hero
element behind the title) and `.bloodStain.s1` (the one surviving corner accent, top-left).

Verified before deploying: div-balance check (37/37, down from 41 — exactly the 4 removed
`.bloodDrip` divs), grep-confirmed exactly one remaining `.bloodStain` element (`s1`) and no
stray references to the removed classes anywhere in `client.js` (it never touched these
elements directly, so nothing there needed changing). pm2 restarted clean. Not browser-tested
per standing instruction, though this round is a pure subtraction from an already-verified-
working state, so risk here is low.

## Batch 46 (2026-09-15): DONE — background music, louder explosion, grenade ear-ring, real knife sound, real footsteps

Five separate asks in one batch: `backround.mp3` (background music, 2x gain), explosion volume
bumped again (2x wasn't enough), `ring.mp3` (a "caught in the blast" ear-ring effect),
`knife-stab.mp3` replacing the melee sound, and `running.mp3`/`walking.mp3` as real footstep
loops tied to sprint state — with the latter two explicitly left untrimmed for this pass to
handle, "it's gonna be on loop anyways."

**Background music** (`client.js`): one looping `BufferSource` at gain 2, started in `onJoined`
(guarded so joining mid-match doesn't restart it if somehow called twice), stopped in
`onMatchEnded` via the same explicit-handle stop pattern as the AKM spray loop — so it doesn't
keep playing under the game-over sting.

**Explosion volume**: `gain: 2` → `gain: 3.5` (batch 35 boosted it once already; still came
back "still low" after that).

**Grenade ear-ring, the trickiest one — needed a server change, not just client audio.** The
`hit` broadcast (`server/index.js`) only ever carried `shooterId`/`targetId`/`health`, nothing
identifying WHAT caused it — added `weapon: weaponName` (both existing `applyDamage` call
sites, bullets/melee and grenade splash, already pass a real weapon name, `'Grenade'` for
blast damage specifically) so the target's own client can tell a grenade hit apart from a
regular one. Client's `case 'hit':` now checks `msg.weapon === 'Grenade'` (only for hits on the
local player) and calls `playRingEffect()` — plays `ring.mp3` in full (flat/non-positional,
same reasoning as your own gunfire: this represents damage to YOUR ears, not a world sound to
localize) then fades it to silence over the last 0.8s via a real `GainNode` ramp
(`linearRampToValueAtTime`), since "at last it fades away" needed an actual envelope, not
trusting the raw clip to already taper off.

**Knife**: `sfx.shoot()`'s melee branch swapped from a synthesized `tone()` beep to
`playBuffer('knifeStab')` — one line, same call pattern as every other real-recording swap in
this project.

**Footsteps — the one requiring real audio trimming, done properly with tools, not guessed.**
Neither file had silence to signal loop boundaries in an obvious way, so `ffmpeg` (installed
fresh for this — wasn't available before) got used two ways: `silencedetect` to find the actual
per-step gaps, and a decoded-PCM RMS envelope (via Python/numpy over raw WAV samples, no
listening needed) to see the loudness pattern over the whole file. That combination revealed:
- `running.mp3` (8.1s raw) has clean, evenly-spaced footsteps the entire way through except a
  ~0.3s lead-in and ~0.9s trailing silence — trimmed to just the real step content
  (`[0.30s, 7.20s]` → 6.95s).
- `walking.mp3` (20.5s raw) turns out to have TWO different characters: discrete individual
  footsteps for its first ~6-8s (matching running's style, just slower cadence), then the RMS
  envelope shows it becomes dense/continuous for the remaining ~12s — a different recording
  texture, not more of the same steps. Looping the back half would have sounded like a
  different walk mid-loop, so only the clean discrete-step front portion was kept
  (`[0.14s, 6.20s]` → 6.10s).
- Both trims got a tiny (20-30ms) fade in/out at the cut points specifically to avoid an
  audible click where the loop seam is (`afade`), and both were re-verified afterward with
  `silencedetect` at a coarser threshold (0.5s) to confirm no accidental internal gap survived
  the cut — neither did.
- `setFootstepMode('run'|'walk'|null)` (new, `client.js`) manages one swappable loop source —
  called from `updateMovement` based on `isMoving`/`sprinting` (both already computed there),
  from the `falling` branch (stops footsteps while airborne), and from the `animate()` call
  site's else-branch (stops them when `updateMovement` isn't even running — paused, dead, back
  at the menu — since that function wouldn't otherwise get a chance to notice the state
  changed). Verified the state machine itself with a standalone simulation (idle→walk→walk
  again→run→idle→airborne→walk→dead) before trusting it — no double-starts on a repeated mode,
  every transition stops the old loop before starting the new one, ends silent.

Verified before deploying: `node --check` on both touched files. The trimmed
running/walking re-checked with `silencedetect` (no gaps >0.5s survived). Footstep state
machine simulated standalone. All 5 new sound files confirmed reachable (curl 200 each) and
every new function/field (`startBackgroundMusic`, `playRingEffect`, `setFootstepMode`,
`weapon: weaponName` in the hit broadcast) grep-confirmed live on the remote. pm2 restarted
clean. Not browser-tested per standing instruction — audio timing/feel and loop seam
smoothness specifically need a real listen, which is what this summary is for.

## Batch 47 (2026-09-15): DONE — fixed ring sound playing before the explosion, not after

User caught it live: the grenade ear-ring was playing BEFORE the explosion sound instead of
after.

**Root cause (server-side ordering, not a client timing issue):** `explodeGrenade()` ran the
per-player damage loop — which calls `applyDamage()`, broadcasting a `hit` message per affected
player — and only broadcast `grenadeExploded` AFTER that whole loop finished. WebSocket
delivers messages in send order, so send order IS playback order on the receiving client: every
affected player's `hit` (which triggers `playRingEffect()` client-side, added last batch) was
arriving and starting playback BEFORE `grenadeExploded` (which triggers the explosion sound)
ever went out. Moved the `grenadeExploded` broadcast to the TOP of the function, before the
damage loop — explosion now always sends first.

**Verified live against the real server, not just by reading the diff:** a two-client `ws` test
— thrower creates a room, a victim joins and reports its own real spawn position back, the
thrower throws a grenade with that exact position as the origin (guaranteeing the victim is
inside the blast radius once it detonates on its normal fuse timer) — and the test asserts the
victim's client receives `grenadeExploded` before `hit`. First attempt used a made-up origin
near world-origin and timed out (both players' real spawn points are wherever
`randomSpawn()` picks, not `[0,0,0]`) — fixed by reading the victim's actual spawned position
from the room state instead of guessing, then it passed cleanly:
`['grenadeExploded', 'hit']`, explosion first.

Syntax-checked, deployed, pm2 restarted clean (twice — once to deploy, once more to clear the
test room from memory). Confirmed via the live test rather than trusting the code-read alone,
since this was exactly the kind of ordering bug that "looks right in the diff" but only proves
itself against the real message flow.

## Batch 48 (2026-09-15): DONE — enemy footsteps now spatial, own footsteps quieter

Scoped in a "talk" round first, then built after the user corrected their own framing: own
footsteps down to 70-80%, enemy footsteps distance-faded like gunfire (not a fixed reduced
gain — distance alone tells them apart from the player's own).

**Own footsteps**: `gain: 0.75` (was full/1) in `setFootstepMode` (local-only, flat, unchanged
otherwise).

**Enemy footsteps — new capability, reusing three already-built systems rather than inventing
one:**
- The `state` protocol already relayed `moving`/`crouch`/`prone` per player at 20Hz (already
  driving remote leg-swing animation) but never distinguished walk from run — added `sprint`
  end-to-end: client promotes its local `sprinting` const to a module-level `isSprinting`
  (mirroring how `isMoving` already worked), sends it in the outgoing `state` message; server
  stores `player.sprint` and relays it in both places it already relays `crouch`/`prone`/
  `moving` (the initial `joined` snapshot and the 20Hz broadcast tick) — pure forwarding, no
  new server logic.
- `setRemoteFootstepMode(playerId, mode, pos)` (new) — same "one swappable loop per key, no
  restart on a repeated same-mode call" shape as the AKM's remote spray loop (batch 37), but
  simpler: that one had to infer "still firing" from a timeout between discrete shot events;
  movement state arrives continuously, so the mode is just directly known from each `state`
  tick, no inference needed. Started at full gain (`1`, not reduced) — per the corrected ask,
  distance/occlusion alone should differentiate an enemy's footsteps, not an artificially
  quieter base.
- Per-frame position tracking in `animate()`'s existing remote-player loop, same split as the
  grenade tick (batch 38): reposition every frame (cheap), throttle the occlusion raycast to
  ~180ms — flagged as more load-bearing here than for the grenade tick, since several players
  could realistically be moving/running simultaneously (grenades are rarer).
- Cleanup: `removeRemote()` now also stops that player's footstep loop, so a mid-stride
  disconnect doesn't orphan a looping sound.

**Verified before deploying:** the mode-transition state machine simulated standalone across
multiple concurrent players (idle→walk×3 repeats→run→dead→walk→disconnect for one, independent
run-only for a second) — no double-starts on repeated same-mode calls, correct per-player
isolation, clean removal on disconnect. Then a REAL two-client `ws` test against the live
server (not just the simulation): one client sends a `state` update with `sprint:true`, a
second client (in the same room) is asserted to receive that exact field back in its own
`state` broadcast — passed on the first try. Syntax-checked both files, pm2 restarted clean
(twice — deploy, then again to clear the test room). Not browser-tested per standing
instruction — the actual audible balance between 75%-you and full-gain-distance-faded-them is
exactly the kind of thing that needs a real listen with a second person.

## Batch 49 (2026-09-15): DONE — nametag removed, real headshot hitbox bug found and fixed

Two of three asks from this round ("remove the nametag, headshots sometimes don't register,
and the crosshair — talk first on that one"). Crosshair deliberately NOT started, per the
user's own "talk first" instruction — needs a scoping conversation before any code changes.

**Nametag removed.** The floating name sprite above remote players' heads (`nameSpriteFor()`,
a canvas-drawn text texture on a `THREE.Sprite`) is gone entirely — justified by the spatial
audio system (batches 37-39, 48) already giving directional identification, making the visual
tag redundant. Confirmed via grep no other code referenced the removed function before deploying.

**Headshot bug — found the real root cause, not a guess.** The user's own hypothesis ("i think
the head box isnt correctly placed") was right. `handleAttack`'s hit-cylinder yMax
(`STAND_HEAD_OFFSET=1.5`/`CROUCH_HEAD_OFFSET=1.0`/`PRONE_HEAD_OFFSET=0.35`, each +0.2 margin)
and the client's actual rendered head geometry (`HEAD_Y=1.7` center, 0.32-unit box) were two
independently-tuned numbers that had drifted apart:
- **Standing:** visual head spans world-Y [1.54, 1.86], but the old yMax capped at 1.7 — the
  top ~0.16 units (literally the upper half of the visible head) was a TOTAL WHIFF, not even a
  body hit. Aiming at the top of someone's head would just miss outright.
- **Crouch:** same pattern — `animateRemoteFigure`'s crouch squash (`mesh.scale.y = 0.72`)
  scales the visual head down too (true top ≈1.339), but the old yMax was only 1.2.
- **Prone:** worse — the whole figure rotates -90° about X to lie flat, which turns the head's
  old Z-thickness into its new Y-extent, collapsing the visual head to a thin band right at
  ground level ([0, 0.32]) instead of "the top of the model". The old headshot zone (top 18% of
  the 0.55-tall prone cylinder = [0.451, 0.55]) never overlapped that band at all — prone
  headshots were essentially impossible, not just unlikely.

**Fix:** added three new shared constants to `gameData.js` — `HEAD_CENTER_Y` (1.7),
`HEAD_HALF` (0.16), `CROUCH_SCALE_Y` (0.72) — as the single source of truth for both the
client's rendered head box (`buildCharacterFigure`/`animateRemoteFigure`, client.js, which now
import and use these instead of independent local numbers) and the server's hit logic
(`headBandFor()`, new helper in server/index.js), so the two systems can't drift apart again
the way `STAND_HEAD_OFFSET`/`CROUCH_HEAD_OFFSET`/`HEADSHOT_ZONE_FRAC` did (all three removed).
Standing/crouch: the overall hit-cylinder top now equals the true visual head-top (fixes the
whiff). Prone: the overall hit-cylinder height is intentionally left at its old, more generous
`PRONE_HEAD_OFFSET`-based value (torso/legs still need real coverage) but headshot
classification now checks the correct absolute ground-level band instead of a "top X%
of the cylinder" heuristic that doesn't apply once a figure is lying flat (head and torso end
up at nearly the same Y once prone — verified this isn't a marginal case, torso's own
world-Y span after rotation is a subset of the head's).

**Side effect caught and fixed:** batch 24's diagonal cover wall (`makeDiagonalCoverWall`,
`coverH=1.3`) was tuned so a crouched player's OLD hit-cylinder top (1.2) sat fully behind it
with a 0.1 margin. Since crouch's true top is now 1.339, bumped `coverH` to 1.45 (keeps a real
~0.11 margin above the new crouch top, still well under standing's 1.86) so that cover spot
doesn't regress.

**Verified before deploying:**
- Standalone simulation (`sim_headshot.mjs`, reusing the exact `rayCylinderDist` from
  server-index.js) — 13 checks across all 3 stances (torso/head-bottom/head-top/above-head)
  plus an angled (non-level) ray sanity check, all passing, explicitly including the 3
  previously-broken "head-top" cases in each stance that used to whiff or misclassify.
- A REAL two-client `ws` test against the live running server (not just the diff): fired an
  AKM shot at the victim's exact visual head-top world-Y (1.85) — the precise case that used to
  be a complete whiff — and confirmed a `hit` message actually arrives with `dmg=40`
  (`round(16*2.5)`, a real headshot), plus a body shot (Y=1.25, dmg=16, no bonus) and a
  head-center shot (Y=1.70, dmg=40) as controls. All 3 passed on first run.

Syntax-checked all three files locally and on remote, pm2 restarted clean (twice — deploy, then
again to clear the test room from memory), grep-confirmed the new constants
(`HEAD_CENTER_Y`/`HEAD_HALF`/`CROUCH_SCALE_Y`) are live in the served `gameData.js`, confirmed
`nameSpriteFor` is completely absent from the live `client.js`.

**Not started — crosshair redesign.** User explicitly said "talk first" on this one (partial
cross + center dot excluding the reference image's outer ring, plus a sprint-triggered
expand/bloom animation). Waiting on that scoping conversation before writing any code.

## Batch 50 (2026-09-15): DONE — new broken-cross crosshair, sprint + fire bloom

Scoped in a "talk" round first per the user's own "talk first" instruction, then built after
confirming one open question (sprint-only bloom, or also a quick kick on firing) — user chose
both.

**Shape:** replaced the old single filled-circle `#crosshair` div with 5 children: a center
`.ch-dot` plus 4 `.ch-tick` marks (top/bottom/left/right), no connecting ring — matches the
user's reference image minus the circle, per their explicit "excluding the circle" ask.

**Bloom, both triggers, same mechanism:** each tick's position is `translate(-50%, calc(-50% ±
var(--spread) ± var(--extra)))` — `--spread` is the sprint-aware base gap (7px normal, 13px
sprinting, set every frame in `updateMovement` off the existing `sprinting` local), `--extra`
is a short-lived fire-bloom kick (`crosshairKick()`, called from `fire()`: jumps `--extra` to
6px instantly, then back to 0 after 70ms). Both variables feed into the same CSS `transform`,
which already has a 140ms ease-out transition — so a change to EITHER variable animates
smoothly with zero extra JS easing code; the fire-kick's fast-out/eased-back feel comes from
setting the peak instantly and letting the transition handle the return.

**Hit marker preserved:** `showHitMarker()` used to flash `crosshair.style.background` directly
(only worked because the old crosshair was one plain div). Adapted to set `--ch-color` (which
every tick/dot already read for their own background) instead, so the same red-flash-and-scale
feedback still works against the new multi-piece shape — `transform: scale(1.8)` on the 0×0
`#crosshair` wrapper scales its whole subtree around the exact center point, no translate
compensation needed (unlike the old version, which had to re-add `translate(-50%,-50%)` itself
since its own box wasn't zero-sized).

Verified before deploying: `node --check` on client.js, a markup sanity check confirming all 5
child elements exist exactly once in index.html, syntax-checked again on remote, pm2 restarted
clean, grep-confirmed `crosshairKick`/`--spread`/`--extra` are live in the served client.js and
the 5 crosshair child elements are live in the served index.html. Not browser-tested per
standing instruction — the actual visual feel of the bloom timing/spread distances is exactly
the kind of thing that needs a real look in-game; flagging the two tunable numbers (`--spread`:
7px/13px, kick: 6px/70ms) in case they need adjusting after a look.

## Batch 51 (2026-09-15): DONE — shotgun distance falloff, knife headshot one-shot kill

Scoped in a "talk only" round first (user weighed sniper-reskin vs a falloff fix, chose
falloff; then asked for exact per-weapon damage numbers before deciding the curve), then built
after explicit go-ahead with the two curve parameters the user picked.

**Shotgun distance falloff.** Root problem: `damage:60` was flat across the shotgun's whole
28-unit range, and with the 2.5x headshot multiplier (`round(60*2.5)=150`, well past
`MAX_HEALTH=100`) it was a guaranteed one-shot kill on ANY headshot at ANY distance inside its
range — playing like a sniper rather than a shotgun. Added `falloffStart:8, falloffEnd:28,
falloffMinDamage:16` to the Shotgun's entry only (`gameData.js`) — no other weapon defines
these fields, so the new logic is a pure no-op for AKM/Glock/Knife. `handleAttack`
(`server/index.js`) now computes a linear falloff between those two distances when they're
present: full 60 damage inside the 8-unit "kill zone" (unchanged, still a near-instant kill up
close), tapering straight down to 16 by 28 units. Headshot multiplier still applies on top of
the falloff-adjusted number, so a close headshot is still instantly lethal (150) but a far one
is now weak (`round(16*2.5)=40`) instead of still guaranteed-lethal.

**Knife headshot — one-shot kill.** The `weapon.type !== 'melee'` gate that excluded melee from
headshot detection entirely was removed — headshot classification (using the same
`bestHeadYMin`/`bestHeadYMax` band from batch 49's fix, already computed for every weapon type
regardless) now applies uniformly to every weapon. No knife-specific multiplier was needed:
the existing shared `HEADSHOT_MULTIPLIER=2.5` against the knife's 55 body damage already gives
`round(55*2.5)=138`, comfortably past `MAX_HEALTH=100` — a guaranteed kill on any headshot
regardless of the target's current health, exactly the ask. Body-shot knife damage (55,
unchanged) still takes 2 hits.

**Verified before deploying:**
- Standalone simulation (`sim_falloff.mjs`) — 10 checks: shotgun full damage through the whole
  8-unit kill zone including the exact boundary, correct linear interpolation at 3 points
  in between, floor-clamping past max range, a close headshot still hitting 150, a far
  headshot dropping to 40 (explicitly asserted `<100`, i.e. no longer a guaranteed kill), knife
  body damage unchanged at 55, knife headshot at 138 (explicitly asserted `>=100`). All passed.
- A REAL two-client `ws` test against the live running server: point-blank shotgun body shot
  confirmed still 60; a far (dist≈25) shotgun HEADSHOT landed with `dmg=59` — matching the
  hand-calculated falloff math (`60-44×0.83≈58.7`) almost exactly, live proof the formula runs
  correctly end-to-end, not just in the isolated simulation; knife body shot confirmed 55
  unchanged; knife headshot confirmed `dmg=100` (victim health dropped to exactly 0) — a real
  one-shot kill against a full-health target. One far body-shot line of sight whiffed due to a
  short obstacle blocking that specific ray height on the `ruins` map (confirmed as map
  geometry, not the fix — the headshot case on the identical line, aimed higher, passed clean
  through the same low obstacle) — not chased further since the headshot case on the same line
  already gave direct live confirmation of the falloff math.

Syntax-checked both files locally and on remote, confirmed only the Shotgun's `WEAPONS` entry
carries the new falloff fields (AKM/Glock both `undefined`), pm2 restarted clean (twice —
deploy, then again to clear the test rooms from memory).

## Batch 52 (2026-09-15): DONE — real death-fall + eyelid-close camera sequence, respawn light-beam effect

User asked to replace the old death experience (a plain centered "Eliminated by X" text label,
no camera/visual feedback at all) with a real sequence: camera falls to the ground flat, face
to the sky, eyelids flutter then slowly close, fall.mp3 synced to the fall; then on respawn,
light circles appear around the character synced to a respawn.mp3, "like the light from a
spaceship." Told to fill in the gaps and apply it directly (no "talk first" gate this round),
then mid-implementation explicitly confirmed wanting the eyelid-REOPENING half on respawn too.

**Found the two source files already sitting in `/home/chicmic/a/games/`** (`fall.mp3` 1.848s,
`respawn.mp3` 1.541s, measured via mutagen) — same drop-a-file-and-I-process-it pattern as
every other named asset this project has used. Both durations became the exact timing anchors
for the new animation, not guessed numbers.

**Death sequence (`onLocalDeath`/`updateDeathAnim`, client.js):** starting from whatever
eyeHeight/pitch/stance the player was actually in at the moment of death (not a fixed pose —
correctly handles dying while crouched/prone/on an elevated platform), the camera:
- Drops from its current height to a low resting height (current eye height minus a fixed
  0.32 rest height, so it lands correctly relative to whatever floor/platform they died on,
  not always world-Y 0).
- Tilts `camera.rotation.x` up to ~86° (looking almost straight at the sky) and adds a small
  randomized roll (`camera.rotation.z`, ±~9-17°) so it reads as toppling to one side, not a
  perfectly clean mechanical drop.
- Both eased with `easeOutCubic` over exactly `DEATH_FALL_MS=1848` — fall.mp3's measured
  length — so the visual collapse finishes right as the sound does.
- `sfx.fall()` plays the instant the sequence starts, flat/non-positional (same reasoning as
  the existing grenade ear-ring effect: this is YOUR view collapsing, not a world sound others
  need to localize).

**Eyelids** — two JS-created overlay divs (`eyelidTop`/`eyelidBottom`, curved leading edge via
`border-radius` so they read as lids rather than a flat wipe), height driven every frame by
`setEyelidCoverage(pct)` rather than a CSS transition, so it can be kept in exact lockstep with
real audio lengths instead of a fixed CSS duration:
- First 500ms: two quick flutter pulses (`|sin|` wave peaking at ~16% coverage) — the "eyelids
  flap" the user asked for, read as consciousness flickering right after impact.
- Remaining time up to `RESPAWN_MS` (3000ms, imported from `gameData.js` — the server's actual
  respawn delay): `easeInCubic` slow close from 0 to full coverage (black), landing fully shut
  right as the server's real respawn message should arrive.
- Mouse look is now frozen during death too (the `mousemove` handler previously only checked
  `pointerLocked`, not `localAlive` — a real pre-existing gap, since nothing else froze camera
  rotation on death before this batch) — otherwise moving the mouse mid-death would fight the
  scripted `camera.rotation.x/z` the fall sequence drives directly.

**Respawn — both halves:**
- **Eyelids reopen** (`openEyelids()`, `onLocalRespawn`): reverses from whatever coverage the
  lids actually measured at that instant (tracked via `eyelidPct`, not assumed to be exactly
  1) back to 0 over 1500ms — respawn.mp3's measured length — so a respawn that lands slightly
  early or late relative to the death sequence's own timing still opens cleanly from wherever
  it really was, no snap/jump.
- Camera state restored: `camera.rotation.x` reset to the stored `pitch` variable (untouched
  during death since mouse look was frozen) and `camera.rotation.z` cleared — the death fall
  drove these directly, bypassing the normal look variables, so respawn has to explicitly hand
  control back.
- **Light-circle "beam-in" effect** (`spawnRespawnEffect(pos)`, new): 3 staggered expanding
  rings (`THREE.RingGeometry`, additive cyan glow, launched 140ms apart for a layered pulse —
  "light circles," plural, as described) plus a soft glowing vertical beam column for the
  "spaceship light" look specifically called out, both fading out over ~1.5s to match
  `respawn.mp3`. Triggered from the server's EXISTING `respawn` broadcast (`id`/`pos`/`health`,
  already sent to the whole room, not just the respawning player, unchanged from before this
  batch — no server code touched this round) for every respawn regardless of whose it is, so
  anyone nearby actually sees a teammate or enemy visibly reappear, not just a private effect
  only the respawning player experiences. Sound (`sfx.respawnBeam`) goes through the same
  positional pipeline as gunfire/explosions/footsteps for the same reason — everyone nearby
  should hear it fade with distance, not just the person spawning.

**Scope note, not chased further:** the same `onLocalDeath` sequence also fires for the
existing "fell off the play area" death path (env kill, not combat) — deliberately left
uniform rather than special-cased, since forcing a plain uniform fall-to-sky pose there too is
a reasonable default; flagging in case that specific case ends up looking odd layered on top of
the existing off-edge fall-through-space sequence, which is a separate, older mechanic.

**Verified before deploying:** `node --check` on client.js; grep-confirmed the old synthesized
`sfx.death()` tone was fully removed with no dangling call sites (would have thrown — the
`'killed'` handler used to call it directly, now moved to `sfx.fall()` inside `onLocalDeath`
itself); a standalone numeric simulation of every timing curve (fall-progress easing hits 0/1
at the right instants and clamps after, eyelid coverage is 0 at blink-start, exactly 1 at
`RESPAWN_MS`, monotonically non-decreasing through the whole close phase with no flicker, the
blink flutter peaks near the intended 0.16, and `openEyelids`'s reverse curve correctly starts
from a partial value rather than assuming 1) — 13/13 checks passed. Both new sound files
confirmed reachable (curl 200 each), every new function/element
(`spawnRespawnEffect`/`updateDeathAnim`/`openEyelids`/`setEyelidCoverage`) grep-confirmed live
on the remote, pm2 restarted clean. Not browser-tested per standing instruction — the exact
fall pose/timing feel, eyelid curve shape, and respawn beam's visual weight are exactly what
the user said they'd test themselves and report back on.

## Batch 53 (2026-09-17): DONE — per-map background music (Ruins gets its own lava/bg2 combo, City untouched)

User pointed out `backround.mp3` (with its helicopter ambience) fit the City map but not
Ruins, and asked for Ruins to use `bg2.mp3` (80%) + `lava-sound.mp3` (60%) together instead,
explicitly asking to leave City alone and to keep the system modular/easy to retune.

**Made this fully data-driven rather than branching in code.** Added a `music` field to each
entry in `MAPS` (`gameData.js`): a list of `{key, gain}` layers, where `key` matches a
`SOUND_FILES` entry in client.js. `startBackgroundMusic(mapKey)` (client.js) now just reads
`MAPS[mapKey].music` and starts one looping source per layer into an array
(`backgroundMusicSources`, replacing the old single-slot `backgroundMusicSource`);
`stopBackgroundMusic()` stops everything in that array. City's entry is the exact same track
and gain as before (`background`, gain 2), just expressed in the new shared shape — its actual
sound is byte-for-byte unchanged. Ruins gets two simultaneous layers (`bg2` gain 0.8,
`lavaSound` gain 0.6) instead of reusing City's track. Adding, removing, or retuning a map's
music going forward is a one-line edit to that map's `music` array — no new code path needed,
which is the "modular and easy to fix" the user asked for.

`onJoined` now passes the actual joined map (`msg.map || DEFAULT_MAP`) into
`startBackgroundMusic` instead of it running blind — this was the one real gap in the old
single-track version (it never even knew which map it was playing for, since there was only
ever one track to consider).

Verified before deploying: `node --check` on both files, confirmed via curl that the live
`gameData.js`'s `MAPS.city.music`/`MAPS.ruins.music` match exactly what was intended (checked
the actual deployed content, not just the local diff), both new sound files reachable (curl 200
each), grep-confirmed the array-based `backgroundMusicSources`/`startBackgroundMusic(mapKey)`
are live in the served client.js, no stale references to the old singular
`backgroundMusicSource` anywhere. pm2 restarted clean. Not browser-tested per standing
instruction — the actual 80/60 volume balance between the two Ruins layers, and whether either
clip has an audible loop-seam click (neither was trimmed this round, unlike the footstep clips
in batch 46 which needed it), are worth a real listen.

**Sky hole — investigated, not yet fixed.** Before touching anything, read through the entire
horizon/skybox system (`buildHorizon`/`buildHorizonTexture`, the shared canvas-painted-skyline-
on-a-cylinder trick) and ruled out every code-level cause a "hole" could have:
- The horizon cylinder (`CylinderGeometry(170,170,240,32,1,true)`, full 360° — thetaStart/
  Length are the unpassed defaults, a complete wrap) is positioned/sized identically for both
  themes; only its TEXTURE differs. Its radius (170) comfortably encloses the entire playable
  area including the Ruins-side map extension (farthest reachable corner is ~126.5 units from
  center) — no way to see past/around it from anywhere a player can stand.
- The canvas texture itself is proven fully opaque for both themes: an unconditional full-
  canvas gradient fill happens BEFORE any theme-specific drawing (lava ridges/cracks for dusk,
  sun/clouds for day), and neither theme's follow-up drawing ever clears or punches through
  that base layer (no `destination-out`/`clearRect` anywhere in either path) — there's no way
  for a literal transparent gap to exist in the texture.
- Checked whether the mansion/houses (the only Ruins-flavored *structures*) could have an
  actual roof/wall gap letting sky show through somewhere it shouldn't — but `getMapLayout`
  builds identical mansion/house geometry for BOTH map keys (only colors differ via `mapKey ===
  'ruins' ? ... : ...`), so a structural gap would show in City too, which doesn't match "not
  city" in the ask.
Given all of that comes back clean, this doesn't look like something I can pin down by reading
code alone — asked the user for a screenshot (and roughly where on the map/from what vantage
point they're seeing it) before attempting a fix, rather than guess at the wrong theory and
burn a deploy round-trip on it.

## Batch 53b (2026-09-17): DONE — fixed the Ruins sky hole (dead-center overhead)

Follow-up to batch 53. User confirmed the hole is "right above, dead centre" — looking
straight up. That pinpointed it precisely: the horizon "sky" is a 360° painted cylinder wrapped
around the whole map (`buildHorizon`, shared code for both themes), and it's deliberately
`openEnded: true` — no top cap. Looking straight up passes through that open rim (world y=150)
and falls through to the bare flat `scene.background` color, which has zero painted detail —
against Ruins' otherwise fully-painted sunset/lava horizon, that flat gap reads exactly as a
hole dead-center overhead. City's flat blue zenith already looks correct as-is (a real midday
sky IS just uniform blue up top), which is exactly why this never showed up there.

**Fix, scoped strictly to Ruins:** added a solid disc (`THREE.CircleGeometry(170, 32)`) capping
the cylinder's open top, gated behind `if (theme === 'dusk')` — City's code path is completely
unreached by this addition, confirmed by grep (the new block only exists inside that
conditional). Colored `0x241f16` — an exact match to the horizon texture's own top-edge pixel
color (the sky gradient's offset-0 stop in `buildHorizonTexture`) — so the cap meets the
cylinder's rim with no visible seam, rather than trying to hand-build a continued gradient.

Verified before deploying: `node --check`, grep-confirmed the new cap code only exists inside
the `theme === 'dusk'` branch (City's rendering is byte-identical to before), pm2 restarted
clean, grep-confirmed the deployed client.js contains the new geometry. Not browser-tested per
standing instruction — the exact color match/seam blend is worth a look now that it's live.

## Batch 53c (2026-09-17): DONE — the sky-cap fix from batch 53b still read as a hole, real fix this time

User screenshot showed a large, hard-edged dark circle dominating a large chunk of the normal
gameplay view (not a rare "look straight up" edge case — the math actually confirms this: at
map center, the rim is only ~41° above horizontal, well inside the ~74.5° mouse-look pitch
clamp, so this area is reachable during ordinary aiming/looking around, not just an extreme
angle). "You painted it on all sides but left on the top" — the batch 53b cap WAS there, but a
single flat unlit color with no gradient and no fog treatment stood out as an obviously
different, hard-edged patch against the rest of the painted sky — technically covered, but
still reading as a void/hole to the eye.

**Real fix:** replaced the flat-color disc with an actual radial-gradient canvas texture (same
painted-canvas technique already used for every other sky/wall texture in this file, not a new
pattern) — rim edge exactly matches the horizon texture's own top-edge color (seamless meeting,
unchanged from 53b), center eases to a slightly deeper tone instead of a flat single shade, so
it reads as the sky continuing to darken toward zenith (realistic for a dusk sky) rather than a
separate flat patch. Also bumped the cap's radius from exactly 170 to 172 (a small overlap past
the cylinder's own 170 radius) to rule out any hairline seam gap right at the rim as a
contributing factor. Still scoped strictly to `theme === 'dusk'` — City's code path is
untouched (confirmed via grep, same check as batch 53b).

Syntax-checked, deployed, grep-confirmed the new gradient code is live, pm2 restarted clean.
Not browser-tested per standing instruction — asking for a fresh screenshot/look this time
before considering it closed, given the first attempt at this exact fix didn't actually read
as fixed despite being technically present.

## Batch 54 (2026-09-17): DONE — split the 2,765-line client.js into 11 proper modules

User asked, after a design-discussion round about the game's limitations/mobile/voice-chat/
graphics options, to fix an existing structural problem first: "there is one giant file please
carefully make everything modular and divide it into functions and files as standard practice
says and optimize the code structure over all... make sure nothing breaks."

**Scoped to `client.js` only** — `server/index.js` (794 lines) and `shared/gameData.js` (763
lines) are already single-purpose, cohesive files; the "giant file" complaint was specifically
about the 2,765-line, ~230-top-level-declaration client script that every prior batch had been
adding onto. Planned via `EnterPlanMode` + a Plan-agent review before touching anything, given
the scale and that this is a live game people actively play — the approved plan is in this
session's history; summary of what actually shipped follows.

**New structure**: `public/js/` now holds 11 feature modules (`state.js`, `net.js`, `audio.js`,
`ui.js`, `world.js`, `characters.js`, `pickups.js`, `grenades.js`, `weapons.js`, `movement.js`,
`death.js`); `public/client.js` (221 lines, down from 2,765) becomes a thin bootstrap that owns
only the inbound-message dispatch and the main render loop — the two things that legitimately
touch nearly every module and would otherwise force circular imports between feature files.
**Zero changes needed to `index.html` or `server/index.js`** — `express.static` already serves
the whole `public/` tree, so the new `/js/*.js` paths work automatically, and the existing
single `<script type="module" src="/client.js">` tag didn't need to move.

**Shared state — one flat mutable object (`js/state.js`), not per-variable exports.** ES
modules only allow reassigning a binding from the module that declared it, so `export let x`
can't be set from an importer — mutating a *property* of an imported object (`state.x = ...`)
is always legal, which is what makes this pattern work at all. Flat (`state.playerX`, not
`state.player.x`) so every call site is a pure `playerX` → `state.playerX` rename, nothing more
— minimizes the mechanical-edit risk on top of the real re-architecture work. Deliberately
trimmed to ~25 genuinely cross-module fields (camera/scene/yawObject, player position/stance/
look direction, alive/session flags, the active map layout arrays) — anything only ever
touched inside one feature file (reload timers, the AKM loop handle, grenade-aim UI state,
`audioCtx`/`soundBuffers`, the three player/grenade/pickup Maps) stayed a private `let` in that
file instead, extending the codebase's own pre-existing `syncGrenades`/`syncPickups`
encapsulation pattern rather than exposing raw state — new small functions
(`syncRemotePlayer`/`updateRemotePlayers` in characters.js, `updateGrenades` in grenades.js,
`applyPickup`/`getCurrentWeaponIndex` in weapons.js) cover the handful of places that used to
reach into those Maps/variables directly.

**Circular-import resolution, decided concretely rather than left to "ES modules tolerate
it":** `net.js` imports ONLY `state.js` — never a feature module — so every feature module can
import `sendMsg`/`sendState` from it with zero risk. The inbound message switch
(`handleMessage`) and the render loop (`animate`) both stayed in the bootstrap rather than
living in `net.js`, since they're the two functions that legitimately need to call into nearly
every module. One additional case found only while writing the actual code (not anticipated in
the plan): `initScene` (world.js) used to also call `initViewmodels()`/`initTrajectoryVisuals()`
(weapons.js) and `animate()` (the bootstrap) at the end of its one-time setup — moved those
three calls out into a small separate bootstrap-owned gate (`startGameLoopOnce`, called right
after `initScene` from `onJoined`) instead, which preserves the exact original "all four things
happen together, exactly once" guarantee without world.js ever needing to import weapons.js or
the bootstrap.

**Verified before deploying — more rigor than the project's usual `node --check`, called out
explicitly because a broken import path or wrong export name in browser ES modules never shows
up in `pm2 logs` or a `curl` 200 (Express just serves the broken file byte-for-byte; only a
real browser's module loader would throw):**
- `node --check` on all 12 files, locally and again after scp to the remote.
- **Exhaustive export/import cross-reference**: extracted every `export` from every file and
  every `import {...} from './x.js'` line across the whole tree, diffed them — zero missing
  exports, zero typos. Caught one real bug this way before it ever reached a syntax check:
  `characters.js`'s new `updateRemotePlayers` called `isOccludedBetween`/`localListenerPos`
  without importing them.
- **Orphan audit against the full original inventory**: extracted all 113 original top-level
  function names and all 140 top-level variable names from the pre-refactor file, confirmed
  every single one still exists somewhere in the new tree — nothing silently dropped.
- **Bare-reference sweep** on the ~24 trickiest shared-state names (`playerX`, `pitch`, `yaw`,
  `localAlive`, `camera`, `scene`, `sceneReady`, `falling`, etc.) — grepped every remaining
  non-`state.`-prefixed occurrence across the whole tree and hand-confirmed each one is inside
  a comment, not a missed rewrite spot. Zero misses.
- **Cycle assertion**: confirmed `net.js`'s only local import is `./state.js`.
- **DOM id audit**: 47 unique `getElementById` ids in the original file, 47 in the new tree,
  identical sets (one apparent mismatch, `grenadeCountEl`, is expected — it's created at
  runtime inside `buildWeaponBar()` via `innerHTML`, not present in the static `index.html`,
  same as the original code).
- **Live deploy check**: syntax-checked all 12 files on the remote, `pm2 restart` came up
  clean, then curl-verified `index.html` + `client.js` + all 11 `/js/*.js` paths individually —
  every one reachable and 200.

**What this doesn't cover, said plainly**: none of the above proves the game actually *runs*
correctly end to end — a browser's ES module loader is the only thing that would surface a
subtle runtime mismatch (e.g., an execution-order assumption between two modules) that static
analysis and grep can't fully rule out. This is a much larger, more structural change than any
prior batch, so **a real live playtest matters more here than usual** — join a room on both
maps, move/jump/crouch/prone, fire all four weapons, reload, throw a grenade, get a kill and a
death (checking the new death-fall/respawn sequence still works), check the minimap, chat/menu/
pause flows, and a second client for multiplayer sync — before trusting this the way the last
53 batches' smaller, narrower changes could be trusted off static verification alone. The
pre-refactor `client.js` is preserved locally
(`scratchpad/ruins/client.js.pre-refactor-backup`) and in git history on the remote for an
instant revert if anything surfaces.

## Batch 55 (2026-09-17): DONE — fixed the client.js/js module import paths after the refactor

User reported being stuck on the login screen right after batch 54's module split deployed.
Screenshot showed every `/js/*.js` file 404ing, initiated from `client.js`'s own import lines.

**Real bug, found immediately from the screenshot:** `client.js` lives at the site root
(`/client.js`), but its 11 import lines used bare `./state.js`-style relative paths — which
resolve relative to `client.js`'s OWN location (site root), giving `/state.js`, not
`/js/state.js` where the files actually live. The modules' imports of EACH OTHER were all
correct (they're siblings inside `/js/`, e.g. `audio.js`'s `import ... from './state.js'`
correctly resolves to `/js/state.js`) — only the 11 lines in the bootstrap itself were wrong.
Fixed by prefixing all 11 with `./js/` (`from './js/state.js'`, etc.).

**Why this got past the batch 54 verification:** every check run before deploying was either a
syntax check (doesn't touch import resolution at all) or a cross-reference of export NAMES
against import NAMES (would never catch a wrong PATH, since the names matched perfectly) — the
one gap explicitly flagged in that batch's own note ("none of the above proves the game
actually runs... a browser's ES module loader is the only thing that would surface" this
exact class of issue) turned out to be exactly what broke. Noted for next time: any refactor
that changes a file's DIRECTORY relative to files it imports needs an explicit check of each
import's resolved path against the actual deployed file layout, not just that the import
graph's names line up.

Fixed both `audio.js` and `weapons.js` in the same deploy... no wait, that's the NEXT bug — see
below, this batch was import-paths only. Syntax-checked, deployed, pm2 restarted clean, curl-
verified the live client.js now reads `./js/state.js` etc for all 11 imports.

## Batch 56 (2026-09-17): DONE — reload sound didn't stop when switching weapons mid-reload

User: switching weapons while a reload is in progress cancelled the reload state/UI but the
reload sound effect kept playing to completion regardless.

**Real bug:** `sfx.reload(w)` (audio.js) fired the reload clip via `playBuffer()` but never
returned the resulting `BufferSource` — so `weapons.js` had no handle to it at all, meaning
`cancelReload()` (already correctly called from `setWeapon()` on every weapon switch) could
only hide the UI ring and clear the reload state, with nothing available to actually stop the
audio. This is the exact same "no handle kept, so nothing can stop it early" class of bug this
project has fixed before for the AKM spray loop and remote gun loops — reload was simply never
given the same treatment when it moved from an instant action to a real timed one.

**Fix:** `sfx.reload(w)` now returns `playBuffer(...)`'s result (one-line change per branch,
mirroring how every other stoppable sound in this codebase already returns its source).
`weapons.js`'s `reload()` captures it into a new `reloadSoundSource` handle; `cancelReload()`
stops it (try/catch, in case it already finished) before clearing the reload state — same
pattern as `stopAkmLoop`/`stopRemoteGunLoop`. `updateReload()`'s natural-completion path clears
the handle too (nothing to stop, it already finished on its own).

Verified before deploying: confirmed `cancelReload()` really is called from every weapon-switch
path (`setWeapon`'s `cancelReload();` call, unchanged from before). Syntax-checked both files
locally and on remote, pm2 restarted clean, grep-confirmed `reloadSoundSource` is live in the
served `weapons.js`.

## Batch 57 (2026-09-17): DONE — renamed to "Wreckveil", full login dashboard, Postgres migration

Biggest single day of work since the local migration (batch 56 was still on the old remote
before that). Four things, done in this order.

**1. Game renamed Ruins → Wreckveil.** Picked via `whois`-checked domain availability
(`wreckveil.com`/`.gg` both open at decision time, not yet purchased). `<title>`, auth/dashboard
headings, pm2 process (`ruins-fpp` → `wreckveil`), and the server's own startup log line all
updated. The map dropdown's "Ruins" theme option was deliberately left alone — that's the map's
own name (mud-yellow Ruins vs concrete City), not the game brand, a real distinction.

**2. Real logo, twice** (user supplied two versions across the session, both processed the same
way). Background removal used a flood-fill color-key from the border (NOT `rembg`'s ML
segmentation — rembg missed interior gaps like the space between the gun and the wing shapes,
since it treats the whole silhouette as one blob; flood-fill correctly punches out only
background-colored regions actually connected to the outside edge). First version: also had one
small isolated "sparkle" artifact removed by keeping only the largest connected foreground
component. Second version (the "more blood stained" one, with dozens of scattered blood-droplet
islands around the main shape) needed a smarter removal — keeping only the largest component
would have stripped all that intentional detail, so instead only ONE specific component was
targeted for removal: small, neutral-gray colored (not reddish), in the bottom-right corner —
i.e. still just the sparkle, this time found by its own color/position signature rather than by
size/connectivity. Both tilted -10°/+10° (PIL) to lean right, matching the game-over screen's
existing top-left blood-stain decal's own rotation direction — got the sign wrong on the very
first attempt (leaned left instead) and had to flip it once the user pointed out the mismatch.
Deployed as `public/favicon.png` (square-padded, PLUS a solid black circle backing added after
the user reported the transparent PNG was invisible against light browser tabs) and
`public/images/wreckveil_logo.png`, used on the auth screen, the dashboard top bar, and a
tilted corner badge on the match-end screen.

**3. New post-login flow: a real dashboard, not straight into join/create.** New
`#dashboardScreen` — top bar (logo + "WRECKVEIL" on the left, account name + Log Out on the
right) + a left sidebar (Play / Profile / Character / Settings / Controls) + a main pane per
tab. The OLD join/create screen (`#menuScreen`) didn't go away — it now opens as a modal on top
of the dashboard via a "PLAY" button, closed with a new "×" (`#closeMenuBtn`) back to the
dashboard, instead of being the first thing shown after login. `decorateButtonsWithBlood()`
(the per-button random blood-decal system) got a `.modalClose` exclusion — that button is a
tiny ~30px icon-only "×", and decals sized for a normal label button would swallow the glyph
entirely.

**4. Account storage moved off `server/users.json` onto Postgres — a real migration, not a
toy.** A dedicated `wreckveil` role+database was created INSIDE the already-running
`antiszn_postgres` docker container (port 5432) rather than spinning up a second container —
asked the user first via a real tradeoff question (isolation vs one-less-container) rather than
assuming either way, since it meant sharing infra with an unrelated project. Connection lives in
`server/db.js` (a `pg` Pool, env-overridable, defaults `wreckveil`/`wreckveil_dev`/`wreckveil`).
Schema (`server/db/schema.sql`, idempotent `CREATE ... IF NOT EXISTS`) has 3 tables: `users`
(scrypt-hashed passwords, same hashing scheme as the old JSON version, just relocated),
`player_stats` (kills/deaths/matches_played), `player_customization` (primary/secondary hex
color). `npm run db:migrate` applies the schema, `npm run db:seed` seeds a demo account
(`demo`/`demo1234`, idempotent). New REST endpoints: `/api/register`/`/api/login` (DB-backed
now, same behavior), `GET /api/profile?username=` (stats + customization for the dashboard),
`POST /api/customization` (save colors).

**Character customization is real, not a settings stub.** A player's primary color is sent in
the WebSocket `hello` message, stored on the room's player object, broadcast in `joined`/`state`
payloads (`color` field, same convention `weapon` already used), and `characters.js`'s
`buildCharacterFigure`/`syncRemotePlayer` tint a remote player's suit material with it — falls
back to the existing `colorForId(id)` hash-color for anyone without a saved color (guests, or
accounts that never touched the Character tab).

**Found and fixed a real race condition via a live test, not just code review.** First version
resolved a connection's linked account (for persisting stats) via an async DB lookup fired
fire-and-forget from the `hello` handler, hoping it would resolve before the client's very next
message. A two-client WebSocket test proved this lost the race **every single time** in
practice — the real client sends `hello` then `createRoom`/`joinRoom` back-to-back with zero
delay, so the DB round-trip never won against the very next synchronous message; `matches_played`
stayed 0 no matter what. Fixed by storing only the plain username synchronously at `hello` time
(`ws.authUsername`) and doing the actual DB lookup `await`ed inline inside `joinRoom()` (now
`async`) right before the player object is built. Confirmed fixed with the same live test:
`matches_played` correctly becomes 1 on join, kills/deaths correctly persist after a real kill
(7× point-blank AKM shots to guarantee a lethal 112 damage, not just one non-lethal 16-damage
hit that would leave kills/deaths untouched by design).

**Settings tab wired to two real mechanisms, not stubs.** Master volume now routes through one
shared `masterGain` node in `audio.js` — every existing sound path redirected to it instead of
`audioCtx.destination` directly (a bulk `sed` replace on this also clobbered the new node's own
connection into a self-loop; caught and fixed before deploying, since a node connected to
itself is a silent dead end, not an error). Mouse sensitivity multiplies the existing `0.0022`
look-speed constant in `movement.js`. Both persist to `localStorage`
(`ruins_masterVolume`/`ruins_mouseSensitivity`) — per-device, not per-account, deliberately kept
separate from the DB-backed account settings.

**Verified with the same rigor the batch 54/55 module-split postmortem demanded** (that
postmortem's own lesson: `node --check` and curl 200s don't catch wrong import paths or
message-timing bugs — only a real browser or a real live test does): a full export/import
cross-reference across every `public/js/*.js` file + `client.js` (a naive first pass threw false
positives from trailing commas in multi-line import lists — fixed the checker, confirmed those
weren't real bugs, not the other way around), a DOM-id audit of every `getElementById` call
against real `index.html` ids (one expected miss, `grenadeCountEl`, a documented pre-existing
runtime-created element from batch 54), and the live two-client WebSocket test described above.

Syntax-checked every changed file, pm2 restarted clean at each step, curl-verified new/changed
assets and endpoints, cleaned up every test account/room created during verification before
calling it done.

## Batch 58 (2026-09-17): DONE — button blood-decal corners fixed (were spilling outside)

User screenshot: the "Save" button's blood decal showed a visible hard square/diagonal corner
sticking OUTSIDE the button's own edge against the dark page background — read as a messy
floating rectangle, not a stain on the button. Root cause: `decorateButtonsWithBlood()` picked 2
random corners out of all 4 per button, with a negative offset (`-8px`) that deliberately let
part of the decal image hang past the button's boundary, and the button itself had no
`overflow: hidden` to clip it.

**Fix:** corners are no longer randomized — always top-right and bottom-left specifically
(explicit user ask: "place one at top right... other on bottom left... just the corners"). Every
decorated button now also gets `overflow: hidden` set in JS at decoration time, so no matter the
decal's random rotation/size, it's clipped flush to the button's own rounded rect — physically
impossible for it to spill outside anymore, not just less likely to.

Syntax-checked, deployed, pm2 restarted clean.

## Batch 59 (2026-09-18): DONE — dashboard overhaul: 3D character preview, richer Profile, BGMI-style Settings

**Play + Character panes** now have a framed "operator card" beside the content
(`#playPreviewSlot` / `#characterPreviewSlot`). `public/js/preview.js` owns ONE shared
three.js scene/canvas that `mountPreviewInto()` reparents into whichever pane is active (single
WebGL context, single RAF loop; stopped when neither pane is visible or the Play modal covers
the dashboard). Color pickers update the figure live before Save.

**Profile:** identity header (avatar tinted with the player's color, member-since, BGMI-style
rank badge Bronze→Ace computed client-side from lifetime kills) + 6 stat cards. New real stat:
`player_stats.wins` (schema.sql `ALTER ... ADD COLUMN IF NOT EXISTS`), credited in `endMatch()`
to the top-kills CONNECTED player only, and only if kills > 0. `/api/profile` also returns
`wins` + `memberSince`. Verified with a live two-client test (kills:1, wins:1 after a real
kill + auto-ended 6s match).

**Settings**, every control wired to a real mechanism: Master/Music/Effects volume (audio.js now
has musicGain + sfxGain feeding masterGain; `playBuffer` takes `bus:'music'|'sfx'`, only
background music uses 'music'), mouse sensitivity, FOV (`setFov` in world.js, live on the camera),
Sprint Mode hold/toggle (`state.toggleSprint`, Shift keydown flips `sprintToggledOn` in client.js,
auto-cancels when movement stops). No ADS/shadow controls — the engine has neither, so they
would have been fake.

**Bug fixed after user report ("you box empty, no button works"):** `showDashboard()` was invoked
at module load, before the `const`s it transitively reads (`playPreviewSlot`, `activePane`) were
declared → temporal-dead-zone ReferenceError that killed the rest of `ui.js`, so no listener
after that point was ever attached. Moved the initial-screen trigger to the LAST statement of
`ui.js`. Not catchable by node --check / curl / import-export cross-reference.

## Batch 60 (2026-09-18): DONE — face + cap on the character, secondary color now real

Eyes on the -Z (front) face and a cap with a brim (brim = the silhouette that reads at distance)
so front/back is obvious. Secondary color, previously "reserved", now drives the cap; threaded
hello → `ws.secondaryColor` → `player.secondaryColor` → `joined`/`state` broadcast →
`syncRemotePlayer`, live-previewed in the Character tab. Verified round-trip with a live ws test.

## Batch 61 (2026-09-18): DONE — real 3D models replace the box figures; login regression fixed

**Assets (all Quaternius, CC0, user downloaded the zips — itch.io widget downloads can't be
scripted):** Universal Base Characters (Superhero_Male, rigged UE-style skeleton, ~1.82 units
tall with feet at y≈0 so it matches the engine's scale with no rescale), Universal Animation
Library (43 clips; used Idle_Loop / Walk_Loop / Sprint_Loop / Crouch_Idle_Loop /
Crouch_Fwd_Loop on the SAME bone names as the character, so clips play with no retargeting),
Ultimate Guns Pack (FBX only in the free tier: AssaultRifle_1→AKM, Shotgun_1, Pistol_1→Glock,
Bayonet→knife). Files live in `public/models/`, original filenames kept (renaming the .gltf broke
its internal buffer URI). Two texture names the gltf references (`T_Eye_Normal_png.png`,
`T_Hair_1_Normal_png.png`) don't exist in the pack (Quaternius packaging quirk); supplied
copies of the correct normal maps under those names.

**Code:** `characters.js` rewritten — async template preload at module load (same pattern as
audio.js), `buildCharacterFigure` clones via SkeletonUtils `clone`, tints the `MI_Superhero_Male`
material per instance, parents a procedural cap to the `Head` bone and per-weapon FBX guns to
`hand_r`, one `AnimationMixer` per figure with 0.25s crossfades. Prone still rotates the whole
rig flat (no prone clip exists) but over a crouch pose; the old `CROUCH_SCALE_Y` squash is gone
from the client (still exported for the server's headshot band). `createRemote` queues if the
template isn't loaded; `syncRemotePlayer` returns early and retries next tick. Server serves
`node_modules/three/examples/jsm` at `/vendor/three-examples`.

**Login regression (user: "login page not working") — root cause:** I wrote
`import { SkeletonUtils } from '.../SkeletonUtils.js'` but that file exports `clone`, `retarget`,
`retargetClip` individually — no `SkeletonUtils` binding exists. A missing named export is a
link-time SyntaxError, and because ui.js → preview.js → characters.js, the whole ui.js module
(all auth listeners) failed. Fixed to `import { clone as cloneSkinned }`. I had grepped the
export shape for GLTFLoader/FBXLoader but ASSUMED it for SkeletonUtils. Afterward walked the
entire vendor import graph (7 modules): every file resolves, every named import matches.

**Known first-pass estimates needing a real look (no browser available here):** gun
position/rotation in the hand (`inst.position/rotation` in `buildCharacterFigure`), FBX gun
scale (trusting FBXLoader's unit handling), cap fit on the real head, animation crossfade feel,
and the headshot constants (`HEAD_CENTER_Y`/`HEAD_HALF` in gameData.js) which were tuned for the
old box head and are close to, but not verified against, this model. Bundled hair meshes were
NOT integrated (they need re-skinning to this skeleton); the procedural cap stays instead.

## Batch 62 (2026-09-21): DONE — giant-gun "blob" fixed, cap removed, guns actually held (verified by rendering)

User screenshots: a huge black rock-like shape in the world, and a loose box floating above the
character's head. Two causes, one bug each:
- **The blob was another player's gun, ~100x too big.** Measured the FBX bounding boxes in Node
  (`FBXLoader.parse` works headlessly for untextured FBX): AKM is 310 units long, shotgun 521,
  glock 182, knife 117 — cm-scale exports, and FBXLoader does not convert. `normalizeGun()` in
  characters.js now scales each gun from its MEASURED length to a real-world target
  (`GUN_FIT`: AKM 0.9, shotgun 1.0, glock 0.2, knife 0.3) and re-pivots it to the grip point.
  (The Character preview looked fine only because its camera sat INSIDE the giant gun, where
  back-faces are culled.)
- **Cap removed** entirely (characters.js, preview.js, ui.js, client.js) and the Character tab's
  secondary-color picker with it, since it had no remaining visual hook. `secondaryColor` still
  exists in the DB / API / hello / broadcasts, untouched and harmless, for a future use.

Also found by rendering: the model faces +Z but the game's forward is -Z, so remote players
would have faced backwards. `buildCharacterFigure` now wraps the model in an outer Group
(`model.rotation.y = PI`); prone rotation/yaw apply to the outer group, the mixer binds to the
inner model. Guns were hanging down the forearm; measured hand_r's real axes in the idle pose
(local +Y runs down the arm to the fingers) and built `GUN_IN_HAND_QUAT` from them so barrels
point forward with sights up. Verified in a side-view render: AKM, shotgun, glock, knife all
read correctly. Preview camera pulled back (`1.1, 4.3`) so feet aren't cropped.

**Verification method changed this batch:** headless Chrome IS available (`google-chrome`), and
driving it over the DevTools protocol with the already-installed `ws` package gives real console
errors AND screenshots (`--screenshot` alone returned blank pages here; CDP `Page.captureScreenshot`
worked). Logged-in dashboard rendered by seeding `localStorage.ruins_auth` before navigation.
Known remaining: the model is a near-naked body, so the primary color tints skin as well as the
shorts (muddy olive at some colors) — real clothing needs the Modular Outfits pack or a
per-region material split; walk/sprint arm swing tilts the gun a little (attachment is fixed to
the idle-pose orientation).

## Batch 63 (2026-09-21): DONE — proper two-handed rifle stance (arm IK), verified by rendering

User: the character held the AKM "like a stick" (gun glued to the right hand, arm hanging).
Real fix, not a better attachment point: `characters.js` now poses both arms around the gun
every frame. The guns (AKM/shotgun/glock) ride an `aim` anchor on the model whose ORIENTATION
is fixed to model-forward and whose POSITION follows spine_03 plus a mounting offset swung by the
torso's lean from bind pose (parenting it to the spine outright made the barrel point at the
floor in the crouch clip; ignoring lean put the gun at head height in a crouch). `updateFigure`
(exported; used by remote players AND preview.js) = `mixer.update` then `solveArm` for each arm:
analytic two-bone IK (bone lengths read from the live pose, elbow pushed toward `ELBOW_POLE`),
right hand oriented via the measured hand↔gun relation, left hand palm-up under the handguard
(measured: hand_l +X = palm normal, +Y = fingers). Reach is the constraint: arms are ~0.545 long
so the gun must sit close in at chest height (`AIM_POS`) or the left hand can't reach it. Knife
stays a one-handed grip on hand_r. `setFigureWeapon(fig, id)` swaps visibility + which grips
apply. Legs/torso still come from the real Idle/Walk/Sprint/Crouch clips.
Verified in side/front/three-quarter renders for idle, walk and crouch, and on the real
dashboard card.

**Follow-up checks of the gaps above (same day), all rendered:** sprint (4 stride frames) and
crouch-walk (3 frames) hold the stance with no arm breakage; hands are the model's own curled
fists, which read as gripping the pistol grip / supporting under the handguard, so no finger work
was needed. **Prone was actually broken** (found only by rendering): a crouch pose laid flat came
out curled up, and because the rig is laid flat by rotating the outer group, model-forward points
at the GROUND, so the rifle pointed into the floor. Fixed with a separate prone aim pose
(`AIM_POS_PRONE`/`AIM_FORWARD_PRONE`/`AIM_UP_PRONE`/`ELBOW_POLE_PRONE`: gun along the body axis
ahead of the chest, elbows out and toward the ground), a straight-bodied `Idle_Loop` as the prone
base clip, and `fig.prone` set from `rp.prone` each frame. Verified side + top view.

## Batch 64 (2026-09-21): DONE — appearance / closet system (2 bodies, skin spectrum, wardrobe)

User: replace the color palette with a white→black skin-tone spectrum, more characters, a closet.
Only two bodies exist in the free Quaternius pack (Superhero Male + Female) — both are used, and
variety comes from multiplying them by hair / clothes / skin. The Male body reads a bit "monster"
(heavy proportions); kept as a selectable "Superhero" build. A more normal male needs a different
pack — options told to the user: Universal Base Characters "Regular/Teen" (same rig, so all the
dress/IK code below would work unchanged, paid ~$20, price unconfirmed), Quaternius Ultimate
Modular Men (free CC0, different skeleton → needs retargeting), Mixamo (free Adobe login,
different skeleton).

- `shared/appearance.js` (client UI + renderer + server all import it): `SKIN_TONES` (12 shades,
  `#fbeee4`→`#241510`), hair/cloth palettes, `SLOTS` menus, `DEFAULT_APPEARANCE`,
  `sanitizeAppearance()` (unknown ids / bad hex → defaults, so a stale DB row can't break a
  render), `guestAppearance(id)` (deterministic spread for guests). Stored as JSONB in
  `player_customization.appearance` (schema.sql `ADD COLUMN IF NOT EXISTS`); `POST
  /api/customization` takes `{username, appearance}` and sanitizes; `hello` and `joined`/`state`
  carry `appearance`.
- Skin tint: the shipped skin textures had a tan baked in, so neutral gray detail maps were
  generated (`public/models/character/T_Skin_*_Neutral.png`, average sRGB 0.75); the tone colour is
  multiplied by 1/0.5225 (linear) to compensate. Hair meshes are re-skinned onto the body
  skeleton by bone-name remap of `skinIndex`; hair tint scaled 1/0.275.
- Wardrobe (`public/js/dress.js`): clothes are SkinnedMesh copies of the body geometry bound to
  the SAME skeleton (so they animate with it for free), with a per-vertex `clothW` mask built
  from skin weights (+ along-bone fraction for tank straps, + bind-height `minY`), inflated in
  the vertex shader (`onBeforeCompile`), unwanted verts `discard`ed in the fragment shader, and
  procedural camo noise. One shared program via `customProgramCacheKey`. Items: tank/tee/
  longsleeve/camojacket, shorts/pants/camopants, sneakers/boots, gloves, beanie/helmet, beard.
  Known cosmetic nit: slightly jagged bits at the shorts waistline.
- `characters.js`: `buildCharacterFigure(id, name, appearance)`, `redressFigure`,
  `setRemoteAppearance`; `preview.js` `setPreviewAppearance` (rebuild on body change, else just
  redress). Closet UI lives in `ui.js` (`draftAppearance` vs saved `myAppearance`).
- Fixed a latent bug: repeated `createRemote` before the models finished loading queued/duplicated
  figures (now guarded by `remotePlayers.has(id)` + pendingCreates dedupe).

**pm2 stale-process trap (cost real time):** after the local migration the pm2 process
`wreckveil` did not exist any more — an old `ruins-fpp` (pid 1953) was still serving OLD code, and
`pm2 restart wreckveil >/dev/null` failed silently, so new endpoints looked broken. Fixed with
`pm2 delete ruins-fpp` + `pm2 start server/index.js --name wreckveil`. Rules: never hide pm2
output, and check `pm2 list` (name + uptime) before trusting a "deploy". Also: `pkill -f "<pat>"`
/ `pgrep -f` match the invoking shell itself (exit 144) — kill test servers by pid from
`ss -ltnp | grep :PORT`.

## Batch 65 (2026-09-21): DONE — reconnect flow + text chat (server + client, browser-verified)

User: "reconnect flow specially". Design: a dropped connection must never cost a match.

**Server (`server/index.js`):** every player gets a secret `token` (sent in `joined` as
`sessionToken`). On socket close the slot is NOT removed: the player is flagged `disconnected`
(`dc: true` in state/leaderboard payloads), is invulnerable/untargetable, others get a
`playerStatus:'disconnected'` + a system chat line, and a `RECONNECT_GRACE_MS` (30s) timer starts.
`{type:'reconnect', roomId, token}` swaps the new socket into the same player (same id, health,
score; old socket, if still open, is closed = takeover) and replies `joined` with
`reconnected:true`, `you:{health,alive,pos}`, and `chat` history (and replays `matchEnded` if the
match finished meanwhile). Bad token / unknown room / expired grace → `reconnectFailed`. `leave`
= deliberate quit, frees the slot immediately. Heartbeat ping every 10s (`HEARTBEAT_MS`; a socket that misses a full cycle is terminated) so a
half-open TCP connection is closed server-side too. Chat: `{type:'chat', text}` → whitespace-
collapsed, 200 chars, 400ms cooldown, 40-line room history, name set by the server; system lines
(joined/left/lost connection/reconnected) go through the same `pushChat`.

**Client:** `net.js` is now a self-healing connection (`connectWebSocket({onOpen,onMessage,
onStatus})`): any close schedules a retry with growing delay (cap 5s); a 2s watchdog abandons a
socket that has been silent >6s during a live match (half-open connections can sit "OPEN" for
minutes); `leaveConnection()` = `leave` + stop retrying + clear session. Session
(`wreckveil_session` = roomId+token) and a 1Hz loadout snapshot (`wreckveil_loadout`: ammo,
grenades, weapon) live in **sessionStorage** — survives a refresh of this tab, not a new tab /
browser restart, so nobody is silently teleported into an old match. `client.js` `onOpen` sends
`hello` then either `reconnect` (if a session exists, banner "Rejoining your match…") or
`listRooms`. `onJoined` has two resume paths: same page + scene already running →
`onRejoined()` (resync players/health/alive only, no scene re-init); fresh page (refresh) → full
init, then `applyLoadout` and, if the server says we were dead, `onLocalDeath`. `reconnectFailed`
clears the session and reloads to the dashboard. `matchEnded` clears the session. Quit buttons
call `leaveMatchAndReload()`. Chat UI (`ui.js`): `#chatLog` (fades after 12s, history lines start
faded), `#chatInput` opened with Enter while pointer-locked, closed by Enter/Esc/losing lock;
`state.chatOpen` gates movement keys and mouse fire; text is inserted with `textContent` only
(never HTML). Scoreboard shows an "offline" tag for `dc` players.

**Verification (real headless Chrome via CDP against the live server, plus ws clients):**
server: 30/30 checks on a test instance (token, drop→grace, invulnerable, reconnect keeps
id/state, takeover, bad token, chat relay/rate-limit/cap/history, grace expiry, `leave`).
Browser scenario `rc.mjs` 26/26 (3 consecutive runs): create room, chat both ways + HTML
injection check, hard socket drop → banner → rejoin same page with same token and no scene reset,
muted inbound socket → watchdog reconnect, page refresh mid-match resumes slot + chat history,
Quit frees the slot immediately and the next load is the dashboard. `rc2.mjs` 8/8: real fire
(pointer lock works in headless with a CDP click) spent 2 rounds, refresh kept 28/180, `pm2
restart` mid-match → `reconnectFailed` → back on dashboard with the session cleared. `rc3.mjs`
9/9: Enter opens/focuses the box, typing lands in it, a mouse click while typing does not fire,
Enter sends, Esc closes. No uncaught page errors in any run. Import/export cross-reference of all
client modules clean. Test harness scripts live in the session scratchpad only (not in the repo).

Not done / next ideas: first-person viewmodels are still plain black slabs (the real gun models
are only used on the character figures + dashboard preview); a "Regular" male body (see batch 64);
tank-top straps and shorts waistline never re-rendered after the last tweak.

## Batch 66 (2026-09-21): DONE — rejoin asks first, hair/gun/cloth polish, real first-person viewmodel

**Rejoin now asks permission.** After a refresh / reopened tab that still has a match session, the
player sees a "Rejoin your match?" prompt (`#rejoinPrompt`, ui.js `showRejoinPrompt`) instead of being
dropped into the match. Yes → `reconnect` as before. No → new server message `abandon {roomId, token}`:
`removePlayer(room, player, {clearStats:true})` takes them out of that room WITHOUT banking their
kills/deaths into `room.leftStats` (their scoreboard row disappears and a later join of that room by
the same name starts at 0/0 — the batch-4 name-reclaim can't resurrect them), the old token is dead,
and the client forgets the session. "Clear the stats" = that room's scoreboard stats; the account's
lifetime `player_stats` (persisted live per kill) are NOT rolled back. A same-page network blip (scene
already running) still resumes silently — only a fresh page asks. If the slot expired while the prompt
was open, Yes shows "That match has ended or your spot expired". Session now also stores `roomName`.
Verified in headless Chrome: `rc.mjs` 29/29 (prompt appears, does NOT auto-join, server slot still
held, Yes resumes), `rc4.mjs` 13/13 (No → others see playerLeft, row gone from leaderboard, session
cleared, no prompt on next load, old token → reconnectFailed, same-name rejoin starts 0/0), `rc2.mjs`
9/9 (ammo restore now goes through the prompt).

**Hair (Long / Buns looked bald on top with the fringe on the forehead).** Root cause: those meshes
are authored for the FEMALE head; the male head sits 4.41cm higher (+0.0045 back) — measured from
the two buzz-cut meshes, which share topology vertex-for-vertex. `dress.js` `HAIR_NATIVE` records which
body each mesh was authored for and `hairGeometry` shifts it by `MALE_HEAD_OVER_FEMALE` (sign flipped)
when worn on the other body (also fixes Side Part / Beard on the female). Verified front/side on both.

**Gun in the chest + proportions.** Measured: torso z −0.22…+0.09 at chest height, AKM rear end at
z −0.16 → 25cm inside the chest. `GUN_FIT` now has `slim` (height/width scale, AKM 0.72, shotgun 0.78,
glock 0.82; AKM also 0.9→0.84m long); anchor moved to (−0.13, 1.36, 0.30); left-hand grips pulled back
(reach is ~0.545) so the arms still meet the handguard. Gun materials restyled from near-black Phong
(#070707…) to lit gunmetal/wood by material NAME (`GUN_MATERIALS`) — also fixes the too-dark world guns.

**Cloth artifacts.** Orange skin patches at the shoulder: tee/tank/shorts `along` ranges started at 0
so shoulder-cap/hip-top vertices (t<0) were excluded → now start at −1. Jagged hems/waistline: the mask
is now a soft ramp (`EDGE_ALONG`, `EDGE_Y`) so the fragment discard cuts on the true boundary line, not
the mesh edges. Thin slits along the sleeve hems: UV-seam vertices share a position but not a normal,
so inflating each along its own normal pried the seam open — cloth now inflates along `inflN`, a normal
averaged over coincident vertices.

**First-person viewmodel (replaces the old placeholder boxes + the leftover "Hawk Marksman" model).**
`characters.js`: `buildFirstPersonRig` = the player's own dressed figure reduced to arms/hands
(`restrictToArms` filters triangles by arm-bone skin weight, so sleeves/gloves/skin tone match what
others see), parented under the camera, seated so the shoulders sit just outside the frustum;
`updateFirstPersonRig(rig, weaponId, pos, euler)` moves the gun anchor in camera space and reuses the
same two-arm IK (`poseArms`, now factored out of `updateFigure`). Rest pose is re-evaluated each frame
(`mixer.update(0)`) so IK never accumulates twist. Knife: right hand only, left arm parked behind the
camera. `viewmodel.js` owns the motion: per-weapon rest pose (`REST`), look-lag sway, breathing, walk/
sprint bob, sprint carry, recoil kick, reload dip timed to the weapon's real `reloadTime`, raise on
weapon switch / respawn, knife slash, muzzle flash at the real barrel tip, and its OWN render pass
(`renderViewmodel`, after the world render, `clearDepth`) so the gun never clips into walls. Tracer now
starts at the real muzzle. Hidden while dead. `client.js` feeds it the local appearance on join.
Verified in-game in headless Chrome (idle/walk/sprint/fire/reload/all four weapons/death/respawn,
no page errors) and in an isolated first-person harness.

Not done / worth a real look: viewmodel poses were tuned from headless renders — the exact feel of
sway/bob/recoil and the pistol's two-forearms look need a human eye; prone/crouch viewmodel not
specially tuned (camera just drops); grenade throw only kicks the gun (no throwing-hand animation);
the muzzle-flash sprite is a simple additive glow.

## Batch 67 (2026-09-21): DONE — viewmodel stability, real grenade + throw animation, sprint-fire straightening

**Gun "waving/bending" while turning the camera — fixed.** Cause: a look-sway I added in batch 66
(gun lags the camera, then springs back). It scaled with per-frame yaw, so it varied with frame rate,
and the IK arms visibly flexed to follow it. Removed entirely (and the idle breathing too):
standing still = perfectly still; only walking, firing, reloading, switching etc. move the gun.
Measured in headless Chrome during a continuous fast turn: gun anchor range 0.000 on all axes.
Also cut the per-frame cost: the rig no longer re-evaluates the idle animation each frame (the six IK
bones are reset from cached rest rotations), and `updateFirstPersonRig` skips the IK entirely when the
gun pose is identical to last frame (arms are solved relative to the camera, so turning never
invalidates them). Turning while standing: ~0.14 ms/frame (was ~1.5 ms avg, 7 ms spikes).

**Grenade.** No 3D grenade exists in the asset packs, so `public/js/grenadeModel.js` builds a
fragmentation ("pineapple") grenade procedurally: lathe body with a canvas grid texture + bump
(raised olive cells, dark grooves, grime), fuse neck/head/cap, a curved safety lever, pin + brass
ring (`userData.pin`). World grenades (`grenades.js`) use it (11 cm body radius, tumbling in
proportion to distance travelled); the red PointLight and emissive tint that made it a "red glowing
block" are gone. To swap in a downloaded model later: replace `buildGrenadeModel()`.

**Throw animation (first person).** `viewmodel.js` grenade state machine: lower (gun dips) → prep
(grenade rises into the right hand while the left hand comes up and pulls the pin; ring disappears)
→ hold (as long as G is held; trajectory preview unchanged) → wind (arm cocks back) → toss (arm snaps
forward; at the release point the grenade leaves the hand) → follow-through → gun raises again. The
grenade rides the same IK rig as a prop (`attachFirstPersonProp`, pseudo weapon id 4, left hand target
via `updateFirstPersonRig(..., leftTarget)`). The throw MESSAGE to the server and the throw sound are
now sent at the release point (a fraction of a second after G is released) with the aim captured at
release, so the world grenade appears when the arm lets go instead of before the wind-up. Firing,
reloading and starting a reload are blocked while the grenade is out; starting a grenade drops an
in-progress reload (same as switching weapons). A tap of G still completes the whole sequence
(~0.6 s to leave the hand); server logic/cooldown untouched. Dying or losing pointer lock cancels it.

**Sprint + fire.** While the trigger is held (and for 0.3 s after each shot) the sideways sprint carry
blends back to the straight aiming pose (fast, 18/s) and eases back into the carry after (8/s); walk-bob
amplitude also drops to the walking level while firing. `setTriggerHeld` is driven from the fire
handlers in weapons.js (`stopFiring` clears it).

Verified in headless Chrome: rc8 (hold G, release: server sees the throw, count 3→2, world grenade
renders, no errors), rc9 (sprint / sprint+fire / after — frames confirm the gun squares up while firing
and returns), rc7 (turn stability + timing), plus rc and rc3 regressions (29/29, 9/9). Not verified by
a human eye: the exact feel/timing of the throw and the pin-pull hand motion.

## Batch 68 (2026-09-21): DONE — real M67 grenade + 5 sounds, bounce sounds, dropped-player immunity guard, chat hint

**Assets (user supplied 5 files, dropped in the project root; originals still in ~/Downloads):**
`m67_hand_grenade.glb` (Sketchfab "M67 Hand Grenade" by Loukey, **CC BY 4.0 — attribution required**, shown
in the dashboard Settings tab "Credits") and 4 clips. The GLB was downscaled offline (3× 2048px PNG → 1024px,
8.8 MB → 2.7 MB, ~48 MB → ~12 MB of GPU texture memory) into `public/models/grenade/m67_hand_grenade.glb`.
It is ONE mesh of 2,904 tris whose node transforms already stand it upright (Sketchfab ×6.4 chain); the mesh
is really 5 islands: the body (lever is welded into it — can't be separated) and 4 tiny ones = pin ring, shaft,
ends. `grenadeModel.js` splits those 4 into a `GrenadePin` group at load (union-find over welded vertices;
skips the split if the island count isn't 5), normalises to body radius 1 at the origin, and exposes
`createGrenade()` (M67 once loaded, the old procedural grenade as a stand-in before that / on failure),
`setPinPull(g, 0..1)` (slides the pin out along raw +Y, hides at 1), `setPinVisible`, `onGrenadeModelReady`.
NB `Object3D.clone` JSON-copies userData, so parts are found by NAME (`GrenadePin`), never via userData.
Sounds cut with ffmpeg into `public/sounds/`: `grenade-pin.mp3` (0.48 s, the bright metallic ring) and
`grenade-throw.mp3` (0.145 s, the low tonal "effort" thump, boosted ×7 — very quiet in the source) are the two
halves of the user's "pin+throw" clip, split at its silent gap (475–665 ms); `grenade-ground.mp3` (0.5 s),
`grenade-wall.mp3` (0.26 s), `grenade-blast.mp3` (1.96 s; replaces `grenade-explosion.mp3`, which is now unused).
Blast is ~1.2× louder than the old clip so its play gain went 3.5 → 2.9 (same perceived level).

**Where each plays (3D preserved):** tick (unchanged), blast, and the new bounces are all POSITIONAL
(`playPositionalOneShot`: HRTF wet/dry blend, distance falloff, wall-occlusion muffling). Pin pull and throw
are flat/local (your own hands, like your own gunfire) — other players do NOT hear a thrower's pin/throw
(they hear the tick from when the grenade appears, as before). Ear-ring on `hit` weapon 'Grenade' unchanged.
**Server:** `grenadeBounce {id,pos,surface:'ground'|'wall',speed}` broadcast to the room on real impacts
(≥2.5 units/s, ≤1 per grenade per 150 ms). Implemented as read-only bookkeeping (`noteGrenadeImpact`) inside
the existing collision code — verified by diff vs HEAD that the only pre-existing physics line touched is the
ground-bounce line where the note call was inserted (velocity math identical). Client plays
`sfx.grenadeBounce(pos, surface, speed)` (louder for harder hits).

**First person:** the M67 is the hand prop (`viewmodel.js`, scale 0.05, offset (0,.085,-.005) so the body sits
on top of the fist); pin slides out at prep 50–67% and the pin sound fires exactly once at that moment
(`onGrenadePin` hook registered by weapons.js; also fires if a tap skips ahead). World grenades: M67 at 11 cm
body radius, pin hidden (already pulled), rolls as it travels; the old red PointLight/emissive are gone.

**Dropped-player immunity (asked mid-batch, confirmed + hardened):** every damage path already skipped players
with `disconnected` (handleAttack, explodeGrenade, pickups); `applyDamage` and `killByEnvironment` now ALSO
refuse a `disconnected` target, so no current/future source can hurt a held slot. Also true while the "Rejoin
your match?" prompt is up (the slot stays held until Yes). Live test `dc_immunity.mjs` 10/10: AKM/shotgun/Glock/
knife from 4 sides + a grenade dropped on the victim do nothing; after reconnecting the same attacks land.
Side note (not changed): after Yes-reconnect there is no spawn protection while the scene loads.

**Chat discoverability (user couldn't find it):** chat opens with Enter in a match (unchanged) but nothing said
so — added an "Enter chat" hint at the lower left of the HUD (hidden while the box is open) and an Enter row in
the Controls list.

**Tests (real headless Chrome / live server), all passing:** `gren_physics.mjs` (12 rooms × 6 rounds, both maps,
~10.5k tick samples over 3 runs: no grenade position inside any wall/door/slab, no path segment between ticks
crosses one, never below ground/stairs, thrown-at-mansion-wall never gets past the face and announces a WALL
bounce, grenades dropped on 4 stairs and the rooftop rest on top, every grenade reaches BOTH clients every
tick = globally visible); `rc10.mjs` 15/15 ×3 (grenade on the player: tick/bounce/blast are 3D, ring is flat
and plays after the blast; far grenade: blast heard in 3D, NO ring, NO damage; own pin + throw flat; thrown
grenade ticks in 3D; other player receives it); rc/rc3/rc8 regressions. Test bug worth remembering: a player
respawns at a NEW position after dying — measure "outside the radius" from the current state, not the join pos.
Not verified by a human eye: how the M67 grip/orientation feels in hand and the pin-pull hand motion.

## Batch 69 (2026-09-21): DONE — weapon fire/reload animations, muzzle flash, casings; interactive dashboard character

**Weapon animation (first person; `gunanim.js` + `weaponfx.js` + `viewmodel.js`).** The three FBX guns are each one
mesh but consist of separate triangle islands; `splitGunParts` (characters.js, in `normalizeGun`) splits them by
where each island sits in the gun's bounding box (fractions, unit-independent) while PRESERVING per-triangle
materials (the FBX is non-indexed with per-material groups): Glock **slide** (incl. sights/serrations; the barrel
stays), shotgun **pump** (biggest island), AKM **magazine** (island reaching the bottom). No separate AKM
charging handle or Glock magazine exists, so `gunanim.js` adds small stand-in props (`FxHandle`, `FxMag`,
`FxShell`). Part API: `gunPart / setPartOffset / setPartVisible / cloneGunPartWorld` (offsets in GUN space, metres:
+X barrel, +Y up, +Z right). `updateFirstPersonRig(..., opts)` gained `leftGrip` (gun-space support-hand grip, so the
hand follows the pump / goes to the mag / belt) and a generic change-signature that skips the IK when nothing moved.
- **Fire:** AKM handle/bolt reciprocates every shot + brass ejects right; shotgun big fireball, 3 smoke puffs,
  heavy kick, pump back 0.20–0.33 s / forward 0.48–0.665 s (matches the two clacks of `shotgunpump.mp3`) with the
  left hand riding the fore-end and the red shell ejecting at the back stroke; Glock slide snaps back/forward, brass
  ejects, and on the LAST round the slide stays locked back until the reload releases it (`setViewmodelAmmo`).
  Muzzle flash = round glow + 12-point star + a real PointLight lighting gun/hands (sizes per gun).
- **Reload:** timelines timed to the transients measured in the recordings: AKM mag out 0.26 s (real mag part falls
  as a physical prop), new mag rides the left hand in 1.25–1.735 s, seats at 1.735/2.07 s, handle racked 3.16/3.33 s;
  Glock mag out 0.24 s, in 1.1–1.28 s, slide rack 1.9 s / release 2.19 s; shotgun 4 shells at 1.0/1.45/1.9/2.35 s
  (hand ping-pongs belt↔port with a shell prop), closing pump 2.82/3.05 s. The gun is lifted and rolled toward the
  eyes for the reload (otherwise the well is below the screen edge). Weapon switch / grenade cancels cleanly.
- **`weaponfx.js`:** pooled world-space casings (rifle/pistol/shell) with gravity, floor bounce and a synthesized
  positional clink on first contact (`sfx.casingDrop`; no recorded clip exists), smoke sprites, dropped-mag props.
- Verified with a deterministic frame harness (real viewmodel, fixed 60 fps, contact sheets of every cycle) and in
  the real game (`rc14`: burst, pump, empty Glock, all 3 reloads refill correctly, switch-mid-reload keeps ammo).
- **Not done / limits:** the AKM charging handle is a prop (handle is on the right side and is only lightly visible
  from the first-person angle); the reload hand grabs with a fixed palm orientation (no per-finger grip); the pistol's
  spent mag and the two-forearm look are approximate; other players' guns do NOT show muzzle flash/casings/slide
  yet (only the local first-person view was animated); casings only bounce on the floor plane (not walls); Glock
  new-mag prop is only briefly visible. Feel/timing need a human look.

**Dashboard character preview is now interactive.** No more auto-spin: drag to rotate (inertia on release), vertical
drag tilts the camera, pinch or scroll to zoom, double-click/tap resets, ⟲ ⟳ turn buttons; pose chips (Idle / Walk /
Run / Crouch, cross-faded), weapon chips (AKM / Shotgun / Pistol / Knife) and a 📷 button that saves a transparent PNG.
One code path for mouse/touch/pen (pointer events, `touch-action:none`). The character starts facing the camera.
Same controls on the Play and Character tabs (`preview.js`, `.pvBar` CSS). Test: `rc13` 6/6.

**Batch 69 addenda (same day):** other players' shots now show a muzzle flash (+ a wisp of smoke) on THEIR gun —
`getRemoteGunMuzzle` (characters.js) + pooled `spawnMuzzleFlash` (weaponfx.js), triggered from `handleRemoteShot`
(test `rc15`: 5 remote shots → 5 flash sprites). Their casings / slide / pump are still not animated. Dashboard Play
pane got rotating one-line tips (`TIPS` in ui.js); the tip uses `width:0;min-width:100%` because a long tip
previously widened the Play card and pushed the character card sideways (caught by the preview test).

## Batch 70 (2026-09-23): DONE — 8 named "Operators" (Mixamo, retargeted), real animation-freeze bug found and fixed

**Assets.** User dropped 8 correctly-exported Mixamo FBX characters (T-pose, FBX Binary — a first
batch of 7 came out as unusable FBX 6.1 because "FBX 6.1" was picked instead of "FBX Binary" in
Mixamo's own download dialog; caught by checking the raw file header version bytes before touching
anything, re-requested and this time verified 7700 across all 8 before proceeding). Renamed onto
movie/character names by gender+look, checked by actually rendering each one first (not guessed
from filename): **Frank** (Ch11, stealth suit), **Hanzo** (Ch24, ninja), **Rico** (Ely, armored
soldier), **Neo** (Remy, casual), **Katniss** (Erika Archer, hooded archer), **Selene** (Eve/Space
Pirate), **Diana** (Maria, armored warrior), **Furiosa** (Medea, bald sci-fi warrior). 3 of the 12
originally supplied were excluded and said so plainly rather than silently dropped: a literal demon
monster, a mocap reference dummy (`passive_marker_man`), and a duplicate of Maria holding a prop.
A 9th (Peasant Girl, floor-length dress) was proposed then dropped per the user's own call.

**Why this was real engineering, not a data add:** these use Mixamo's own skeleton (`mixamorig`-
prefixed bone names) — a totally different rig from the Quaternius "Custom" bodies, with genuinely
different local bind-rotation conventions per bone (measured directly: Quaternius's `upperarm_r`
sits ~90° from identity in its own local frame, mixamorig's `RightArm` sits near identity) — so our
existing Idle/Walk/Sprint/Crouch animation library couldn't just be renamed onto it.

- **`public/js/retarget.js`**: bind-pose-delta retargeting (the standard, convention-independent
  technique) — measures each bone's WORLD-space rotation delta from its own bind pose on the source
  (Quaternius) rig at each sampled frame, applies that same world delta to the target bone's own
  bind pose, converts back to target-local via the target's own (freshly recomputed, parent-first)
  hierarchy. `QUAT_TO_MIXAMO`: a complete 65-bone map (every Quaternius bone incl. all finger
  segments, both are UE-mannequin-derived so this is a real 1:1, not an approximation) built from
  directly inspecting both live skeletons in a browser, not guessed. **A real, serious bug caught
  only by direct verification, not visual spot-checking**: the internal scrub mixer had
  `action.paused = true` (meant defensively, to stop it "auto-advancing" — except nothing else ever
  drove this private mixer, so there was nothing to guard against) — three.js forces an action's own
  deltaTime to 0 whenever `paused` is true, and `mixer.setTime()` routes through that same per-action
  update, so the scrub never actually moved past the first frame: EVERY retargeted clip for EVERY
  operator was silently baking one static pose repeated for the whole duration. This looked correct
  in an early render (a single frame of Walk_Loop happens to look like a natural mid-stride pose,
  and different CLIPS produce different frozen poses, which together read as "a walk cycle" at a
  glance) — only caught by directly sampling the SAME clip's own baked bone quaternions at several
  different `t`s and finding them byte-identical. Fixed by removing the pause; re-verified the same
  way (now genuinely different per-frame values) and by rendering two timestamps of one Walk_Loop
  side by side (visibly different leg positions).
- **`public/js/operators.js`**: the 8-entry roster (id/label/gender, data lives in
  `shared/appearance.js` so the server's sanitizer sees the same catalog); `mergeSkeletons()` fixes
  a real quirk in these files — each skinned mesh arrived with its OWN duplicate full copy of the
  skeleton (confirmed by traversing the raw scene graph and finding e.g. 3 separate top-level
  `mixamorigHips` root bones) rather than sharing one, which would leave every mesh but the one the
  mixer happened to bind to frozen in bind pose, plus leaves duplicate-named bones a later
  `getObjectByName` could grab by mistake — remapped via the same skinIndex-by-bone-name technique
  already used for hair in `dress.js`, then the orphaned duplicate chains are actually removed from
  the tree, not just left unused. Height-normalized to the same 1.82 units as the Quaternius bodies
  (measured bounding box, same fit-to-target pattern as the guns/grenade — these FBX arrive in real
  centimeters, confirmed once rather than assumed twice). Operators load lazily per-id (~5-60MB
  each, ~195MB for all 8 — not worth eager-loading for players who never open Operators mode; fine
  over LAN, this project's actual deployment).
- **`characters.js` integration**: `buildCharacterFigure` branches on `appearance.mode` and returns
  the SAME `fig` shape either way (`bones{spine_03,upperarm_r,...}` populated via the retarget map's
  keys instead of literal names) — every downstream consumer (arm IK, first-person rig, remote
  animation, gun attachment) needed zero changes beyond that, the same way it already didn't care
  about male vs female. `attachAimAndGuns()` factored out of the original inline block for reuse by
  both body types — **caught and fixed a self-inflicted bug from that refactor**: the extracted
  helper's function body was composed but never actually spliced back into the file, so
  `buildOperatorFigure` immediately threw `attachAimAndGuns is not defined` the first time it ran
  live (caught by the browser test, not the syntax checker — a `node --check` can't catch a missing
  top-level declaration that's only ever referenced, never assigned wrong). Two more real bugs found
  only by testing the actual first-person path specifically (not just the dashboard preview): (1)
  `armsOnlyGeometry`'s Quaternius-only bone-name regex matched nothing on a mixamorig skeleton,
  silently producing zero triangles and invisible first-person arms for every operator — fixed with
  a second regex (`mixamorig(Left|Right)(Shoulder|Arm|ForeArm|Hand)`, prefix-matches finger bones
  for free the same way the Quaternius one does); (2) that same function assumed `geometry.index`
  always exists (true for the Quaternius glTF bodies, not true for some of these FBX meshes,
  non-indexed) — crashed for every single-mesh operator specifically, caught via a standalone rig
  dump script after noticing the in-game first-person view still showed plain default skin instead
  of the saved operator. (3) `setViewmodelAppearance`'s "did the body change, do I need to rebuild
  instead of just re-dress" check only compared `character` (male/female) — which stays `'male'`
  even in operator mode (present but unused) — so switching into Operators (or between two
  different Operators) never tripped a rebuild, silently leaving whatever body was already built and
  just re-dressing it with the new appearance's fields. This is exactly why (2) above was findable
  at all: fixing the crash alone wasn't enough, the stale-figure bug meant the fixed code path
  wasn't even being reached. Fixed with the same `mode`/`operator`-aware check already used in
  `preview.js`'s equivalent function (should have been applied there too the first time; wasn't).
  `redressFirstPersonRig`/`redressFigure` branch the same way to call the operator's `stripClothes`
  toggle instead of the Quaternius-only `dressFigure`. `getFigureAnimationClip(fig, name)` added
  since operator clips live on that operator's own retargeted set, not the shared Quaternius
  `template.clips` (`setRemoteAnim`/`preview.js` updated to read from `fig.clipsSource`).
  `createRemote`'s retry-when-not-ready path generalized from "template not loaded" to "figure came
  back null for any reason" (an operator not finished loading is the new case), with a new
  `retryPendingCreates()` also called after each operator's own load finishes, not just the shared
  template's.

**Strip-clothes toggle** (the "future closet support" ask): real per-mesh visibility, not a stub —
works for the 2 operators whose outfit is genuinely separate geometry (Neo: Body/Tops/Bottoms/Shoes/
Hair as distinct meshes; Katniss: a distinct Clothes mesh) found by inspecting each FBX's own mesh
list, not assumed uniform. The other 6 are one fused body+clothes mesh with nothing to hide — the
toggle is visibly disabled with an explanatory note there rather than silently doing nothing.
Where it does work, stripping reveals the underlying body mesh is NOT a complete nude figure (real,
visible gaps/incomplete coverage) — an honest limitation of the source asset, said plainly rather
than hidden; a real per-operator wardrobe is future work.

**UI**: Character tab gets a Custom/Operators switch (`shared/appearance.js`'s `MODES`), an operator
grid grouped by gender, and the strip-clothes toggle with its disabled-state explanation.
`preview.js`'s own body-change detection got the same `mode`/`operator`-aware fix as viewmodel.js's
(caught by the same class of bug, fixed the same way, before it ever reached the live game).

**Verified, in order, each with real evidence not assumption**: retargeted bind pose + walk/sprint/
crouch poses rendered directly (natural stance, correct stride/lean/crouch, no broken joints) before
touching characters.js at all; the actual frozen-clip bug found by sampling baked quaternions at
multiple times and only trusting a render after they differed; full dashboard round trip in headless
Chrome (mode switch, 8-name grid, live preview per pick, toggle enabled/disabled correctly per
operator) — caught the `attachAimAndGuns` splice bug here; saved an operator, joined a real match,
found the stale-figure bug by comparing the LIVE first-person rig's actual mesh/material against
what should have been loaded (not by eyeballing a screenshot alone, though the screenshot before and
after the fix is the clearest evidence: plain default arms holding the AKM before, Rico's dark
armored gauntlet after); a second client's own scene independently confirmed the correct mesh name
(`Maria_J_J_Ong`/`maria_M1`) for a saved Diana, not just the appearance JSON round-tripping over the
network; the full pre-existing regression suite (reconnect, chat, grenade sound/blast, weapon fire/
reload, disconnected-player immunity, dashboard preview drag/spin) re-run clean afterward to confirm
none of this broke anything unrelated. `demo` test account's saved appearance reset back to Custom
before finishing, so it isn't left in a test state for the user's own next look.

**Not done / said plainly**: no closet editing for Operators beyond the one strip-clothes toggle;
their own bundled facial/eye materials aren't tinted or adjustable; remote OTHER players' Operator
figures don't get any live redress either (matches the existing Custom-body behavior — appearance is
fixed for the whole match once broadcast, by original design, not something this batch changed).

## Batch 71 (2026-09-23): DONE — fixed Operators' hands-behind-back / invisible-gun bug (scale mismatch)

User screenshot: Katniss holding the AKM with her hands down/behind instead of gripping it forward.
Real bug, found by measuring rather than guessing: `operators.js` height-normalizes each predefined
body via `model.scale.setScalar(s)` (their FBX arrives at real centimeters, s≈0.01, vs the Quaternius
bodies whose geometry is already authored at game scale and never has model.scale touched at all).
`attachAimAndGuns` (shared by both body types) has several FIXED constants — `AIM_POS` (where the
gun's grip point sits), `GUN_IN_HAND_OFFSET` — tuned assuming "1 local unit = 1 game unit", which
`model.scale` breaks for anything parented under `model`. Measured directly before touching code:
the aim target ended up ~1.4 units from the shoulder (impossible for a ~0.3-long two-bone arm, so
the IK maxed out reaching for it — the hands-behind-back look) and the held gun itself rendered
~100x too small (0.0085 units long instead of the intended 0.84 — invisible at that scale, not
merely small). Fixed by computing `worldScale = model.scale.x` once in `attachAimAndGuns` (1 for
Quaternius bodies, a no-op there) and dividing the position constants by it before use, plus giving
every held gun/prop its own `1/worldScale` scale to cancel the inherited shrink.

Verified precisely, not just re-screenshotted: dumped shoulder/hand/aim world positions and the
gun's actual measured bounding size before and after (reach went from 1.44→0.38, well inside the arm's
real reach; gun length went from 0.0085→0.8447, matching the intended 0.84) across 3 different
operators (Frank, Katniss, Diana) so the fix isn't coincidentally right for just one; rendered all 3
holding the AKM to confirm a natural forward two-handed grip; reproduced the user's exact screenshot
(Katniss / Walk / AKM in the dashboard preview) before and after. Re-ran the full existing regression
suite (reconnect, chat, grenade, weapon fire/reload, disconnected-player immunity, operator UI/match)
clean afterward since this touches shared figure-building code used by every player, not just
Operators. `demo` test account's appearance reset back to Custom before finishing.

## Batch 72 (2026-09-23): DONE — crouch "looking at the ground" and prone (curled + clipping + yaw wobble) fixed

User: all characters (Custom and Operator both) look down instead of forward while crouching, and
prone has the head going through the ground; then mid-fix, a second real bug: rotating the camera
sideways while prone makes the character rotate in and out of the ground. All three are shared
code (`characters.js`, used by every body type identically), found and fixed by rendering the actual
poses directly rather than guessing from the complaint text alone.

**Crouch head-down.** Rendered `Crouch_Idle_Loop` directly: the stock clip bakes a real, pronounced
downward tilt into the neck/head specifically (on top of the torso's own forward lean), reading as
staring at the ground. First attempt (reset neck+head to their BIND-pose LOCAL rotation each frame
while crouching, so any animation-driven tilt beyond bind is removed) helped but wasn't enough —
rendered again and the head still visibly pitched down, because a bind-LOCAL reset still inherits
whatever the torso's CURRENT lean is (crouch genuinely leans the torso forward, that's correct).
Fixed properly: the head is now pinned to its bind-pose WORLD rotation (captured once at figure-build
time) instead, so it reads level/forward regardless of how far the torso itself leans. Scoped to
crouch only (`fig.crouch`, newly tracked — set from `rp.crouch` for remote figures,
`previewPose==='Crouch_Idle_Loop'` for the dashboard preview) — walk/idle/sprint were never part of
the complaint and are untouched.

**Prone, three separate real bugs, not one:**
1. **Curled/fetal shape.** The base pose laid flat was `Idle_Loop` (a standing idle with natural knee
   bend/weight shift) — rotating that -90° about X folds the bent knees toward the torso instead of
   producing a straight line. Rendered `Idle_Loop` AND `Crouch_Idle_Loop` both laid flat to confirm
   it's the bent knees specifically (both curl), then tried the animation library's `A_TPose` (dead
   straight legs/spine) — clean straight silhouette laid flat, confirmed by rendering top-down. The
   prone arm-IK already overrides the arms regardless of which clip is playing, so T-pose's own
   arms-out shape never actually shows; only the leg/torso shape mattered for picking a base pose.
2. **Head/body through the ground.** Measured directly: with the old pivot-only approach, the head
   sat 2cm BELOW y=0 — real clipping, not a rounding nicety. Fixed with a real ground-clamp: the
   figure's own bounding box is measured once (the prone pose is now fixed/A_TPose, so the shape
   doesn't change frame to frame — no need to remeasure every frame) and the model is shifted to sit
   exactly at ground level, computed from the actual geometry rather than a guessed constant, so it's
   correct for any body's proportions, Custom or Operator alike. Also re-tuned `AIM_POS_PRONE`
   (the gun ended up floating in a completely different place once the base pose changed from
   Idle_Loop's own lean to A_TPose's near-zero lean) — iterated by rendering the actual result until
   the gun sat forward at chest height, gripped naturally, instead of poking into the dirt or floating
   above the head.
3. **Rotating view makes them wobble in/out of the ground (found mid-fix, from a follow-up report).**
   Root cause: the flatten rotation (`rotation.x = -90°`) and the yaw-follow rotation (`rotation.y`,
   driven every frame by wherever that player is aiming) were BOTH being set on the same object
   (`fig.root`). three.js resolves an object's rotation as one fixed-order Euler sequence, not as
   independent per-axis rotations — so changing yaw while X was also rotated visibly pulled the "flat"
   plane out of true horizontal as the player's own aim direction changed. Fixed by moving the flatten
   rotation onto a new child group (`poseGroup`, inserted between `root` and `model` in both the
   Custom and Operator figure-build paths) so root.rotation.y is a pure yaw spin and
   poseGroup.rotation.x is a pure flatten, on two different objects with no shared-object Euler
   interaction. Verified precisely, not just re-screenshotted: swept yaw through a full circle (9
   angles, 0 to a full 2π and back) via the real remote-player pipeline and measured the figure's
   actual world bounding box at each step — minY held at exactly 0.02 at every single angle, zero
   variation, confirming the wobble is gone rather than just reduced.

All three verified on both a Custom body and an Operator (Rico) side by side, and the full existing
regression suite (reconnect, chat, grenade, weapon fire/reload, disconnected-player immunity,
operator UI/match) re-run clean afterward since this touches the shared figure-build/animate code
every player goes through. `demo` test account reset back to Custom before finishing.
