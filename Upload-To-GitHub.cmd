@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish-release.ps1"
if errorlevel 1 (
  echo.
  echo Upload failed. Review the message above and run this file again.
) else (
  echo.
  echo Vandar release is ready on GitHub.
)
pause
