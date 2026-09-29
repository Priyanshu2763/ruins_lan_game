# Wreckveil — Android app (WebView container)

A minimal Android wrapper around the live web game. There is **no native game logic here** —
the whole game keeps running exactly as it does in a desktop browser; this just gives it an
installable app icon and a full-screen container to run inside on a phone/tablet.

- `SplashActivity` — a placeholder splash screen (solid background + wordmark, ~1.2s) shown on
  cold start. Real splash artwork/logo is still to come; swap `res/drawable/ic_launcher_foreground.xml`,
  `res/values/colors.xml` and `activity_splash.xml` once it's available.
- `MainActivity` — a full-screen `WebView` pointed at `https://game.antiszn.com` (see
  `MainActivity.GAME_URL`). Handles JS/localStorage, keeps in-game navigation inside the app,
  hides the system status/nav bars, and shows a pull-to-refresh retry screen if the game can't
  be reached.

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

- **Splash screen art** — currently just a solid color + text placeholder, real branding to
  follow.
- **App icon** — a simple placeholder vector mark (`ic_launcher_foreground.xml`), same story.
- **Signing** — this is a *debug*-signed APK (Android's own auto-generated debug keystore), fine
  for sideloading/testing, not for a Play Store release. A real release keystore + signing config
  would be a separate, deliberate step before any store submission.
- **iOS** — not started; nothing here is iOS-specific or portable to it as-is (this is a plain
  native Android WebView shell, not a cross-platform framework like Capacitor/Cordova).
