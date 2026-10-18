@echo off
setlocal
set "TEMP=%~dp0.runtime\tmp\snowluma"
set "TMP=%TEMP%"
if not exist "%TEMP%" mkdir "%TEMP%"
for /d %%D in ("%~dp0.runtime\node-v24*-win-x64") do set "PATH=%%~fD;%PATH%"
cd /d "%~dp0vendor\SnowLuma"
if not exist launcher.bat (
  echo SnowLuma package missing. See README.md.
  pause
  exit /b 1
)
call launcher.bat
