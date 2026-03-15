@echo off
title Linker Pro
color 0B
cd /d "%~dp0"

echo.
echo  ============================================
echo      LINKER PRO - Multi-Platform Dashboard
echo  ============================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed!
    echo  Download it from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

if not exist "frontend\node_modules" (
    echo  Installing dependencies first time, please wait...
    echo.
    cd /d "%~dp0frontend"
    npm install
    if %errorlevel% neq 0 (
        echo.
        echo  [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
    cd /d "%~dp0"
    echo.
)

echo  Starting Linker Pro...
echo.
echo  Opening in browser: http://localhost:3001
echo  Close this window to stop the server.
echo.

start "" cmd /c "ping -n 6 127.0.0.1 >nul && start http://localhost:3001"
cd /d "%~dp0frontend"
npx next dev --port 3001

pause
