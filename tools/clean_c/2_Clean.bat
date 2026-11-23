@echo off
REM Clean: asks y/N for every category before deleting. Right-click -> Run as administrator.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0CleanC.ps1" -Clean
echo.
pause
