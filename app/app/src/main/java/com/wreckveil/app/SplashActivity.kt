package com.wreckveil.app

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity

/**
 * Placeholder splash screen: just a solid background + wordmark (see res/layout/activity_splash.xml
 * and res/drawable/splash_background.xml) held for a fixed, short delay before handing off to the
 * WebView. Real branding/splash art comes later — this exists so the app has *something* on cold
 * start rather than a blank white flash while MainActivity's WebView spins up.
 */
class SplashActivity : AppCompatActivity() {
    private val splashDelayMs = 1200L

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_splash)

        Handler(Looper.getMainLooper()).postDelayed({
            if (!isFinishing) {
                startActivity(Intent(this, MainActivity::class.java))
                finish()
            }
        }, splashDelayMs)
    }
}
