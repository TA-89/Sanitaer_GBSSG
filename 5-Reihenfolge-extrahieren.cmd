@echo off
REM Liest aus den Master-Excels die zeitliche Reihenfolge der Lernauftraege
REM und erzeugt web\data\lernpfad-reihenfolge.json.
REM
REM Dauer: ca. 30-90 Sekunden.
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0extract-reihenfolge.ps1"
echo.
echo Fertig. Druecke eine Taste zum Schliessen.
pause >nul
