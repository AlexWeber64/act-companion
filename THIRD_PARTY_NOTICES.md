# Third-party notices

ACT Companion bundles the following third-party assets. Their licenses apply to those files only;
the rest of the project is under the [MIT license](LICENSE).

## Inter (typeface)

- File: `src/act_companion/static/fonts/InterVariable.woff2`
- Source: https://github.com/rsms/inter (release 4.1)
- License: SIL Open Font License 1.1, full text in `src/act_companion/static/fonts/OFL.txt`
- Copyright (c) 2016 The Inter Project Authors

## Phosphor Icons

- File: `src/act_companion/static/icons.svg` (a sprite with the icons the app uses)
- Source: https://github.com/phosphor-icons/core
- License: MIT

```
MIT License

Copyright (c) 2023 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Libraries bundled in the Windows .exe

`ACT-Companion.exe` is built with PyInstaller and contains a Python runtime plus these packages, each under its own
license (versions as of the latest build):

| Package | License |
|---|---|
| Python | PSF License |
| pywebview | BSD 3-Clause |
| pythonnet, clr_loader | MIT |
| pystray | LGPL-3.0 (see below) |
| Pillow | MIT-CMU |
| requests | Apache-2.0 |
| certifi | MPL-2.0 |
| urllib3, charset-normalizer, keyring, platformdirs, bottle, proxy_tools, jaraco.*, more-itertools, six | MIT |
| idna, pycparser, pywin32-ctypes | BSD 3-Clause |
| cffi | MIT-0 |
| typing_extensions | PSF-2.0 |

pystray is used unmodified under the GNU Lesser General Public License v3. Its source is at
https://github.com/moses-palmer/pystray. Because ACT Companion's own source and build script (`packaging/build_exe.py`)
are public, you can rebuild the .exe with any other version of pystray.

The app window uses Microsoft Edge WebView2, which is part of Windows and is not bundled.

## Libraries bundled in the Android app

`ACT-Companion.apk` contains the Kotlin standard library and these AndroidX libraries, all under the Apache License 2.0:
core, activity, work (WorkManager) and webkit, with their AndroidX dependencies. Pages are shown by Android System
WebView, which is part of Android and is not bundled.

## Design

The UI design (`companion.css`, `icons.svg`, `icon.svg`, `theme.js`, and the notes in `docs/DESIGN.md`) was made with
Claude Design. The SVG files carry the C2PA content credentials it attached.
