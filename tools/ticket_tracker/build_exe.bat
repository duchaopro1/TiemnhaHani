@echo off
REM Build a single .exe (colleagues do not need Python). Run once on a machine with Python.
cd /d "%~dp0"
python -m pip install pyinstaller
python -m PyInstaller --onefile --noconsole --name TeamTicketTracker ticket_tracker_app.py
echo.
echo Done! File to send to colleagues: dist\TeamTicketTracker.exe
pause
