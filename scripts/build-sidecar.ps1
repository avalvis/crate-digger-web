$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'
& $python -m pip install pyinstaller
& $python -m PyInstaller --noconfirm --clean --onefile --name crate-digger-api --paths (Join-Path $root 'backend') --collect-submodules cratedigger_api --collect-submodules core --collect-submodules utils --collect-all imageio_ffmpeg (Join-Path $root 'backend\sidecar_entry.py')
$triple = 'x86_64-pc-windows-msvc'
$destination = Join-Path $root "src-tauri\binaries\crate-digger-api-$triple.exe"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
Copy-Item -Force -LiteralPath (Join-Path $root 'dist\crate-digger-api.exe') -Destination $destination
Write-Host "Sidecar ready: $destination"
