@echo off
title FRC Mock UDP Sender
chcp 65001 >nul
cd /d "%~dp0"
go build -o mockudp.exe ./cmd/mockudp && mockudp.exe %*
pause
