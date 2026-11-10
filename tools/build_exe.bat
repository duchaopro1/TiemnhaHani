@echo off
REM Dong goi thanh 1 file .exe (dong nghiep khong can cai Python). Chay 1 lan tren may co Python.
cd /d "%~dp0"
python -m pip install pyinstaller
python -m PyInstaller --onefile --noconsole --name IGBT_Drop_Avg igbt_gui.py
echo.
echo Xong! File gui cho dong nghiep: dist\IGBT_Drop_Avg.exe
pause
