# ACT Companion

A desktop, Android and iPhone companion for [activity.act.edu](https://activity.act.edu), the school's Moodle site. See your deadlines, grades,
course files, forums and messages in one clean dashboard, and get desktop alerts before things are due.

It runs on your own computer or phone and signs in with your own account, the same way the official Moodle mobile app does.

> **Unofficial.** ACT Companion is a student project. It is not affiliated with, endorsed by, or supported by the school.

## Features

- **Home:** what is due this week, overdue work, unread notifications and messages, your courses and grades at a glance.
- **Planner:** a week grid with overdue work pinned on the left, countdowns for what is next, and week-by-week navigation
  (`Alt` + arrow keys).
- **Deadlines** grouped into Overdue, Today, Tomorrow, Next 7 days and Later, filterable by course.
- **Courses:** browse content by section, filter files by name with highlighted matches, download with one click.
  Assignments (with submission status), forums and discussions (with attachments), and item-by-item grades with feedback
  are one tab away. Reorder your courses and pick their colors in Settings.
- **Search everything:** press `Ctrl K` (or `/`) to jump to any course, file, deadline or page.
- **Messages and notifications:** conversations in two panes, notifications grouped by day; opening one marks it read.
- **Four themes:** Nocturne, Graphite, Daylight and Paper, or follow your system.
- **Works on a phone-sized window** too, with a bottom tab bar.
- **Desktop alerts** on Windows, macOS and Linux:
  - new deadlines, and reminders before they are due (24 hours and 1 hour by default)
  - newly posted grades (the grade itself stays hidden unless you turn that on)
  - *optional, off by default:* course changes, meaning new or newly visible files, resources and forum posts

## Install on Windows (no Python needed)

1. Download **[ACT-Companion.exe](https://github.com/AlexWeber64/act-companion/releases/latest/download/ACT-Companion.exe)**
   (or pick a version on the [releases page](https://github.com/AlexWeber64/act-companion/releases)).
2. Put it somewhere permanent, for example a folder in Documents, and double-click it.
3. Windows may say **"Windows protected your PC"**, because the app is not signed with a paid code-signing certificate.
   Click **More info**, then **Run anyway**. You only need to do this once.
4. ACT Companion opens in its own window. Sign in, then turn on **Settings > Start when I log in to this computer**.

Closing the window keeps ACT Companion running in the system tray (the icons by the clock), so alerts keep arriving.
Click the tray icon or double-click the .exe to open it again; right-click the tray icon and choose **Quit** to stop it.
If you move the .exe, open it once from its new place so start at login follows it.

Course files you open are saved to **Downloads > ACT Companion** and open in their usual app. Code and programs
(such as `.py` or `.exe` files) are only saved and shown in their folder, never run.

## Install on Android

1. On your phone, download **[ACT-Companion.apk](https://github.com/AlexWeber64/act-companion/releases/latest/download/ACT-Companion.apk)**
   and open it. Android asks you to allow installing apps from your browser (or Files app) the first time.
2. Open ACT Companion, allow notifications, and sign in.

Alerts keep arriving when the app is closed; Android runs the checks every 15 minutes or more. Some phones, Samsung's
among them, pause apps you don't open often: if alerts stop, open **Settings > App settings** in ACT Companion and set
**Battery** to **Unrestricted**. Course files are saved to **Downloads > ACT Companion**. To uninstall, long-press the
app icon and choose **Uninstall**, which also deletes your sign-in and settings.

## Use on iPhone (or in any browser)

1. In Safari, open **[alexweber64.github.io/act-companion](https://alexweber64.github.io/act-companion/)**.
2. Tap **Share**, then **Add to Home Screen**. ACT Companion opens from its icon like an app. Sign in.

This is a web app: it has your deadlines, grades, course files, forums and messages, but **no alerts**, because iOS
lets web apps do nothing while they are closed. For alerts, use the desktop or Android app. It talks to activity.act.edu
straight from your phone; your sign-in stays on your phone and no other server sees it (GitHub only hosts the app's
files). Signing out removes it. It updates itself when a new version is released.

## Install from source

You need [Python 3.10 or newer](https://www.python.org/downloads/) and git.

```sh
git clone https://github.com/AlexWeber64/act-companion.git
cd act-companion
python -m venv .venv
```

Then install and start it:

| | Install | Start |
|---|---|---|
| Windows | `.venv\Scripts\pip install -e .` | `.venv\Scripts\act-companion` |
| macOS / Linux | `.venv/bin/pip install -e .` | `.venv/bin/act-companion` |

ACT Companion opens in its own window (on Windows and macOS; on Linux, and with `act-companion --browser`, it uses your
web browser instead). Sign in with your activity.act.edu username and password, then open **Settings** to pick your alerts
and turn on **Start when I log in to this computer** so alerts keep arriving after a restart.

Alerts only arrive while ACT Companion is running. Closing the window (or browser tab) does not stop it; on Windows it stays
in the system tray. Use **Settings > Quit** or the tray icon's **Quit** to stop it. Running `act-companion` again while it
is already running brings the window back.

The code is mirrored at [github.com/Cyverno/act-companion](https://github.com/Cyverno/act-companion) and
[gitlab.com/AlexWeber64/act-companion](https://gitlab.com/AlexWeber64/act-companion).

### Alerts on each system

| System | How alerts appear | Notes |
|---|---|---|
| Windows 10/11 | Toast notifications; click one to open the item | Alerts are sent as "Windows PowerShell", so allow notifications for it and check Focus Assist / Do Not Disturb. |
| macOS | Notification Center | `brew install terminal-notifier` adds click-to-open. |
| Linux | `notify-send` | Install `libnotify-bin` (Debian/Ubuntu) or `libnotify` if it is missing. |

Use **Settings > Send a test alert**, or run `act-companion --test-notification`, to check.

## Privacy and security

- **Your password** is sent only to activity.act.edu, once, to get an access token. It is never stored.
- **The token** lives in your system keychain (Windows Credential Manager, macOS Keychain, or Secret Service on Linux).
  If there is no keychain, it falls back to a file only your user account can read. On Android it is in the app's private
  storage, which other apps cannot read, and it is left out of phone backups.
- **No servers, analytics or telemetry.** ACT Companion only ever talks to activity.act.edu.
- **The dashboard** listens on `127.0.0.1:8765` only, and every request needs a random key that the app hands your browser.
  Other programs, other people using the same computer, and websites cannot read your data through it.
- **Course content** such as forum posts is shown in a sandbox with scripts disabled, under a strict Content-Security-Policy.
- **Signing out** deletes the token and the app's alert history for your account.

App data (settings, alert history, log) is stored in:

- Windows: `%LOCALAPPDATA%\ACTCompanion`
- macOS: `~/Library/Application Support/ACTCompanion`
- Linux: `~/.local/share/ACTCompanion`

## Be kind to the school's server

Each check makes a few requests per watched course; the default is every 5 minutes, and grades every 15. If many students run this,
the load adds up, so please avoid very short intervals. Course-change alerts are off by default for the same reason. If the site is
down or starts refusing requests, ACT Companion backs off automatically (up to 30 minutes between tries).

## Uninstall

1. In **Settings**, turn off **Start when I log in**, then **Sign out** and **Quit**.
2. Delete ACT-Companion.exe (or the project folder, if you installed from source) and the app data folder above.

If you deleted the folder first, remove the startup entry by hand: the `ACTCompanion` value under
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (Windows), `~/Library/LaunchAgents/com.actcompanion.agent.plist` (macOS),
or `~/.config/autostart/act-companion.desktop` (Linux).

## Development

```sh
act-companion --check               # run one round of checks in the foreground
act-companion --test-notification   # show a test alert
act-companion --browser             # use your browser instead of the app window
```

There is no build step for development. The UI is plain HTML, CSS and JavaScript, served by the Python standard library.

To build the Windows .exe (on Windows):

```sh
.venv\Scripts\pip install -e ".[build]"
.venv\Scripts\python packaging\build_exe.py     # writes dist\ACT-Companion.exe
```

Release builds are not made by hand. The [Build workflow](.github/workflows/build.yml) builds the .exe on GitHub's
Windows runners, and the Android app, for every push and pull request (download them from the run's artifacts). To release, bump the version in
`src/act_companion/__init__.py` and `pyproject.toml`, then push a tag such as `v0.3.0`: the workflow creates a draft
release with both builds attached, ready to review and publish.

| File | Purpose |
|---|---|
| `src/act_companion/moodle.py` | Moodle Web Services client and token storage |
| `src/act_companion/watcher.py` | Background checks for deadlines, grades and (optionally) course changes |
| `src/act_companion/notify.py` | Desktop alerts per OS |
| `src/act_companion/autostart.py` | Start at login per OS |
| `src/act_companion/server.py` | Local web server, JSON API and file proxy |
| `src/act_companion/desktop.py` | The app window (pywebview, Edge WebView2 on Windows) and tray icon |
| `src/act_companion/static/app.js` | The dashboard UI (rendering, routing, interactions) |
| `src/act_companion/static/companion.css` | The design system and screen styles, exactly as exported from the design. Do not edit by hand; replace it with a new export |
| `src/act_companion/static/app.css` | Small runtime additions the design export does not cover |
| `web/` | The web app for iPhone and browsers: `web.js` answers the UI's API calls in the page, straight from activity.act.edu (`python web/build.py` builds it) |
| `android/` | The Android app: the web app in a WebView, plus background checks in Kotlin that port `watcher.py` (see [android/README.md](android/README.md)) |

`docs/DESIGN.md` describes how every screen is meant to behave.

Issues and merge requests are welcome. Please never include real student data (names, grades, messages) in issues or screenshots.

## License

[MIT](LICENSE). The bundled Inter font (SIL Open Font License) and Phosphor icons (MIT) keep their own licenses; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
