@echo off
REM Startet das PowerShell-Skript start.ps1 per Doppelklick.
REM ExecutionPolicy wird nur fuer diesen Aufruf umgangen (-ExecutionPolicy Bypass).
REM Beenden mit Strg+C im sich oeffnenden Fenster.
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
