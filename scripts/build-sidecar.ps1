$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'
& $python -m pip install pyinstaller
& $python -m PyInstaller --noconfirm --clean --onefile --name crate-digger-api --paths (Join-Path $root 'backend') --collect-submodules cratedigger_api --collect-submodules core --collect-submodules utils --collect-all imageio_ffmpeg --collect-data ytmusicapi --collect-data demucs (Join-Path $root 'backend\sidecar_entry.py')
$builtSidecar = Join-Path $root 'dist\crate-digger-api.exe'
$archiveViewer = Join-Path $root '.venv\Scripts\pyi-archive_viewer.exe'
$ytmusicLocale = & $archiveViewer -l $builtSidecar | Select-String -Pattern 'ytmusicapi.*locales.*en.*base\.mo' -Quiet
if (-not $ytmusicLocale) {
    throw 'Packaged sidecar is missing ytmusicapi translation data.'
}
$demucsRegistry = & $archiveViewer -l $builtSidecar | Select-String -Pattern 'demucs.*remote.*files\.txt' -Quiet
if (-not $demucsRegistry) {
    throw 'Packaged sidecar is missing the Demucs model registry.'
}
$triple = 'x86_64-pc-windows-msvc'
$destination = Join-Path $root "src-tauri\binaries\crate-digger-api-$triple.exe"
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
Copy-Item -Force -LiteralPath $builtSidecar -Destination $destination
Write-Host "Sidecar ready: $destination"
