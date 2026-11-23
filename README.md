# Crate Digger Web

A desktop-first web redesign of Crate Digger. React renders the interface; a loopback FastAPI sidecar adapts the existing Python media engine, SQLite vault, discovery, analysis, stems, and MPC export services.

Digital Crate v0.2 uses producer-focused Boom Bap, Lo-Fi, Global, and Cinematic lenses. It searches several Discogs lanes per dig, suppresses low-yield metal/EDM sources, diversifies countries and artists, and resolves only credible YouTube Music audio matches.

New to this stack? Read the [beginner developer guide](guide.md) for an explanation of each technology, daily commands, testing, sidecar packaging, and Windows installer builds.

## Development

Requirements: Node.js 22+, Python 3.14 (see `.python-version`), and (for the native shell) Rust plus the Windows MSVC Build Tools/SDK. MSVC is used only as the Windows linker and SDK; the shell itself is Rust.

```powershell
.\scripts\setup.ps1
.\scripts\dev.ps1
```

Open `http://127.0.0.1:5173`. The dev API token is `cratedigger-local`; packaged builds generate a fresh session token, and the sidecar binds its own free loopback port and reports it to the shell (`CRATEDIGGER_LISTENING port=…` on stdout).

The lightweight setup (`backend/requirements-dev.txt`: runtime plus test tools) supports the UI, SQLite vault, configuration, crates, and API tests. Install the full media engine when you need downloads, previews, analysis, or exports:

```powershell
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements-engine.txt
```

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest .\backend\tests
npm --prefix .\frontend test
npm --prefix .\frontend run build
```

`npm run build` also type-checks `frontend/src/lib/apiContract.ts`, which fails when the
hand-written client types drift from the backend schema. After changing an API model,
regenerate the schema and types:

```powershell
cd backend; ..\.venv\Scripts\python.exe -m cratedigger_api.openapi; cd ..
npm --prefix .\frontend run api:generate
```

GitHub Actions (`.github/workflows/ci.yml`) runs all of the above on Windows, plus a weekly
check that in-app tool updates still resolve against live PyPI.

## Desktop build

Install Rust and Tauri prerequisites, then package the Python sidecar and desktop application:

```powershell
.\scripts\build-sidecar.ps1
npm --prefix .\frontend run desktop:build
```

`build-sidecar.ps1` packages the engine installed in `.venv` as a PyInstaller **one-folder** bundle
(nothing is unpacked to `%TEMP%` on launch), smoke-tests that it starts and reports its port, and
copies it to `src-tauri/resources/crate-digger-api/`, which the installer ships as a resource. The Windows bundle includes the CPU Torch/Demucs runtime and is several hundred MB; a future lightweight distribution can publish that engine as a separate optional pack.

YouTube support also bundles the Node.js executable used for the build (22 or newer)
and the matching `yt-dlp-ejs` challenge solver. To refresh YouTube compatibility,
update the project's downloader before rebuilding the sidecar and desktop app:

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade "yt-dlp[default]" ytmusicapi imageio-ffmpeg
```

Updating `.venv` alone does not update an already installed desktop executable.
Normal desktop launches do not require administrator privileges. The interface
waits up to two minutes for a cold backend startup. If the engine exits unexpectedly,
the shell restarts it (up to three times in two minutes) while the UI shows a
"Reconnecting the audio engine…" overlay; after that it offers a manual restart.
Engine child processes (FFmpeg, Demucs) are tied to the engine with a Windows Job
Object, so none outlive it. Launch diagnostics are kept in
`%LOCALAPPDATA%\com.cratedigger.desktop\crate-digger-startup.log`; media and settings
diagnostics are in `crate-digger-desktop.log` beside it.

## Startup tool checks

Every launch checks the installed media tools in the background and queries the
publishers for current releases. **Settings → Media tools & updates** shows the
installed/latest versions and an **Update tools** button. Offline release checks
are reported as unavailable and do not prevent use of installed tools.

The app can independently update FFmpeg/FFprobe (stable Windows x64 builds), Node
(latest LTS), yt-dlp, its matching EJS solver, and ytmusicapi. It verifies publisher
SHA-256 checksums, validates the downloaded tools in a separate process, and
activates a complete release on the next launch. **Restore previous tools**
selects the prior release for the next launch. No administrator privileges or
system-wide Python/Node installation is needed.

Each tool updates independently: one failure never blocks the others, and failed
attempts are cleaned up. When a new yt-dlp needs a newer pure-Python dependency than
the app bundles (for example `certifi`), the updater stages that dependency alongside
it; optional extras that cannot be staged (compiled packages) keep the bundled copy.
**Use yt-dlp nightly builds** in the same panel tracks yt-dlp's nightly channel, which
fixes YouTube breakage days before a stable release.

Audio-analysis and stem libraries are checked too, but native/ML dependency
upgrades stay part of tested application releases. A downloader update that truly
requires a compiled dependency is reported instead of partially replacing working tools.
Managed releases live under the app data directory in `media-tools`; updates do
not overwrite the installed application or an in-use tool release.
