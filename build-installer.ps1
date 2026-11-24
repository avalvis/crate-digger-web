<#
.SYNOPSIS
    Build the latest Crate Digger Windows installer in one step.

.DESCRIPTION
    1. Packages the Python engine (scripts\build-sidecar.ps1, includes a smoke test).
    2. Builds the desktop app and its installers (Tauri: NSIS setup + MSI).
    3. Copies the new installers to the repository root as
         CrateDigger-<version>-Setup.exe   (recommended: double-click to install/upgrade)
         CrateDigger-<version>.msi
       and removes older copies from the root, so the latest is always here.

    Run from anywhere:  .\build-installer.ps1
    Or double-click:    Build Installer.cmd
    Skip the engine step when only the UI/shell changed:  .\build-installer.ps1 -SkipEngine
#>
param(
    [switch] $SkipEngine
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$started = Get-Date
$version = (Get-Content -Raw (Join-Path $root 'src-tauri\tauri.conf.json') | ConvertFrom-Json).version

function Step([string] $message) {
    Write-Host ''
    Write-Host "==> $message" -ForegroundColor Yellow
}

Write-Host "Building Crate Digger $version installer" -ForegroundColor Cyan

if ($SkipEngine) {
    $engine = Join-Path $root 'src-tauri\resources\crate-digger-api\crate-digger-api.exe'
    if (-not (Test-Path -LiteralPath $engine)) { throw 'No packaged engine found; run without -SkipEngine first.' }
    Step 'Skipping engine packaging (reusing the existing one)'
}
else {
    Step 'Packaging the audio engine (this takes a few minutes)'
    & (Join-Path $root 'scripts\build-sidecar.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Engine packaging failed.' }
}

Step 'Installing frontend dependencies'
npm --prefix (Join-Path $root 'frontend') ci --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }

Step 'Building the desktop app and installers'
& (Join-Path $root 'scripts\desktop.ps1') build
if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }

Step 'Copying the installers to the project root'
$bundle = Join-Path $root 'src-tauri\target\release\bundle'
$setup = Get-ChildItem -LiteralPath (Join-Path $bundle 'nsis') -Filter "*_${version}_x64-setup.exe" | Select-Object -First 1
$msi = Get-ChildItem -LiteralPath (Join-Path $bundle 'msi') -Filter "*_${version}_x64_*.msi" | Select-Object -First 1
if (-not $setup) { throw "The build finished but no $version setup .exe was found in $bundle\nsis." }

# Keep only the latest installers in the root.
Get-ChildItem -LiteralPath $root -File | Where-Object { $_.Name -like 'CrateDigger-*-Setup.exe' -or $_.Name -like 'CrateDigger-*.msi' } | Remove-Item -Force
$setupTarget = Join-Path $root "CrateDigger-$version-Setup.exe"
Copy-Item -LiteralPath $setup.FullName -Destination $setupTarget
if ($msi) { Copy-Item -LiteralPath $msi.FullName -Destination (Join-Path $root "CrateDigger-$version.msi") }

$minutes = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
Write-Host ''
Write-Host "Done in $minutes min." -ForegroundColor Green
Write-Host "Latest installer: $setupTarget" -ForegroundColor Green
if ($msi) { Write-Host "MSI:              $(Join-Path $root "CrateDigger-$version.msi")" }
