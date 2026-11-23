@echo off
REM Report only: shows what is using drive C: (deletes nothing). Right-click -> Run as administrator for best results.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0CleanC.ps1" -Big
echo.
pause
