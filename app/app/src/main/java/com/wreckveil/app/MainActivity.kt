package com.wreckveil.app

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
import androidx.appcompat.app.AppCompatActivity
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout

/**
 * The whole app, today: a full-screen WebView pointed at the live game. No native game logic
 * lives here on purpose — this is deliberately just an outer container ("a container for the
 * website running inside"), so every gameplay/UI change already made to the actual web client
 * (public/js, index.html) shows up here automatically with zero app updates needed.
 *
 * GAME_URL is the same public game.antiszn.com domain the desktop browser uses (see the repo's
 * own CLAUDE.md / memory for the Apache reverse-proxy setup this points through) — not
 * localhost, since this needs to work on a real device, not just this dev machine.
 */
class MainActivity : AppCompatActivity() {
    companion object {
        const val GAME_URL = "https://game.antiszn.com"
    }

    private lateinit var webView: WebView
    private lateinit var swipeRefresh: SwipeRefreshLayout

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        hideSystemBars()

        webView = findViewById(R.id.webView)
        swipeRefresh = findViewById(R.id.swipeRefresh)
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
        // report ("login/create buttons not working" on a real phone) that turned out to be the
        // screenOrientation bug below — but there was no way to SEE that from here at the time,
        // only guess from source. Debuggable is checked via the ApplicationInfo flag (not
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

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }
}
