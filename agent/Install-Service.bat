@echo off
title Install CinemaOS Agent Service
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Please right-click this file and choose Run as administrator.
  pause
  exit /b 1
)
call npm install
node install-service.js
pause
