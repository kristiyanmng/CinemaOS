@echo off
title CinemaOS Agent Setup
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-Agent.ps1"
pause
