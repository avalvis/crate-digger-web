# Crate Digger Web

A desktop-first web redesign of Crate Digger. React renders the interface; a loopback FastAPI sidecar adapts the existing Python media engine, SQLite vault, discovery, analysis, stems, and MPC export services.

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

`build-sidecar.ps1` packages the engine installed in `.venv`. The current Windows bundle includes the CPU Torch/Demucs runtime and is therefore about 277 MB; a future lightweight distribution can publish that engine as a separate optional pack.
