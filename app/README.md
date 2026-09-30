# Wreckveil — Android app (WebView container)

A minimal Android wrapper around the live web game. There is **no native game logic here** —
the whole game keeps running exactly as it does in a desktop browser; this just gives it an
installable app icon and a full-screen container to run inside on a phone/tablet.

- **App icon** — the real game logo (`public/favicon.png`, already a self-contained circular
  badge with a transparent background), scaled to ~66% of the adaptive-icon canvas and centered
  as `mipmap-xxxhdpi/ic_launcher_foreground.png` so no launcher mask shape (circle/squircle/
  rounded-square) clips the badge's own edges. Background layer is the flat brand color
  (`@color/splash_background`).
- `MainActivity` — a single Activity: a full-screen `WebView` pointed at `https://game.antiszn.com`
  (see `MainActivity.GAME_URL`) starts loading immediately — before any splash UI — and keeps
  loading in the background through the entire cold-start sequence below. Orientation is locked
  `userLandscape` (this is a landscape shooter); an earlier attempt unlocked this to fix a real
  "login buttons unreachable" bug, which traded one bug for a worse one (portrait-only) — fixed
  properly at the source instead (`public/index.html`'s `.screen` CSS scrolls instead of clipping
  when content is taller than the viewport), so the app stays landscape-locked throughout.

  **Cold-start sequence** (strictly ordered — each stage only starts once the previous one has
  actually finished, chained via callbacks, never independent timers that could drift):
  1. `splashVideo` (`res/raw/splash.mp4`, a real clip the user supplied, sped up 1.5x, kept at its
     full frame — no crop/stretch) fades in, plays once, fades out. Driven by a `TextureView` +
     `MediaPlayer` directly, not `android.widget.VideoView` (which wraps a `SurfaceView` that
     defaults to compositing BEHIND the WebView's own hardware layer — a live-reported bug,
     "sound comes, no visual"; `TextureView` composites through the normal view hierarchy so it
     just works).
  2. `loadingScreen`: the banner image (`res/drawable/splash_banner.jpg`, used as supplied) doubles
     as a real BGMI-style loading screen — a thin gold progress bar + percentage near the bottom,
     driven by REAL load progress reported from the web side
     (`public/js/characters.js`'s `reportLoadProgress` → `window.AndroidBridge.onLoadProgress`, a
     `@JavascriptInterface`), not a fixed timer. An earlier version revealed the game after a
     guessed duration regardless of whether loading had actually finished — exactly the failure
     mode behind a live "gun/hands invisible" report on a slow connection; tying the reveal to a
     real signal fixes that at the root. A 20s safety timeout still reveals anyway if progress
     genuinely stalls, so a broken load can't strand the player indefinitely.
  3. The backdrop fades out, revealing the (by now loaded) game underneath.

  `offlineOverlay` is independent of all of the above — a themed dialog (matching the app's own
  dark/gold palette, not Android's generic system alert style) with a RETRY button, shown/hidden
  purely by the WebView's own load-failure/success signals, so it can interrupt any stage above at
  any point (or appear later, if the connection drops mid-match). Replaces an earlier bare
  "blank page + silently-enabled pull-to-refresh" fallback with one clear, discoverable recovery
  path.

  There used to be a separate `SplashActivity` shown for a fixed delay BEFORE `MainActivity` (and
  its WebView) even existed, so the game never started loading during the splash at all — merged
  away once an actual splash video needed the WebView loading underneath it in parallel.

- **Static asset caching** (`server/index.js`) — `/models`, `/images`, `/sounds` are now served
  with `Cache-Control: max-age=1d` (vendor JS libraries get 30d), so a repeat app open within that
  window re-uses the WebView's own cache instead of re-fetching potentially 100s of MB every
  single time — a live report ("takes too much time" on repeat opens) traced to `express.static()`
  sending no cache headers at all by default. `index.html`/`public/js/*` (actively iterated on
  every batch of this project) are deliberately left uncached, so a deploy is still picked up
  immediately rather than needing a cache-clear.

## Debugging a real device

Debug builds pipe every WebView `console.log`/`warn`/`error` to `adb logcat` under the tag
`WreckveilWeb` (`adb logcat -s WreckveilWeb`), and enable `chrome://inspect` remote DevTools
from a desktop Chrome over a USB/adb connection — both gated on the app being debuggable, so
neither is present in a release build.

## Building

Requires a JDK (17) and either Android Studio or the command-line SDK. From this directory:

```sh
./gradlew assembleDebug
```

The APK lands at `app/build/outputs/apk/debug/app-debug.apk`. A prebuilt copy for install/testing
is checked into [`releases/`](releases/) — see that folder for the current version.

CI (`.github/workflows/android-app.yml` at the repo root) rebuilds and uploads the debug APK as
a workflow artifact on every push that touches this folder.

## Not done yet / known placeholder status

- **Signing** — this is a *debug*-signed APK (Android's own auto-generated debug keystore), fine
  for sideloading/testing, not for a Play Store release. A real release keystore + signing config
  would be a separate, deliberate step before any store submission.
- **iOS** — not started; nothing here is iOS-specific or portable to it as-is (this is a plain
  native Android WebView shell, not a cross-platform framework like Capacitor/Cordova).
