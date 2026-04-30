@echo off
pushd "%~dp0"
title CRM Dashboard Server
echo ======================================================
echo           CRM Dashboard Local Server
echo ======================================================
echo.
echo Current Directory: %cd%
echo.
echo Server is starting...
echo Once started, the dashboard will open in your browser.
echo.
echo URL: http://localhost:8000
echo.
echo (To stop the server, close this window)
echo ======================================================
echo.

:: Open the browser
start http://localhost:8000

:: Start the Python local server on port 8000
python -m http.server 8000
popd
