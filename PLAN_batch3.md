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
