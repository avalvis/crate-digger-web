# Crate Digger developer guide

This guide explains the project in beginner-friendly terms and lists the commands used during development. Run all commands from the repository root:

```text
C:\Projects\crate-digger-web
```

Use PowerShell unless a command says otherwise.

## The stack in plain language

Crate Digger is a web interface packaged as a local Windows desktop application. It has three main pieces:

```text
React interface  →  local FastAPI server  →  Python media engine + SQLite
       ↑
   Tauri window
```

### Frontend

- **React** builds the screens and reusable interface components.
- **TypeScript** is JavaScript with type checking. It catches many mistakes before the app runs.
- **Vite** starts the development server and creates optimized production frontend files.
- **Tailwind CSS 4 and custom CSS** provide the visual styling and design tokens.
- **TanStack Query** loads and refreshes information from the Python API.
- **Zustand** holds temporary interface state, such as the active audio player.
- **wavesurfer.js** renders audio waveforms and supports future chopping regions.
- **Radix primitives** provide accessible building blocks for menus and dialogs.

Frontend source lives in `frontend/src`.

### Python backend

- **FastAPI** exposes the existing Python engine through a local HTTP API.
- **Pydantic** validates API requests, responses, and configuration.
- **SQLite + FTS5** store and search the local vault without a separate database server.
- **yt-dlp, FFmpeg, librosa, Torch, and Demucs** handle downloading, conversion, analysis, and stem separation.
- **PyInstaller** packages Python and its dependencies into `crate-digger-api.exe`.

The API adapter lives in `backend/cratedigger_api`. The reusable media engine lives in `backend/core` and `backend/utils`.

### Desktop shell

- **Tauri 2** opens the native Windows window and starts the packaged Python API beside it.
- **Rust** contains the small native shell and lifecycle code.
- **Microsoft MSVC Build Tools and Windows SDK** are only the Windows linker/toolchain used to compile Tauri. Crate Digger's native code is Rust, not C++.
- **WebView2** displays the React interface using the browser engine included with modern Windows.

Desktop source and configuration live in `src-tauri`.

## Important folders

| Path | Purpose |
|---|---|
| `frontend/src` | React and TypeScript interface |
| `backend/cratedigger_api` | FastAPI endpoints and desktop API runtime |
| `backend/core` | Downloading, DSP, discovery, stems, database, and export engine |
| `backend/utils` | Configuration, FFmpeg setup, and path utilities |
| `src-tauri/src` | Rust desktop-shell code |
| `src-tauri/tauri.conf.json` | Window and installer configuration |
| `scripts` | Setup, development, and packaging helpers |
| `.venv` | Local Python environment; generated, not source code |
| `frontend/node_modules` | Installed JavaScript packages; generated, not source code |
| `src-tauri/target` | Rust builds and Windows installers; generated |

The installed application's settings and SQLite database are kept under:

```text
%LOCALAPPDATA%\CrateDigger
```

The default library paths are:

```text
%USERPROFILE%\Music\CrateDigger_Vault
%USERPROFILE%\.cratedigger\staging
%USERPROFILE%\Music\CrateDigger_MPC
```

## First-time setup

The basic setup installs frontend packages and the lightweight Python API dependencies:

```powershell
.\scripts\setup.ps1
```

Install the complete downloading, analysis, and stem-separation engine with:

```powershell
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements-engine.txt
```

The native desktop shell additionally requires:

- Rust using the `stable-x86_64-pc-windows-msvc` toolchain
- Visual Studio Build Tools with **Desktop development with C++**
- MSVC x64/x86 Build Tools
- A Windows 10 or Windows 11 SDK
- WebView2 Runtime

Before the first desktop run, package the Python sidecar once:

```powershell
.\scripts\build-sidecar.ps1
```

Check the installed toolchain:

```powershell
rustc --version
cargo --version
node --version
python --version
npm --prefix .\frontend run desktop:check
```

