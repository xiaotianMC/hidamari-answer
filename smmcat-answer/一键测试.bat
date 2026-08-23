@echo off
title smmcat-answer Local Test
cd /d "%~dp0"

echo ==============================================
echo   smmcat-answer Local Test
echo ==============================================
echo.
echo   [1] Smoke test (automated, verify full flow)
echo   [2] Chat test (interactive, simulate group chat)
echo   [3] Exit
echo.
set /p choice=Select [1/2/3]:

if "%choice%"=="1" goto smoke
if "%choice%"=="2" goto chat
exit /b

:smoke
echo.
echo Running smoke test...
node scripts\smoke.cjs
echo.
pause
exit /b

:chat
echo.
echo Starting chat test (type "exit" to quit)...
node scripts\chat.cjs
echo.
pause
exit /b
