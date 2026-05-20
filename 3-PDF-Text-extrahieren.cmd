@echo off
REM Startet das PowerShell-Skript extract-pdf-text.ps1 per Doppelklick.
REM Wandelt das Schullehrplan-PDF via Word in eine .txt um.
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0extract-pdf-text.ps1"
echo.
echo Fertig. Druecke eine Taste zum Schliessen.
pause >nul
