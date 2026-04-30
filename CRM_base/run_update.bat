@echo off
title CRM Data Dashboard - DB Sync Tool
echo ======================================================
echo           CRM Data Dashboard - Syncing...
echo ======================================================
echo.
echo [STEP 1] Checking Excel files in the folder...
echo [STEP 2] Processing Lender, Beneficiary, Assets, and Fund Master...
echo [STEP 3] Uploading to Supabase Cloud Database...
echo.

:: Execute the python uploader
python "%~dp0uploader.py"

echo.
echo ======================================================
echo           DB Update Process Finished!
echo ======================================================
echo.
echo You can now check the results in your dashboard.
pause
