plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "com.homehub.companion"
    compileSdk = 35
    defaultConfig { applicationId = "com.homehub.companion"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "0.1.0" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies { implementation("androidx.webkit:webkit:1.14.0") }
