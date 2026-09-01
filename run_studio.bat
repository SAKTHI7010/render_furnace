@echo off
title SmartMelt Studio
echo Starting SmartMelt Studio...
echo.
echo The app will open in your default browser at http://localhost:8000
echo Do not close this window while using the app.
echo.

:: Start the browser (it will retry until the server is up, or just load once the server binds)
start http://localhost:8000

:: Start the combined backend + frontend server
call .venv\Scripts\activate
uvicorn backend.main:app --host 0.0.0.0 --port 8000
