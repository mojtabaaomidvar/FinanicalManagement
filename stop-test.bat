@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local-test-environment.ps1" -Action Stop
if errorlevel 1 pause
