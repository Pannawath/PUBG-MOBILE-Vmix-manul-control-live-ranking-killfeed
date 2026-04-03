@echo off
chcp 65001 >nul
title PUBG LIVE - System Launcher
echo ==========================================
echo       STARTING PUBG LIVE SYSTEM
echo ==========================================
echo.

echo [1/3] Starting Server (Port 3001)...
start "Control Server" cmd /k "cd server && npm run dev"

echo [2/3] Starting Client (Port 5173)...
start "Control Client" cmd /k "cd client && npm run dev"

echo [3/3] Starting Ranking System (Port 3000)...
start "Ranking System" cmd /k "cd ..\รับบบเปลี่ยน ranking && node server.js"

echo.
echo ==========================================
echo        ALL SYSTEMS STARTED!
echo ==========================================
echo.
echo  - Admin Panel:    http://localhost:5173/admin
echo  - Ranking System: http://localhost:3000
echo.
