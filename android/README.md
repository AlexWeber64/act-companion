# ACT Companion for Android

The Android app shows the web app (`../web`, the same UI as the desktop app) in a WebView. `web.js` talks to
activity.act.edu straight from the page, so the app opens without starting anything first. The Kotlin code adds what a
phone needs:

| File | Purpose |
|---|---|
| `MainActivity.kt` | The screen: loads the web app from the APK's assets; other links open in the browser |
| `Bridge.kt` | `window.ACTAndroid` for the page: keeps the token and settings in private storage, reports the checks' status, saves course files to Downloads > ACT Companion and opens them, colors the system bars |
| `Checks.kt` | The background checks for alerts (deadlines, reminders, grades, optional course changes), a port of `src/act_companion/watcher.py` with the same rules and the same `state.json` layout |
| `Moodle.kt` | The Moodle Web Services client the checks use, a port of `src/act_companion/moodle.py` |
| `Store.kt` | Private storage: token, settings (same defaults as `config.py`), `state.json` and the last check's status |
| `CheckWorker.kt`, `Shell.kt` | WorkManager runs the checks every 15 minutes or more, also after a restart; notifications and Quit |

If you change how alerts work in `watcher.py`, change `Checks.kt` to match.

Android runs background work at most every 15 minutes, so on Android the check frequency setting offers 15, 30 and
60 minutes. The token is stored in the app's private storage, and backups are turned off so it never leaves the phone.
The app has no local server and only talks to activity.act.edu, over HTTPS.

## Build

You need JDK 17 or newer, the Android SDK (Android Studio installs it), and Python 3 on the PATH: the build runs
`web/build.py --app` to put the web app in the APK's assets (set `PYTHON` to use another interpreter).

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
