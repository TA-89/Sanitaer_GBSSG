# Sanitär GBS – Lernplattform · PDFs einbinden
# --------------------------------------------------------------
# Kopiert die Original-PDFs aus den Semesterordnern in den
# Webordner unter web\pdfs\<semester>\, damit der Server sie
# ausliefern kann. Existierende Dateien werden überschrieben
# (idempotent).

$ErrorActionPreference = 'Stop'

$webRoot   = $PSScriptRoot
if (-not $webRoot) { $webRoot = (Get-Location).Path }
$dataRoot  = Split-Path $webRoot -Parent   # ..\14_Webseite Sanitär
$targetDir = Join-Path $webRoot 'pdfs'

Write-Host "Sanitär GBS · PDFs verlinken" -ForegroundColor Cyan
Write-Host "Quelle: $dataRoot"
Write-Host "Ziel:   $targetDir"
Write-Host ""

$total = 0
foreach ($i in 1..8) {
  $src = Join-Path $dataRoot "$i.Semester"
  $dst = Join-Path $targetDir "$i"

  if (-not (Test-Path $src)) {
    Write-Host "[$i. Semester] Quellordner fehlt: $src" -ForegroundColor Yellow
    continue
  }

  if (-not (Test-Path $dst)) {
    New-Item -ItemType Directory -Path $dst -Force | Out-Null
  }

  $pdfs = Get-ChildItem -Path $src -Filter '*.pdf' -File
  foreach ($pdf in $pdfs) {
    Copy-Item -LiteralPath $pdf.FullName -Destination (Join-Path $dst $pdf.Name) -Force
    $total++
  }
  Write-Host "[$i. Semester] $($pdfs.Count) PDFs kopiert" -ForegroundColor Green
}


# Plakat (Handlungskompetenzen)
$plakatSrc = Join-Path $dataRoot 'suissetec_sanitaer_D_A2.pdf'
$plakatDst = Join-Path $targetDir 'plakat.pdf'
if (Test-Path $plakatSrc) {
  Copy-Item -LiteralPath $plakatSrc -Destination $plakatDst -Force
  Write-Host "[Plakat] suissetec_sanitaer_D_A2.pdf kopiert nach pdfs\plakat.pdf" -ForegroundColor Green
  $total++
} else {
  Write-Host "[Plakat] Quelle nicht gefunden: $plakatSrc" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Fertig. Insgesamt $total Dateien kopiert nach $targetDir." -ForegroundColor Cyan
Write-Host "Starte als Nächstes start.ps1, um die Webseite zu öffnen."
