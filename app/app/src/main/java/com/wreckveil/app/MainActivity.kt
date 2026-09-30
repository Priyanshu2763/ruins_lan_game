package com.wreckveil.app

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.annotation.SuppressLint
import android.content.pm.ApplicationInfo
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Surface
import android.view.TextureView
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
import android.widget.Button
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

/**
 * The whole app, today: a full-screen WebView pointed at the live game, wrapped in a cold-start
 * sequence, then otherwise no native game logic — deliberately just an outer container ("a
 * container for the website running inside"), so every gameplay/UI change already made to the
 * actual web client (public/js, index.html) shows up here automatically with zero app updates.
 *
 * GAME_URL is the same public game.antiszn.com domain the desktop browser uses (see the repo's
 * own CLAUDE.md / memory for the Apache reverse-proxy setup this points through) — not
 * localhost, since this needs to work on a real device, not just this dev machine.
 *
 * Cold-start sequence, strictly ordered end to end (see runStartupSequence/each stage's own
 * function below — every stage only starts once the previous one has actually finished, chained
 * via callbacks, never on independent timers that could drift out of sync):
 *   1. webView.loadUrl(GAME_URL) fires FIRST and unconditionally, before any splash UI — the page
 *      starts loading in the background for the ENTIRE sequence below, not just part of it.
 *   2. splashVideo (res/raw/splash.mp4, a real clip the user supplied, sped up 1.5x, kept at its
 *      full frame via sizeSplashVideoToAspect — no crop/stretch): fades in, plays once, fades out.
 *   3. loadingScreen: the banner image (res/drawable/splash_banner.jpg, used as supplied) doubles
 *      as a real BGMI-style loading screen — fades in, then STAYS UP until the web side reports
 *      real load completion (window.AndroidBridge.onLoadProgress, called from
 *      public/js/characters.js's reportLoadProgress as its ~15 core asset requests resolve) or a
 *      safety timeout elapses, then fades out. This is a deliberate architecture change from an
 *      earlier version, which revealed the game after a fixed timer regardless of whether loading
 *      had actually finished — exactly the class of bug behind a live "gun/hands invisible"
 *      report on a slow connection. Tying the reveal to a REAL signal instead of a guessed
 *      duration fixes that at the root rather than extending the guess further.
 *   4. splashBackdrop fades out, revealing the (now loaded) game underneath.
 *
 * offlineOverlay is independent of all of the above: shown/hidden purely by the WebView's own
 * onReceivedError/successful-load signals, so it can interrupt the sequence at any point (or
 * appear later, if the connection drops mid-match) and doesn't need to know or care which of the
 * four stages above is currently active.
 *
 * The video is driven through a TextureView + MediaPlayer directly, not android.widget.VideoView
 * — VideoView wraps a SurfaceView internally, a genuinely separate compositor surface that
 * (without an explicit setZOrderOnTop call VideoView doesn't expose) defaults to sitting BEHIND
 * the window's own content; layered over the WebView (itself hardware-accelerated), that meant
 * the video's audio played fine (a separate pipeline, unaffected) while the picture itself was
 * invisible — a live-reported bug ("sound comes, no visual"). TextureView is a normal View
 * subclass that composites through the regular view hierarchy, so it just works on top with no
 * special handling needed.
 *
 * screenOrientation is locked to "userLandscape" in the manifest (this is a landscape shooter) —
 * an earlier attempt unlocked it to fix a real "login buttons unreachable" bug, which traded one
 * bug for a worse one; that's now fixed properly at the source instead (public/index.html's
 * `.screen` CSS scrolls instead of clipping when content is taller than the viewport), so the app
 * can stay landscape-locked throughout.
 */
class MainActivity : AppCompatActivity() {
    companion object {
        const val GAME_URL = "https://game.antiszn.com"
        // Never leave the player stuck if progress genuinely stalls. Bumped 20s -> 40s once the
        // web side started waiting for the player's own Operator character too (a separate 5-62MB
        // file, on top of the ~20MB base template) — 20s was sized for the base template alone,
        // and a big operator over a real slow mobile connection could plausibly need more room
        // than that before genuinely finishing, not stalling.
        const val LOADING_SCREEN_TIMEOUT_MS = 40000L
    }

