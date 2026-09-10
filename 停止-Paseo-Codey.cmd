@echo off
setlocal
chcp 65001 >nul
if defined REM_CODEY_NODE (
  set "REM_NODE=%REM_CODEY_NODE%"
) else (
  set "REM_NODE=node.exe"
  where node.exe >nul 2>&1
  if errorlevel 1 (
    echo Node.js 22+ not found. Add it to PATH or set REM_CODEY_NODE.
    if /i not "%~1"=="--no-pause" pause
    exit /b 1
  )
)
"%REM_NODE%" "%~dp0tools\launch_paseo_codey.mjs" --stop %*
set "REM_EXIT=%errorlevel%"
if /i "%~1"=="--no-pause" exit /b %REM_EXIT%
echo.
pause
exit /b %REM_EXIT%
