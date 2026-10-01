@echo off
setlocal
echo.
echo TDA Physical Acceptance Pack
echo ============================
echo.
where pwsh.exe >nul 2>nul
if errorlevel 1 (
  echo ERRO: PowerShell 7 ^(pwsh.exe^) nao encontrado.
  pause
  exit /b 1
)
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0RUN-ALL-TDA-ACCEPTANCE.ps1" -RepositoryPath "G:\Project\tda"
set EXITCODE=%ERRORLEVEL%
echo.
echo Exit code: %EXITCODE%
pause
exit /b %EXITCODE%
