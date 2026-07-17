$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
python -m venv (Join-Path $root '.venv')
& (Join-Path $root '.venv\Scripts\python.exe') -m pip install -r (Join-Path $root 'backend\requirements.txt')
npm --prefix (Join-Path $root 'frontend') install

