@echo off
title FRC Engineer - Backend
cd /d "%~dp0"
go build -o frc.engineer.exe ./cmd/server && frc.engineer.exe
pause
