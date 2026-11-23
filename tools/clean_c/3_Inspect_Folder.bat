@echo off
REM Lists what is big inside ONE folder (read only). Example: C:\Users\HP\AppData\Local\Google
cd /d "%~dp0"
set /p TARGET=Folder to inspect: 
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0CleanC.ps1" -Dig "%TARGET%"
echo.
pause
