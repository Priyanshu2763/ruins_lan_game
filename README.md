# Ruins — LAN FPP Shooter

Browser-based, first-person, LAN multiplayer. No install for players — just a browser.

## Run it (host)

```
npm install   # already done
npm start
```

The terminal prints a LAN address like `http://192.168.x.x:3000`. Open that yourself, and send it to friends on the **same WiFi/network**.

## Play

1. Enter a name.
2. Host: type a room name, click "Create Room".
3. Everyone else: pick that room from the list (auto-refreshes).
4. Click into the game to lock the mouse.

Controls: **WASD** move, **Shift** sprint, **Space** jump, **mouse** look, **left click** fire/swing, **1-4** switch weapon (Vulcan Rifle / Hawk Marksman / Sidearm Pistol / Combat Knife), **Tab** scoreboard.

Kills/deaths are tracked live and shown on Tab. Died? You respawn in 3 seconds.

## Notes / limits

- Up to 10 players per room, smooth target is ~5-8 on a home WiFi/LAN.
- Works over LAN only (no internet/WAN matchmaking) — that needs a relay server, out of scope for this build.
- No anti-cheat — fine for playing with friends, not for public release.
- Map, weapons, spawn points all live in `shared/gameData.js` if you want to tweak numbers (damage, fire rate, wall layout) without touching game logic.
