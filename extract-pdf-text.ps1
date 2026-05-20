# Sanitär GBS – Lernplattform · PDF zu Text extrahieren
# --------------------------------------------------------------
# Wandelt eine PDF-Datei via Word (COM-Automation) in eine .txt um.
# Output: web\data\_extract\<dateiname>.txt
#
# Voraussetzung: Microsoft Word ist installiert.

$ErrorActionPreference = 'Stop'

$webRoot   = $PSScriptRoot
if (-not $webRoot) { $webRoot = (Get-Location).Path }
$dataRoot  = Split-Path $webRoot -Parent   # ..\14_Webseite Sanitär
$outDir    = Join-Path $webRoot 'data\_extract'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

# Welche PDFs sollen extrahiert werden?
$targets = @(
  @{ Pfad = (Join-Path $dataRoot 'Reg_02_01_Schullehrplan Sanitaerinstallateur_DE_web.pdf'); Name = 'schullehrplan' }
)

Write-Host "Sanitär GBS · PDF-Text-Extraktion" -ForegroundColor Cyan
Write-Host "Ziel: $outDir"
Write-Host ""

# Word starten
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
} catch {
  Write-Host "FEHLER: Microsoft Word konnte nicht gestartet werden." -ForegroundColor Red
  Write-Host "Bitte sicherstellen, dass Word installiert ist." -ForegroundColor Yellow
  Write-Host "Alternative: PDF in Edge öffnen, Strg+A, Strg+C, in den Chat einfügen." -ForegroundColor Yellow
  exit 1
}

foreach ($t in $targets) {
  if (-not (Test-Path $t.Pfad)) {
    Write-Host "[$($t.Name)] Datei nicht gefunden: $($t.Pfad)" -ForegroundColor Yellow
    continue
  }
  Write-Host "[$($t.Name)] öffne $(Split-Path $t.Pfad -Leaf) …" -ForegroundColor Gray
  try {
    # Word öffnet PDFs ab Word 2013 nativ. ReadOnly=true, ConfirmConversions=false.
    $doc = $word.Documents.Open(
      [ref] $t.Pfad,        # FileName
      [ref] $false,         # ConfirmConversions
      [ref] $true,          # ReadOnly
      [ref] $false          # AddToRecentFiles
    )
    $text = $doc.Content.Text
    $doc.Close([ref] $false)
    $out = Join-Path $outDir "$($t.Name).txt"
    [System.IO.File]::WriteAllText($out, $text, [System.Text.UTF8Encoding]::new($false))
    Write-Host "[$($t.Name)] OK · $($text.Length) Zeichen → $out" -ForegroundColor Green
  } catch {
    Write-Host "[$($t.Name)] FEHLER: $($_.Exception.Message)" -ForegroundColor Red
  }
}

$word.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null

Write-Host ""
Write-Host "Fertig." -ForegroundColor Cyan
