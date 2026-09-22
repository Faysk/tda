@echo off
setlocal
where pwsh.exe >nul 2>nul
if errorlevel 1 (
  echo POWERSHELL_7_REQUIRED
  exit /b 1
)
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-final-current-source-acceptance.ps1" %*
exit /b %ERRORLEVEL%
