@echo off
setlocal
cd /d "%~dp0"
echo.
echo   9ssault / ULTIMATE EDITION
echo   Offline preview by default. No packages to install.
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js 22 or newer is required: https://nodejs.org/
  pause
  exit /b 1
)
node -e "if (Number(process.versions.node.split('.')[0]) < 22) process.exit(1)"
if errorlevel 1 (
  echo   Please upgrade to Node.js 22 or newer: https://nodejs.org/
  pause
  exit /b 1
)
node index.js %*
exit /b %errorlevel%
