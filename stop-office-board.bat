@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\stop-office-board.ps1" -Port 3006 -Data "%~dp0data"
pause
