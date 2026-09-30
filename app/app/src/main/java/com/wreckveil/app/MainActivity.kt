package com.wreckveil.app

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.annotation.SuppressLint
import android.content.pm.ApplicationInfo
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.ConsoleMessage
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
 * letterboxes/pillarboxes to show the whole frame instead). The reveal only happens once BOTH the
 * video has played through at least once AND the page has actually finished loading
 * (onPageFinished — the closest native-side signal to "the game is loaded correctly"; it fires
 * once the HTML document itself is ready, not once every background 3D asset fetch is done, which
 * would need a JS bridge this simple container doesn't have) — if the page is slower than the
 * video, the video loops rather than freezing on a dead last frame until it's ready.
 */
class MainActivity : AppCompatActivity() {
    companion object {
        const val GAME_URL = "https://game.antiszn.com"
    }

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var splashVideo: VideoView

    private var videoPlayedThrough = false
    private var pageReady = false
    private var revealed = false

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

            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                pageReady = true
                tryRevealGame()
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) {
                    webView.loadUrl("about:blank")
                    swipeRefresh.isEnabled = true
                    // Don't leave the splash spinning forever over a page that will never finish
                    // loading — reveal the retry screen instead once the video's had its play.
                    pageReady = true
                    tryRevealGame()
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
        splashVideo.setOnCompletionListener {
            if (!videoPlayedThrough) {
                videoPlayedThrough = true
                tryRevealGame()
            }
            if (!revealed) {
                // The game isn't ready yet — loop instead of freezing on a dead last frame.
                splashVideo.seekTo(0)
                splashVideo.start()
            }
        }
        splashVideo.start()
    }

    // Reveals the loaded game underneath only once the splash video has played through in full
    // AND the page has actually finished loading — whichever of the two finishes second is what
    // triggers this (both call sites are harmless no-ops until both flags are true).
    private fun tryRevealGame() {
        if (revealed || !videoPlayedThrough || !pageReady) return
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
