@echo off
:: Use UTF-8 encoding
chcp 65001 >nul
title STOP PUBG LIVE SYSTEM
echo ==========================================
echo       STOPPING PUBG LIVE SYSTEM
echo ==========================================
echo.

echo [1/3] Killing Node.js Processes (Backend, Frontend, Maps)...
taskkill /F /IM node.exe /T 2>nul
if %ERRORLEVEL% equ 0 (
    echo    - Node.js processes stopped.
) else (
    echo    - No Node.js processes found or access denied.
)

echo.
echo [2/3] Killing Python Processes (OCR Service)...
taskkill /F /IM python.exe /T 2>nul
if %ERRORLEVEL% equ 0 (
    echo    - Python processes stopped.
) else (
    echo    - No Python processes found.
)

echo.
echo [3/3] Closing Command Windows...
:: Attempt to close specific titled windows if they remain
taskkill /F /FI "WINDOWTITLE eq Control Server*" 2>nul
taskkill /F /FI "WINDOWTITLE eq Control Client*" 2>nul
taskkill /F /FI "WINDOWTITLE eq Ranking System*" 2>nul
taskkill /F /FI "WINDOWTITLE eq Random Map System*" 2>nul
taskkill /F /FI "WINDOWTITLE eq OCR Service*" 2>nul

echo.
echo ==========================================
echo           ALL SYSTEMS STOPPED
echo ==========================================
echo.
pause
