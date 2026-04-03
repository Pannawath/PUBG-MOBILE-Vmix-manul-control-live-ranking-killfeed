@echo off
echo Starting PUBG Killfeed OCR Service...

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Python is not installed or not in PATH.
    echo Please install Python from https://www.python.org/downloads/
    echo IMPORTANT: Check "Add Python to PATH" during installation.
    pause
    exit /b
)

cd ocr_service

if not exist "venv" (
    echo Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate

echo Installing dependencies (this may take a while the first time)...
pip install -r requirements.txt

echo.
echo ==========================================
echo  OCR Service Started
echo  Close this window to stop scanning.
echo ==========================================
python main.py

pause
