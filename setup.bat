@echo off
REM Badges Spoofer — Windows setup
cd /d "%~dp0"
echo.
echo   ============================================================
echo      BADGES SPOOFER  —  SETUP (Windows)
echo   ============================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   [!] Node.js not found. Install Node 18+ from https://nodejs.org
  pause
  exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do echo   [+] Node.js %%i
echo   [*] Zero runtime deps
call npm install --omit=dev 2>nul
if not exist data mkdir data
if not exist profiles mkdir profiles
if not exist debug mkdir debug

echo.
echo   Interactive:  node index.js
echo   Auto:         node index.js --auto --mode all --hours 2 --titles 40
echo   Drip:         node index.js --auto --pace drip --mode playtime
echo   Target:       node index.js --auto --target 500 --mode playtime
echo.
echo   Update: git pull --ff-only  (keeps vault.json)
echo.
node index.js %*
