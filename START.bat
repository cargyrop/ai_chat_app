@echo off
title BLACKLINE AI

:: Keep window open on any error
if "%1"=="" (
    cmd /k "%~f0" run
    exit /b
)

echo ============================================
echo   BLACKLINE AI - Starting
echo ============================================
echo.

echo Checking for Node.js...
node --version
if errorlevel 1 (
    echo.
    echo ERROR: Node.js was not found.
    echo.
    echo Please install Node.js from: https://nodejs.org
    echo Choose the LTS version, run the installer, then try again.
    echo.
    pause
    exit /b 1
)

echo Node.js OK.
echo.

cd /d "%~dp0"
echo Working directory: %CD%
echo.

if not exist "node_modules\" (
    echo Installing dependencies for the first time...
    call npm install --silent
    echo.
)

echo Starting server...
node server.js
echo.
echo Server stopped.
pause
