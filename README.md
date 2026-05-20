# Sanitär GBS · Lernplattform

Statische Webseite für Lernende der GBS St. Gallen (Sanitärinstallateur/in EFZ):
alle 8 Semester und ihre Lernaufträge finden, durchsuchen und direkt ansehen.

Design: Schweizer Minimalismus, Leitfarbe tiefes Petrol. Urheberrecht der
Lernaufträge: T. Arnold & M. Item (ITM), GBS St. Gallen.

## Lokal testen (Windows)

1. Doppelklick auf `1-PDFs-einbinden.cmd` → kopiert alle PDFs nach `pdfs/`.
2. Doppelklick auf `2-Webseite-starten.cmd` → Server auf <http://localhost:5173/>.

Beenden mit `Strg+C` im schwarzen Fenster.

## Funktionen

- **Startseite** mit Hero und Schnelleinstieg
- **Semesterübersicht** (8 Karten) + Semester-Detail mit Filtern
- **Lernpfad** – chronologische Reise durch alle Aufträge (Akkordeon, Reihenfolge aus Master-Excels)
- **Suche** (Fuse.js): inhaltsbasiert, Top-Treffer + nach Semester gruppiert
- **Auftrag-Detail** mit Lernzielen, Kernbegriffen, Handlungskompetenzen, Leistungszielen
- **PDF-Reader** im Modal (PDF.js), Seitenzahlen, Zoom; kein Download-Button
- **Interaktives Handlungskompetenz-Plakat**: Klick auf ein Kästchen zeigt die zugehörigen Aufträge + Semester
- **Auftrags-Editor** (über Info) zum Korrigieren von Titeln/Kernbegriffen
- Vollständig responsive, Mobile-First

## Datenmodell

| Datei | Inhalt |
|---|---|
| `data/auftraege.json` | Manifest aller Lernaufträge |
| `data/handlungskompetenzen.json` | 7 Handlungsfelder mit 36 Handlungskompetenzen |
| `data/lernpfad-reihenfolge.json` | Auftrags-Reihenfolge pro Semester (aus Master-Excels) |
| `data/plakat-hotspots.json` | Klickbare Bereiche auf dem Plakat |

## Online stellen (GitHub Pages)

Die Seite ist 100 % statisch und braucht keinen Build.

1. Auf <https://github.com> einloggen → **New repository** → Name z. B. `sanitaer-gbs` → **Public** → **Create**.
2. Auf der Repo-Seite **„uploading an existing file"** wählen und **den gesamten Inhalt dieses `web`-Ordners** hochladen (per Drag & Drop alle Dateien/Ordner). Commit.
3. Repo → **Settings → Pages** → unter „Build and deployment": Source = **Deploy from a branch**, Branch = **main**, Ordner = **/ (root)** → **Save**.
4. Nach 1–2 Minuten ist die Seite erreichbar unter
   `https://<dein-benutzername>.github.io/sanitaer-gbs/`

> Die Datei `.nojekyll` (liegt bereits bei) sorgt dafür, dass GitHub Pages alle
> Ordner korrekt ausliefert. Die `.ps1`/`.cmd`-Helfer schaden im Hosting nicht.

### Aktualisieren

- Geänderte oder neue PDFs: in den Semesterordner legen, `1-PDFs-einbinden.cmd`
  ausführen, dann den `pdfs/`-Ordner ins Repo hochladen.
- Inhalte (Titel, Kernbegriffe): über den **Auftrags-Editor** bearbeiten,
  als JSON exportieren, `data/auftraege.json` ersetzen, hochladen.

## Hinweis Downloads

Vollständiger Download-Schutz ist im Browser technisch nicht möglich. Die Seite
verzichtet auf Download-Buttons und Druckmenü und lädt PDFs nur zur Ansicht.
