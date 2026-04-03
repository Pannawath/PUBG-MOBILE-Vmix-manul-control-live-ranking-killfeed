@echo off
title vMix Mobile Controller
color 0B

echo =======================================
echo    Starting vMix Mobile Server...
echo =======================================
echo.

:: เปลี่ยนโฟลเดอร์ให้ไปรันถูกที่
cd /d "%~dp0\vmix-mobile"

:: เรียกใช้งาน Node.js
node server.js

:: ล็อกหน้าจอหากมีข้อผิดพลาด
pause
