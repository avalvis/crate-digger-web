# Crate Digger Web

A desktop-first web redesign of Crate Digger. React renders the interface; a loopback FastAPI sidecar adapts the existing Python media engine, SQLite vault, discovery, analysis, stems, and MPC export services.

Digital Crate v0.2 uses producer-focused Boom Bap, Lo-Fi, Global, and Cinematic lenses. It searches several Discogs lanes per dig, suppresses low-yield metal/EDM sources, diversifies countries and artists, and resolves only credible YouTube Music audio matches.

New to this stack? Read the [beginner developer guide](guide.md) for an explanation of each technology, daily commands, testing, sidecar packaging, and Windows installer builds.

## Development

Requirements: Node.js 20+, Python 3.11+, and (for the native shell) Rust plus the Windows MSVC Build Tools/SDK. MSVC is used only as the Windows linker and SDK; the shell itself is Rust.

```powershell
.\scripts\setup.ps1
.\scripts\dev.ps1
```

Open `http://127.0.0.1:5173`. The dev API token is `cratedigger-local`; packaged builds generate a fresh session token and bind the API to a random loopback port.

The lightweight setup supports the UI, SQLite vault, configuration, crates, and API tests. Install the full media engine when you need downloads, previews, analysis, or exports:

```powershell
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements-engine.txt
```

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest .\backend\tests
npm --prefix .\frontend test
npm --prefix .\frontend run build
```

## Desktop build

Install Rust and Tauri prerequisites, then package the Python sidecar and desktop application:

```powershell
.\scripts\build-sidecar.ps1
npm --prefix .\frontend run desktop:build
```

`build-sidecar.ps1` packages the engine installed in `.venv`. The Windows bundle includes the CPU Torch/Demucs runtime and is several hundred MB; a future lightweight distribution can publish that engine as a separate optional pack.

YouTube support also bundles the Node.js executable used for the build (22 or newer)
and the matching `yt-dlp-ejs` challenge solver. To refresh YouTube compatibility,
update the project's downloader before rebuilding the sidecar and desktop app:

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade "yt-dlp[default]" ytmusicapi imageio-ffmpeg
```

Updating `.venv` alone does not update an already installed desktop executable.
Normal desktop launches do not require administrator privileges. The interface
waits up to two minutes for a cold backend startup. Launch diagnostics are kept in
`%LOCALAPPDATA%\com.cratedigger.desktop\crate-digger-startup.log`; media and settings
diagnostics are in `crate-digger-desktop.log` beside it.

## Startup tool checks (v0.2.5)

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

Audio-analysis and stem libraries are checked too, but native/ML dependency
upgrades stay part of tested application releases. Newer incompatible downloader
dependencies are likewise reported instead of partially replacing working tools.
Managed releases live under the app data directory in `media-tools`; updates do
not overwrite the installed application or an in-use tool release.
