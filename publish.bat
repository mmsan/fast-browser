@echo off
cd /d "%~dp0"
node tools/publish.js
if errorlevel 1 (
  pause
  exit /b 1
)
