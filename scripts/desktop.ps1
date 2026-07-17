param(
    [Parameter(Position = 0)]
    [ValidateSet('dev', 'build', 'check')]
    [string] $Command = 'dev'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$cargoBin = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cargo\bin'
$cargo = Join-Path $cargoBin 'cargo.exe'
$rustc = Join-Path $cargoBin 'rustc.exe'
$tauri = Join-Path $root 'frontend\node_modules\@tauri-apps\cli\tauri.js'

# IDE terminals opened before Rust was installed keep an old PATH. Resolve the
# standard rustup location here so the documented npm commands still work.
if (Test-Path -LiteralPath $cargo) {
    $pathEntries = $env:PATH -split ';'
    if ($cargoBin -notin $pathEntries) {
        $env:PATH = "$cargoBin;$env:PATH"
    }
}

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    throw "Cargo was not found. Install Rust with rustup, then reopen your terminal. Expected: $cargo"
}
if (-not (Test-Path -LiteralPath $tauri)) {
    throw 'Tauri CLI was not found. Run .\scripts\setup.ps1 first.'
}

if ($Command -eq 'check') {
    & $cargo --version
    if (Test-Path -LiteralPath $rustc) {
        & $rustc --version
    }
    node --version
    & $cargo metadata --no-deps --format-version 1 --manifest-path (Join-Path $root 'src-tauri\Cargo.toml') | Out-Null
    Write-Host 'Tauri project metadata: OK'
    exit 0
}

Push-Location $root
try {
    node $tauri $Command --config 'src-tauri\tauri.conf.json'
    $exitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

exit $exitCode
