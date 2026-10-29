// The Android app: the web app (../../web, the same UI as the desktop) in a WebView, plus Kotlin for what a phone needs:
// background checks, notifications and saving course files. See android/README.md.
import org.gradle.api.DefaultTask
import org.gradle.api.file.ConfigurableFileCollection
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.tasks.InputFiles
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.TaskAction
import org.gradle.process.ExecOperations
import javax.inject.Inject

plugins {
    id("com.android.application")
}

val repo = rootDir.resolve("..")
val appVersion = Regex("__version__ = \"([^\"]+)\"").find(repo.resolve("src/act_companion/__init__.py").readText())!!.groupValues[1]

// Release signing comes from environment variables (the CI workflow sets them from repository secrets).
val keystore = System.getenv("ANDROID_KEYSTORE_FILE")?.let(::file)?.takeIf { it.exists() }

/** Builds the web app into the APK's assets with web/build.py (it needs Python 3, nothing else, in --app mode). */
abstract class BuildWebApp : DefaultTask() {
    @get:InputFiles abstract val sources: ConfigurableFileCollection
    @get:OutputDirectory abstract val outputDir: DirectoryProperty
    @get:Inject abstract val exec: ExecOperations

    @TaskAction
    fun build() {
        val python = System.getenv("PYTHON") ?: if (System.getProperty("os.name").startsWith("Windows")) "python" else "python3"
        val script = sources.files.first { it.name == "build.py" }
        exec.exec { commandLine(python, script.path, "--app", outputDir.get().dir("web").asFile.path) }
    }
}

val webApp = tasks.register<BuildWebApp>("buildWebApp") {
    sources.from(repo.resolve("web/build.py"), repo.resolve("web/web.js"), repo.resolve("src/act_companion/static"), repo.resolve("src/act_companion/__init__.py"))
    outputDir.set(layout.buildDirectory.dir("generated/webapp"))
}

android {
    namespace = "io.github.alexweber64.actcompanion"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.github.alexweber64.actcompanion"
        minSdk = 29  // Android 10: MediaStore Downloads without storage permissions
        targetSdk = 36
        versionName = appVersion
        versionCode = appVersion.split(".").map(String::toInt).let { (a, b, c) -> a * 10000 + b * 100 + c }
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
            isMinifyEnabled = true  // the page calls Bridge by its @JavascriptInterface methods, which R8 keeps
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
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

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(webApp, BuildWebApp::outputDir)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.work:work-runtime-ktx:2.12.0")
    implementation("androidx.webkit:webkit:1.18.0")
}
