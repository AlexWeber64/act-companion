# ACT Companion

A desktop companion for [activity.act.edu](https://activity.act.edu), the school's Moodle site. See your deadlines, grades,
course files, forums and messages in one clean dashboard, and get desktop alerts before things are due.

It runs on your own computer and signs in with your own account, the same way the official Moodle mobile app does.

> **Unofficial.** ACT Companion is a student project. It is not affiliated with, endorsed by, or supported by the school.

## Features

- **Home dashboard:** what is due this week, overdue work, unread notifications and messages, your courses and grades at a glance.
- **Deadlines** grouped into Overdue, Today, Tomorrow, Next 7 days and Later.
- **Courses:** every course gets its own color. Browse content by section, filter files by name, download with one click.
  Assignments, forums (with attachments) and item-by-item grades with feedback are one tab away.
- **Search everything:** press `Ctrl K` (or `/`) to jump to any course, file, deadline or page.
- **Messages and notifications** in a familiar two-pane layout, with "mark all as read".
- **Light and dark themes** (follows your system, or pick one).
- **Desktop alerts** on Windows, macOS and Linux:
  - new deadlines, and reminders before they are due (24 hours and 1 hour by default)
  - newly posted grades (the grade itself stays hidden unless you turn that on)
  - *optional, off by default:* course changes, meaning new or newly visible files, resources and forum posts

## Install

You need [Python 3.10 or newer](https://www.python.org/downloads/) and git.

```sh
git clone https://github.com/Cyverno/act-companion.git
cd act-companion
python -m venv .venv
```

Then install and start it:

| | Install | Start |
|---|---|---|
| Windows | `.venv\Scripts\pip install -e .` | `.venv\Scripts\act-companion` |
| macOS / Linux | `.venv/bin/pip install -e .` | `.venv/bin/act-companion` |

Your browser opens ACT Companion. Sign in with your activity.act.edu username and password, then open **Settings** to pick
your alerts and turn on **Start when I log in to this computer** so alerts keep arriving after a restart.

Alerts only arrive while ACT Companion is running. Closing the browser tab does not stop it; use **Settings > Quit** for that.
Running `act-companion` again while it is already running just reopens the dashboard.

The code is mirrored on GitLab at [gitlab.com/AlexWeber64/act-companion](https://gitlab.com/AlexWeber64/act-companion).

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
  If there is no keychain, it falls back to a file only your user account can read.
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
2. Delete the project folder and the app data folder above.

If you deleted the folder first, remove the startup entry by hand: the `ACTCompanion` value under
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (Windows), `~/Library/LaunchAgents/com.actcompanion.agent.plist` (macOS),
or `~/.config/autostart/act-companion.desktop` (Linux).

## Development

```sh
act-companion --check               # run one round of checks in the foreground
act-companion --test-notification   # show a test alert
```

There is no build step. The UI is plain HTML, CSS and JavaScript, served by the Python standard library.

| File | Purpose |
|---|---|
| `src/act_companion/moodle.py` | Moodle Web Services client and token storage |
| `src/act_companion/watcher.py` | Background checks for deadlines, grades and (optionally) course changes |
| `src/act_companion/notify.py` | Desktop alerts per OS |
| `src/act_companion/autostart.py` | Start at login per OS |
| `src/act_companion/server.py` | Local web server, JSON API and file proxy |
| `src/act_companion/static/` | The dashboard UI |

Issues and merge requests are welcome. Please never include real student data (names, grades, messages) in issues or screenshots.

## License

[MIT](LICENSE)
