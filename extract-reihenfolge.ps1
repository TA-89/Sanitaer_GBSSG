# Sanitär GBS – Lernplattform · Lernauftrags-Reihenfolge aus Excel
# -----------------------------------------------------------------
# Öffnet jede Master-Excel und ermittelt die zeitliche Reihenfolge
# der Lernaufträge aus den Schultag-Sheets (ST_*).
#
# Output: web\data\lernpfad-reihenfolge.json mit Format:
#   { "1": ["1.12","1.4","1.1",...], "2": [...], ... }
# Plus eine TXT-Datei mit lesbarer Übersicht zur manuellen Korrektur.

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$ErrorActionPreference = 'Continue'

$webRoot   = $PSScriptRoot
if (-not $webRoot) { $webRoot = (Get-Location).Path }
$dataRoot  = Split-Path $webRoot -Parent
$outJson   = Join-Path $webRoot 'data\lernpfad-reihenfolge.json'
$outTxt    = Join-Path $webRoot 'data\_extract\lernpfad-reihenfolge.txt'
$outDir    = Split-Path $outTxt -Parent
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

Write-Host "Sanitaer GBS - Lernauftrags-Reihenfolge aus Excel" -ForegroundColor Cyan
Write-Host "Quelle: $dataRoot"
Write-Host ""

# Excel starten
try {
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  $excel.AskToUpdateLinks = $false
} catch {
  Write-Host "FEHLER: Microsoft Excel konnte nicht gestartet werden." -ForegroundColor Red
  exit 1
}

# Alle Auftrags-Pfade pro Semester sammeln (für Validierung)
$gueltige = @{}
foreach ($i in 1..8) {
  $gueltige[$i] = @()
  $src = Join-Path $dataRoot "$i.Semester"
  if (Test-Path $src) {
    foreach ($pdf in Get-ChildItem -Path $src -Filter '*_Auftrag.pdf' -File) {
      $id = ($pdf.BaseName -replace '_Auftrag$','')
      $gueltige[$i] += $id
    }
  }
}

$reihenfolge = [ordered]@{}
$txtBuilder = New-Object System.Text.StringBuilder

foreach ($i in 1..8) {
  $xlsx = Join-Path $dataRoot "$i.Semester_Master.xlsx"
  if (-not (Test-Path $xlsx)) {
    Write-Host "[$i. Semester] Datei nicht gefunden: $xlsx" -ForegroundColor Yellow
    $reihenfolge["$i"] = @()
    continue
  }
  Write-Host "[$i. Semester] $($xlsx | Split-Path -Leaf) ..." -ForegroundColor Gray
  [void]$txtBuilder.AppendLine("=== Semester $i ===")

  $wb = $null
  try {
    $wb = $excel.Workbooks.Open($xlsx, 0, $true)  # ReadOnly
    $found = New-Object System.Collections.Generic.List[string]
    $seen = @{}

    # Sheet-Namen alphabetisch nach ST_-Nummer sortieren
    $stSheets = @()
    foreach ($sh in $wb.Sheets) {
      if ($sh.Name -match '^ST[_ ]?(\d+)') {
        $stSheets += [PSCustomObject]@{ Sheet = $sh; Num = [int]$matches[1]; Name = $sh.Name }
      }
    }
    $stSheets = $stSheets | Sort-Object Num

    foreach ($entry in $stSheets) {
      $sheet = $entry.Sheet
      $sheetName = $entry.Name
      $used = $sheet.UsedRange
      $arr = $null
      try { $arr = $used.Value() } catch {}
      if ($null -eq $arr) { continue }

      # arr kann 2D-Array oder Einzelwert sein
      $rows = 1; $cols = 1
      if ($arr -is [object[,]]) {
        $rows = $arr.GetLength(0)
        $cols = $arr.GetLength(1)
      }

      # Auftragsnummern in diesem Sheet sammeln (in Reihenfolge Zeile/Spalte)
      $sheetAuf = @()
      $sheetSeen = @{}
      for ($r = 1; $r -le $rows; $r++) {
        for ($c = 1; $c -le $cols; $c++) {
          $val = if ($arr -is [object[,]]) { $arr[$r, $c] } else { $arr }
          if ($null -eq $val) { continue }
          $s = [string]$val
          if ($s.Length -gt 200) { continue }

          # Pattern: "Auftrag 1.4" oder einfach "1.4" mit Validierung
          $matches2 = [regex]::Matches($s, "(?:Auftrag\s+)?(\b$($i)\.\d{1,2}\b)")
          foreach ($m in $matches2) {
            $cand = $m.Groups[1].Value
            if ($gueltige[$i] -contains $cand -and -not $sheetSeen[$cand]) {
              $sheetSeen[$cand] = $true
              $sheetAuf += $cand
            }
          }
        }
      }

      if ($sheetAuf.Count -gt 0) {
        [void]$txtBuilder.AppendLine("  $sheetName : $($sheetAuf -join ', ')")
      }
      foreach ($a in $sheetAuf) {
        if (-not $seen[$a]) {
          $seen[$a] = $true
          $found.Add($a) | Out-Null
        }
      }
    }

    # Aufträge, die in keinem Sheet auftauchten, am Ende anhängen
    foreach ($a in $gueltige[$i]) {
      if (-not $seen[$a]) {
        $found.Add($a) | Out-Null
        [void]$txtBuilder.AppendLine("  (nirgends gefunden, hinten angefügt): $a")
      }
    }

    $reihenfolge["$i"] = @($found.ToArray())
    Write-Host "[$i. Semester] $($found.Count) Aufträge geordnet" -ForegroundColor Green
    [void]$txtBuilder.AppendLine("  -> Endgültig: $(($found.ToArray()) -join ', ')")
    [void]$txtBuilder.AppendLine("")
  } catch {
    Write-Host "[$i. Semester] FEHLER: $($_.Exception.Message)" -ForegroundColor Red
    $reihenfolge["$i"] = $gueltige[$i]
    [void]$txtBuilder.AppendLine("  FEHLER: $($_.Exception.Message)")
  } finally {
    if ($null -ne $wb) {
      try { $wb.Close($false) } catch {}
    }
  }
}

try { $excel.Quit() } catch {}
try { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null } catch {}

# JSON schreiben
$out = [ordered]@{
  version = "1.0"
  stand = (Get-Date -Format 'yyyy-MM-dd')
  hinweis = "Reihenfolge der Lernaufträge pro Semester, ermittelt aus den Schultag-Sheets der Master-Excels."
  semester = $reihenfolge
}
$json = $out | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($outJson, $json, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText($outTxt, $txtBuilder.ToString(), [System.Text.UTF8Encoding]::new($false))

Write-Host ""
Write-Host "Fertig." -ForegroundColor Cyan
Write-Host "JSON: $outJson"
Write-Host "TXT:  $outTxt"
