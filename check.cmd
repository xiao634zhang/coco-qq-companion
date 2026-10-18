@echo off
setlocal
for /d %%D in ("%~dp0.runtime\node-v24*-win-x64") do set "PROJECT_NODE=%%~fD\node.exe"
cd /d "%~dp0"
"%PROJECT_NODE%" node_modules\typescript\bin\tsc --noEmit
if errorlevel 1 goto failed
"%PROJECT_NODE%" --test "test/*.test.ts"
if errorlevel 1 goto failed
echo All checks passed.
pause
exit /b 0
:failed
echo Checks failed.
pause
exit /b 1
