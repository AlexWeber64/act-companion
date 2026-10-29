// The Android app: the Python package in ../../src runs inside the app (Chaquopy) and the UI is the same web UI,
// shown in a WebView. See android/README.md.
plugins {
    id("com.android.application")
    id("com.chaquo.python")
}

val src = rootDir.resolve("../src")
val appVersion = Regex("__version__ = \"([^\"]+)\"").find(src.resolve("act_companion/__init__.py").readText())!!.groupValues[1]

// Release signing comes from environment variables (the CI workflow sets them from repository secrets).
val keystore = System.getenv("ANDROID_KEYSTORE_FILE")?.let(::file)?.takeIf { it.exists() }

android {
    namespace = "io.github.alexweber64.actcompanion"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.github.alexweber64.actcompanion"
        minSdk = 29  // Android 10: MediaStore Downloads without storage permissions
        targetSdk = 36
        versionName = appVersion
        versionCode = appVersion.split(".").map(String::toInt).let { (a, b, c) -> a * 10000 + b * 100 + c }
        ndk {
            abiFilters += listOf("arm64-v8a", "x86_64")  // phones, and the emulator
        }
    }

    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = keystore
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false  // Python calls the Kotlin classes by name
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

chaquopy {
    defaultConfig {
        version = "3.14"
        pip {
            // The app's dependencies from pyproject.toml, minus the desktop-only ones (keyring, pywebview, pystray, pillow).
            install("requests>=2.31")
            install("platformdirs>=4")
        }
    }
    sourceSets {
        getByName("main") {
            srcDir(src)
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.work:work-runtime-ktx:2.12.0")
}