    private lateinit var webView: WebView
    private lateinit var splashVideo: TextureView
    private lateinit var splashBackdrop: View
    private lateinit var loadingScreen: View
    private lateinit var loadingProgressBar: ProgressBar
    private lateinit var loadingProgressText: TextView
    private lateinit var offlineOverlay: View
    private lateinit var offlineRetryBtn: Button
    private var mediaPlayer: MediaPlayer? = null

    private var revealed = false
    private var loadingScreenDone = false
    private val loadingTimeoutRunnable = Runnable { finishLoadingScreen() }

    // Exposed to the page as `window.AndroidBridge` — lets the web client (characters.js's
    // reportLoadProgress) push real load-progress numbers to this native loading screen instead
    // of the app guessing with a fixed timer. Narrow on purpose (one method, an int) since
    // anything exposed here is callable by whatever content the WebView happens to be showing.
    private inner class WebAppInterface {
        @JavascriptInterface
        fun onLoadProgress(pct: Int) {
            runOnUiThread { updateLoadingProgress(pct) }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        hideSystemBars()

        webView = findViewById(R.id.webView)
        splashVideo = findViewById(R.id.splashVideo)
        splashBackdrop = findViewById(R.id.splashBackdrop)
        loadingScreen = findViewById(R.id.loadingScreen)
        loadingProgressBar = findViewById(R.id.loadingProgressBar)
        loadingProgressText = findViewById(R.id.loadingProgressText)
        offlineOverlay = findViewById(R.id.offlineOverlay)
        offlineRetryBtn = findViewById(R.id.offlineRetryBtn)
        offlineRetryBtn.setOnClickListener {
            offlineOverlay.visibility = View.GONE
            webView.loadUrl(GAME_URL)
        }

        configureWebView(webView.settings)

        // Debug builds only: pipes every page console.log/warn/error to `adb logcat` under the
        // "WreckveilWeb" tag, and turns on chrome://inspect remote DevTools. Debuggable is checked
        // via the ApplicationInfo flag (not BuildConfig.DEBUG, which needs
        // buildFeatures.buildConfig turned on in Gradle) so this needs zero build-config changes
        // and can never accidentally ship enabled in a release build.
        val isDebuggable = (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (isDebuggable) WebView.setWebContentsDebuggingEnabled(true)

        // Registered before loadUrl, per Android's own guidance for addJavascriptInterface — the
        // actual reportLoadProgress calls only start firing well after this (once characters.js's
        // module code runs and its fetches start resolving), so exact ordering here isn't load-
        // bearing in practice, but this is the documented-correct order regardless.
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

            // Replaces an earlier bare "load about:blank + enable pull-to-refresh" fallback with a
            // real themed dialog (offlineOverlay) + an explicit RETRY button, per the explicit ask
            // — one clear recovery path instead of a silent gesture the player might not discover.
            // Sits on top of the whole splash sequence regardless of which stage is currently
            // active (it's the topmost element in activity_main.xml) and doesn't need to pause or
            // cancel whatever's still running underneath — it's fully opaque, so that's harmless.
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                super.onReceivedError(view, request, error)
                if (request.isForMainFrame) {
                    offlineOverlay.visibility = View.VISIBLE
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

    // TextureView creates its SurfaceTexture as soon as it's attached+laid out, independent of
    // whether a listener is set — and onSurfaceTextureAvailable fires exactly ONCE, at that
    // creation moment. Checking isAvailable first (using the already-existing SurfaceTexture
    // directly when it's there) rather than unconditionally waiting on the listener avoids a real
    // bug class this hit once already: if this function's caller is ever delayed relative to
    // onCreate for any reason, the surface may already exist by the time this runs, and a listener
    // attached after the fact would silently never fire.
    private fun setUpSplashVideo() {
        if (splashVideo.isAvailable) {
            startVideoPlayback(splashVideo.surfaceTexture!!, splashVideo.width, splashVideo.height)
        } else {
            splashVideo.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
                override fun onSurfaceTextureAvailable(surface: SurfaceTexture, availW: Int, availH: Int) {
                    startVideoPlayback(surface, availW, availH)
                }
                override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {}
                override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean = true
                override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {}
            }
        }
    }

    private fun startVideoPlayback(surface: SurfaceTexture, availW: Int, availH: Int) {
        val mp = MediaPlayer()
        mediaPlayer = mp
        try {
            mp.setSurface(Surface(surface))
            val afd = resources.openRawResourceFd(R.raw.splash)
            mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
            afd.close()
            mp.setOnPreparedListener {
                sizeSplashVideoToAspect(mp.videoWidth, mp.videoHeight, availW, availH)
                mp.start()
                splashVideo.animate().alpha(1f).setDuration(300).start()
            }
            // Video fully fades out before the loading screen appears — a hard cut between them
            // would undercut the "lights down, next beat lights up" feel that was specifically
            // asked for; onError takes the same path (skip straight to the loading screen) rather
            // than leaving the player stuck on a broken video with nothing else ever happening.
            mp.setOnCompletionListener { fadeOutVideoThenShowLoadingScreen() }
            mp.setOnErrorListener { _, _, _ -> fadeOutVideoThenShowLoadingScreen(); true }
            mp.prepareAsync()
        } catch (e: Exception) {
            Log.e("WreckveilSplash", "splash video setup failed, skipping to loading screen", e)
            fadeOutVideoThenShowLoadingScreen()
        }
    }

    // Resizes the TextureView itself (rather than a transform matrix) to the correctly
    // letterboxed/pillarboxed size for the video's real aspect ratio within the space available —
    // layout_gravity="center" (activity_main.xml) then centers it, giving the same
    // "show the full frame, no cropping" behavior VideoView provided by default.
    private fun sizeSplashVideoToAspect(videoW: Int, videoH: Int, availW: Int, availH: Int) {
        if (videoW <= 0 || videoH <= 0 || availW <= 0 || availH <= 0) return
        val videoAspect = videoW.toFloat() / videoH
        val availAspect = availW.toFloat() / availH
        val params = splashVideo.layoutParams
        if (videoAspect > availAspect) {
            params.width = availW
            params.height = (availW / videoAspect).toInt()
        } else {
            params.width = (availH * videoAspect).toInt()
            params.height = availH
        }
        splashVideo.layoutParams = params
    }

    private fun fadeOutVideoThenShowLoadingScreen() {
        splashVideo.animate()
            .alpha(0f)
            .setDuration(300)
            .setListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    releaseMediaPlayer()
                    splashVideo.visibility = View.GONE
                    showLoadingScreen()
                }
            })
            .start()
    }

