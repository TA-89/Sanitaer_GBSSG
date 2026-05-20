@echo off
REM Extrahiert die ersten Textzeilen aus jedem Auftrags-PDF (Word im Hintergrund).
REM Ergebnis: web\data\_extract\auftrag-titel.txt und auftrag-titel.json
REM
REM Dauer: ca. 5-10 Minuten fuer 73 PDFs.
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0extract-auftrag-titel.ps1"
echo.
echo Fertig. Druecke eine Taste zum Schliessen.
pause >nul
