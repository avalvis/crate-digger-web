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

# One-folder build: unlike --onefile, nothing is unpacked to %TEMP% on every
# launch (or on every Demucs worker start), so startup and stems are faster.
# The console stays enabled: the desktop shell hides it and reads the
# sidecar's stdout for the port handshake. UPX is disabled because it breaks
# Torch DLLs and slows startup. The generated spec goes to .tmp, not the repo.
& $python -m PyInstaller --noconfirm --clean --onedir --noupx `
    --name crate-digger-api `
    --specpath (Join-Path $root '.tmp') `
    --workpath (Join-Path $root 'build') `
    --distpath (Join-Path $root 'dist') `
    --paths (Join-Path $root 'backend') `
    --collect-submodules cratedigger_api --collect-submodules core --collect-submodules utils `
    --collect-all imageio_ffmpeg --collect-all yt_dlp_ejs `
    --collect-data ytmusicapi --collect-data demucs `
    --add-binary "${node}:tools" --add-data "${versions}:tools" `
    --exclude-module tkinter --exclude-module pytest --exclude-module _pytest `
    --exclude-module IPython --exclude-module matplotlib `
    (Join-Path $root 'backend\sidecar_entry.py')
if ($LASTEXITCODE -ne 0) { throw 'Sidecar packaging failed.' }

$bundle = Join-Path $root 'dist\crate-digger-api'
$internal = Join-Path $bundle '_internal'
function Assert-Bundled([string] $pattern, [string] $message) {
    $match = Get-ChildItem -LiteralPath $internal -Recurse -File | Where-Object { $_.FullName -match $pattern } | Select-Object -First 1
    if (-not $match) { throw $message }
}
Assert-Bundled 'yt_dlp_ejs.*solver.*core\.min\.js$' 'Packaged sidecar is missing YouTube challenge solver scripts.'
Assert-Bundled 'tools[\\/]node\.exe$' 'Packaged sidecar is missing the YouTube JavaScript runtime.'
Assert-Bundled 'ytmusicapi.*locales.*en.*base\.mo$' 'Packaged sidecar is missing ytmusicapi translation data.'
Assert-Bundled 'demucs.*remote.*files\.txt$' 'Packaged sidecar is missing the Demucs model registry.'

# Smoke test: the packaged API must start and report its port.
$smokeData = Join-Path $root '.tmp\sidecar-smoke'
$env:CRATEDIGGER_PORT = '0'
$env:CRATEDIGGER_DATA_DIR = $smokeData
$process = New-Object System.Diagnostics.Process
$process.StartInfo.FileName = Join-Path $bundle 'crate-digger-api.exe'
$process.StartInfo.UseShellExecute = $false
$process.StartInfo.RedirectStandardOutput = $true
$process.StartInfo.CreateNoWindow = $true
[void] $process.Start()
try {
    $line = $process.StandardOutput.ReadLineAsync()
    if (-not $line.Wait(120000) -or $line.Result -notmatch '^CRATEDIGGER_LISTENING port=\d+') {
        throw "Packaged sidecar did not report its port. First output: $($line.Result)"
    }
    Write-Host "Smoke test: $($line.Result)"
}
finally {
    if (-not $process.HasExited) { $process.Kill($true) }
    Remove-Item Env:CRATEDIGGER_PORT, Env:CRATEDIGGER_DATA_DIR -ErrorAction SilentlyContinue
}

$destination = Join-Path $root 'src-tauri\resources\crate-digger-api'
if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
Copy-Item -LiteralPath $bundle -Destination $destination -Recurse
Write-Host "Sidecar ready: $destination"
