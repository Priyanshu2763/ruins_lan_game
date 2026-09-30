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
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
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
 * the ffmpeg command — kept at its full original frame, not cropped: sizeSplashVideoToAspect below
 * letterboxes/pillarboxes to show the whole frame instead of stretching or cropping it). The video
 * plays exactly once, then fades out — an earlier version waited for the page to finish loading
 * too and looped the video if it hadn't, which read as a stuck/broken splash on a live device
 * rather than "play then disappear smoothly" as asked.
 *
 * The video is driven through a TextureView + MediaPlayer directly, not the android.widget.
 * VideoView an earlier version used — VideoView wraps a SurfaceView internally, a genuinely
 * separate compositor surface that (without an explicit setZOrderOnTop call VideoView doesn't
 * expose) defaults to sitting BEHIND the window's own content. Layered over the WebView (itself
 * hardware-accelerated), that meant the video's audio played fine — a separate pipeline,
 * unaffected — while the picture itself was invisible: a live-reported bug ("sound comes, no
 * visual"). TextureView is a normal View subclass that composites through the regular view
 * hierarchy, so it just works on top with no special handling needed.
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
    }

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout
    private lateinit var splashVideo: TextureView
    private lateinit var splashBackdrop: View
    private var mediaPlayer: MediaPlayer? = null

    private var revealed = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        hideSystemBars()

        webView = findViewById(R.id.webView)
        swipeRefresh = findViewById(R.id.swipeRefresh)
        splashVideo = findViewById(R.id.splashVideo)
        splashBackdrop = findViewById(R.id.splashBackdrop)
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
        // "WreckveilWeb" tag, and turns on chrome://inspect remote DevTools. Debuggable is checked
        // via the ApplicationInfo flag (not BuildConfig.DEBUG, which needs
        // buildFeatures.buildConfig turned on in Gradle) so this needs zero build-config changes
        // and can never accidentally ship enabled in a release build.
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
        splashVideo.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
            override fun onSurfaceTextureAvailable(surface: SurfaceTexture, availW: Int, availH: Int) {
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
                    }
                    mp.setOnCompletionListener { revealGame() }
                    mp.setOnErrorListener { _, _, _ -> revealGame(); true }
                    mp.prepareAsync()
                } catch (e: Exception) {
                    Log.e("WreckveilSplash", "splash video setup failed, revealing game directly", e)
                    revealGame()
                }
            }
            override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {}
            override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean = true
            override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {}
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

    // Plays exactly once, then fades out to reveal the game loading underneath (which started
    // loading back in onCreate, in parallel with the video).
    private fun revealGame() {
        if (revealed) return
        revealed = true
        splashVideo.animate()
            .alpha(0f)
            .setDuration(300)
            .setListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    releaseMediaPlayer()
                    splashVideo.visibility = View.GONE
                }
            })
            .start()
        // Faded out together with the video, same duration — this is the backdrop that fills the
        // letterbox/pillarbox gap around the (aspect-fit) video; see its own layout comment.
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
