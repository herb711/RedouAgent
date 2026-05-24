@echo off
setlocal

for %%I in ("%~dp0..") do set "RUNTIME_ROOT=%%~fI"
for %%I in ("%RUNTIME_ROOT%\..\..") do set "REDOU_PROJECT_ROOT=%%~fI"
if not defined REDOU_CODEX_HOME set "REDOU_CODEX_HOME=%REDOU_PROJECT_ROOT%\.redou\redou-codex"
set "CODEX_HOME=%REDOU_CODEX_HOME%"
set "REDOU_CODEX_RUNTIME=1"
set "REDOU_CODEX_MANAGED_PACKAGE_ROOT=%RUNTIME_ROOT%"
if not exist "%REDOU_CODEX_HOME%" mkdir "%REDOU_CODEX_HOME%" >nul 2>nul

set "RELEASE_BIN=%RUNTIME_ROOT%\codex-rs\target\release\redou-codex.exe"
set "DEBUG_BIN=%RUNTIME_ROOT%\codex-rs\target\debug\redou-codex.exe"
set "NODE_WRAPPER=%RUNTIME_ROOT%\codex-cli\bin\redou-codex.js"

if exist "%RELEASE_BIN%" (
  echo redou-codex exe: "%RELEASE_BIN%" 1>&2
  "%RELEASE_BIN%" %*
  if errorlevel 1 exit /b 1
  exit /b 0
)

if exist "%DEBUG_BIN%" (
  echo redou-codex exe: "%DEBUG_BIN%" 1>&2
  "%DEBUG_BIN%" %*
  if errorlevel 1 exit /b 1
  exit /b 0
)

if not "%REDOU_CODEX_DEV_MODE%"=="1" if not "%REDOU_CODEX_ALLOW_CARGO_FALLBACK%"=="1" (
  echo REDOU_CODEX_RUNTIME_NOT_FOUND: redou-codex.exe
  exit /b 1
)

if exist "%NODE_WRAPPER%" (
  node "%NODE_WRAPPER%" %*
  if errorlevel 1 exit /b 1
  exit /b 0
)

echo REDOU_CODEX_RUNTIME_NOT_FOUND: redou-codex.exe
exit /b 1
