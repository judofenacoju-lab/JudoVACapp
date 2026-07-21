@echo off
setlocal
REM Lanceur Windows — n'exige pas que npm soit deja dans le PATH
set "NODE_DIR=C:\Program Files\nodejs"
if not exist "%NODE_DIR%\npm.cmd" (
  echo Node.js introuvable dans "%NODE_DIR%".
  echo Installez Node.js 20+ depuis https://nodejs.org puis reessayez.
  exit /b 1
)
set "PATH=%NODE_DIR%;%PATH%"
cd /d "%~dp0"
"%NODE_DIR%\npm.cmd" run dev %*
