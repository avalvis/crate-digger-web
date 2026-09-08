$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'
$versions = Join-Path $root '.tmp\bundled-versions.json'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $versions) | Out-Null
& $python (Join-Path $PSScriptRoot 'collect-tool-versions.py') $versions
if ($LASTEXITCODE -ne 0) { throw 'Could not collect bundled tool versions.' }
$node = (Get-Command node -ErrorAction Stop).Source
$nodeMajor = [int]((& $node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw 'YouTube downloads require Node.js 22 or newer.' }
& $python -m pip install pyinstaller
if ($LASTEXITCODE -ne 0) { throw 'Could not install PyInstaller.' }
& $python -c 'import yt_dlp_ejs'
if ($LASTEXITCODE -ne 0) { throw 'Install backend/requirements-engine.txt before building (YouTube challenge solver missing).' }
& $python -m PyInstaller --noconfirm --clean --onefile --name crate-digger-api --paths (Join-Path $root 'backend') --collect-submodules cratedigger_api --collect-submodules core --collect-submodules utils --collect-all imageio_ffmpeg --collect-all yt_dlp_ejs --add-binary "${node}:tools" --add-data "${versions}:tools" --collect-data ytmusicapi --collect-data demucs (Join-Path $root 'backend\sidecar_entry.py')
if ($LASTEXITCODE -ne 0) { throw 'Sidecar packaging failed.' }
$builtSidecar = Join-Path $root 'dist\crate-digger-api.exe'
$archiveViewer = Join-Path $root '.venv\Scripts\pyi-archive_viewer.exe'
$archive = & $archiveViewer -l $builtSidecar
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect packaged sidecar.' }
if (-not ($archive | Select-String -Pattern 'yt_dlp_ejs.*solver.*core.min.js' -Quiet)) {
    throw 'Packaged sidecar is missing YouTube challenge solver scripts.'
}
if (-not ($archive | Select-String -Pattern 'tools.*node.exe' -Quiet)) {
    throw 'Packaged sidecar is missing the YouTube JavaScript runtime.'
}
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
