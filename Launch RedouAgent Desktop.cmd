@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo.
echo RedouAgent desktop launcher
echo Project: %ROOT%
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*RedouAgent*electron*' } | Select-Object -First 1; if ($p) { (New-Object -ComObject WScript.Shell).AppActivate($p.Id) | Out-Null; exit 42 }"
if "%ERRORLEVEL%"=="42" (
  echo RedouAgent desktop is already running. Brought the window forward if Windows allowed it.
  echo.
  pause
  exit /b 0
)

if not exist "node_modules" (
  echo Installing JavaScript workspace dependencies with Bun 1.3.14...
  call npx.cmd --yes bun@1.3.14 install
  if errorlevel 1 (
    echo.
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

if not exist ".github\TEAM_MEMBERS" (
  echo # Local RedouAgent desktop development placeholder.> ".github\TEAM_MEMBERS"
)

if not exist "packages\opencode\runtimes\redou-codex\codex-rs\target\debug\redou-codex.exe" (
  echo.
  echo Warning: redou-codex.exe was not found.
  echo The desktop app can start, but redou-codex model runs may fail until the runtime is built.
  echo.
)

echo Starting RedouAgent desktop app...
echo Keep this window open while using the development desktop app.
echo.

call npx.cmd --yes bun@1.3.14 --cwd packages/desktop dev

echo.
echo RedouAgent desktop app stopped.
pause
