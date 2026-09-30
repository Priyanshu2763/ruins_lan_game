package com.wreckveil.app

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.annotation.SuppressLint
import android.content.pm.ActivityInfo
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.VideoView
import androidx.appcompat.app.AppCompatActivity
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * The whole app, today: a full-screen WebView pointed at the live game, with a splash video
 * playing on top of it while the page loads underneath. No native game logic lives here on
 * purpose — this is deliberately just an outer container ("a container for the website running
 * inside"), so every gameplay/UI change already made to the actual web client (public/js,
 * index.html) shows up here automatically with zero app updates needed.
 *
 * GAME_URL is the same public game.antiszn.com domain the desktop browser uses (see the repo's
 * own CLAUDE.md / memory for the Apache reverse-proxy setup this points through) — not
 * localhost, since this needs to work on a real device, not just this dev machine.
 *
 * There used to be a separate SplashActivity that showed a placeholder for a fixed 1.2s delay
 * BEFORE MainActivity (and its WebView) were even created — meaning the game never started
 * loading until after the splash was already done. Merged into one Activity so the WebView starts
 * loading immediately, in parallel with the splash video baked into res/raw/splash.mp4 (a real
 * clip the user supplied, sped up 1.5x — see the app's own scratchpad notes / commit message for
 * the ffmpeg command — kept at its full original frame, not cropped: VideoView's default scaling
 * letterboxes/pillarboxes to show the whole frame instead). The video plays exactly once, then
 * fades out — an earlier version waited for the page to finish loading too and looped the video
 * if it hadn't, which read as a stuck/broken splash on a live device rather than "play then
 * disappear smoothly" as asked; the WebView's own dark background (@color/splash_background)
 * means an still-loading page underneath is never a jarring white flash either way.
 *
 * `AndroidBridge` (a @JavascriptInterface) lets the web client (touchControls.js) lock/unlock
 * screen orientation NATIVELY instead of through the browser Fullscreen+Orientation-Lock APIs —
 * added after a live report ("app isn't opening in landscape") traced to those web APIs simply
 * not working inside a bare WebView: `screen.orientation.lock()` is spec-gated behind a successful
 * `Element.requestFullscreen()` first, and generic-element fullscreen in Android WebView requires
 * the host app to implement `WebChromeClient.onShowCustomView`, which this app never did (that
 * callback exists for `<video>` fullscreen, not arbitrary DOM fullscreen) — so the whole chain
 * silently no-ops and the .catch() swallows it. `Activity.requestedOrientation` has no such
 * dependency and just works, so the web client now calls this bridge (in addition to, not instead
 * of, the browser APIs it already tries — harmless where the bridge doesn't exist, i.e. a normal
 * mobile browser tab).
 */
class MainActivity : AppCompatActivity() {
    companion object {
        const val GAME_URL = "https://game.antiszn.com"
    }

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var splashVideo: VideoView

    private var revealed = false

    // Exposed to the page as `window.AndroidBridge` — see the class doc comment above for why
    // this exists instead of relying on the browser's own Fullscreen/Orientation-Lock APIs.
    // Methods are deliberately narrow (orientation only, no filesystem/data access) since anything
    // exposed here is callable by whatever content the WebView happens to be showing.
    private inner class WebAppInterface {
        @JavascriptInterface
        fun lockLandscape() {
            runOnUiThread { requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE }
        }
        @JavascriptInterface
        fun unlockOrientation() {
            runOnUiThread { requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        hideSystemBars()

        webView = findViewById(R.id.webView)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        splashVideo = findViewById(R.id.splashVideo)
        // Pull-to-refresh only ever makes sense on the error/offline screen (dragging down
        // mid-match to "refresh" would be a real footgun) - see the loadUrl-on-error handling
        // below, which is the only place this actually gets enabled.
        swipeRefresh.isEnabled = false
        swipeRefresh.setOnRefreshListener {
            swipeRefresh.isRefreshing = false
            webView.loadUrl(GAME_URL)
        }

        configureWebView(webView.settings)

        // Debug builds only: pipes every page console.log/warn/error to `adb logcat` under the
        // "WreckveilWeb" tag, and turns on chrome://inspect remote DevTools. Added after a live
        // report ("login/create buttons not working" on a real phone) that turned out to be a
        // screenOrientation bug — but there was no way to SEE that from here at the time, only
        // guess from source. Debuggable is checked via the ApplicationInfo flag (not
        // BuildConfig.DEBUG, which needs buildFeatures.buildConfig turned on in Gradle) so this
        // needs zero build-config changes and can never accidentally ship enabled in a release build.
        val isDebuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (isDebuggable) WebView.setWebContentsDebuggingEnabled(true)

        webView.addJavascriptInterface(WebAppInterface(), "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            // Keep normal navigation (and the auth/dashboard flow, which is all same-origin)
            // inside the WebView; only hand off truly external links (if any ever appear) to a
            // real browser instead of trying to render them in-app.
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                return if (url.host == Uri.parse(GAME_URL).host) {
                    false
                } else {
                    startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, url))
                    true
                }
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) {
                    webView.loadUrl("about:blank")
                    swipeRefresh.isEnabled = true
                }
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(msg: ConsoleMessage): Boolean {
                val level = when (msg.messageLevel()) {
                    ConsoleMessage.MessageLevel.ERROR -> Log.ERROR
                    ConsoleMessage.MessageLevel.WARNING -> Log.WARN
                    else -> Log.DEBUG
                }
                Log.println(level, "WreckveilWeb", "${msg.message()} (${msg.sourceId()}:${msg.lineNumber()})")
                return true
            }
        }

        webView.loadUrl(GAME_URL)
        setUpSplashVideo()
    }

    private fun setUpSplashVideo() {
        val uri = Uri.parse("android.resource://$packageName/${R.raw.splash}")
        splashVideo.setVideoURI(uri)
        splashVideo.setOnCompletionListener { revealGame() }
        splashVideo.start()
    }

    // Plays exactly once, then fades out to reveal the game loading underneath (which started
    // loading back in onCreate, in parallel with the video — see the class doc comment).
    private fun revealGame() {
        if (revealed) return
        revealed = true
        splashVideo.animate()
            .alpha(0f)
            .setDuration(300)
            .setListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    splashVideo.stopPlayback()
                    splashVideo.visibility = View.GONE
                }
            })
            .start()
    }

    private fun configureWebView(settings: WebSettings) {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true // localStorage: auth session, settings, loadout
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false // the game's own WebAudio sfx/music
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.setSupportZoom(false) // this is a game viewport, not a document to pinch-zoom
        settings.builtInZoomControls = false
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        // WebGL itself needs no explicit settings flag on modern (Chromium-backed) WebView -
        // it's available whenever hardware acceleration is (see the manifest's
        // android:hardwareAccelerated="true" on <application>).
    }

    override fun onResume() {
        super.onResume()
        hideSystemBars()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_FULLSCREEN
                )
        }
    }

    override fun onDestroy() {
        splashVideo.stopPlayback()
        super.onDestroy()
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
