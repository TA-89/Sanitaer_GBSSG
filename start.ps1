# Sanitär GBS – Lernplattform · Lokaler Entwicklungsserver
# ----------------------------------------------------------
# Startet einen kleinen HTTP-Server auf http://localhost:5173/
# und öffnet die Seite automatisch im Standardbrowser.
# Beenden mit Strg+C.
#
# Hintergrund: PDFs und JSON-Dateien lassen sich aus Sicherheitsgründen
# nicht direkt über "file://" laden, deshalb braucht es einen kleinen
# lokalen Server. Dieses Skript benutzt nur Windows-Bordmittel
# (System.Net.HttpListener) – keine Installation nötig.

# Wichtig: NICHT ErrorActionPreference='Stop' setzen – ein einzelner
# fehlgeschlagener Request darf nicht den ganzen Server-Loop killen.
$ErrorActionPreference = 'Continue'

[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()

$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }
$prefix = 'http://localhost:5173/'

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.mjs'  = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.webp' = 'image/webp'
  '.ico'  = 'image/x-icon'
  '.pdf'  = 'application/pdf'
  '.woff' = 'font/woff'
  '.woff2'= 'font/woff2'
  '.ttf'  = 'font/ttf'
  '.map'  = 'application/json; charset=utf-8'
  '.txt'  = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() }
catch {
  Write-Host "Konnte HTTP-Listener nicht starten: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Hinweis: Eventuell ist Port 5173 belegt." -ForegroundColor Yellow
  Read-Host "Druecke Enter zum Beenden"
  exit 1
}

Write-Host "Sanitaer GBS - Lernplattform"        -ForegroundColor Cyan
Write-Host "Server laeuft auf $prefix"           -ForegroundColor Green
Write-Host "Wurzel: $root"
Write-Host "Beenden mit Strg+C oder Fenster schliessen." -ForegroundColor DarkGray
Write-Host ""
Start-Process $prefix | Out-Null

$rootFull = [System.IO.Path]::GetFullPath($root)

try {
  while ($listener.IsListening) {
    # ---- Request annehmen ------------------------------------------------
    $ctx = $null
    try {
      $ctx = $listener.GetContext()
    } catch {
      # Falls der Listener beendet wurde: Schleife verlassen
      if (-not $listener.IsListening) { break }
      Write-Host "GetContext-Fehler: $($_.Exception.Message)" -ForegroundColor DarkYellow
      Start-Sleep -Milliseconds 50
      continue
    }

    # ---- Request verarbeiten --------------------------------------------
    $req = $ctx.Request
    $res = $ctx.Response
    $status = 200
    $serveDescription = "?"

    try {
      $rel = ""
      try {
        $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath.TrimStart('/'))
      } catch {
        $rel = $req.Url.AbsolutePath.TrimStart('/')
      }
      if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
      $serveDescription = $rel

      # Pfad zusammenbauen; bei Verzeichnis -> index.html
      $path = Join-Path $root $rel
      try {
        if (Test-Path -LiteralPath $path) {
          $item = Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
          if ($item -and $item.PSIsContainer) {
            $path = Join-Path $path 'index.html'
          }
        }
      } catch {}

      # Sicherheitscheck: Pfad muss innerhalb des Roots liegen
      $full = $null
      try {
        $full = [System.IO.Path]::GetFullPath($path)
      } catch {
        $status = 400
      }

      if ($full -and (-not $full.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase))) {
        $status = 403
      }

      if ($status -eq 200 -and $full -and (Test-Path -LiteralPath $full -PathType Leaf)) {
        $ext = [System.IO.Path]::GetExtension($full).ToLowerInvariant()
        $ct  = $mime[$ext]
        if (-not $ct) { $ct = 'application/octet-stream' }
        try {
          $bytes = [System.IO.File]::ReadAllBytes($full)
          $res.ContentType = $ct
          $res.Headers.Add('Cache-Control','no-cache')
          $res.ContentLength64 = $bytes.Length
          $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } catch {
          $status = 500
          Write-Host "Read-Fehler $rel : $($_.Exception.Message)" -ForegroundColor DarkYellow
        }
      } elseif ($status -eq 200) {
        $status = 404
      }

      if ($status -ne 200) {
        $res.StatusCode = $status
        try {
          $body = "$status - $rel"
          $msg = [System.Text.Encoding]::UTF8.GetBytes($body)
          $res.ContentType = 'text/plain; charset=utf-8'
          $res.OutputStream.Write($msg, 0, $msg.Length)
        } catch {}
      }

    } catch {
      Write-Host "Request-Fehler: $($_.Exception.Message)" -ForegroundColor DarkYellow
      try {
        $res.StatusCode = 500
        $msg = [System.Text.Encoding]::UTF8.GetBytes("500 - $($_.Exception.Message)")
        $res.OutputStream.Write($msg, 0, $msg.Length)
      } catch {}
    } finally {
      try { $res.Close() } catch {}
    }

    # Knappes Logging in der Konsole
    $tag = if ($status -eq 200) { "200" } elseif ($status -eq 404) { "404" } else { "$status" }
    $color = if ($status -lt 300) { "DarkGray" } elseif ($status -lt 500) { "DarkYellow" } else { "Red" }
    Write-Host "[$tag] $serveDescription" -ForegroundColor $color
  }
}
finally {
  if ($listener -and $listener.IsListening) {
    try { $listener.Stop() } catch {}
  }
  if ($listener) {
    try { $listener.Close() } catch {}
  }
}
