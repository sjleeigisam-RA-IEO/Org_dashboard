@echo off
setlocal
cd /d "%~dp0"
start "RA Insight v2 server" /min node serve-local.mjs 8766
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:8766/01.%%20RA%%20Portal/portfolio-analysis/index-v2.html"
