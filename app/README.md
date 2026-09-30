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
  (see `MainActivity.GAME_URL`) starts loading immediately, with a splash video
  (`res/raw/splash.mp4`, a real clip the user supplied — sped up 1.5x, full original frame kept,
  not cropped) playing on top of it via a `TextureView` + `MediaPlayer` (not
  `android.widget.VideoView`, which wraps a `SurfaceView` that defaults to compositing BEHIND the
  WebView's own hardware layer — a live-reported bug, "sound comes, no visual"; `TextureView`
  composites through the normal view hierarchy so it just works). The two run in parallel; the
  video plays exactly once, then fades out, regardless of whether the page has finished loading
  yet (an earlier version waited for both and looped the video if the page wasn't ready, which
  read as a stuck/broken splash on a real device). Handles JS/localStorage, keeps in-game
  navigation inside the app, hides the system status/nav bars, and shows a pull-to-refresh retry
  screen if the game can't be reached. Orientation is locked `userLandscape` (this is a landscape
  shooter) — an earlier attempt unlocked this to fix a real "login buttons unreachable" bug, which
  traded one bug for a worse one (portrait-only); that's now fixed properly at the source instead
  (`public/index.html`'s `.screen` CSS scrolls instead of clipping when content is taller than the
  viewport), so the app stays landscape-locked throughout. There used to be a separate
  `SplashActivity` shown for a fixed delay BEFORE `MainActivity` (and its WebView) even existed, so
  the game never started loading during the splash at all — merged away once an actual splash
  video needed the WebView loading underneath it in parallel.

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
