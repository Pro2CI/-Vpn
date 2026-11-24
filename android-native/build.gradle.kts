plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val violetBuildNumber = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull() ?: 3

android {
    namespace = "com.violetvpn.android"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.violetvpn.android"
        minSdk = 24
        targetSdk = 35
        versionCode = 10000 + violetBuildNumber
        versionName = "2.1.$violetBuildNumber"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    sourceSets["main"].assets.srcDir("src/main/assets")
    packaging { jniLibs { useLegacyPackaging = true } }
}

dependencies {
    implementation(fileTree(mapOf("dir" to "libs", "include" to listOf("*.aar", "*.jar"))))
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
}
