@echo off
title CRM Data Auto-Update System
echo ==================================================
echo   CRM Data Auto-Update to Supabase Starting...
echo ==================================================
echo.

cd /d "%~dp0"

echo [1/2] Checking Python environment...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Python is not installed or not in PATH.
    pause
    exit /b
)

echo [2/2] Running Data Uploader...
python uploader.py

echo.
echo ==================================================
echo   Update Completed! Press any key to close.
echo ==================================================
pause
