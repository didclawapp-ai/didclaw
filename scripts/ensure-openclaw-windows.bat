@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure-openclaw-windows.ps1" %*
set "EC=%ERRORLEVEL%"
echo.
pause
exit /b %EC%
