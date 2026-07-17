$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    throw 'Run scripts\setup.ps1 first.'
}
$backend = Start-Process -FilePath $python -ArgumentList '-m','cratedigger_api.cli' -WorkingDirectory (Join-Path $root 'backend') -WindowStyle Hidden -PassThru
try {
    npm --prefix (Join-Path $root 'frontend') run dev
}
finally {
    Stop-Process -Id $backend.Id -ErrorAction SilentlyContinue
}

