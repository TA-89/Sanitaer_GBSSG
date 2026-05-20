@echo off
REM Startet das PowerShell-Skript link-pdfs.ps1 per Doppelklick.
REM ExecutionPolicy wird nur fuer diesen Aufruf umgangen (-ExecutionPolicy Bypass).
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0link-pdfs.ps1"
echo.
echo Fertig. Druecke eine Taste zum Schliessen.
pause >nul
