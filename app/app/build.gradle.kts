plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.wreckveil.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.wreckveil.app"
        // 26 (Android 8.0) instead of something lower specifically so the launcher icon can be a
        // plain adaptive-icon XML + vector drawable (no per-density PNG exports needed for a
        // placeholder) - real device coverage in 2026 makes this a non-issue either way.
        minSdk = 26
        targetSdk = 34
        // Bump versionCode/versionName here for each future release build.
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.webkit:webkit:1.11.0")
}
