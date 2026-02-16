@echo off
cd /d "%~dp0"
start "FRC Engineer - Backend" cmd /c start-backend.bat
start "FRC Engineer - Frontend" cmd /c start-frontend.bat
