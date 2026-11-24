@echo off
rem Double-click to build the latest Crate Digger installer into this folder.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-installer.ps1" %*
echo.
pause
