@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local-test-environment.ps1" -Action Refresh -OpenBrowser
if errorlevel 1 pause
