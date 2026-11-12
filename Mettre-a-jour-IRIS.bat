@echo off
title IRIS//VIZ - mise a jour
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\mettre-a-jour.ps1"
echo.
pause
