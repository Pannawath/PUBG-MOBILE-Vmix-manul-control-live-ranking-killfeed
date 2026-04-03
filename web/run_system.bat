@echo off
:: Use UTF-8 encoding for Thai characters
chcp 65001 >nul
title PUBG LIVE SYSTEM STARTER
echo ==========================================
echo       STARTING PUBG LIVE SYSTEM
echo ==========================================
echo.

:: 1. Control Server (Backend) - Port 3001
echo [1/5] Starting Control Server...
start "Control Server (Backend)" cmd /k "cd control\server && npm start"

:: 2. Control Client (Frontend) - Port 5173
echo [2/5] Starting Control Client...
start "Control Client (Frontend)" cmd /k "cd control\client && npm run dev"

:: 3. Ranking System - Port 3000
echo [3/5] Starting Ranking System...
start "Ranking System" cmd /k "cd "รับบบเปลี่ยน ranking" && npm start"

:: 4. Random Map - Port 3002 (Custom PORT to avoid conflict)
echo [4/5] Starting Random Map...
start "Random Map System" cmd /k "cd "random map" && set PORT=3002 && npm start"

:: 5. OCR Service (Python)
echo [5/6] Starting OCR Service...
:: Check if venv exists, otherwise try global python
if exist "control\ocr_service\venv\Scripts\python.exe" (
    start "OCR Service" cmd /k "cd control\ocr_service && venv\Scripts\python.exe main.py"
) else (
    echo Venv not found, trying global python...
    start "OCR Service" cmd /k "cd control\ocr_service && python main.py"
)

:: 6. vMix Mobile - Port 8000
echo [6/6] Starting vMix Mobile...
start "vMix Mobile Controller" cmd /k "cd vmix-mobile && node server.js"

echo.
echo ==========================================
echo      ALL SYSTEMS STARTED
echo ==========================================
echo.
echo Operational Ports:
echo - Ranking System: http://localhost:3000
echo - Control Backend: http://localhost:3001
echo - Random Map:     http://localhost:3002
echo - Control Panel:  http://localhost:5173
echo - vMix Mobile:    http://localhost:8000
echo.

echo Waiting 10 seconds for servers to initialize before opening browsers...
timeout /t 10

echo Opening Web Pages...
start http://localhost:5173
start http://localhost:3000
start http://localhost:3002/index.html
start http://localhost:8000

echo.
echo Done!
pause
