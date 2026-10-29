# ACT Companion for Android

The Android app runs the same Python package as the desktop app (`../src/act_companion`) inside the app, using
[Chaquopy](https://chaquo.com/chaquopy/), and shows the same web UI in a WebView. The Kotlin code only adds what a phone
needs:

| File | Purpose |
|---|---|
| `MainActivity.kt` | The screen: starts the local server and shows the dashboard; other links open in the browser |
| `Bridge.kt` | `window.ACTAndroid` for the page: saves course files to Downloads > ACT Companion and opens them, colors the system bars |
| `Shell.kt` | What Python calls (`act_companion/android.py`, `notify.py`): notifications, scheduling the checks, quitting |
| `CheckWorker.kt` | The background check, run by WorkManager every 15 minutes or more, also after a restart |

Android runs background work at most every 15 minutes, so on Android the check frequency setting offers 15, 30 and
60 minutes. The token is stored in the app's private storage, and backups are turned off so it never leaves the phone.

## Build

You need JDK 17 or newer, the Android SDK (Android Studio installs it), and Python 3.14 on the PATH (Chaquopy compiles
the app's Python with it).

```sh
cd android
./gradlew assembleDebug        # app/build/outputs/apk/debug/app-debug.apk
./gradlew installDebug         # onto a connected phone or emulator
```

Debug builds allow WebView debugging from `chrome://inspect`.

## Release signing

Release builds (`./gradlew assembleRelease`) are signed when these environment variables are set:
`ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS`. The CI workflow
(`../.github/workflows/build.yml`) sets them from the repository secrets `ANDROID_KEYSTORE_BASE64` (the keystore,
base64-encoded), `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS`.

Every release must be signed with the same key, or phones refuse to install the update over the old version. Keep a
backup of the keystore and its password.