    // Beat 2: the banner-as-loading-screen fades in ("lights turning on slowly"), then stays up
    // until updateLoadingProgress sees 100% (real completion OR characters.js giving up after its
    // own retries, which also reports 100 — see that file's own comment) or the safety timeout
    // below fires — whichever happens first. Not a fixed duration like the old banner-only beat
    // was; this is the whole point of the change, tying the reveal to a real signal.
    private fun showLoadingScreen() {
        loadingScreenDone = false
        loadingProgressBar.progress = 0
        loadingProgressText.text = getString(R.string.loading_prefix)
        loadingScreen.visibility = View.VISIBLE
        loadingScreen.animate().alpha(1f).setDuration(700).start()
        loadingScreen.postDelayed(loadingTimeoutRunnable, LOADING_SCREEN_TIMEOUT_MS)
    }

    private fun updateLoadingProgress(pct: Int) {
        val clamped = pct.coerceIn(0, 100)
        loadingProgressBar.progress = clamped
        loadingProgressText.text = "${getString(R.string.loading_prefix)} $clamped%"
        if (clamped >= 100) finishLoadingScreen()
    }

    // "Lights turning off slowly" — the other half of the fade the banner phase was asked for,
    // now triggered by real completion instead of a timer. Idempotent (guards against both the
    // 100%-progress path and the safety timeout firing close together).
    private fun finishLoadingScreen() {
        if (loadingScreenDone) return
        loadingScreenDone = true
        loadingScreen.removeCallbacks(loadingTimeoutRunnable)
        loadingScreen.animate()
            .alpha(0f)
            .setDuration(700)
            .setListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    loadingScreen.visibility = View.GONE
                    revealGame()
                }
            })
            .start()
    }

    // Final stage: the backdrop (which was only ever there to fill the letterbox gap behind the
    // video/loading-screen — see its own layout comment) fades out, revealing the by-now-loaded
    // game underneath.
    private fun revealGame() {
        if (revealed) return
        revealed = true
        splashBackdrop.animate()
            .alpha(0f)
            .setDuration(300)
            .setListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    splashBackdrop.visibility = View.GONE
                }
            })
            .start()
    }

    private fun releaseMediaPlayer() {
        mediaPlayer?.let {
            try { it.stop() } catch (e: IllegalStateException) { /* already stopped/released */ }
            it.release()
        }
        mediaPlayer = null
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
        releaseMediaPlayer()
        super.onDestroy()
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
