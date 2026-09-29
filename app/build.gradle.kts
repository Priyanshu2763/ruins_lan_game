// Root build file. Real config lives in app/build.gradle.kts; this just wires up the
// Android/Kotlin plugin versions once for the whole (single-module) project.
plugins {
    id("com.android.application") version "8.5.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.24" apply false
}
