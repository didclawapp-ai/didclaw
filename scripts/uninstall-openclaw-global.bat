@echo off
setlocal
REM Uninstall global OpenClaw (npm) and clear npm cache — same flow as manual cleanup.
REM Does NOT delete %USERPROFILE%\.openclaw (configs, agents, workspace stay).

cd /d "%~dp0"

echo.
echo === Uninstall OpenClaw (global npm) ===
echo.

where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm not found in PATH. Install Node.js or fix PATH.
  pause
  exit /b 1
)

call npm uninstall -g openclaw
set "EC=%ERRORLEVEL%"

echo.
echo === npm cache clean --force ===
call npm cache clean --force

echo.
echo === Remove leftovers under %APPDATA%\npm (if any) ===
if exist "%APPDATA%\npm\node_modules\openclaw" (
  echo Removing "%APPDATA%\npm\node_modules\openclaw"
  rmdir /s /q "%APPDATA%\npm\node_modules\openclaw"
)
if exist "%APPDATA%\npm\openclaw" del /f /q "%APPDATA%\npm\openclaw"
if exist "%APPDATA%\npm\openclaw.cmd" del /f /q "%APPDATA%\npm\openclaw.cmd"
if exist "%APPDATA%\npm\openclaw.ps1" del /f /q "%APPDATA%\npm\openclaw.ps1"

echo.
echo Done.
echo   User data NOT removed: "%USERPROFILE%\.openclaw"
echo   Reinstall: npm install -g openclaw@latest
echo.
pause
exit /b %EC%
