# Wreckveil — Android app (WebView container)

A minimal Android wrapper around the live web game. There is **no native game logic here** —
the whole game keeps running exactly as it does in a desktop browser; this just gives it an
installable app icon and a full-screen container to run inside on a phone/tablet.

- `MainActivity` — a single Activity: a full-screen `WebView` pointed at `https://game.antiszn.com`
  (see `MainActivity.GAME_URL`) starts loading immediately, with a splash video
  (`res/raw/splash.mp4`, a real clip the user supplied — sped up 1.5x, full original frame kept,
  not cropped) playing on top of it. The two run in parallel; the video overlay only fades out once
  it has played through in full AND the page has actually finished loading (whichever takes
  longer), so the game is never revealed mid-load, and a slow connection just loops the video
  instead of freezing on a dead last frame. Handles JS/localStorage, keeps in-game navigation
  inside the app, hides the system status/nav bars, and shows a pull-to-refresh retry screen if the
  game can't be reached. Orientation is left `unspecified` (free rotation, matching a normal app)
  rather than locked — the web client already locks to landscape itself once a match actually
  starts (see `public/js/touchControls.js`); an earlier version of this app force-locked landscape
  at the Activity level instead, which cramped the login form off the bottom of the screen on a
  real phone (a live-reported bug: fixed by removing that lock, not by touching the web CSS).
  There used to be a separate `SplashActivity` shown for a fixed delay BEFORE `MainActivity` (and
  its WebView) even existed, so the game never started loading during the splash at all — merged
  away once an actual splash video needed the WebView loading underneath it in parallel.

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

- **App icon** — a simple placeholder vector mark (`ic_launcher_foreground.xml`); the splash
  screen now uses a real video (`res/raw/splash.mp4`), but the icon is still a placeholder.
- **Signing** — this is a *debug*-signed APK (Android's own auto-generated debug keystore), fine
  for sideloading/testing, not for a Play Store release. A real release keystore + signing config
  would be a separate, deliberate step before any store submission.
- **iOS** — not started; nothing here is iOS-specific or portable to it as-is (this is a plain
  native Android WebView shell, not a cross-platform framework like Capacitor/Cordova).