If Rust was installed after PowerShell was opened, restart PowerShell. A temporary alternative is:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
```

## Daily development

### Run the complete desktop application

```powershell
npm --prefix .\frontend run desktop:dev
```

This starts Vite, compiles the Rust shell if needed, opens the Tauri window, and starts the packaged Python sidecar. Frontend edits normally appear through hot reload.

Close the development window or press `Ctrl+C` in the terminal to stop it.

Important: desktop development currently uses the same `%LOCALAPPDATA%\CrateDigger` data as the installed application. Do not use destructive test data while your real vault is configured.

### Run as a normal browser web app

```powershell
.\scripts\dev.ps1
```

Then open:

```text
http://127.0.0.1:5173
```

This mode runs the current Python source directly, making it the quickest option while changing the backend. The local development token is `cratedigger-local`. Stop it with `Ctrl+C`.

Restart this command after changing Python backend code; the current helper does not automatically reload Python modules.

### Run only the frontend

Use this only when a compatible backend is already running:

```powershell
npm --prefix .\frontend run dev
```

### Preview the production frontend

First build it, then start the preview server:

```powershell
npm --prefix .\frontend run build
npm --prefix .\frontend run preview
```

## Which rebuild is required?

| What changed? | Fastest way to test | Required before making an installer |
|---|---|---|
| React, TypeScript, or CSS | `npm --prefix .\frontend run desktop:dev` | Run `desktop:build` |
| Python API, core, or utilities | Restart `.\scripts\dev.ps1` | Rebuild the sidecar, then run `desktop:build` |
| Rust or `tauri.conf.json` | Restart `desktop:dev` | Run `desktop:build` |
| Python dependencies | Install into `.venv` and restart | Rebuild the sidecar, then run `desktop:build` |
| JavaScript dependencies | Run `npm install` and restart | Run `desktop:build` |

The installed application never reads source files from this repository. It changes only after a newer installer is built and installed.

## Tests and checks

### Run backend tests

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

### Run frontend tests once

```powershell
npm --prefix .\frontend test -- --run
```

### Run frontend tests continuously

```powershell
npm --prefix .\frontend run test:watch
```

### Type-check and build the frontend

```powershell
npm --prefix .\frontend run build
```

### Check the Rust shell

```powershell
npm --prefix .\frontend run desktop:check
```

### Run Playwright end-to-end tests

```powershell
npm --prefix .\frontend run test:e2e
```

Playwright browser binaries must be installed before the first end-to-end run:

```powershell
npm --prefix .\frontend exec playwright install
```

## Rebuild the Python sidecar

Rebuild the sidecar after changing Python backend code or Python dependencies:

```powershell
.\scripts\build-sidecar.ps1
```

This command:

1. Uses `.venv` and installs PyInstaller if necessary.
2. Packages FastAPI and the complete media engine into one executable.
3. Creates `dist\crate-digger-api.exe`.
4. Copies the correctly named sidecar into `src-tauri\binaries` for Tauri.

The build can take several minutes because Torch, Demucs, SciPy, and FFmpeg are included. Warnings about unavailable CUDA, TensorBoard, or Linux libraries are expected in the CPU-only Windows build.

## Build a new Windows installer

### 1. Choose a new version

Use semantic versioning:

- `0.1.1` → small fix
- `0.2.0` → meaningful new functionality
- `1.0.0` → stable public release

Keep the version synchronized in:

```text
backend/cratedigger_api/runtime.py
backend/pyproject.toml
frontend/package.json
frontend/package-lock.json
frontend/src/components/Sidebar.tsx
src-tauri/Cargo.toml
src-tauri/Cargo.lock
src-tauri/tauri.conf.json
```

Also update version assertions or generated API metadata when applicable.

### 2. Run the tests

```powershell
.\.venv\Scripts\python.exe -m pytest -q
npm --prefix .\frontend test -- --run
npm --prefix .\frontend run build
npm --prefix .\frontend run desktop:check
```

### 3. Rebuild the Python sidecar

```powershell
.\scripts\build-sidecar.ps1
```

Do this whenever Python code, Python dependencies, or the API version changed.

### 4. Build the desktop application and installers

```powershell
npm --prefix .\frontend run desktop:build
```

The resulting installers are written to:

```text
src-tauri\target\release\bundle\nsis\Crate Digger_<version>_x64-setup.exe
src-tauri\target\release\bundle\msi\Crate Digger_<version>_x64_en-US.msi
```

Use the NSIS `.exe` for normal testing and distribution. A user can close Crate Digger and run a newer installer over the existing version. The application files are upgraded while the data under `%LOCALAPPDATA%\CrateDigger` and the configured vault remain in place.

The installers are currently unsigned, so Windows SmartScreen may show an **Unknown publisher** warning.

## Add or update dependencies

### Frontend package

```powershell
npm --prefix .\frontend install package-name
```

### Lightweight backend package

Add it to `backend/requirements.txt`, then run:

```powershell
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
```

### Media-engine package

Add it to `backend/requirements-engine.txt`, then run:

```powershell
.\.venv\Scripts\python.exe -m pip install -r .\backend\requirements-engine.txt
```

Rebuild the sidecar after changing Python dependencies.

## API contract generation

FastAPI produces an OpenAPI description of the backend. After changing an API request or response model, regenerate both the schema and the frontend TypeScript types:

```powershell
Push-Location .\backend
..\.venv\Scripts\python.exe -m cratedigger_api.openapi
Pop-Location
npm --prefix .\frontend run api:generate
```

Contract changes should be followed by backend tests, frontend type checking, and regeneration of the client types.

## Common problems

### `cargo` or `rustc` is not recognized

The project's `desktop:dev`, `desktop:build`, and `desktop:check` commands automatically add Rust's standard installation directory to their child process. Verify that setup with:

```powershell
npm --prefix .\frontend run desktop:check
```

For other Cargo commands, restart PowerShell or temporarily add Cargo to the current session:

```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
```

### Settings are empty just after startup

Version `0.1.1` and later wait for the packaged Python API and retry startup requests. If loading eventually reports an error, close and reopen the app, then check whether `crate-digger-api.exe` was blocked by antivirus software.

### A Python change is missing in desktop mode

The Tauri app runs the packaged sidecar, not Python files directly. Stop the app, rebuild the sidecar, and start desktop mode again:

```powershell
.\scripts\build-sidecar.ps1
npm --prefix .\frontend run desktop:dev
```

### Installer build uses an old backend

Run the commands in this order:

```powershell
.\scripts\build-sidecar.ps1
npm --prefix .\frontend run desktop:build
```

### Digital Crate returns an error or weak matches

The default Digital Crate is intentionally producer-focused. Leave Genre override on **Let the lens choose**, choose a producer lens, and use **Dig for gems** to explore a fresh portfolio. Explicit genre filters are respected even when they are outside the recommended sample-source lanes.

Live discovery uses the Discogs token. YouTube Music supplies the playable match. The DeepSeek key is optional and is currently used to clean metadata during the download pipeline; it is not required to dig or preview records.

The web app writes detailed diagnostics to:

```text
%LOCALAPPDATA%\CrateDigger\cratedigger-web.log
```

The older `cratedigger.log` belongs to the previous Tkinter application and may contain stale errors.

### Port already in use

The installed Tauri app chooses a random loopback port automatically. Browser development uses ports `8000` and `5173`; close older development terminals before starting another copy.

## Recommended working rhythm

1. Make a small change.
2. Test frontend work with `desktop:dev`, or Python work with `scripts\dev.ps1`.
3. Run the relevant automated tests.
4. Repeat until a useful checkpoint is ready.
5. Bump the version.
6. Run the complete test set.
7. Rebuild the Python sidecar when required.
8. Build and install the new NSIS package.

An installer is a release artifact, so it does not need to be rebuilt after every line of code.
