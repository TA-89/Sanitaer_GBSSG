# Sanitär GBS – Lernplattform · Auftragstitel aus allen PDFs extrahieren
# -----------------------------------------------------------------------
# Öffnet jeden Lernauftrags-PDF mit Microsoft Word und extrahiert die
# erste Textseite. Das Ergebnis landet in
# web\data\_extract\auftrag-titel.txt und web\data\_extract\auftrag-titel.json
#
# Vorbereitung: In Word einmal "Diese Meldung nicht mehr anzeigen" aktivieren.

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$ErrorActionPreference = 'Continue'

$webRoot   = $PSScriptRoot
if (-not $webRoot) { $webRoot = (Get-Location).Path }
$dataRoot  = Split-Path $webRoot -Parent   # ..\14_Webseite Sanitär
$outDir    = Join-Path $webRoot 'data\_extract'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

$outTxt  = Join-Path $outDir 'auftrag-titel.txt'
$outJson = Join-Path $outDir 'auftrag-titel.json'

Write-Host "Sanitaer GBS - Auftragstitel extrahieren" -ForegroundColor Cyan
Write-Host "Quelle: $dataRoot"
Write-Host "Ziel:   $outDir"
Write-Host ""

# Word starten
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
} catch {
  Write-Host "FEHLER: Microsoft Word konnte nicht gestartet werden." -ForegroundColor Red
  exit 1
}

# Sammle alle PDFs aus den Semester-Ordnern
$pdfList = @()
foreach ($i in 1..8) {
  $src = Join-Path $dataRoot "$i.Semester"
  if (-not (Test-Path $src)) { continue }
  foreach ($pdf in Get-ChildItem -Path $src -Filter '*_Auftrag.pdf' -File) {
    $id = ($pdf.BaseName -replace '_Auftrag$','')
    $pdfList += @{ Id = $id; Semester = $i; Pfad = $pdf.FullName; Datei = $pdf.Name }
  }
}

# Sortiere nach Auftragsnummer
$pdfList = $pdfList | Sort-Object @{ Expression = { [int]$_.Semester } }, @{ Expression = { [decimal]($_.Id -split '\.' | Select-Object -Last 1) } }

Write-Host "$($pdfList.Count) PDFs gefunden." -ForegroundColor Gray
Write-Host ""

# Pro PDF: öffnen, Text der ersten ~3000 Zeichen lesen, Titelkandidaten extrahieren
$entries = @()
$total = $pdfList.Count
$idx = 0
foreach ($item in $pdfList) {
  $idx++
  Write-Host "[$idx/$total] $($item.Id) ..." -NoNewline -ForegroundColor Gray
  try {
    $doc = $word.Documents.Open(
      [ref] $item.Pfad,
      [ref] $false,   # ConfirmConversions
      [ref] $true,    # ReadOnly
      [ref] $false    # AddToRecentFiles
    )
    # Erste ca. 3000 Zeichen reichen, um Titel zu finden
    $maxLen = [Math]::Min(3000, $doc.Content.Text.Length)
    $rawText = $doc.Range(0, $maxLen).Text
    $doc.Close([ref] $false)

    # Bereinigen: \r → \n, Bell-Zeichen weg, mehrere Whitespaces zusammenfassen
    $clean = $rawText -replace "[\x07]", "" -replace "`r", "`n"
    $lines = $clean -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_.Length -gt 0 }

    # Titelkandidat: die ersten 5 sinnvollen Zeilen
    $kandidaten = @($lines | Select-Object -First 8)
    $entries += @{
      id = $item.Id
      semester = $item.Semester
      datei = $item.Datei
      kandidaten = $kandidaten
    }
    Write-Host " ok" -ForegroundColor Green
  } catch {
    Write-Host " FEHLER: $($_.Exception.Message)" -ForegroundColor Red
    $entries += @{
      id = $item.Id
      semester = $item.Semester
      datei = $item.Datei
      kandidaten = @()
      fehler = $_.Exception.Message
    }
  }
}

# Word beenden
try { $word.Quit() } catch {}
try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}

# Lesbare TXT-Ausgabe
$sb = New-Object System.Text.StringBuilder
foreach ($e in $entries) {
  [void]$sb.AppendLine("=== Auftrag $($e.id) (Semester $($e.semester)) ===")
  [void]$sb.AppendLine("Datei: $($e.datei)")
  if ($e.fehler) {
    [void]$sb.AppendLine("FEHLER: $($e.fehler)")
  } else {
    foreach ($k in $e.kandidaten) {
      [void]$sb.AppendLine("  $k")
    }
  }
  [void]$sb.AppendLine("")
}
[System.IO.File]::WriteAllText($outTxt, $sb.ToString(), [System.Text.UTF8Encoding]::new($false))

# JSON-Ausgabe (für späteren Import in den Editor)
$jsonStr = $entries | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($outJson, $jsonStr, [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "Fertig." -ForegroundColor Cyan
Write-Host "TXT:  $outTxt"
Write-Host "JSON: $outJson"
