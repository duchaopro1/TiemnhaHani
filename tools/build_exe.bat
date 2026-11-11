@echo off
REM Build a single .exe (colleagues do not need Python). Run once on a machine with Python.
cd /d "%~dp0"
python -m pip install pyinstaller
python -m PyInstaller --onefile --noconsole --name IGBT_Drop_Avg igbt_gui.py
echo.
echo Done! File to send to colleagues: dist\IGBT_Drop_Avg.exe
pause
