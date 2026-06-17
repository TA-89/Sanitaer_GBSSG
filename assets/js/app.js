/* Sanitär GBS – Lernplattform · Mini-SPA
   Vanilla JS, ES-Module, hashbasiertes Routing.
   --------------------------------------------------------------- */

const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs";

// Live-Datenquelle: die Auftrags-PDFs liegen auf sanitaerlernen.ch und werden
// immer in der aktuellen Version geladen. URL wird aus der Auftragsnummer gebildet.
const PDF_BASE = "https://sanitaerlernen.ch/0_Datenbank/1_Auftraege/";
function auftragPdfUrl(a) {
  return `${PDF_BASE}${a.semester}.Semester/${a.auftragNummer}_Auftrag.pdf`;
}
// Direkter Link zum Auftrags-PDF: live von sanitaerlernen.ch, sonst lokaler Fallback (PDF_NICHT_ONLINE)
function auftragLiveUrl(a) {
  return (typeof PDF_NICHT_ONLINE !== "undefined" && PDF_NICHT_ONLINE.has(a.id)) ? a.pdfPfad : auftragPdfUrl(a);
}

// ---------------------------------------------------------------------------
// Datenzugriff
// ---------------------------------------------------------------------------
const state = {
  data: null,
  hf: null,
  fuse: null,
  ready: false,
};

async function loadData() {
  const [auf, hf] = await Promise.all([
    fetch("data/auftraege.json", { cache: "no-cache" }).then((r) => r.json()),
    fetch("data/handlungskompetenzen.json", { cache: "no-cache" }).then((r) => r.json()),
  ]);
  state.data = auf;
  state.hf = hf;

  // Optional: Lernpfad-Reihenfolge laden (kann fehlen)
  state.reihenfolge = null;
  try {
    const res = await fetch("data/lernpfad-reihenfolge.json", { cache: "no-cache" });
    if (res.ok) state.reihenfolge = await res.json();
  } catch {}

  // Optional: Plakat-Hotspots laden (kann fehlen)
  state.plakatHotspotsBase = null;
  try {
    const res = await fetch("data/plakat-hotspots.json", { cache: "no-cache" });
    if (res.ok) state.plakatHotspotsBase = await res.json();
  } catch {}

  // Tagesprogramm-Daten: Klassen, Ferien, Unterrichtsinhalte (fehlertolerant)
  state.klassen = null;
  state.ferien = null;
  state.tagesprogramm = null;
  try {
    const r = await fetch("data/klassen.json", { cache: "no-cache" });
    if (r.ok) state.klassen = await r.json();
  } catch {}
  try {
    const r = await fetch("data/ferien.json", { cache: "no-cache" });
    if (r.ok) state.ferien = await r.json();
  } catch {}
  try {
    const r = await fetch("data/tagesprogramm.json", { cache: "no-cache" });
    if (r.ok) state.tagesprogramm = await r.json();
  } catch {}
  state.auftragFarben = null;
  try {
    const r = await fetch("data/auftrag-farben.json", { cache: "no-cache" });
    if (r.ok) state.auftragFarben = await r.json();
  } catch {}
  state.lernziele = null;
  try {
    const r = await fetch("data/lernziele.json", { cache: "no-cache" });
    if (r.ok) state.lernziele = await r.json();
  } catch {}

  state.fuse = new Fuse(auf.aufträge, {
    keys: [
      // Hohes Gewicht für spezifischen Inhalt – mehrere Aufträge tragen denselben
      // Titel (z. B. "Trinkwasserleitungen montieren") und müssen über
      // Kernbegriffe und Lernziele unterschieden werden.
      { name: "kernbegriffe", weight: 0.40 },
      { name: "lernziele", weight: 0.20 },
      { name: "kurzbeschreibung", weight: 0.15 },
      { name: "thema", weight: 0.10 },
      { name: "titel", weight: 0.10 },
      { name: "auftragNummer", weight: 0.05 },
    ],
    threshold: 0.38,
    ignoreLocation: true,
    minMatchCharLength: 2,
    includeMatches: true,
    includeScore: true,
  });
  state.ready = true;
}

const hfByCode = (code) =>
  state.hf?.handlungsfelder.find((h) => h.code === code);

// Findet eine Handlungskompetenz anhand ihres Codes (z.B. "1.3" oder "2.6")
const hkByCode = (code) => {
  if (!state.hf) return null;
  for (const hf of state.hf.handlungsfelder) {
    const hk = (hf.kompetenzen || []).find((k) => k.code === code);
    if (hk) return { ...hk, handlungsfeld: hf };
  }
  return null;
};

// Liste aller Handlungskompetenzen flach (für Filter etc.)
const allHks = () =>
  (state.hf?.handlungsfelder || []).flatMap((hf) =>
    (hf.kompetenzen || []).map((k) => ({ ...k, handlungsfeld: hf }))
  );

const semByNum = (n) => state.data?.semester.find((s) => s.nummer === Number(n));

const aufById = (id) => state.data?.aufträge.find((a) => a.id === id);

const auftraegeForSemester = (n) =>
  state.data?.aufträge.filter((a) => a.semester === Number(n));

// Akzentfarbe eines Lernauftrags: explizit aus auftrag-farben.json (Schriftfarbe im PDF),
// sonst Handlungsfeld-Farbe als Fallback.
function auftragFarbe(id) {
  const explicit = state.auftragFarben?.farben?.[id];
  if (explicit) return explicit;
  const a = aufById(id);
  const hk = a && (a.handlungskompetenzen || []).map((c) => hkByCode(c)).filter(Boolean)[0];
  return (hk && hk.handlungsfeld && hk.handlungsfeld.farbe) || null;
}
function hexToRgba(hex, a) {
  if (!hex) return `rgba(0,0,0,${a})`;
  let h = String(hex).replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  // Wenn mehrere Top-Level-Elemente vorhanden sind: ganzes DocumentFragment
  // zurückgeben, damit appendChild() alle einfügt. Bei einem Element nur
  // dieses (für DOM-Manipulationen am Ergebnis).
  if (t.content.children.length === 1) return t.content.firstElementChild;
  return t.content;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


function highlight(text, query) {
  if (!query) return escapeHtml(text);
  const safe = escapeHtml(text);
  const tokens = String(query)
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!tokens.length) return safe;
  const re = new RegExp(`(${tokens.join("|")})`, "gi");
  return safe.replace(re, "<mark>$1</mark>");
}

// Vorschau-Karte für einen Auftrag (Schema, später durch echtes PDF-Thumbnail ersetzt)
function previewSheet(auftrag, opts = {}) {
  const hkCode = (auftrag.handlungskompetenzen || [])[0];
  const hk = hkCode ? hkByCode(hkCode) : null;
  const hfColor = hk?.handlungsfeld?.farbe || "var(--water-deep)";
  const big = opts.big ? "auf-preview-big" : "";
  return `
    <div class="auf-preview ${big}" data-thumb-id="${escapeHtml(auftrag.id)}" data-thumb-pdf="${escapeHtml(auftrag.pdfPfad)}">
      <span class="auf-num">${escapeHtml(auftrag.auftragNummer)}</span>
      <div class="sheet" aria-hidden="true">
        <div class="line title"></div>
        <div class="line short"></div>
        <div class="line"></div>
        <div class="line"></div>
        <div class="line short"></div>
        <div class="line water" style="background:${hfColor};margin-top:auto"></div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// PDF-Thumbnail-Lazy-Loader
//   – beobachtet alle Vorschau-Elemente mit data-thumb-pdf
//   – rendert die erste PDF-Seite in einen Canvas, cached als Data-URL
//   – Cache liegt in localStorage (begrenzt auf ~30 Einträge)
// ---------------------------------------------------------------------------
const THUMB_CACHE_KEY = "sanigbs:thumbs:v1";
const THUMB_LIMIT = 40;
const inflightThumbs = new Map();
let thumbObserver = null;

function readThumbCache() {
  try { return JSON.parse(localStorage.getItem(THUMB_CACHE_KEY) || "{}"); }
  catch { return {}; }
}
function writeThumbCache(cache) {
  try {
    // LRU: behalten der zuletzt benutzten Einträge
    const entries = Object.entries(cache);
    if (entries.length > THUMB_LIMIT) {
      entries.sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
      cache = Object.fromEntries(entries.slice(0, THUMB_LIMIT));
    }
    localStorage.setItem(THUMB_CACHE_KEY, JSON.stringify(cache));
  } catch { /* Quota voll – ignorieren */ }
}

function applyThumbToElement(elm, dataUrl) {
  if (!elm || !dataUrl) return;
  elm.classList.add("has-thumb");
  elm.style.backgroundImage = `url("${dataUrl}")`;
  const sheet = elm.querySelector(".sheet");
  if (sheet) sheet.style.display = "none";
}

async function renderThumbnail(pdfPath, scale = 0.6) {
  if (inflightThumbs.has(pdfPath)) return inflightThumbs.get(pdfPath);
  const p = (async () => {
    const lib = await ensurePdfJs();
    const task = lib.getDocument({ url: pdfPath, disableFontFace: true });
    const pdf = await task.promise;
    try {
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas.toDataURL("image/jpeg", 0.7);
    } finally {
      try { pdf.cleanup?.(); pdf.destroy?.(); } catch {}
    }
  })();
  inflightThumbs.set(pdfPath, p);
  try { return await p; }
  finally { inflightThumbs.delete(pdfPath); }
}

function ensureThumbObserver() {
  if (thumbObserver) return thumbObserver;
  thumbObserver = new IntersectionObserver((entries) => {
    entries.forEach(async (entry) => {
      if (!entry.isIntersecting) return;
      const elm = entry.target;
      thumbObserver.unobserve(elm);
      const id = elm.dataset.thumbId;
      const pdfPath = elm.dataset.thumbPdf;
      if (!id || !pdfPath) return;

      // Hochgeladenes PDF (IndexedDB) hat Vorrang – Vorschau neu rendern
      const rec = await idbGetPdf(id);
      if (rec && rec.blob) {
        const cache = readThumbCache();
        const cacheKey = `${id}@${rec.ts}`;
        if (cache[cacheKey]?.url) {
          applyThumbToElement(elm, cache[cacheKey].url);
          return;
        }
        const blobUrl = URL.createObjectURL(rec.blob);
        try {
          const dataUrl = await renderThumbnail(blobUrl);
          const c = readThumbCache();
          // alte Caches für diese id entfernen
          Object.keys(c).forEach((k) => { if (k === id || k.startsWith(id + "@")) delete c[k]; });
          c[cacheKey] = { url: dataUrl, ts: Date.now() };
          writeThumbCache(c);
          applyThumbToElement(elm, dataUrl);
        } catch {} finally { URL.revokeObjectURL(blobUrl); }
        return;
      }

      const cache = readThumbCache();
      if (cache[id]?.url) {
        applyThumbToElement(elm, cache[id].url);
        cache[id].ts = Date.now();
        writeThumbCache(cache);
        return;
      }
      try {
        const dataUrl = await renderThumbnail(pdfPath);
        const c = readThumbCache();
        c[id] = { url: dataUrl, ts: Date.now() };
        writeThumbCache(c);
        applyThumbToElement(elm, dataUrl);
      } catch {
        // PDF nicht erreichbar oder noch nicht eingebunden – Schema bleibt sichtbar
      }
    });
  }, { rootMargin: "200px 0px", threshold: 0.01 });
  return thumbObserver;
}

function attachThumbnails(root = document) {
  const obs = ensureThumbObserver();
  $$(".auf-preview[data-thumb-pdf]", root).forEach((elm) => {
    const id = elm.dataset.thumbId;
    const cache = readThumbCache();
    if (cache[id]?.url) {
      applyThumbToElement(elm, cache[id].url);
    } else {
      obs.observe(elm);
    }
  });
}

function attachHitThumbs(root = document) {
  const obs = ensureThumbObserver();
  $$(".thumb[data-thumb-pdf]", root).forEach((elm) => {
    const id = elm.dataset.thumbId;
    const cache = readThumbCache();
    if (cache[id]?.url) {
      applyThumbToElement(elm, cache[id].url);
    } else {
      obs.observe(elm);
    }
  });
}

// ---------------------------------------------------------------------------
// Recent-Aufträge (Startseite)
// ---------------------------------------------------------------------------
const RECENT_KEY = "sanigbs:recent:v1";
const RECENT_MAX = 6;
function pushRecent(id) {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    const next = [id, ...list.filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}
function getRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); }
  catch { return []; }
}

function pillRow(auftrag) {
  const parts = [];
  if (auftrag.thema) parts.push(`<span class="pill pill-thema">${escapeHtml(auftrag.thema)}</span>`);
  (auftrag.handlungskompetenzen || []).forEach((c) => {
    const hk = hkByCode(c);
    if (hk) {
      const color = hk.handlungsfeld?.farbe || "var(--water)";
      parts.push(`<span class="pill pill-hk" style="--hk-color:${color}" title="${escapeHtml(hk.titel)}"><span class="pill-prefix">HK</span> ${escapeHtml(hk.code)}</span>`);
    }
  });
  return `<div class="pill-row">${parts.join("")}</div>`;
}

// ===========================================================================
// Tagesprogramm: Datums-Helfer + Schultagsberechnung
//   Schultage werden NICHT aus PDFs übernommen, sondern berechnet aus
//   Semesterstart + fixem Wochentag der Klasse + Ferienplan.
// ===========================================================================
const WD_LANG = ["", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const WD_KURZ = ["", "Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function parseISO(s) { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function toISO(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function addDays(dt, n) { const r = new Date(dt); r.setDate(r.getDate() + n); return r; }
function isoWeekday(dt) { const w = dt.getDay(); return w === 0 ? 7 : w; } // 1=Mo … 7=So
function weekdayLang(dt) { return WD_LANG[isoWeekday(dt)]; }
function weekdayKurz(n) { return WD_KURZ[n] || ""; }
function formatLang(dt) { return `${dt.getDate()}. ${MONATE[dt.getMonth()]} ${dt.getFullYear()}`; }
function todayISO() { return toISO(new Date()); }

// Ferien/Feiertage
function getFerienplan(planId) { return state.ferien?.plaene?.[planId] || null; }
function ferienInfo(dt, plan) {
  if (!plan) return null;
  const iso = toISO(dt);
  for (const f of (plan.ferien || [])) { if (iso >= f.von && iso <= f.bis) return { typ: "ferien", name: f.name }; }
  for (const t of (plan.feiertage || [])) { if (iso === t.datum) return { typ: "feiertag", name: t.name }; }
  return null;
}
const istFrei = (dt, plan) => !!ferienInfo(dt, plan);

// Alle Schultage einer Klasse über das Semester berechnen → Array von ISO-Strings
function computeSchooldays(klasse) {
  const cfg = state.klassen;
  const periode = cfg?.semesterDaten?.[klasse.periode];
  if (!periode) return [];
  const plan = getFerienplan(periode.ferienplan);
  const end = parseISO(periode.bis);
  // erster passender Wochentag ab Semesterstart
  let d = parseISO(periode.von);
  let guard = 0;
  while (isoWeekday(d) !== klasse.wochentag && guard++ < 14) d = addDays(d, 1);
  const days = [];
  while (d <= end) {
    if (!istFrei(d, plan)) days.push(toISO(d));   // Ferien-/Feiertag-Wochen überspringen
    d = addDays(d, 7);
  }
  return days;
}

// Den aktuell relevanten Schultag bestimmen: heute → sonst nächster → sonst letzter
function pickCurrentSchoolday(days, heute) {
  if (!days.length) return { index: -1, status: "keine" };
  const i = days.indexOf(heute);
  if (i !== -1) return { index: i, status: "heute" };
  if (heute < days[0]) return { index: 0, status: "vor-start" };
  const fut = days.findIndex((d) => d > heute);
  if (fut === -1) return { index: days.length - 1, status: "vorbei" };
  return { index: fut, status: "naechster" };
}

// ===========================================================================
// Klassen-Auswahl (persistiert)
// ===========================================================================
const KLASSE_KEY = "sanigbs:klasse:v1";
const allKlassen = () => state.klassen?.klassen || [];
const klasseById = (id) => allKlassen().find((k) => k.id === id) || null;
function getActiveKlasseId() {
  try {
    const saved = localStorage.getItem(KLASSE_KEY);
    if (saved && klasseById(saved)) return saved;
  } catch {}
  const first = allKlassen()[0];
  return first ? first.id : null;
}
function setActiveKlasse(id) { try { localStorage.setItem(KLASSE_KEY, id); } catch {} }
function applyKlasse(id) {
  if (!klasseById(id)) return;
  setActiveKlasse(id);
  location.hash = `#/klasse/${id}`;
}

// Optionen für die Klassen-Dropdowns (gruppiert nach Bildungsgang)
function klasseOptionsHtml(activeId) {
  const groups = {};
  allKlassen().forEach((k) => { (groups[k.bildungsgang] = groups[k.bildungsgang] || []).push(k); });
  return Object.entries(groups).map(([bg, list]) =>
    `<optgroup label="${escapeHtml(bg)}">${list.map((k) =>
      `<option value="${escapeHtml(k.id)}" ${k.id === activeId ? "selected" : ""}>${escapeHtml(k.id)} · ${k.lehrjahr}. LJ · ${weekdayKurz(k.wochentag)} ${escapeHtml(k.halbtag)}</option>`
    ).join("")}</optgroup>`
  ).join("");
}

// Lokale Bearbeitungen der Lehrperson (Overlay über die Basis-JSON), keyed "klasse|datum".
// Wird vom Editor (#/lehrer) geschrieben und unten in tagesprogramm.json exportiert.
const TP_EDIT_KEY = "sanigbs:tp-edits:v1";
function loadTpEdits() { try { return JSON.parse(localStorage.getItem(TP_EDIT_KEY) || "{}"); } catch { return {}; } }
function saveTpEdits(map) {
  try { localStorage.setItem(TP_EDIT_KEY, JSON.stringify(map)); return true; }
  catch (e) { alert("Speichern fehlgeschlagen – evtl. ist der lokale Speicher voll (z. B. zu viele/grosse Fotos).\n\n" + (e.message || e)); return false; }
}
const tpEditKey = (klasseId, dateISO) => `${klasseId}|${dateISO}`;
function schooldayBase(klasseId, dateISO) {
  return state.tagesprogramm?.klassen?.[klasseId]?.schultage?.[dateISO] || null;
}

// Unterrichtsinhalte für Klasse + Datum (lokale Bearbeitung hat Vorrang vor der Basis)
function schooldayContent(klasseId, dateISO) {
  const ov = loadTpEdits()[tpEditKey(klasseId, dateISO)];
  if (ov) return ov;
  return schooldayBase(klasseId, dateISO);
}
// Hat ein Schultag überhaupt gepflegte Inhalte?
function schooldayHasContent(content) {
  if (!content) return false;
  if ((content.lektionen || []).some((l) => l && l.thema && l.thema.trim())) return true;
  if ((content.bloecke || []).some((b) => b && (b.titel || b.auftrag))) return true;
  return (content.links || []).length > 0 || (content.pdfs || []).length > 0;
}
// Kurzvorschau (Kachel): Block-Titel, sonst erstes Lektionsthema
function ersteThemenVorschau(content) {
  const titel = [...new Set((content && content.bloecke || []).map((b) => b.titel).filter(Boolean))];
  if (titel.length) return titel.join(" · ");
  const l = (content?.lektionen || []).find((x) => x && x.thema && x.thema.trim());
  return l ? l.thema : "";
}
// Auftrags-Nummern eines Schultags (aus den Blöcken)
function schooldayAuftraege(content) {
  return [...new Set((content && content.bloecke || []).map((b) => b.auftrag).filter(Boolean))];
}
// Findet an diesem Schultag eine Prüfung statt? Nur Lektions-THEMEN + Block-Titel,
// und nur echte Prüfungen (Vorbereitung wie „Üben für …" / „Prüfungsvorbereitung" zählt nicht).
function isPruefungPhrase(s) {
  return /Prüfung/i.test(s) && !/(üben|vorbereit|repetition|lernen)/i.test(s);
}
function schooldayHasPruefung(content) {
  if (!content) return false;
  if (schooldayPruefung(content)) return true;
  const parts = [];
  (content.lektionen || []).forEach((l) => { if (l && l.thema) parts.push(l.thema); });
  (content.bloecke || []).forEach((b) => { if (b && b.titel) parts.push(b.titel); });
  return parts.some(isPruefungPhrase);
}
// Strukturierte Prüfung eines Schultags (vom Editor gesetzt): { titel, auftrag }
function schooldayPruefung(content) {
  return (content && content.pruefung && content.pruefung.titel) ? content.pruefung : null;
}
// Lernziele-PDF (Prüfungsvorbereitung): Live-Link von sanitaerlernen.ch (Pfad aus Manifest)
function lernzielePdf(auftragNr) {
  const lz = state.lernziele;
  const rel = lz && lz.pdf && lz.pdf[auftragNr];
  if (!rel) return null;
  return (lz.basis || "https://sanitaerlernen.ch/0_Datenbank/6_Lernziele/") + rel;
}
// Nächste Prüfung der Klasse innerhalb von `tage` Tagen ab Schultag-Index (für Vorab-Hinweis)
function naechstePruefung(klasseId, days, fromIdx, tage) {
  if (fromIdx < 0) return null;
  const from = parseISO(days[fromIdx]);
  for (let j = fromIdx + 1; j < days.length; j++) {
    const diff = Math.round((parseISO(days[j]) - from) / 86400000);
    if (diff > tage) break;
    const p = schooldayPruefung(schooldayContent(klasseId, days[j]));
    if (p) return { datum: days[j], pruefung: p };
  }
  return null;
}
// Ziel-Icon (Lernziel) – dezent, einheitlich
const icoZiel = `<svg class="lz-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/></svg>`;
function _lzLink(auftrag) {
  const pdf = auftrag ? lernzielePdf(auftrag) : null;
  return pdf ? `<a class="tp-pruef-lz" href="${escapeHtml(pdf)}" target="_blank" rel="noopener">Lernziele ↗</a>` : "";
}
// Am Prüfungstag: dezenter Hinweis ganz oben
function buildPruefungHeuteHtml(content) {
  const p = schooldayPruefung(content);
  if (!p) return "";
  return `<div class="tp-pruef-top">${icoZiel}<span><strong>${escapeHtml(p.titel)}</strong></span>${_lzLink(p.auftrag)}</div>`;
}
// In den 2 Wochen davor: Hinweis unten (bei den Hausaufgaben) mit Icon, Titel, Datum, Lernziele
function buildPruefungVorabHtml(klasseId, days, idx) {
  const up = naechstePruefung(klasseId, days, idx, 14);
  if (!up) return "";
  const d = parseISO(up.datum);
  const dStr = `${weekdayKurz(isoWeekday(d))} ${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
  return `<div class="tp-pruef-vorab">${icoZiel}<span><strong>${escapeHtml(up.pruefung.titel)}</strong> am ${dStr}</span>${_lzLink(up.pruefung.auftrag)}</div>`;
}

// kleine Inline-Icons
const icoMat = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 9h16" stroke="currentColor" stroke-width="1.8"/></svg>`;
const icoLink = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const icoPdf = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M6 3h9l4 4v14H6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.7"/></svg>`;

// Lektions- und Extras-HTML eines Schultags (von Tagesprogramm + Timeline genutzt)
// Lektionszeiten je Halbtag (Vormittag wie GBS-Vorgabe, Nachmittag aus den Schultag-PDFs)
const LEKTIONSZEITEN = {
  Vormittag:  ["07:30–08:15", "08:20–09:05", "09:10–09:55", "10:15–11:00", "11:05–11:50"],
  Nachmittag: ["12:50–13:35", "13:40–14:25", "14:30–15:15", "15:30–16:15", "16:20–17:05"],
};
const PAUSENZEIT = { Vormittag: "09:55–10:15", Nachmittag: "15:15–15:30" };

function buildLektionenHtml(content, halbtag) {
  const lekt = (content && content.lektionen) || [];
  const bloecke = (content && content.bloecke) || [];
  const zeiten = LEKTIONSZEITEN[halbtag] || LEKTIONSZEITEN.Nachmittag;
  const row = (i) => {
    const l = lekt[i];
    const thema = l && l.thema ? l.thema.trim() : "";
    const notiz = thema ? (l.notizen || "").trim() : "";
    const notizHtml = notiz ? `<p class="lektion-notizen">${escapeHtml(notiz)}</p>` : "";
    return `<div class="lektion-row ${thema ? "" : "is-empty"}">
      <span class="lektion-zeit">${zeiten[i]}</span>
      <div class="lektion-row-body"><h3 class="lektion-thema">${escapeHtml(thema || "Noch offen")}</h3>${notizHtml}</div>
    </div>`;
  };
  // Block-Kopf: Gruppenlabel + Titel + Auftrags-Nummer (öffnet direkt das sanitaerlernen-PDF), dezent getönt
  const blockHtml = (idx, range, label) => {
    const blk = bloecke[idx] || {};
    const farbe = blk.auftrag ? auftragFarbe(blk.auftrag) : null;
    const style = farbe ? ` style="--blk:${farbe}; --blk-bg:${hexToRgba(farbe, 0.055)}; --blk-bd:${hexToRgba(farbe, 0.28)}"` : "";
    const a = blk.auftrag ? aufById(blk.auftrag) : null;
    const aufHtml = blk.auftrag
      ? (a ? `<a class="blk-auf" href="${escapeHtml(auftragLiveUrl(a))}" target="_blank" rel="noopener" title="${escapeHtml(a.titel)} – PDF öffnen">${escapeHtml(a.auftragNummer)}</a>`
           : `<span class="blk-auf">${escapeHtml(blk.auftrag)}</span>`)
      : "";
    const head = `<div class="lektion-block-head">
      <div class="blk-titel-wrap">
        <span class="lektion-group-label">${label}</span>
        ${blk.titel ? `<span class="blk-titel">${escapeHtml(blk.titel)}</span>` : ""}
      </div>
      ${aufHtml}
    </div>`;
    // Ausklappbare Lernziele des Block-Auftrags (im Block, nicht mehr oben gesammelt)
    const ziele = a ? (a.lernziele || []).filter(Boolean) : [];
    const lzHtml = ziele.length ? `
      <button type="button" class="lz-btn lz-btn-inline" data-lz="${idx}" aria-expanded="false">${icoZiel}<span>Lernziele ${escapeHtml(blk.auftrag)}</span><svg class="lz-btn-chev" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <div class="lz-panel" data-lz="${idx}" hidden><ul class="lz-list2">${ziele.map((z) => `<li>${escapeHtml(z)}</li>`).join("")}</ul></div>` : "";
    return `<div class="lektion-block ${farbe ? "has-blk" : ""}"${style}>${head}${range.map(row).join("")}${lzHtml}</div>`;
  };
  const pause = PAUSENZEIT[halbtag] || PAUSENZEIT.Nachmittag;
  return `<div class="lektion-blocks">
    ${blockHtml(0, [0, 1, 2], "Lektion 1–3")}
    <div class="lektion-pause"><span>Pause · ${pause}</span></div>
    ${blockHtml(1, [3, 4], "Lektion 4–5")}
  </div>`;
}


function buildExtrasHtml(content) {
  if (!content) return "";
  let html = "";
  // Lernaufträge stehen jetzt direkt in den Block-Köpfen – hier nur noch Zusatzmaterial/Links.
  const pdfs = (content.pdfs || []).filter((l) => l && l.url);
  const links = (content.links || []).filter((l) => l && l.url);
  if (pdfs.length || links.length) {
    const chips = [
      ...pdfs.map((l) => `<a class="tp-link-chip" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${icoPdf}${escapeHtml(l.label || l.url)}</a>`),
      ...links.map((l) => `<a class="tp-link-chip" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${icoLink}${escapeHtml(l.label || l.url)}</a>`),
    ].join("");
    html += `<div class="tp-section-label"><h2>Zusatzmaterial &amp; Links</h2></div><div class="tp-chiprow">${chips}</div>`;
  }
  return html;
}

const icoHwDue = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M9 11l3 3L22 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const icoHwNext = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Hausaufgaben-Box (fällig auf diesen Schultag / auf nächste Woche)
function buildHausaufgabenHtml(hw, kind) {
  if (!hw) return "";
  const text = (hw.text || "").trim();
  const fotos = (hw.fotos || []).filter(Boolean);
  if (!text && !fotos.length) return "";
  const isNext = kind === "naechste";
  const label = isNext ? "Hausaufgaben auf nächste Woche" : "Hausaufgaben auf diesen Schultag";
  const fotoHtml = fotos.length
    ? `<div class="ha-fotos">${fotos.map((f) => { const url = f.url || f; const cap = f.label || "Foto"; return `<a class="ha-foto" href="${escapeHtml(url)}" target="_blank" rel="noopener"><img src="${escapeHtml(url)}" alt="${escapeHtml(cap)}" loading="lazy"></a>`; }).join("")}</div>`
    : "";
  return `<div class="ha-box ha-${kind}">
    <div class="ha-head">${isNext ? icoHwNext : icoHwDue}<span>${label}</span></div>
    ${text ? `<p class="ha-text">${escapeHtml(text)}</p>` : ""}
    ${fotoHtml}
  </div>`;
}

const icoFerien = `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;

// Kachel-Übersicht aller Schultage (Überthema + verlinkte Aufträge), mit Ferien-Trennern
function buildTilesHtml(klasseId, days, currentIdx, heute) {
  const klasse = klasseById(klasseId);
  const periode = klasse ? state.klassen.semesterDaten[klasse.periode] : null;
  const plan = periode ? getFerienplan(periode.ferienplan) : null;
  const ferienList = (plan && plan.ferien) || [];
  const kurzD = (iso) => { const d = parseISO(iso); return `${d.getDate()}.${d.getMonth() + 1}.`; };

  const pieces = [];
  days.forEach((iso, i) => {
    // Ferien, die zwischen dem vorherigen und diesem Schultag liegen, als Strich einfügen
    if (i > 0) {
      const prev = days[i - 1];
      ferienList
        .filter((f) => f.von > prev && f.bis < iso)
        .forEach((f) => {
          pieces.push(`<div class="tp-ferien-sep"><span>${icoFerien}${escapeHtml(f.name)} · ${kurzD(f.von)}–${kurzD(f.bis)}</span></div>`);
        });
    }
    const dt = parseISO(iso);
    const c = schooldayContent(klasseId, iso);
    const thema = ersteThemenVorschau(c) || "";
    const aufNums = schooldayAuftraege(c);
    const cur = i === currentIdx;
    const today = iso === heute;
    const pruef = schooldayHasPruefung(c);
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    pieces.push(`<a class="tp-tile ${cur ? "is-current" : ""} ${today ? "is-today" : ""}" href="#/klasse/${encodeURIComponent(klasseId)}/${iso}">
      <div class="tp-tile-top">
        <span class="tp-tile-nr">${i + 1}</span>
        ${pruef ? `<span class="tp-tile-ziel" title="Prüfung">${icoZiel}</span>` : ""}
        ${cur ? `<span class="tp-tile-badge">${today ? "Heute" : "Aktuell"}</span>` : ""}
      </div>
      <div class="tp-tile-date">${weekdayKurz(isoWeekday(dt))} ${dd}.${mm}.${dt.getFullYear()}</div>
      <div class="tp-tile-thema ${thema ? "" : "is-empty"}">${thema ? escapeHtml(thema) : "Noch nicht geplant"}</div>
      ${aufNums.length ? `<div class="tp-tile-aufs">${aufNums.map((nr) => { const col = auftragFarbe(nr); return `<span class="tp-tile-auf"${col ? ` style="color:${col}; border-color:${hexToRgba(col, 0.4)}"` : ""}>${escapeHtml(nr)}</span>`; }).join("")}</div>` : ""}
    </a>`);
  });
  return `<div class="tp-section-label" id="weitere-anchor"><h2>Alle Schultage</h2><span class="meta">${days.length} Schultage · zum Öffnen anklicken</span></div><div class="tp-tiles">${pieces.join("")}</div>`;
}

// ===========================================================================
// Seite: Tagesprogramm (neue Startseite)
// ===========================================================================
function renderTagesprogramm(params) {
  const v = $("#view");
  const { id, datum } = params || {};

  if (!allKlassen().length) {
    v.innerHTML = `<div class="empty"><h2>Keine Klassendaten</h2><p>Die Datei <code>data/klassen.json</code> konnte nicht geladen werden.</p></div>`;
    return;
  }

  let klasseId = (id && klasseById(id)) ? id : getActiveKlasseId();
  setActiveKlasse(klasseId);
  const klasse = klasseById(klasseId);

  const days = computeSchooldays(klasse);
  const periode = state.klassen.semesterDaten[klasse.periode];
  const plan = getFerienplan(periode && periode.ferienplan);
  const heute = todayISO();

  // Zielschultag bestimmen
  let idx, status;
  if (datum && days.includes(datum)) {
    idx = days.indexOf(datum);
    status = datum === heute ? "heute" : (datum > heute ? "naechster" : "vorbei");
  } else {
    const p = pickCurrentSchoolday(days, heute);
    idx = p.index; status = p.status;
  }
  // Ferien-Erkennung nur bei Auto-Auswahl
  const ferienHeute = ferienInfo(new Date(), plan);
  if (!datum && ferienHeute && (status === "naechster" || status === "vor-start")) status = "ferien";

  const statusMap = {
    heute: { txt: "Aktueller Schultag", cls: "heute" },
    naechster: { txt: "Nächster Schultag", cls: "naechster" },
    "vor-start": { txt: "Nächster Schultag", cls: "naechster" },
    ferien: { txt: `Ferien${ferienHeute ? " · " + ferienHeute.name : ""}`, cls: "ferien" },
    vorbei: { txt: "Semester abgeschlossen", cls: "vorbei" },
    keine: { txt: "Kein Schultag geplant", cls: "vorbei" },
  };
  const st = statusMap[status] || statusMap.naechster;

  const dayISO = idx >= 0 ? days[idx] : null;
  const dayDate = dayISO ? parseISO(dayISO) : null;

  // Banner-Text
  let banner = "";
  if (status === "vor-start" || (status === "ferien" && dayDate)) {
    const nx = dayDate ? `${weekdayLang(dayDate)}, ${formatLang(dayDate)}` : "—";
    const grund = status === "ferien"
      ? `Aktuell sind Ferien${ferienHeute ? " (" + escapeHtml(ferienHeute.name) + ")" : ""}.`
      : `Das Semester startet am ${formatLang(parseISO(periode.von))}.`;
    banner = `${grund} Nächster Schultag dieser Klasse: <strong>${escapeHtml(nx)}</strong>.`;
  } else if (status === "vorbei") {
    banner = `Das Semester ist abgeschlossen – angezeigt wird der letzte Schultag.`;
  }

  const content = dayISO ? schooldayContent(klasseId, dayISO) : null;
  const hasContent = schooldayHasContent(content);

  v.appendChild(el(`
    <section class="tp">
      <div class="tp-bar">
        <span class="tp-bku">Berufskundeunterricht Sanitär</span>
        <div class="tp-nav">
          <div class="tp-nav-group">
            <button class="tp-navbtn" id="tp-prev" ${idx <= 0 ? "disabled" : ""} aria-label="Vorheriger Schultag" title="Vorheriger Schultag">‹</button>
            <button class="tp-navbtn tp-navbtn-mid" id="tp-today">Aktuell</button>
            <button class="tp-navbtn" id="tp-next" ${idx < 0 || idx >= days.length - 1 ? "disabled" : ""} aria-label="Nächster Schultag" title="Nächster Schultag">›</button>
          </div>
          <button class="tp-navlink" id="tp-sem" type="button">Alle Schultage</button>
        </div>
      </div>

      ${banner ? `<div class="tp-banner"><svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 8v5M12 16v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span>${banner}</span></div>` : ""}

      <div id="tp-day"></div>
      <div id="tp-weitere"></div>
    </section>
  `));

  // Aktueller Schultag als EINE Kachel: Kopf (Schultag-Nr + Datum) → Hausaufgaben fällig
  // → 5 Lektionen (3+2-Raster) → Lernaufträge/Links → Hausaufgaben nächste Woche.
  const dayHost = $("#tp-day");
  if (!dayISO) {
    dayHost.innerHTML = `<div class="tp-empty"><svg viewBox="0 0 24 24" width="40" height="40"><rect x="3" y="4" width="18" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 9h18M8 2v4M16 2v4" stroke="currentColor" stroke-width="1.6"/></svg><h3>Keine Schultage berechnet</h3><p>Für diese Klasse sind im aktuellen Semester keine Schultage hinterlegt.</p></div>`;
  } else {
    const head = `
      <header class="tp-dc-head">
        <div class="tp-dc-num"><span class="tp-dc-num-l">Schultag</span><strong>${idx + 1}</strong><span class="tp-dc-of">/ ${days.length}</span></div>
        <div class="tp-dc-when">
          <span class="tp-dc-klasse">Klasse ${escapeHtml(klasse.id)}</span>
          <span class="tp-dc-wd">${escapeHtml(weekdayLang(dayDate))}</span>
          <span class="tp-dc-date">${escapeHtml(formatLang(dayDate))}</span>
        </div>
      </header>`;
    let html = head + buildPruefungHeuteHtml(content) + buildHausaufgabenHtml(content && content.hausaufgabenFaellig, "faellig");
    html += `<div class="tp-dc-label">Schultag-Ablauf</div>${buildLektionenHtml(content, klasse.halbtag)}`;
    if (!hasContent) {
      html += `<div class="tp-empty tp-empty-inline"><svg viewBox="0 0 24 24" width="32" height="32"><path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg><h3>Dieser Schultag ist noch nicht geplant</h3></div>`;
    } else {
      html += buildExtrasHtml(content);
    }
    html += buildHausaufgabenHtml(content && content.hausaufgabenNaechste, "naechste");
    html += buildPruefungVorabHtml(klasseId, days, idx);
    dayHost.innerHTML = `<article class="tp-daycard">${html}</article>`;
    // Lernziele aus-/einklappen (runde Buttons)
    dayHost.querySelectorAll(".lz-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const panel = dayHost.querySelector(`.lz-panel[data-lz="${btn.dataset.lz}"]`);
        if (!panel) return;
        const open = panel.hasAttribute("hidden");
        if (open) panel.removeAttribute("hidden"); else panel.setAttribute("hidden", "");
        btn.setAttribute("aria-expanded", String(open));
        btn.classList.toggle("is-open", open);
      });
    });
  }

  // Kachel-Übersicht aller Schultage
  if (days.length) $("#tp-weitere").innerHTML = buildTilesHtml(klasseId, days, idx, heute);

  // Interaktion
  $("#tp-today").addEventListener("click", () => { location.hash = `#/klasse/${encodeURIComponent(klasseId)}`; route(); });
  $("#tp-sem").addEventListener("click", () => { const a = $("#weitere-anchor"); if (a) a.scrollIntoView({ behavior: "smooth", block: "start" }); });
  if (idx > 0) $("#tp-prev").addEventListener("click", () => { location.hash = `#/klasse/${encodeURIComponent(klasseId)}/${days[idx - 1]}`; });
  if (idx >= 0 && idx < days.length - 1) $("#tp-next").addEventListener("click", () => { location.hash = `#/klasse/${encodeURIComponent(klasseId)}/${days[idx + 1]}`; });

  // Embed-Modus: ganzen Schultag in die sichtbare iframe-Höhe einpassen
  // (direkt, nach dem nächsten Frame und sobald die Fonts geladen sind – Metriken ändern sich sonst).
  fitEmbed();
  requestAnimationFrame(fitEmbed);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitEmbed);
}

// Semester-Route: leitet aufs Tagesprogramm (mit Kachel-Übersicht) der Klasse um.
function renderSemesterUebersicht(params) {
  const { id } = params || {};
  const klasseId = (id && klasseById(id)) ? id : getActiveKlasseId();
  location.hash = klasseId ? `#/klasse/${encodeURIComponent(klasseId)}` : "#/";
}

// ===========================================================================
// Seite: Lehrer-Bereich · Tagesprogramm-Editor
//   Einfacher Passwortschutz (GBSSG2026). Die Auth-Logik liegt in `lehrerAuth`
//   und kann später 1:1 durch echte Authentifizierung ersetzt werden.
// ===========================================================================
const lehrerAuth = {
  PW: "GBSSG2026",
  KEY: "sanigbs:lehrer-unlocked",
  isUnlocked() { try { return sessionStorage.getItem(this.KEY) === "1"; } catch { return false; } },
  login(pw) { if (pw === this.PW) { try { sessionStorage.setItem(this.KEY, "1"); } catch {} return true; } return false; },
  logout() { try { sessionStorage.removeItem(this.KEY); } catch {} },
  // Später: login() gegen ein Backend/SSO prüfen – gleiche Schnittstelle, Rest bleibt.
};

function blankSchoolday() {
  return {
    bloecke: [{ titel: "", auftrag: "" }, { titel: "", auftrag: "" }],
    lektionen: [0, 1, 2, 3, 4].map(() => ({ thema: "", material: [], notizen: "" })),
    links: [], pdfs: [],
    hausaufgabenFaellig: { text: "", fotos: [] },
    hausaufgabenNaechste: { text: "", fotos: [] },
  };
}

// Bild verkleinern (max. Kante) und als Data-URL zurückgeben – hält den Speicher klein.
function resizeImageToDataUrl(file, maxDim = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * s), h = Math.round(img.height * s);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      try { resolve(c.toDataURL("image/jpeg", quality)); } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bild konnte nicht geladen werden")); };
    img.src = url;
  });
}

// QR-Bibliothek bei Bedarf nachladen (nur im Editor)
let _qrPromise = null;
function ensureQrLib() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (_qrPromise) return _qrPromise;
  _qrPromise = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
    s.onload = () => res(window.qrcode);
    s.onerror = () => rej(new Error("QR-Bibliothek konnte nicht geladen werden"));
    document.head.appendChild(s);
  });
  return _qrPromise;
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Basis-JSON + lokale Bearbeitungen → vollständige tagesprogramm.json zum Speichern im Repo
function exportTagesprogramm() {
  const base = JSON.parse(JSON.stringify(state.tagesprogramm || { version: "2.0", klassen: {} }));
  base.klassen = base.klassen || {};
  const edits = loadTpEdits();
  Object.entries(edits).forEach(([key, content]) => {
    const i = key.indexOf("|"); const kid = key.slice(0, i); const date = key.slice(i + 1);
    base.klassen[kid] = base.klassen[kid] || { schultage: {} };
    base.klassen[kid].schultage = base.klassen[kid].schultage || {};
    base.klassen[kid].schultage[date] = content;
  });
  base.stand = todayISO();
  downloadJson(base, "tagesprogramm.json");
}

// Gesamtes Semester einer Klasse als PDF (Druck-Ansicht aller Schultage).
// Dateiname-Vorschlag = {Klasse}_{N}.Semester_Archiv (über document.title beim Drucken).
function exportSemesterPdf(klasseId) {
  const klasse = klasseById(klasseId);
  if (!klasse) return;
  const days = computeSchooldays(klasse);
  const periode = state.klassen.semesterDaten[klasse.periode];
  const halbtag = klasse.halbtag;
  const daysHtml = days.map((iso, i) => {
    const c = schooldayContent(klasseId, iso);
    const dt = parseISO(iso);
    const pr = schooldayPruefung(c);
    let inner = `<div class="print-day-head"><span class="print-day-nr">Schultag ${i + 1}</span><span>${escapeHtml(weekdayLang(dt))}, ${escapeHtml(formatLang(dt))}</span>${pr ? `<span class="print-day-pruef">${escapeHtml(pr.titel)}</span>` : ""}</div>`;
    inner += buildHausaufgabenHtml(c && c.hausaufgabenFaellig, "faellig");
    inner += buildLektionenHtml(c, halbtag);
    inner += buildExtrasHtml(c);
    inner += buildHausaufgabenHtml(c && c.hausaufgabenNaechste, "naechste");
    return `<div class="print-day">${inner}</div>`;
  }).join("");
  const wrap = el(`<div class="print-archiv">
    <div class="print-archiv-head">
      <h1>${escapeHtml(klasse.id)} · ${klasse.semester}. Semester</h1>
      <p>Berufskundeunterricht Sanitär · ${escapeHtml(klasse.beruf)} · ${escapeHtml(periode ? periode.name : "")} · ${days.length} Schultage</p>
    </div>
    ${daysHtml}
  </div>`);
  document.body.appendChild(wrap);
  document.body.classList.add("printing-archiv");
  const prevTitle = document.title;
  document.title = `${klasse.id}_${klasse.semester}.Semester_Archiv`;
  const cleanup = () => { if (document.body.contains(wrap)) wrap.remove(); document.body.classList.remove("printing-archiv"); document.title = prevTitle; window.removeEventListener("afterprint", cleanup); };
  window.addEventListener("afterprint", cleanup);
  window.print();
  setTimeout(cleanup, 60000);
}

// "Label | URL" je Zeile → in links und pdfs aufteilen
function parseLinkLines(text) {
  const links = [], pdfs = [];
  String(text || "").split("\n").map((l) => l.trim()).filter(Boolean).forEach((line) => {
    const parts = line.split("|");
    const url = (parts.length > 1 ? parts.slice(1).join("|") : parts[0]).trim();
    const label = (parts.length > 1 ? parts[0] : url).trim();
    if (!url) return;
    const entry = { label, url };
    if (/\.pdf(\?|#|$)/i.test(url)) pdfs.push(entry); else links.push(entry);
  });
  return { links, pdfs };
}
// Eine Editor-Zeile für einen Link: Beschriftung (das verlinkte Wort) + URL
function linkRowHtml(label, url) {
  return `<div class="ed-link-row">
    <input class="ed-input ed-link-label" type="text" placeholder="Beschriftung (verlinktes Wort)" value="${escapeHtml(label || "")}">
    <input class="ed-input ed-link-url" type="text" inputmode="url" placeholder="https://…" value="${escapeHtml(url || "")}">
    <button type="button" class="ed-link-del" title="Entfernen" aria-label="Link entfernen">✕</button>
  </div>`;
}

function renderLehrer() {
  const v = $("#view");
  if (!lehrerAuth.isUnlocked()) { renderLehrerGate(v); return; }
  renderEditorUI(v);
}

function renderLehrerGate(v) {
  v.appendChild(el(`
    <div class="editor-gate">
      <div class="editor-gate-card">
        <div class="editor-gate-icon">
          <svg viewBox="0 0 24 24" width="28" height="28"><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="15.5" r="1.4" fill="currentColor"/></svg>
        </div>
        <h1>Lehrer-Bereich</h1>
        <p>Tagesprogramm bearbeiten. Bitte mit dem Lehrer-Passwort anmelden.</p>
        <form id="lehrer-gate-form">
          <input type="password" id="lehrer-pw" placeholder="Passwort" autocomplete="current-password" />
          <button class="btn btn-primary" type="submit">Anmelden</button>
        </form>
        <p class="editor-gate-error" id="lehrer-err" hidden>Falsches Passwort.</p>
        <a class="editor-gate-back" href="#/">← Zurück zum Tagesprogramm</a>
      </div>
    </div>
  `));
  const form = $("#lehrer-gate-form");
  const pw = $("#lehrer-pw");
  pw.focus();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (lehrerAuth.login(pw.value)) renderEditorUI($("#view"));
    else { $("#lehrer-err").hidden = false; pw.value = ""; pw.focus(); }
  });
}

function renderEditorUI(v) {
  v.innerHTML = "";
  if (!allKlassen().length) { v.innerHTML = `<div class="empty"><h2>Keine Klassendaten</h2></div>`; return; }

  // Deeplink-Parameter (z. B. vom QR-Code am Handy): #/lehrer?k=KLASSE&d=DATUM
  const hash = location.hash; const qi = hash.indexOf("?");
  const params = new URLSearchParams(qi >= 0 ? hash.slice(qi + 1) : "");
  let klasseId = (params.get("k") && klasseById(params.get("k"))) ? params.get("k") : getActiveKlasseId();
  let wantDate = params.get("d") || "";

  v.appendChild(el(`
    <div class="editor2">
      <header class="editor2-head">
        <div>
          <span class="editor2-tag">Lehrer-Bereich</span>
          <h1>Tagesprogramm bearbeiten</h1>
        </div>
        <div class="editor2-actions">
          <button class="btn btn-ghost" id="ed-export" type="button">JSON exportieren</button>
          <label class="btn btn-ghost">JSON importieren<input type="file" id="ed-import" accept=".json" hidden></label>
          <button class="btn btn-ghost" id="ed-logout" type="button">Abmelden</button>
        </div>
      </header>

      <details class="ed-teamslinks">
        <summary><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg> Teams-Links der Klassen <span class="ed-tl-sub">– als Website-Reiter einbetten</span></summary>
        <p class="ed-tl-hint">Diese Links als „Website"-Reiter in den Teams-Kanal der jeweiligen Klasse einfügen. Die Seite öffnet dann automatisch das Tagesprogramm dieser Klasse im eingebetteten Modus und skaliert sich auf die Reitergrösse.</p>
        <div class="ed-tl-list">
          ${allKlassen().map((k) => `
            <div class="ed-tl-row">
              <span class="ed-tl-klasse">${escapeHtml(k.id)}</span>
              <input class="ed-input ed-tl-url" type="text" readonly value="${escapeHtml(teamsLink(k.id))}" aria-label="Teams-Link ${escapeHtml(k.id)}">
              <button type="button" class="btn btn-ghost btn-sm ed-tl-copy" data-url="${escapeHtml(teamsLink(k.id))}">Kopieren</button>
            </div>`).join("")}
        </div>
      </details>

      <div class="editor2-pick">
        <div class="ed-field">
          <label for="ed-klasse">Klasse</label>
          <div class="select-wrap"><select id="ed-klasse">${klasseOptionsHtml(klasseId)}</select><svg class="select-chev" viewBox="0 0 24 24" width="16" height="16"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        </div>
        <div class="ed-field">
          <label for="ed-tag">Schultag</label>
          <div class="select-wrap"><select id="ed-tag"></select><svg class="select-chev" viewBox="0 0 24 24" width="16" height="16"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        </div>
      </div>

      <div id="ed-form"></div>

      <div class="ed-footer">
        <button class="btn btn-ghost" id="ed-semester-pdf" type="button">
          <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" style="margin-right:4px"><path d="M12 3v11m0 0l-4-4m4 4l4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Semester als PDF herunterladen
        </button>
        <span class="ed-footer-hint">Alle Schultage der gewählten Klasse als druckbares Archiv (Dateiname: <code>Klasse_Semester_Archiv</code>).</span>
      </div>
    </div>
  `));

  const tagSelect = $("#ed-tag");
  $("#ed-semester-pdf").addEventListener("click", () => exportSemesterPdf($("#ed-klasse").value));

  // Teams-Link kopieren (pro Klasse) – mit Fallback für ältere Browser
  $$(".ed-tl-copy").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const url = btn.dataset.url || "";
      let ok = false;
      try { await navigator.clipboard.writeText(url); ok = true; }
      catch {
        const inp = btn.parentElement.querySelector(".ed-tl-url");
        if (inp) { inp.focus(); inp.select(); try { ok = document.execCommand("copy"); } catch {} }
      }
      const prev = btn.textContent;
      btn.textContent = ok ? "Kopiert ✓" : "Manuell markieren";
      btn.classList.toggle("is-copied", ok);
      setTimeout(() => { btn.textContent = prev; btn.classList.remove("is-copied"); }, 1600);
    });
  });
  const fillTagSelect = (kid, selectDate) => {
    const klasse = klasseById(kid);
    const days = computeSchooldays(klasse);
    tagSelect.innerHTML = days.map((iso, i) => {
      const dt = parseISO(iso);
      const c = schooldayContent(kid, iso);
      const thema = (c && c.thema) || ersteThemenVorschau(c) || "";
      const dd = String(dt.getDate()).padStart(2, "0"), mm = String(dt.getMonth() + 1).padStart(2, "0");
      return `<option value="${iso}" ${iso === selectDate ? "selected" : ""}>Schultag ${i + 1} · ${weekdayKurz(isoWeekday(dt))} ${dd}.${mm}.${dt.getFullYear()}${thema ? " · " + escapeHtml(thema) : ""}</option>`;
    }).join("");
    return days;
  };

  let days = fillTagSelect(klasseId, "");
  // Startdatum: gewünschtes (Deeplink) → sonst aktueller Schultag → sonst erster
  let startDate = (wantDate && days.includes(wantDate)) ? wantDate : null;
  if (!startDate && days.length) {
    const p = pickCurrentSchoolday(days, todayISO());
    startDate = days[Math.max(0, p.index)];
  }
  if (startDate) tagSelect.value = startDate;

  drawEditorForm(klasseId, startDate);

  $("#ed-klasse").addEventListener("change", (e) => {
    klasseId = e.target.value;
    setActiveKlasse(klasseId);
    const d2 = fillTagSelect(klasseId, "");
    const nd = d2.length ? d2[Math.max(0, pickCurrentSchoolday(d2, todayISO()).index)] : null;
    if (nd) tagSelect.value = nd;
    drawEditorForm(klasseId, nd);
  });
  tagSelect.addEventListener("change", () => drawEditorForm(klasseId, tagSelect.value));

  $("#ed-logout").addEventListener("click", () => { lehrerAuth.logout(); location.hash = "#/"; });
  $("#ed-export").addEventListener("click", exportTagesprogramm);
  $("#ed-import").addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    if (!confirm("Importierte Datei als Basis übernehmen? Lokale, noch nicht exportierte Änderungen werden dabei verworfen.")) { ev.target.value = ""; return; }
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !parsed.klassen) throw new Error("Unerwartetes Format (kein 'klassen').");
      state.tagesprogramm = parsed;
      localStorage.removeItem(TP_EDIT_KEY);
      renderEditorUI($("#view"));
      alert("Import erfolgreich.");
    } catch (e) { alert("Import fehlgeschlagen: " + (e.message || e)); }
    ev.target.value = "";
  });
}

// Formular für einen konkreten Schultag zeichnen
function drawEditorForm(klasseId, dateISO) {
  const host = $("#ed-form");
  if (!host) return;
  if (!dateISO) { host.innerHTML = `<div class="tp-empty"><h3>Kein Schultag</h3><p>Für diese Klasse sind keine Schultage berechnet.</p></div>`; return; }

  const base = schooldayContent(klasseId, dateISO);
  const c = base ? JSON.parse(JSON.stringify(base)) : blankSchoolday();
  // Normalisieren (alte/teilweise Datensätze auffüllen)
  c.lektionen = c.lektionen || [];
  while (c.lektionen.length < 5) c.lektionen.push({ thema: "", material: [], notizen: "" });
  c.hausaufgabenFaellig = c.hausaufgabenFaellig || { text: "", fotos: [] };
  c.hausaufgabenNaechste = c.hausaufgabenNaechste || { text: "", fotos: [] };
  c.pruefung = c.pruefung || { titel: "", auftrag: "" };

  // Fotos werden live in diesem Objekt gehalten (Texte erst beim Speichern gelesen)
  const photos = {
    faellig: [...(c.hausaufgabenFaellig.fotos || [])],
    naechste: [...(c.hausaufgabenNaechste.fotos || [])],
  };

  const dt = parseISO(dateISO);
  const klasse = klasseById(klasseId);
  const zeiten = LEKTIONSZEITEN[klasse.halbtag] || LEKTIONSZEITEN.Nachmittag;
  c.bloecke = c.bloecke || [];
  while (c.bloecke.length < 2) c.bloecke.push({ titel: "", auftrag: "" });

  const lektField = (i) => {
    const l = c.lektionen[i] || {};
    return `<div class="ed-lekt">
      <div class="ed-lekt-head"><span class="ed-lekt-zeit">${zeiten[i]}</span><span class="ed-lekt-nr">Lektion ${i + 1}</span></div>
      <input class="ed-input" id="lk-thema-${i}" type="text" placeholder="Thema" value="${escapeHtml(l.thema || "")}">
      <textarea class="ed-input" id="lk-notiz-${i}" rows="2" placeholder="Notizen">${escapeHtml(l.notizen || "")}</textarea>
    </div>`;
  };
  const blockGroup = (k, range, label) => {
    const b = c.bloecke[k] || {};
    return `<div class="ed-block ed-blockgroup">
      <div class="ed-blk-head">
        <span class="ed-blk-label">${label}</span>
        <input class="ed-input ed-blk-titel" id="ed-blk${k}-titel" type="text" placeholder="Titel (z. B. Trinkwasser – Eigenschaften & Gewinnung)" value="${escapeHtml(b.titel || "")}">
        <input class="ed-input ed-blk-auf" id="ed-blk${k}-auf" type="text" placeholder="Auftrag-Nr (z. B. 1.4)" value="${escapeHtml(b.auftrag || "")}">
      </div>
      <div class="ed-lekt-list">${range.map(lektField).join("")}</div>
    </div>`;
  };

  host.innerHTML = `
    <form class="ed-form" id="ed-day-form" autocomplete="off">
      <div class="ed-block ha-edit ha-faellig">
        <label class="ed-label" for="ed-ha-f">Hausaufgaben auf diesen Schultag</label>
        <textarea class="ed-input" id="ed-ha-f" rows="2" placeholder="Was war auf heute zu erledigen?">${escapeHtml(c.hausaufgabenFaellig.text || "")}</textarea>
        <div class="ed-fotos" data-kind="faellig"></div>
        <div class="ed-foto-actions">
          <label class="btn btn-ghost btn-sm">📷 Foto (PC)<input type="file" accept="image/*" multiple hidden data-foto="faellig"></label>
          <button type="button" class="btn btn-ghost btn-sm" data-qr="faellig">Per Handy (QR)</button>
        </div>
      </div>

      <p class="ed-hint" style="margin:0">Jeder Block hat einen Titel und eine Auftrags-Nummer. Die Auftragsfarbe tönt den Block; die Nummer verlinkt aufs Auftrags-PDF.</p>
      ${blockGroup(0, [0, 1, 2], "Block 1 · Lektion 1–3")}
      ${blockGroup(1, [3, 4], "Block 2 · Lektion 4–5")}

      <div class="ed-block">
        <label class="ed-label">Weblinks &amp; PDFs</label>
        <div class="ed-links" id="ed-links">${([...(c.pdfs || []), ...(c.links || [])].filter((l) => l && l.url).map((l) => linkRowHtml(l.label, l.url)).join("")) || linkRowHtml("", "")}</div>
        <button type="button" class="btn btn-ghost btn-sm" id="ed-link-add">+ Link hinzufügen</button>
        <p class="ed-hint">Links: die <strong>Beschriftung</strong> ist das Wort, das verlinkt angezeigt wird; die <strong>URL</strong> ist das Ziel. Endet die Adresse auf <code>.pdf</code>, wird sie als PDF erkannt.</p>
      </div>

      <div class="ed-block ha-edit ha-naechste">
        <label class="ed-label" for="ed-ha-n">Hausaufgaben auf nächste Woche</label>
        <textarea class="ed-input" id="ed-ha-n" rows="2" placeholder="Was ist auf nächste Woche zu erledigen?">${escapeHtml(c.hausaufgabenNaechste.text || "")}</textarea>
        <div class="ed-fotos" data-kind="naechste"></div>
        <div class="ed-foto-actions">
          <label class="btn btn-ghost btn-sm">📷 Foto (PC)<input type="file" accept="image/*" multiple hidden data-foto="naechste"></label>
          <button type="button" class="btn btn-ghost btn-sm" data-qr="naechste">Per Handy (QR)</button>
        </div>
      </div>

      <div class="ed-block ed-pruef-edit">
        <label class="ed-label">Prüfung an diesem Schultag (optional)</label>
        <div class="ed-pruef-row">
          <input class="ed-input" id="ed-pruef-titel" type="text" placeholder="z. B. Prüfung 1.5 – Leitungsmaterialien" value="${escapeHtml(c.pruefung.titel || "")}">
          <input class="ed-input ed-blk-auf" id="ed-pruef-auf" type="text" placeholder="Auftrag-Nr" value="${escapeHtml(c.pruefung.auftrag || "")}">
        </div>
        <p class="ed-hint">Markiert den Tag als Prüfungstag (Kachel orange, „Prüfung" rot). Über die Auftrags-Nr werden die Lernziele automatisch verlinkt und 2 Wochen vorher als Hinweis mit Datum angezeigt.</p>
      </div>

      <div class="ed-bar">
        <button class="btn btn-brand" type="submit">Speichern</button>
        <a class="btn btn-ghost" href="#/klasse/${encodeURIComponent(klasseId)}/${dateISO}" target="_blank" rel="noopener">Vorschau ↗</a>
        <button class="btn btn-ghost" type="button" id="ed-reset">Auf Basis zurücksetzen</button>
        <span class="ed-saved" id="ed-saved" hidden>Gespeichert ✓</span>
      </div>
    </form>`;

  // Foto-Streifen zeichnen
  const drawStrip = (kind) => {
    const wrap = host.querySelector(`.ed-fotos[data-kind="${kind}"]`);
    if (!wrap) return;
    wrap.innerHTML = photos[kind].map((f, i) =>
      `<div class="ed-foto"><img src="${escapeHtml(f.url || f)}" alt="${escapeHtml(f.label || "Foto")}"><button type="button" class="ed-foto-del" data-kind="${kind}" data-i="${i}" title="Entfernen">✕</button></div>`
    ).join("");
  };
  drawStrip("faellig"); drawStrip("naechste");

  // Foto-Upload (PC)
  host.querySelectorAll("input[data-foto]").forEach((inp) => {
    inp.addEventListener("change", async (e) => {
      const kind = inp.dataset.foto;
      for (const file of Array.from(e.target.files || [])) {
        try { const url = await resizeImageToDataUrl(file); photos[kind].push({ url, label: file.name }); }
        catch (err) { alert("Foto konnte nicht verarbeitet werden: " + (err.message || err)); }
      }
      e.target.value = "";
      drawStrip(kind);
    });
  });
  // Foto entfernen / Link-Zeile entfernen (Delegation)
  host.addEventListener("click", (e) => {
    const fdel = e.target.closest(".ed-foto-del");
    if (fdel) { photos[fdel.dataset.kind].splice(Number(fdel.dataset.i), 1); drawStrip(fdel.dataset.kind); return; }
    const ldel = e.target.closest(".ed-link-del");
    if (ldel) { ldel.closest(".ed-link-row").remove(); }
  });
  // Link-Zeile hinzufügen
  const linkAdd = host.querySelector("#ed-link-add");
  if (linkAdd) linkAdd.addEventListener("click", () => {
    const wrap = host.querySelector("#ed-links");
    wrap.insertAdjacentHTML("beforeend", linkRowHtml("", ""));
    const last = wrap.querySelector(".ed-link-row:last-child .ed-link-label");
    if (last) last.focus();
  });
  // QR (Handy)
  host.querySelectorAll("button[data-qr]").forEach((btn) => {
    btn.addEventListener("click", () => openQrOverlay(klasseId, dateISO));
  });

  // Speichern
  const val = (sel) => { const e = host.querySelector(sel); return e ? e.value.trim() : ""; };
  $("#ed-day-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const lekt = [];
    for (let i = 0; i < 5; i++) lekt.push({ thema: val(`#lk-thema-${i}`), material: [], notizen: val(`#lk-notiz-${i}`) });
    const bloecke = [0, 1].map((k) => ({ titel: val(`#ed-blk${k}-titel`), auftrag: val(`#ed-blk${k}-auf`) }));
    // Links aus den Zeilen sammeln: Beschriftung + URL, .pdf wird als PDF erkannt
    const links = [], pdfs = [];
    host.querySelectorAll(".ed-link-row").forEach((r) => {
      const url = r.querySelector(".ed-link-url").value.trim();
      if (!url) return;
      const label = r.querySelector(".ed-link-label").value.trim() || url;
      const entry = { label, url };
      if (/\.pdf(\?|#|$)/i.test(url)) pdfs.push(entry); else links.push(entry);
    });
    const content = {
      bloecke,
      lektionen: lekt,
      links, pdfs,
      hausaufgabenFaellig: { text: val("#ed-ha-f"), fotos: photos.faellig },
      hausaufgabenNaechste: { text: val("#ed-ha-n"), fotos: photos.naechste },
    };
    const pTitel = val("#ed-pruef-titel");
    if (pTitel) content.pruefung = { titel: pTitel, auftrag: val("#ed-pruef-auf") };
    const edits = loadTpEdits();
    edits[tpEditKey(klasseId, dateISO)] = content;
    if (saveTpEdits(edits)) {
      const s = $("#ed-saved"); s.hidden = false; setTimeout(() => { s.hidden = true; }, 1800);
    }
  });
  $("#ed-reset").addEventListener("click", () => {
    if (!confirm("Lokale Bearbeitung dieses Schultags verwerfen und die Basis-Inhalte laden?")) return;
    const edits = loadTpEdits();
    delete edits[tpEditKey(klasseId, dateISO)];
    saveTpEdits(edits);
    drawEditorForm(klasseId, dateISO);
  });
}

// QR-Overlay: Link auf den Editor (dieser Schultag) zum Öffnen am Handy
function openQrOverlay(klasseId, dateISO) {
  const url = location.origin + location.pathname + `#/lehrer?k=${encodeURIComponent(klasseId)}&d=${dateISO}`;
  const overlay = el(`
    <div class="hk-overlay" role="dialog" aria-modal="true" aria-label="Per Handy bearbeiten">
      <div class="hk-overlay-backdrop" data-close></div>
      <div class="hk-overlay-panel qr-panel">
        <button class="hk-overlay-close" data-close aria-label="Schliessen">✕</button>
        <h2>Am Handy bearbeiten</h2>
        <p>QR-Code scannen, um diesen Schultag am Handy zu öffnen – dort kannst du direkt ein Foto aufnehmen und hochladen.</p>
        <div class="qr-box" id="qr-box"><span class="loader"></span></div>
        <p class="qr-url">${escapeHtml(url)}</p>
        <p class="ed-hint">Hinweis: Ohne Server werden Fotos vorerst <strong>auf dem jeweiligen Gerät</strong> gespeichert. Zum Zusammenführen am PC «JSON exportieren» / am anderen Gerät «importieren» – oder später automatisch über ein Backend (Struktur ist vorbereitet).</p>
      </div>
    </div>`);
  document.body.appendChild(overlay);
  document.body.classList.add("has-overlay");
  const close = () => { overlay.remove(); document.body.classList.remove("has-overlay"); };
  overlay.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));

  ensureQrLib().then((qrcode) => {
    const qr = qrcode(0, "M"); qr.addData(url); qr.make();
    $("#qr-box").innerHTML = qr.createSvgTag({ cellSize: 5, margin: 1 });
  }).catch(() => {
    $("#qr-box").innerHTML = `<p class="ed-hint">QR-Code konnte nicht geladen werden. Du kannst den Link oben manuell am Handy öffnen.</p>`;
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const routes = [
  // Neue Startseite = Tagesprogramm der gewählten Klasse
  { match: /^#?\/?$/, render: renderTagesprogramm },
  { match: /^#\/klasse\/([^/]+)\/semester$/, render: renderSemesterUebersicht, params: ["id"] },
  { match: /^#\/klasse\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/, render: renderTagesprogramm, params: ["id", "datum"] },
  { match: /^#\/klasse\/([^/]+)$/, render: renderTagesprogramm, params: ["id"] },
  { match: /^#\/semester$/, render: renderSemesterUebersicht },   // aktive Klasse
  // Bisherige Startseite (Lernweg) → Bereich „Ablauf der Lehre"
  { match: /^#\/ablauf$/, render: renderHome },
  { match: /^#\/entdecken$/, render: () => { location.hash = "#/ablauf"; } },
  { match: /^#\/pfad$/, render: () => { location.hash = "#/ablauf"; } },
  // Funktionale Routen bleiben erhalten
  { match: /^#\/semester\/(\d)$/, render: renderSemester, params: ["num"] },
  { match: /^#\/auftrag\/(\d+\.\d+)$/, render: renderAuftrag, params: ["id"] },
  { match: /^#\/suche(?:\?q=(.*))?$/, render: renderSearch, params: ["q"] },
  { match: /^#\/kompetenzen$/, render: renderKompetenzen },
  { match: /^#\/plakat$/, render: renderPlakat },
  { match: /^#\/info$/, render: renderInfo },
  { match: /^#\/lehrer(?:\?.*)?$/, render: renderLehrer },
  { match: /^#\/edit$/, render: renderEditor },
];

async function route() {
  if (!state.ready) {
    $("#view").innerHTML = `<div class="empty"><span class="loader" aria-hidden="true"></span><h2>Daten werden geladen …</h2></div>`;
    try { await loadData(); }
    catch (e) {
      $("#view").innerHTML = `
        <div class="empty">
          <h2>Daten konnten nicht geladen werden</h2>
          <p>Bitte stelle sicher, dass die Seite über einen lokalen Webserver geöffnet wird.</p>
          <p><code>start.ps1</code> im <code>web</code>-Ordner doppelklicken oder ausführen.</p>
          <p><small>${escapeHtml(e.message || String(e))}</small></p>
        </div>`;
      return;
    }
  }
  initShell();
  const hash = location.hash || "#/";
  for (const r of routes) {
    const m = hash.match(r.match);
    if (m) {
      const params = {};
      (r.params || []).forEach((p, i) => (params[p] = decodeURIComponent(m[i + 1] || "")));
      $("#view").innerHTML = "";
      await r.render(params);
      window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
      updateActiveNav();
      return;
    }
  }
  $("#view").innerHTML = `<div class="empty"><h2>Seite nicht gefunden</h2><p><a href="#/">Zur Startseite</a></p></div>`;
}

// Sidebar ein-/ausklappen (Zustand merken; Standard = ausgeklappt)
const SIDEBAR_KEY = "sanigbs:sidebar-collapsed:v1";
function applySidebarState() {
  let collapsed = false;
  try { collapsed = localStorage.getItem(SIDEBAR_KEY) === "1"; } catch {}
  document.body.classList.toggle("sidebar-collapsed", collapsed);
}

// Embed-Modus: wenn die Seite eingebettet läuft (z. B. als Teams-Reiter im iframe),
// schaltet ein kompaktes, höhensparendes Layout den ganzen Schultag ohne Scrollen sichtbar.
// Automatisch per iframe-Erkennung; mit ?embed=1 / ?embed=0 erzwingbar.
function applyEmbedState() {
  let embedded = false;
  try { embedded = window.self !== window.top; } catch { embedded = true; }
  try {
    const force = new URLSearchParams(location.search).get("embed");
    if (force === "1") embedded = true;
    else if (force === "0") embedded = false;
  } catch {}
  document.body.classList.toggle("is-embed", embedded);
}

// Einbett-Link für einen Teams-Website-Reiter: öffnet das Tagesprogramm der Klasse
// direkt im Embed-Modus (?embed=1). Basis = aktuelle Live-URL (origin + Pfad).
function teamsLink(klasseId) {
  return `${location.origin}${location.pathname}?embed=1#/klasse/${encodeURIComponent(klasseId)}`;
}

// Im Embed-Modus den ganzen Schultag herunterskalieren, bis er in die sichtbare
// iframe-Höhe passt (wie "auf Seite einpassen"). Links ausgerichtet; skaliert mit
// der Reitergrösse mit. Nur Verkleinern (max. 1:1), mit sinnvoller Untergrenze.
function fitEmbed() {
  const view = $("#view");
  if (!view) return;
  // Erst zurücksetzen, um die natürliche Grösse zu messen
  view.style.zoom = "";
  if (!document.body.classList.contains("is-embed")) return;
  // Bezugselement: der Schultag (Tageskachel); fehlt er, nichts skalieren
  const day = view.querySelector(".tp-daycard") || view.querySelector(".tp-empty");
  if (!day) return;
  // Unterkante des Schultags ab Viewport-Oberkante (Seite ist beim Rendern oben)
  const natBottom = day.getBoundingClientRect().bottom + window.scrollY;
  const availH = window.innerHeight - 8;
  if (natBottom <= 0) return;
  // zoom skaliert (anders als transform) den Layout-Fluss mit und richtet links aus.
  let z = availH / natBottom;
  z = Math.max(0.5, Math.min(1, z));
  if (z < 1) view.style.zoom = String(z);
}

// Bei Grössenänderung des iframes neu einpassen (entprellt)
let _fitTimer = null;
function scheduleFit() {
  if (_fitTimer) clearTimeout(_fitTimer);
  _fitTimer = setTimeout(fitEmbed, 80);
}
window.addEventListener("resize", scheduleFit);

// Sidebar einmalig initialisieren (Klassen-Dropdown füllen + Toggle verdrahten)
let _shellInited = false;
function initShell() {
  applySidebarState();
  applyEmbedState();
  if (_shellInited) return;
  const sel = $("#sb-klasse");
  if (sel && allKlassen().length) {
    sel.innerHTML = klasseOptionsHtml(getActiveKlasseId());
    sel.addEventListener("change", () => applyKlasse(sel.value));
  }
  const toggle = $("#sidebar-toggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const collapsed = !document.body.classList.contains("sidebar-collapsed");
      document.body.classList.toggle("sidebar-collapsed", collapsed);
      try { localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0"); } catch {}
    });
  }
  if (sel || toggle) _shellInited = true;
}

function updateActiveNav() {
  const hash = location.hash || "#/";
  // Hauptbereiche: Tagesprogramm (#/, #/klasse, #/semester) · Entdecken · Suchen · Kompetenzen
  let key = "tagesprogramm";
  if (hash.startsWith("#/suche")) key = "suche";
  else if (hash.startsWith("#/kompetenzen") || hash.startsWith("#/plakat")) key = "kompetenzen";
  else if (hash.startsWith("#/entdecken") || hash.startsWith("#/auftrag") || /^#\/semester\/\d/.test(hash)) key = "entdecken";
  else if (hash.startsWith("#/klasse") || hash === "#/" || hash === "" || hash.startsWith("#/semester")) key = "tagesprogramm";
  else key = ""; // Info / Lehrer / Edit – keine Hauptkachel aktiv
  $$(".sidenav a, .bottomnav a").forEach((a) => a.classList.toggle("is-active", key !== "" && a.dataset.nav === key));
  $$(".sidebar-lehrer").forEach((a) => a.classList.toggle("is-active", hash.startsWith("#/lehrer")));

  // Sidebar-Klassenauswahl mit aktivem State synchron halten
  const sb = $("#sb-klasse");
  if (sb && allKlassen().length) {
    const active = getActiveKlasseId();
    if (active && sb.value !== active) sb.value = active;
  }
}

window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", route);

// ---------------------------------------------------------------------------
// Seiten
// ---------------------------------------------------------------------------

// ----- Entdecken (Master-Mosaik aller Aufträge)
const MOSAIK_FILTER_KEY = "sanigbs:mosaik:v1";
function loadMosaikState() {
  try { return JSON.parse(localStorage.getItem(MOSAIK_FILTER_KEY) || "{}"); }
  catch { return {}; }
}
function saveMosaikState(s) {
  try { localStorage.setItem(MOSAIK_FILTER_KEY, JSON.stringify(s)); } catch {}
}

const HOME_OPEN_KEY = "sanigbs:home-open:v1";
function loadHomeOpen() {
  try { return new Set(JSON.parse(localStorage.getItem(HOME_OPEN_KEY) || "[]")); }
  catch { return new Set(); }
}
function saveHomeOpen(set) {
  try { localStorage.setItem(HOME_OPEN_KEY, JSON.stringify([...set])); } catch {}
}

// Aufträge eines Semesters in zeitlicher Reihenfolge
function auftraegeSorted(semNum) {
  const aufs = state.data.aufträge.filter((a) => a.semester === semNum);
  const order = state.reihenfolge?.semester?.[String(semNum)];
  if (order && order.length) {
    const map = new Map(order.map((id, i) => [id, i]));
    return aufs.sort((a, b) => (map.get(a.id) ?? 999) - (map.get(b.id) ?? 999));
  }
  return aufs.sort((a, b) => Number(a.auftragNummer.split(".")[1] || 0) - Number(b.auftragNummer.split(".")[1] || 0));
}

// Prüfungen + ÜK eines Semesters (rechte Kachel im Ablauf)
const icoPruef = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M9 4h6v3H9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.5 13l2 2 4-4.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const icoUek = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M4 20a8 8 0 0 1 16 0z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M7 12a5 5 0 0 1 10 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12 7V4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

// Prüfungen je Semester = Aufträge mit Lernziele-PDF (aus dem Manifest), verlinkt aufs PDF
function buildSemesterSideHtml(semNum) {
  const map = (state.lernziele && state.lernziele.pdf) || {};
  const numKey = (nr) => Number(String(nr).split(".")[1] || 0);
  const items = Object.keys(map)
    .map((nr) => { const a = aufById(nr); return a && a.semester === Number(semNum) ? { nr, a } : null; })
    .filter(Boolean)
    .sort((x, y) => numKey(x.nr) - numKey(y.nr));
  const list = items.length
    ? `<ol class="pruef-list">${items.map(({ nr, a }) => `<li class="pruef-item"><a class="pruef-link" href="${escapeHtml(lernzielePdf(nr))}" target="_blank" rel="noopener" title="Lernziele-PDF (Prüfungsvorbereitung) öffnen"><span class="pruef-bezug">${escapeHtml(nr)}</span><span>${escapeHtml(a.titel)}</span><span class="pruef-lz">Lernziele ↗</span></a></li>`).join("")}</ol>`
    : `<p class="weg-card-empty">Für dieses Semester sind keine Prüfungs-Lernziele hinterlegt.</p>`;
  return `<aside class="weg-side">
    <div class="weg-card weg-card-pruef">
      <div class="weg-card-head">${icoPruef}<span>Prüfungen</span>${items.length ? `<span class="weg-card-count">${items.length}</span>` : ""}</div>
      ${list}
    </div>
  </aside>`;
}

function renderHome() {
  const v = $("#view");
  const total = state.data.aufträge.length;
  const openSet = loadHomeOpen();
  const allOpen = openSet.size >= state.data.semester.length;

  v.appendChild(el(`
    <section class="home">
      <header class="home-hero">
        <div class="home-eyebrow">
          <span class="home-dot"></span>
          GBS St. Gallen · Sanitärinstallateur/in EFZ
        </div>
        <h1>Ablauf der Lehre</h1>
        <p class="home-sub">Acht Semester, ${total} Lernaufträge. Klick auf ein Semester, um den Lernpfad mit Aufträgen und den Prüfungen (mit Lernzielen) zu öffnen.</p>
      </header>

      <div class="home-pathhead">
        <h2>Der Weg durch deine Lehre</h2>
        <button id="home-toggle-all" class="ghostlink" type="button">${allOpen ? "Alle einklappen" : "Alle ausklappen"}</button>
      </div>
      <div class="lernweg" id="lernweg"></div>
    </section>
  `));

  // ---- Lernweg rendern ----
  const weg = $("#lernweg");
  state.data.semester.forEach((s, idx) => {
    const aufs = auftraegeSorted(s.nummer);
    const isOpen = openSet.has(s.nummer);
    const lj = Math.ceil(s.nummer / 2);
    const color = pfadSemesterColor(s.nummer);
    const deep = pfadSemesterDeep(s.nummer);
    const isLast = idx === state.data.semester.length - 1;

    const nodesHtml = aufs.map((a, i) => `
      <a class="pfadnode" href="#/auftrag/${a.id}" style="--node-delay:${i * 40}ms" aria-label="Auftrag ${escapeHtml(a.auftragNummer)} – ${escapeHtml(a.titel)}">
        <span class="pfadnode-circle">${escapeHtml(a.auftragNummer)}</span>
        <span class="pfadnode-info">
          <span class="pfadnode-title">${escapeHtml(a.titel)}</span>
          ${a.thema ? `<span class="pfadnode-thema">${escapeHtml(a.thema)}</span>` : ""}
        </span>
      </a>`).join("");

    const station = el(`
      <div class="weg-station ${isOpen ? "is-open" : ""}" data-sem="${s.nummer}" style="--st-color:${color}; --st-deep:${deep};">
        <div class="weg-line ${isLast ? "is-last" : ""}" aria-hidden="true"></div>
        <button class="weg-head" type="button" aria-expanded="${isOpen}">
          <span class="weg-node"><span class="weg-node-num">${s.nummer}</span></span>
          <span class="weg-info">
            <span class="weg-lj">${lj}. Lehrjahr</span>
            <span class="weg-title">${escapeHtml(s.titel)}</span>
          </span>
          <span class="weg-meta">
            <span class="weg-count">${aufs.length}</span>
            <span class="weg-chev" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </span>
          </span>
        </button>
        <div class="weg-body" ${isOpen ? "" : "hidden"}>
          <div class="weg-expand">
            <div class="weg-path">${nodesHtml}</div>
            ${buildSemesterSideHtml(s.nummer)}
          </div>
        </div>
      </div>
    `);
    weg.appendChild(station);
  });

  // ---- Toggle einzelne Station ----
  const replayTiles = (station) => {
    station.querySelectorAll(".pfadnode").forEach((t) => {
      t.style.animation = "none";
      void t.offsetHeight;
      t.style.animation = "";
    });
  };

  weg.addEventListener("click", (e) => {
    const head = e.target.closest(".weg-head");
    if (!head) return;
    const station = head.closest(".weg-station");
    const sem = Number(station.dataset.sem);
    const body = station.querySelector(".weg-body");
    const isOpenNow = !station.classList.contains("is-open");
    station.classList.toggle("is-open", isOpenNow);
    head.setAttribute("aria-expanded", String(isOpenNow));
    if (isOpenNow) { body.removeAttribute("hidden"); replayTiles(station); }
    else body.setAttribute("hidden", "");
    const open = loadHomeOpen();
    if (isOpenNow) open.add(sem); else open.delete(sem);
    saveHomeOpen(open);
    updateToggleAll();
  });

  const updateToggleAll = () => {
    const open = loadHomeOpen();
    const all = open.size >= state.data.semester.length;
    $("#home-toggle-all").textContent = all ? "Alle einklappen" : "Alle ausklappen";
  };

  $("#home-toggle-all").addEventListener("click", () => {
    const open = loadHomeOpen();
    const all = open.size >= state.data.semester.length;
    const next = new Set();
    if (!all) state.data.semester.forEach((s) => next.add(s.nummer));
    saveHomeOpen(next);
    weg.querySelectorAll(".weg-station").forEach((station) => {
      const sem = Number(station.dataset.sem);
      const isOpen = next.has(sem);
      station.classList.toggle("is-open", isOpen);
      station.querySelector(".weg-head").setAttribute("aria-expanded", String(isOpen));
      const body = station.querySelector(".weg-body");
      if (isOpen) { body.removeAttribute("hidden"); replayTiles(station); }
      else body.setAttribute("hidden", "");
    });
    updateToggleAll();
  });
}

// ----- Semester-Übersicht (8 Karten)
function renderSemesterList() {
  const v = $("#view");
  v.appendChild(el(`
    <header class="section-head">
      <h1>Semesterübersicht</h1>
      <span class="meta">${state.data.semester.length} Semester</span>
    </header>
  `));
  const grid = el(`<div class="sem-grid"></div>`);
  state.data.semester.forEach((s) => {
    const count = auftraegeForSemester(s.nummer).length;
    const themen = (s.themenbloecke || []).join(" · ");
    grid.appendChild(el(`
      <a class="sem-card" href="#/semester/${s.nummer}" aria-label="${escapeHtml(s.titel)}">
        <div class="sem-card-head">
          <span class="num">${s.nummer}</span>
          <span class="sem-count">${count} Aufträge</span>
        </div>
        <h3>${escapeHtml(s.titel)}</h3>
        <p class="sem-themen">${escapeHtml(themen)}</p>
      </a>
    `));
  });
  v.appendChild(grid);
}

// ----- Einzelnes Semester
function renderSemester({ num }) {
  const sem = semByNum(num);
  if (!sem) {
    $("#view").innerHTML = `<div class="empty"><h2>Semester nicht gefunden</h2></div>`;
    return;
  }
  const aufträge = auftraegeForSemester(num);
  const v = $("#view");

  // verfügbare Themen / HFs zum Filtern
  const themen = Array.from(new Set(aufträge.map((a) => a.thema).filter(Boolean))).sort();
  const hfs = Array.from(new Set(aufträge.flatMap((a) => a.handlungskompetenzen || []))).sort();

  v.appendChild(el(`
    <p class="breadcrumb"><a href="#/semester">Semester</a> · ${escapeHtml(sem.titel)}</p>
    <header class="section-head">
      <div>
        <h1>${escapeHtml(sem.titel)}</h1>
        <p>${escapeHtml(sem.kurz)} · Beginn ${escapeHtml(sem.schulbeginn)}</p>
      </div>
      <span class="meta">${aufträge.length} Aufträge</span>
    </header>

    <div class="filterbar">
      <div class="filter-group">
        <label for="f-thema">Thema</label>
        <select id="f-thema">
          <option value="">Alle</option>
          ${themen.map((t) => `<option>${escapeHtml(t)}</option>`).join("")}
        </select>
      </div>
      <div class="filter-group">
        <label for="f-hf">Handlungskompetenz</label>
        <select id="f-hf">
          <option value="">Alle</option>
          ${hfs.map((c) => {
            const hk = hkByCode(c);
            return `<option value="${c}">${c}${hk ? " – " + escapeHtml(hk.titel) : ""}</option>`;
          }).join("")}
        </select>
      </div>
      <button class="filter-clear" type="button">Zurücksetzen</button>
    </div>

    <div class="auf-grid" id="sem-grid"></div>
  `));

  const grid = $("#sem-grid");
  const draw = (list) => {
    grid.innerHTML = "";
    if (!list.length) {
      grid.appendChild(el(`<div class="empty" style="grid-column:1/-1"><p>Keine Aufträge entsprechen den Filtern.</p></div>`));
      return;
    }
    list.forEach((a) => grid.appendChild(auftragCard(a)));
    attachThumbnails(grid);
  };
  draw(aufträge);

  const apply = () => {
    const t = $("#f-thema").value;
    const h = $("#f-hf").value;
    draw(aufträge.filter((a) =>
      (!t || a.thema === t) &&
      (!h || (a.handlungskompetenzen || []).includes(h))
    ));
  };
  $("#f-thema").addEventListener("change", apply);
  $("#f-hf").addEventListener("change", apply);
  $(".filter-clear").addEventListener("click", () => {
    $("#f-thema").value = "";
    $("#f-hf").value = "";
    apply();
  });
}

function auftragCard(a) {
  const card = el(`
    <a class="auf-card" href="#/auftrag/${a.id}" aria-label="Auftrag ${escapeHtml(a.auftragNummer)} – ${escapeHtml(a.titel)}">
      ${previewSheet(a)}
      <div class="auf-body">
        <h3>${escapeHtml(a.titel)}</h3>
        <p class="kurz">${escapeHtml(a.kurzbeschreibung || "")}</p>
        ${pillRow(a)}
      </div>
    </a>
  `);
  return card;
}

// ----- Auftrag-Detail
function renderAuftrag({ id }) {
  const a = aufById(id);
  if (!a) {
    $("#view").innerHTML = `<div class="empty"><h2>Auftrag nicht gefunden</h2></div>`;
    return;
  }
  const sem = semByNum(a.semester);
  const v = $("#view");

  const hkCodes = a.handlungskompetenzen || [];
  const accentColor = hkByCode(hkCodes[0])?.handlungsfeld?.farbe || "var(--water-deep)";

  v.appendChild(el(`
    <p class="breadcrumb">
      <a href="#/">Übersicht</a> ·
      ${escapeHtml(sem?.titel || "")} ·
      ${escapeHtml(a.auftragNummer)}
    </p>

    <article class="auf2">
      <!-- Grosses Vorschaubild -->
      <div class="auf2-media">
        <div class="auf-preview auf-preview-xl" id="auf-preview-card" role="button" tabindex="0" aria-label="PDF öffnen und blättern">
          <iframe class="auf-preview-frame" id="auf-preview-frame" title="Vorschau ${escapeHtml(a.auftragNummer)}" referrerpolicy="no-referrer" loading="lazy" tabindex="-1"></iframe>
          <div class="auf-preview-play" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
          </div>
        </div>
        <button class="btn btn-primary auf2-open" id="open-pdf">Auftrag ansehen &amp; blättern</button>
      </div>

      <!-- Kompakte Info -->
      <div class="auf2-info">
        <div class="auf2-tags">
          <span class="auf2-tag auf2-tag-sem">${a.semester}. Semester</span>
          ${a.thema ? `<span class="auf2-tag">${escapeHtml(a.thema)}</span>` : ""}
          ${hkCodes.map((c) => { const hk = hkByCode(c); const col = hk?.handlungsfeld?.farbe || "var(--water)"; return `<span class="auf2-tag auf2-tag-hk" style="--hk-color:${col}">HK ${escapeHtml(c)}</span>`; }).join("")}
        </div>

        <h1 class="auf2-title"><span class="auf2-num">${escapeHtml(a.auftragNummer)}</span> ${escapeHtml(a.titel)}</h1>

        ${(a.lernziele && a.lernziele.length) ? `
          <div class="auf2-block">
            <h2>Das lernst du</h2>
            <ul class="auf2-goals">${a.lernziele.map((l)=>`<li>${escapeHtml(l)}</li>`).join("")}</ul>
          </div>
        ` : `<p class="auf2-lead">${escapeHtml(a.kurzbeschreibung || "")}</p>`}

        <button class="auf2-infobtn" id="auf2-infobtn" type="button" aria-expanded="false">
          <svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 11v5M12 7.5v.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          Weitere Infos
          <svg class="auf2-infochev" viewBox="0 0 24 24" width="16" height="16"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>

        <div class="auf2-details" id="auf2-details" hidden>
          ${a.kurzbeschreibung && a.lernziele && a.lernziele.length ? `<p class="auf2-lead">${escapeHtml(a.kurzbeschreibung)}</p>` : ""}
          ${(a.kernbegriffe||[]).length ? `
            <div class="auf2-dl"><span class="auf2-dt">Kernbegriffe</span>
              <span class="auf2-dd">${a.kernbegriffe.map((k)=>`<span class="pill pill-thema">${escapeHtml(k)}</span>`).join(" ")}</span></div>` : ""}
          <div class="auf2-dl"><span class="auf2-dt">Handlungskompetenzen</span>
            <span class="auf2-dd">${hkCodes.map((c)=>{const hk=hkByCode(c);const col=hk?.handlungsfeld?.farbe||"var(--water)";return `<span class="pill pill-hk" style="--hk-color:${col}"><span class="pill-prefix">HK</span> ${escapeHtml(c)}${hk?" · "+escapeHtml(hk.titel):""}</span>`;}).join(" ") || "—"}</span></div>
          ${(a.leistungszieleBFS||[]).length ? `
            <div class="auf2-dl"><span class="auf2-dt">Leistungsziele BFS</span>
              <span class="auf2-dd">${a.leistungszieleBFS.map((lz)=>`<span class="pill pill-lz">${escapeHtml(lz)}</span>`).join(" ")}</span></div>` : ""}
          ${(a.leistungsnachweise||[]).length ? `
            <div class="auf2-dl"><span class="auf2-dt">Leistungsnachweise</span>
              <span class="auf2-dd"><ul class="auf2-goals">${a.leistungsnachweise.map((l)=>`<li>${escapeHtml(l)}</li>`).join("")}</ul></span></div>` : ""}
          <div class="auf2-dl"><span class="auf2-dt">Umfang</span>
            <span class="auf2-dd">${a.schultage ? a.schultage + " Schultage" : ""}${a.schultage && a.lektionen ? " · " : ""}${a.lektionen ? a.lektionen + " Lektionen" : ""}</span></div>
          <div class="auf2-dl"><span class="auf2-dt">Stand</span>
            <span class="auf2-dd">${escapeHtml(a.zuletztAktualisiert || "—")}</span></div>
        </div>
      </div>
    </article>
  `));

  pushRecent(a.id);

  const detailPreview = $("#auf-preview-card");
  // Scharfe Vorschau direkt von sanitaerlernen.ch (kein Canvas-Thumbnail, keine hochgeladenen PDFs)
  const previewFrame = $("#auf-preview-frame");
  if (previewFrame) previewFrame.src = auftragLiveUrl(a) + "#toolbar=0&navpanes=0&scrollbar=0&statusbar=0&view=FitH";

  const open = () => openPdf(a);
  $("#open-pdf").addEventListener("click", open);
  detailPreview.addEventListener("click", open);
  detailPreview.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
  });

  // Info-Toggle
  const infoBtn = $("#auf2-infobtn");
  const infoPanel = $("#auf2-details");
  infoBtn.addEventListener("click", () => {
    const open = infoPanel.hasAttribute("hidden");
    if (open) infoPanel.removeAttribute("hidden");
    else infoPanel.setAttribute("hidden", "");
    infoBtn.setAttribute("aria-expanded", String(open));
    infoBtn.classList.toggle("is-open", open);
  });
}

// ----- Suche
function renderSearch({ q }) {
  const v = $("#view");
  v.appendChild(el(`
    <header class="la-head">
      <h1>Lernaufträge BKU</h1>
      <p class="la-sub">Finde jeden der ${state.data.aufträge.length} Lernaufträge nach <strong>Thema</strong>, <strong>Begriff</strong> oder <strong>Nummer</strong> – z.&nbsp;B. «Solar», «Z-Mass» oder «1.4». Tippen genügt, Treffer erscheinen sofort.</p>
    </header>

    <form class="la-search" id="search-form" role="search">
      <div class="la-search-box">
        <svg class="la-search-ic" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        <input type="search" id="search-input" placeholder="Suchen … z. B. Solar, Z-Mass, Hygiene, 1.4" value="${escapeHtml(q || "")}" autocomplete="off" />
        <button class="btn btn-primary la-search-btn" type="submit"><span class="btn-label">Suchen</span></button>
      </div>
    </form>

    <div class="filterbar">
      <div class="filter-group">
        <label for="s-sem">Semester</label>
        <select id="s-sem">
          <option value="">Alle</option>
          ${state.data.semester.map((s) => `<option value="${s.nummer}">${s.nummer}. Semester</option>`).join("")}
        </select>
      </div>
      <div class="filter-group">
        <label for="s-thema">Thema</label>
        <select id="s-thema">
          <option value="">Alle</option>
          ${Array.from(new Set(state.data.aufträge.map((a) => a.thema).filter(Boolean))).sort().map((t)=>`<option>${escapeHtml(t)}</option>`).join("")}
        </select>
      </div>
      <button class="filter-clear" type="button">Filter zurücksetzen</button>
    </div>

    <p class="search-summary" id="search-summary"></p>
    <div class="hit-list" id="hit-list"></div>
  `));

  const runSearch = () => {
    const term = $("#search-input").value.trim();
    const fSem = $("#s-sem").value;
    const fThema = $("#s-thema").value;

    let results;
    if (!term) {
      results = state.data.aufträge.map((a) => ({ item: a, matches: [], score: 0 }));
    } else {
      results = state.fuse.search(term);
    }
    // Filter anwenden
    results = results.filter(({ item }) =>
      (!fSem || item.semester === Number(fSem)) &&
      (!fThema || item.thema === fThema)
    );

    renderHits(results, term);
  };

  const renderHits = (results, term) => {
    const list = $("#hit-list");
    list.innerHTML = "";
    const summary = $("#search-summary");
    if (!results.length) {
      summary.textContent = term ? `Keine Treffer für „${term}".` : "Keine Aufträge entsprechen den Filtern.";
      list.appendChild(el(`<div class="empty"><h2>Nichts gefunden</h2><p>Versuche es mit einem anderen Begriff oder lockere die Filter.</p></div>`));
      return;
    }

    // Top-Treffer-Schwelle: nur bei Suchbegriff sinnvoll. Fuse-Score liegt
    // zwischen 0 (perfect) und 1 (kein Match). < 0.25 = sehr gut.
    const isSearch = !!term;
    let topHits = [];
    let rest = results;

    // Hilfsfunktionen zur chronologischen Sortierung
    const semNum = (a) => Number(a.semester);
    const num = (a) => {
      const parts = String(a.auftragNummer).split(".");
      return Number(parts[1] || 0);
    };
    const chronoCompare = (a, b) => {
      const sa = semNum(a.item), sb = semNum(b.item);
      if (sa !== sb) return sa - sb;
      return num(a.item) - num(b.item);
    };

    if (isSearch) {
      // Sortiere nach Score
      const sorted = [...results].sort((a, b) => (a.score ?? 1) - (b.score ?? 1));
      const bestScore = sorted[0].score ?? 1;

      if (bestScore < 0.45) {
        // ALLE Treffer aufnehmen, deren Score nahe am besten liegt.
        // Bei Begriffen wie "X-Mass" haben 4 Aufträge praktisch denselben
        // Score - alle sollen als Top-Treffer erscheinen.
        const tolerance = 0.18;
        const cutoff = Math.min(bestScore + tolerance, 0.45);
        topHits = sorted.filter((r) => (r.score ?? 1) <= cutoff);

        // Begrenze auf maximal 6 Top-Treffer (sonst wird's zu viel)
        if (topHits.length > 6) topHits = topHits.slice(0, 6);

        // Top-Treffer chronologisch nach Semester sortieren
        topHits.sort(chronoCompare);
      }

      const topIds = new Set(topHits.map((r) => r.item.id));
      rest = results.filter((r) => !topIds.has(r.item.id));
    }

    // Den Rest chronologisch nach Semester + Auftragsnummer sortieren
    rest.sort(chronoCompare);

    summary.innerHTML = isSearch
      ? `<strong>${results.length}</strong> ${results.length === 1 ? "Treffer" : "Treffer"} für „${escapeHtml(term)}"`
      : `<strong>${results.length}</strong> Aufträge`;

    // ----- Top-Treffer-Section
    if (topHits.length) {
      const head = el(`
        <header class="hit-section-head">
          <h2>${topHits.length === 1 ? "Bester Treffer" : "Beste Treffer"}</h2>
          <span class="meta">${topHits.length === 1 ? "1 Auftrag passt besonders gut" : topHits.length + " Aufträge passen besonders gut"}</span>
        </header>
      `);
      list.appendChild(head);
      topHits.forEach((r) => list.appendChild(buildHitElement(r, term, true)));
    }

    // ----- Rest, gruppiert nach Semester
    if (rest.length) {
      const groups = new Map();
      rest.forEach((r) => {
        const s = r.item.semester;
        if (!groups.has(s)) groups.set(s, []);
        groups.get(s).push(r);
      });
      const sortedGroups = Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);

      const subHeadLabel = topHits.length ? "Weitere Aufträge" : "Aufträge";
      list.appendChild(el(`
        <header class="hit-section-head ${topHits.length ? 'is-secondary' : ''}">
          <h2>${subHeadLabel}</h2>
          <span class="meta">nach Semester geordnet</span>
        </header>
      `));

      sortedGroups.forEach(([semester, items]) => {
        const semObj = semByNum(semester);
        list.appendChild(el(`
          <div class="hit-sem-label">${semester}. Semester${semObj ? ` <span style="color:var(--ink-quiet); font-weight:400;">· ${escapeHtml(semObj.kurz)}</span>` : ""}</div>
        `));
        items.forEach((r) => list.appendChild(buildHitElement(r, term, false)));
      });
    }

    // Hit-Thumbs nutzen .thumb statt .auf-preview – Helper separat
    attachHitThumbs(list);
  };

  // Einzelnes Treffer-Element
  function buildHitElement({ item, matches }, term, isTop) {
    // „Match-Begründung" zusammenstellen
    let why = "";
    if (matches && matches.length) {
      const m = matches[0];
      const fieldLabel = ({
        titel: "Titel",
        kurzbeschreibung: "Beschreibung",
        kernbegriffe: "Kernbegriff",
        thema: "Thema",
        lernziele: "Lernziel",
        auftragNummer: "Nummer",
      })[m.key] || m.key;
      const sample = String(m.value || "").slice(0, 120);
      why = `Treffer in <strong>${fieldLabel}</strong>: „${highlight(sample, term)}${sample.length>=120?"…":""}"`;
    } else if (!term) {
      why = "Im Index enthalten";
    }
    return el(`
      <a class="hit ${isTop ? 'is-top' : ''}" href="#/auftrag/${item.id}">
        <div class="thumb" data-thumb-id="${escapeHtml(item.id)}" data-thumb-pdf="${escapeHtml(item.pdfPfad)}">${escapeHtml(item.auftragNummer)}</div>
        <div>
          <h3><span class="hit-nr">${escapeHtml(item.auftragNummer)}</span> · ${highlight(item.titel, term)}</h3>
          <div class="pill-row">
            <span class="pill pill-thema">${escapeHtml(item.thema || "")}</span>
            <span class="pill">${item.semester}. Sem</span>
            ${(item.handlungskompetenzen||[]).map((c) => {
              const hk = hkByCode(c);
              const color = hk?.handlungsfeld?.farbe || "var(--water)";
              return `<span class="pill pill-hk" style="--hk-color:${color}" title="${escapeHtml(hk?.titel||"")}"><span class="pill-prefix">HK</span> ${escapeHtml(c)}</span>`;
            }).join("")}
          </div>
          <div class="hit-why">${why}</div>
        </div>
        <div class="open">Auftrag ansehen →</div>
      </a>
    `);
  }

  $("#search-form").addEventListener("submit", (e) => { e.preventDefault(); runSearch(); $("#search-input").blur(); });
  // Live-Suche: Treffer erscheinen sofort beim Tippen
  let _searchTimer;
  $("#search-input").addEventListener("input", () => {
    clearTimeout(_searchTimer);
    _searchTimer = setTimeout(runSearch, 120);
  });
  $("#s-sem").addEventListener("change", runSearch);
  $("#s-thema").addEventListener("change", runSearch);
  $(".filter-clear").addEventListener("click", () => {
    $("#s-sem").value = ""; $("#s-thema").value = "";
    runSearch();
  });

  runSearch();
}

// ----- Handlungskompetenzen (mit interaktivem Plakat + HF-Akkordeon)
const HF_OPEN_KEY = "sanigbs:hf-open:v1";
const PLAKAT_HS_KEY = "sanigbs:plakat-hotspots:v1";

function loadHfOpen() {
  try { return new Set(JSON.parse(localStorage.getItem(HF_OPEN_KEY) || "[]")); }
  catch { return new Set(); }
}
function saveHfOpen(set) {
  try { localStorage.setItem(HF_OPEN_KEY, JSON.stringify([...set])); } catch {}
}
function loadPlakatHotspots(useDraft) {
  // Im Bearbeitungsmodus: lokaler Entwurf (falls vorhanden).
  // Im Ansichtsmodus: immer die offizielle Datei (data/plakat-hotspots.json).
  if (useDraft) {
    try {
      const ls = localStorage.getItem(PLAKAT_HS_KEY);
      if (ls) {
        const parsed = JSON.parse(ls);
        if (Array.isArray(parsed) && parsed.length) return parsed;
      }
    } catch {}
  }
  const base = (state.plakatHotspotsBase && state.plakatHotspotsBase.hotspots) || [];
  // tiefe Kopie, damit Editor-Änderungen die Basis nicht versehentlich mutieren
  return JSON.parse(JSON.stringify(base));
}
function savePlakatHotspots(arr) {
  try { localStorage.setItem(PLAKAT_HS_KEY, JSON.stringify(arr)); } catch {}
}

function renderKompetenzen() {
  const v = $("#view");
  const openSet = loadHfOpen();
  const allOpen = openSet.size >= state.hf.handlungsfelder.length;

  v.appendChild(el(`
    <header class="section-head">
      <div>
        <h1>Handlungskompetenzen</h1>
        <p>Klick auf ein Kästchen im Plakat zeigt die passenden Lernaufträge. Quelle: suissetec Bildungsplan.</p>
      </div>
    </header>

    <section class="plakat-section">
      <div class="plakat-toolbar">
        <span class="plakat-hint" id="plakat-hint">Tippe auf ein Kästchen, um die zugehörigen Aufträge zu sehen.</span>
        <button id="plakat-edit-toggle" class="btn btn-ghost" type="button">Bereiche bearbeiten</button>
      </div>
      <div class="plakat-frame" id="plakat-frame">
        <canvas id="plakat-canvas" aria-label="Handlungskompetenz-Plakat"></canvas>
        <div class="plakat-hotspots" id="plakat-hotspots"></div>
        <div class="plakat-loading" id="plakat-loading"><span class="loader"></span> Plakat wird geladen …</div>
      </div>
      <div class="plakat-edit-bar" id="plakat-edit-bar" hidden>
        <span>Bearbeiten: Klicke aufs Plakat, um ein Kästchen zu setzen. Ziehe es an die richtige Stelle, weise eine HK zu.</span>
        <div class="plakat-edit-actions">
          <button id="plakat-export" class="btn btn-primary" type="button">Als JSON exportieren</button>
          <button id="plakat-clear" class="btn btn-ghost" type="button">Lokalen Entwurf verwerfen</button>
        </div>
      </div>
    </section>

    <div class="section-head" style="margin-top:var(--space-7)">
      <h2>Die 7 Handlungsfelder</h2>
      <button id="hf-toggle-all" class="btn btn-ghost" type="button">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="margin-right:4px; transform:rotate(${allOpen ? "180deg" : "0deg"})"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        ${allOpen ? "Alle einklappen" : "Alle ausklappen"}
      </button>
    </div>
    <div class="hf-list" id="hf-list"></div>
  `));

  // --- Plakat rendern
  const frame = $("#plakat-frame");
  renderPlakatCanvas(frame).then(() => {
    $("#plakat-loading").hidden = true;
    drawPlakatHotspots(false);
  }).catch(() => {
    $("#plakat-loading").innerHTML = `Plakat konnte nicht geladen werden. Stelle sicher, dass <code>pdfs/plakat.pdf</code> vorhanden ist (1-PDFs-einbinden.cmd).`;
  });

  // --- HF-Akkordeon
  drawHfAccordion(openSet);

  // --- Toggle alle HF
  const updateHfToggleAll = () => {
    const o = loadHfOpen();
    const all = o.size >= state.hf.handlungsfelder.length;
    $("#hf-toggle-all").innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="margin-right:4px; transform:rotate(${all ? "180deg" : "0deg"})"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      ${all ? "Alle einklappen" : "Alle ausklappen"}`;
  };
  $("#hf-toggle-all").addEventListener("click", () => {
    const o = loadHfOpen();
    const all = o.size >= state.hf.handlungsfelder.length;
    const next = new Set();
    if (!all) state.hf.handlungsfelder.forEach((hf) => next.add(hf.code));
    saveHfOpen(next);
    drawHfAccordion(next);
    updateHfToggleAll();
  });

  // --- Hotspot-Editor
  let editMode = false;
  $("#plakat-edit-toggle").addEventListener("click", () => {
    editMode = !editMode;
    $("#plakat-edit-toggle").textContent = editMode ? "Bearbeiten beenden" : "Bereiche bearbeiten";
    $("#plakat-edit-bar").hidden = !editMode;
    frame.classList.toggle("is-editing", editMode);
    drawPlakatHotspots(editMode);
  });
  $("#plakat-export").addEventListener("click", exportPlakatHotspots);
  $("#plakat-clear").addEventListener("click", () => {
    if (!confirm("Lokalen Entwurf verwerfen und die gespeicherte Datei (data/plakat-hotspots.json) laden?")) return;
    localStorage.removeItem(PLAKAT_HS_KEY);
    drawPlakatHotspots(editMode);
  });

  // Klick aufs Plakat im Edit-Modus = neuen Hotspot setzen
  $("#plakat-hotspots").addEventListener("click", (e) => {
    if (!editMode) return;
    if (e.target.closest(".plakat-hotspot")) return; // nicht auf bestehenden
    const rect = frame.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const arr = loadPlakatHotspots(true);
    arr.push({ hk: "", x: Math.max(0, x - 6), y: Math.max(0, y - 4), w: 12, h: 8 });
    savePlakatHotspots(arr);
    drawPlakatHotspots(true);
  });
  // Kein Resize-Re-Render nötig: Canvas skaliert per CSS, Hotspots sind prozentual.
}

// HF-Akkordeon zeichnen
function drawHfAccordion(openSet) {
  const list = $("#hf-list");
  if (!list) return;
  list.innerHTML = "";
  state.hf.handlungsfelder.forEach((hf) => {
    const isOpen = openSet.has(hf.code);
    const aufsCount = (hf.kompetenzen || []).reduce((sum, hk) =>
      sum + state.data.aufträge.filter((a) => (a.handlungskompetenzen || []).includes(hk.code)).length, 0);

    const block = el(`
      <section class="hf-block ${isOpen ? "is-open" : ""}" data-hf="${hf.code}" style="--hf-color:${hf.farbe}">
        <button class="hf-header-btn" type="button" aria-expanded="${isOpen}">
          <div class="hf-code" style="background:${hf.farbe}">${escapeHtml(hf.code)}</div>
          <div class="hf-head-info">
            <h2>HF ${escapeHtml(hf.code)} – ${escapeHtml(hf.titel)}</h2>
            <p>${escapeHtml(hf.kurz || "")}</p>
          </div>
          <div class="hf-head-meta">
            <span class="hf-count">${(hf.kompetenzen || []).length} HK</span>
            <span class="hf-toggle-icon"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
          </div>
        </button>
        <div class="hk-list" ${isOpen ? "" : "hidden"}></div>
      </section>
    `);
    const inner = block.querySelector(".hk-list");
    (hf.kompetenzen || []).forEach((hk) => {
      const aufs = state.data.aufträge.filter((a) => (a.handlungskompetenzen || []).includes(hk.code));
      inner.appendChild(el(`
        <a class="hk-row" href="#/suche?q=${encodeURIComponent(hk.code)}" aria-label="${escapeHtml(hk.titel)}">
          <div class="hk-code" style="background:${hf.farbe}">${escapeHtml(hk.code)}</div>
          <div>
            <h3>${escapeHtml(hk.titel)}</h3>
            <p>${escapeHtml(hk.kurz || "")}</p>
          </div>
          <span class="count">${aufs.length} ${aufs.length === 1 ? "Auftrag" : "Aufträge"}</span>
        </a>
      `));
    });
    list.appendChild(block);
  });

  // Toggle einzelne HF
  list.querySelectorAll(".hf-header-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const block = btn.closest(".hf-block");
      const code = block.dataset.hf;
      const inner = block.querySelector(".hk-list");
      const open = loadHfOpen();
      const isOpenNow = !block.classList.contains("is-open");
      block.classList.toggle("is-open", isOpenNow);
      btn.setAttribute("aria-expanded", String(isOpenNow));
      if (isOpenNow) { inner.removeAttribute("hidden"); open.add(code); }
      else { inner.setAttribute("hidden", ""); open.delete(code); }
      saveHfOpen(open);
    });
  });
}

// Plakat in Canvas rendern (PDF.js)
// Einmaliges Rendern in fester hoher Auflösung. Das Canvas wird per CSS auf
// die Containerbreite skaliert (width:100%, height:auto) – dadurch ist das
// Plakat IMMER vollständig sichtbar und dreht/verzerrt sich nicht bei Zoom.
let plakatRatio = 1.414;
let plakatRendered = false;
async function renderPlakatCanvas(frame) {
  const canvas = $("#plakat-canvas");
  if (!canvas || !frame) return;
  if (plakatRendered && canvas.width > 0) return; // nicht erneut rendern
  const lib = await ensurePdfJs();
  const pdf = await lib.getDocument({ url: "pdfs/plakat.pdf" }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1, rotation: 0 });
  plakatRatio = base.height / base.width;
  // Feste, hohe Renderbreite – unabhängig von Fenster und Browser-Zoom
  const RENDER_WIDTH = 2000;
  const scale = RENDER_WIDTH / base.width;
  const viewport = page.getViewport({ scale, rotation: 0 });
  const ctx = canvas.getContext("2d");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  await page.render({ canvasContext: ctx, viewport }).promise;
  plakatRendered = true;
  try { pdf.cleanup?.(); } catch {}
}

// Hotspots über dem Plakat zeichnen
function drawPlakatHotspots(editMode) {
  const layer = $("#plakat-hotspots");
  if (!layer) return;
  const hotspots = loadPlakatHotspots(editMode);
  layer.innerHTML = "";
  layer.classList.toggle("is-editing", editMode);

  hotspots.forEach((hs, idx) => {
    const hk = hs.hk ? hkByCode(hs.hk) : null;
    const color = hk?.handlungsfeld?.farbe || "var(--water-deep)";
    const spot = el(`
      <div class="plakat-hotspot ${editMode ? "is-edit" : ""} ${hs.hk ? "" : "is-unassigned"}"
           style="left:${hs.x}%; top:${hs.y}%; width:${hs.w}%; height:${hs.h}%; --hs-color:${color};"
           data-idx="${idx}"
           title="${hk ? escapeHtml(hk.code + " – " + hk.titel) : "Keine HK zugewiesen"}">
        ${hs.hk ? `<span class="plakat-hotspot-label">${escapeHtml(hs.hk)}</span>` : ""}
        ${editMode ? `
          <div class="plakat-hotspot-edit">
            <select class="plakat-hk-select" data-idx="${idx}">
              <option value="">– HK –</option>
              ${state.hf.handlungsfelder.map((hf) => `<optgroup label="HF ${hf.code} ${escapeHtml(hf.titel)}">${(hf.kompetenzen||[]).map((k) => `<option value="${k.code}" ${k.code === hs.hk ? "selected" : ""}>${k.code} ${escapeHtml(k.titel)}</option>`).join("")}</optgroup>`).join("")}
            </select>
            <button class="plakat-hs-del" data-idx="${idx}" title="Löschen">✕</button>
          </div>` : ""}
      </div>
    `);
    layer.appendChild(spot);
  });

  if (!editMode) {
    // Klick öffnet das HK-Overlay
    layer.querySelectorAll(".plakat-hotspot").forEach((spot) => {
      const idx = Number(spot.dataset.idx);
      const hs = hotspots[idx];
      if (!hs.hk) return;
      spot.style.cursor = "pointer";
      spot.addEventListener("click", () => openHkOverlay(hs.hk));
    });
  } else {
    // Editor-Interaktionen
    layer.querySelectorAll(".plakat-hk-select").forEach((sel) => {
      sel.addEventListener("change", (e) => {
        const arr = loadPlakatHotspots(true);
        arr[Number(sel.dataset.idx)].hk = e.target.value;
        savePlakatHotspots(arr);
        drawPlakatHotspots(true);
      });
    });
    layer.querySelectorAll(".plakat-hs-del").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const arr = loadPlakatHotspots(true);
        arr.splice(Number(btn.dataset.idx), 1);
        savePlakatHotspots(arr);
        drawPlakatHotspots(true);
      });
    });
    // Drag zum Verschieben
    layer.querySelectorAll(".plakat-hotspot").forEach((spot) => {
      spot.addEventListener("mousedown", (e) => {
        if (e.target.closest(".plakat-hotspot-edit")) return;
        e.preventDefault();
        const idx = Number(spot.dataset.idx);
        const frame = $("#plakat-frame");
        const rect = frame.getBoundingClientRect();
        const onMove = (ev) => {
          const arr = loadPlakatHotspots(true);
          arr[idx].x = Math.max(0, Math.min(100 - arr[idx].w, ((ev.clientX - rect.left) / rect.width) * 100 - arr[idx].w / 2));
          arr[idx].y = Math.max(0, Math.min(100 - arr[idx].h, ((ev.clientY - rect.top) / rect.height) * 100 - arr[idx].h / 2));
          spot.style.left = arr[idx].x + "%";
          spot.style.top = arr[idx].y + "%";
          savePlakatHotspots(arr);
        };
        const onUp = () => {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
      });
    });
  }
}

function exportPlakatHotspots() {
  const arr = loadPlakatHotspots(true);
  const out = { version: "1.0", stand: new Date().toISOString().slice(0, 10), hotspots: arr };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "plakat-hotspots.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Overlay: HK angeklickt → Aufträge zeigen, Plakat verschwommen dahinter
function openHkOverlay(hkCode) {
  const hk = hkByCode(hkCode);
  if (!hk) return;
  const aufs = state.data.aufträge
    .filter((a) => (a.handlungskompetenzen || []).includes(hkCode))
    .sort((a, b) => a.semester - b.semester || Number(a.auftragNummer.split(".")[1]) - Number(b.auftragNummer.split(".")[1]));
  const color = hk.handlungsfeld?.farbe || "var(--water-deep)";

  // Semester, in denen diese HK behandelt wird
  const semesters = [...new Set(aufs.map((a) => a.semester))].sort((a, b) => a - b);
  const semesterBadges = semesters.map((s) =>
    `<span class="hk-overlay-sembadge">${s}. Semester</span>`
  ).join("");

  const overlay = el(`
    <div class="hk-overlay" role="dialog" aria-modal="true" aria-label="Aufträge zu ${escapeHtml(hk.titel)}">
      <div class="hk-overlay-backdrop" data-close></div>
      <div class="hk-overlay-panel">
        <button class="hk-overlay-close" data-close aria-label="Schliessen">✕</button>
        <header class="hk-overlay-head">
          <div class="hk-overlay-code" style="background:${color}">${escapeHtml(hk.code)}</div>
          <div>
            <h2>${escapeHtml(hk.titel)}</h2>
            <p>HF ${escapeHtml(hk.handlungsfeld.code)} · ${escapeHtml(hk.handlungsfeld.titel)}</p>
          </div>
        </header>
        <div class="hk-overlay-body">
          ${aufs.length
            ? `${semesters.length ? `<div class="hk-overlay-semrow"><span class="hk-overlay-semlabel">Behandelt in:</span> ${semesterBadges}</div>` : ""}
               <p class="hk-overlay-count">${aufs.length} ${aufs.length === 1 ? "Lernauftrag behandelt" : "Lernaufträge behandeln"} diese Handlungskompetenz:</p>
               <div class="hk-overlay-aufs">${aufs.map((a) => `
                 <a class="hk-overlay-auftrag" href="#/auftrag/${a.id}" data-close-nav>
                   <span class="hk-oa-num" style="color:${color}">${escapeHtml(a.auftragNummer)}</span>
                   <span class="hk-oa-titel">${escapeHtml(a.titel)}</span>
                   <span class="hk-oa-sem">${a.semester}. Sem</span>
                 </a>`).join("")}</div>`
            : `<div class="hk-overlay-uek">
                 <div class="hk-overlay-uek-icon" style="color:${color}">
                   <svg viewBox="0 0 24 24" width="40" height="40"><path d="M15 4a5 5 0 0 0-4.5 7.2L3 18.7 5.3 21l7.5-7.5A5 5 0 1 0 15 4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
                 </div>
                 <h3>Komplett im ÜK und Betrieb</h3>
                 <p>Diese Handlungskompetenz wird vollständig im überbetrieblichen Kurs (ÜK) und im Lehrbetrieb vermittelt – dazu gibt es keinen schulischen Lernauftrag.</p>
               </div>`
          }
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);
  document.body.classList.add("has-overlay");

  const close = () => {
    overlay.remove();
    document.body.classList.remove("has-overlay");
  };
  overlay.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  overlay.querySelectorAll("[data-close-nav]").forEach((b) => b.addEventListener("click", close));
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
  });
}

// Plakat-Route leitet auf die Kompetenzen-Seite um (Plakat ist jetzt dort integriert)
function renderPlakat() {
  location.hash = "#/kompetenzen";
}

// ----- Lernpfad: Akkordeon-Reise durch alle Semester
const PFAD_OPEN_KEY = "sanigbs:pfad-open:v1";
function loadPfadOpen() {
  try { return new Set(JSON.parse(localStorage.getItem(PFAD_OPEN_KEY) || "[]")); }
  catch { return new Set(); }
}
function savePfadOpen(set) {
  try { localStorage.setItem(PFAD_OPEN_KEY, JSON.stringify([...set])); }
  catch {}
}

function renderLernpfad() {
  const v = $("#view");

  // Aufträge pro Semester sortieren: Reihenfolge-JSON wenn vorhanden, sonst nach Nummer
  const aufgabenNumKey = (a) => Number(String(a.auftragNummer).split(".")[1] || 0);
  const sortBySem = (sem) => {
    const aufs = state.data.aufträge.filter((a) => a.semester === sem.nummer);
    const reihenfolge = state.reihenfolge?.semester?.[String(sem.nummer)];
    if (reihenfolge && reihenfolge.length) {
      const orderMap = new Map(reihenfolge.map((id, i) => [id, i]));
      return aufs.sort((a, b) => {
        const ao = orderMap.has(a.id) ? orderMap.get(a.id) : 999;
        const bo = orderMap.has(b.id) ? orderMap.get(b.id) : 999;
        if (ao !== bo) return ao - bo;
        return aufgabenNumKey(a) - aufgabenNumKey(b);
      });
    }
    return aufs.sort((a, b) => aufgabenNumKey(a) - aufgabenNumKey(b));
  };

  // Hauptthemen pro Semester aus den Aufträgen ableiten
  const hauptThemen = (sem) => {
    const aufs = sortBySem(sem);
    const themen = new Set();
    aufs.forEach((a) => { if (a.thema) themen.add(a.thema); });
    return Array.from(themen).slice(0, 4);
  };

  const stations = [];
  stations.push({ type: "start" });
  state.data.semester.forEach((sem) => {
    stations.push({ type: "semester", sem, aufträge: sortBySem(sem), hauptthemen: hauptThemen(sem) });
  });
  stations.push({ type: "ziel" });
  stations.push({ type: "weiterbildung" });

  const hatEchteReihenfolge = !!state.reihenfolge;
  const openSet = loadPfadOpen();

  const allOpen = openSet.size >= state.data.semester.length;
  v.appendChild(el(`
    <header class="section-head">
      <div>
        <h1>Chronologie</h1>
        <p>Alle ${state.data.aufträge.length} Lernaufträge in der zeitlichen Reihenfolge — vom 1. bis zum 8. Semester. Klick auf ein Semester, um die Aufträge zu sehen.</p>
      </div>
      <button id="pfad-toggle-all" class="btn btn-ghost" type="button">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="margin-right:4px"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        ${allOpen ? "Alle einklappen" : "Alle ausklappen"}
      </button>
    </header>

    <div class="pfad-wrap" id="pfad-wrap"></div>
  `));

  const wrap = $("#pfad-wrap");

  // Stationen erzeugen
  stations.forEach((s, idx) => {
    const side = idx % 2 === 0 ? "left" : "right";

    if (s.type === "start") {
      wrap.appendChild(el(`
        <div class="pfad-station pfad-milestone pfad-start" data-side="${side}">
          <div class="pfad-flag pfad-flag-start" aria-hidden="true">
            <svg viewBox="0 0 32 36" width="36" height="42">
              <path d="M6 4v30" stroke="#5A574F" stroke-width="2" stroke-linecap="round" fill="none"/>
              <path d="M6 5 L28 9 L22 14 L28 19 L6 16 Z" fill="#6F9070" stroke="#4F7A55" stroke-width="0.5" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="pfad-milestone-card pfad-milestone-start">
            <span class="pfad-milestone-label">Start</span>
            <h3>Los geht's – 1. Lehrjahr</h3>
            <p>Beginn der Ausbildung als Sanitärinstallateur*in EFZ an der GBS St.&nbsp;Gallen.</p>
          </div>
        </div>
      `));
    } else if (s.type === "ziel") {
      wrap.appendChild(el(`
        <div class="pfad-station pfad-milestone pfad-ziel" data-side="${side}">
          <div class="pfad-flag pfad-flag-ziel" aria-hidden="true">
            <svg viewBox="0 0 32 36" width="40" height="46">
              <path d="M6 4v30" stroke="#3F2F1A" stroke-width="2" stroke-linecap="round" fill="none"/>
              <path d="M6 5 L28 9 L22 14 L28 19 L6 16 Z" fill="#C9956B" stroke="#8A5E36" stroke-width="0.5" stroke-linejoin="round"/>
              <rect x="6" y="5" width="22" height="14" fill="url(#checker)" opacity="0.5" />
              <defs>
                <pattern id="checker" width="4" height="4" patternUnits="userSpaceOnUse">
                  <rect width="2" height="2" fill="#fff"/>
                  <rect x="2" y="2" width="2" height="2" fill="#fff"/>
                </pattern>
              </defs>
            </svg>
          </div>
          <div class="pfad-milestone-card pfad-milestone-ziel">
            <span class="pfad-milestone-label">Ziel erreicht</span>
            <h3>Sanitärinstallateur*in EFZ</h3>
            <p>Eidgenössisches Fähigkeitszeugnis – und damit Profi im Berufsfeld Sanitär. Glückwunsch!</p>
          </div>
        </div>
      `));
    } else if (s.type === "weiterbildung") {
      wrap.appendChild(el(`
        <div class="pfad-station pfad-milestone pfad-weiterbildung" data-side="${side}">
          <div class="pfad-flag pfad-flag-weiter" aria-hidden="true">
            <svg viewBox="0 0 48 48" width="52" height="52">
              <circle cx="24" cy="24" r="22" fill="#FBF7F0" stroke="#4C7A8A" stroke-width="2"/>
              <path d="M12 22 L24 16 L36 22 L24 28 Z" fill="#4C7A8A"/>
              <path d="M16 26 L16 32 C 16 34, 32 34, 32 32 L 32 26" fill="none" stroke="#4C7A8A" stroke-width="2" stroke-linecap="round"/>
              <line x1="36" y1="22" x2="36" y2="30" stroke="#4C7A8A" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <div class="pfad-milestone-card pfad-milestone-weiter">
            <span class="pfad-milestone-label">Weiterbildung</span>
            <h3>Und danach? Viele Wege stehen offen.</h3>
            <ul class="pfad-weiter-list">
              <li><strong>Chefmonteur*in Sanitär</strong> – eidg. Fachausweis (BP)</li>
              <li><strong>Sanitärplaner*in</strong> – eidg. Fachausweis (BP)</li>
              <li><strong>Sanitärmeister*in</strong> – eidg. Diplom (HFP)</li>
              <li><strong>Dipl. Techniker*in HF</strong> Gebäudetechnik</li>
              <li><strong>Energieberater*in Gebäude</strong> (BP)</li>
              <li><strong>Berufsbildner*in</strong> im Lehrbetrieb</li>
              <li><strong>ÜK-Instruktor*in</strong> suissetec</li>
              <li>… und viele weitere Spezialisierungen</li>
            </ul>
          </div>
        </div>
      `));
    } else if (s.type === "semester") {
      const isOpen = openSet.has(s.sem.nummer);
      const pastel = pfadSemesterColor(s.sem.nummer);
      const deep = pfadSemesterDeep(s.sem.nummer);
      const lehrjahr = Math.ceil(s.sem.nummer / 2);
      const block = el(`
        <div class="pfad-station pfad-semester-block ${isOpen ? "is-open" : ""}" data-side="${side}" data-sem="${s.sem.nummer}" style="--sem-color:${pastel}; --sem-deep:${deep};">
          <button class="pfad-sem-header" type="button" aria-expanded="${isOpen}">
            <div class="pfad-sem-bubble" style="background:${pastel}; color:${deep};">
              <span class="pfad-sem-num">${s.sem.nummer}</span>
            </div>
            <div class="pfad-sem-info">
              <span class="pfad-sem-lj" style="color:${deep};">${lehrjahr}. Lehrjahr</span>
              <h2>${escapeHtml(s.sem.titel)}</h2>
            </div>
            <div class="pfad-sem-meta">
              <span class="pfad-sem-count">${s.aufträge.length} Aufträge</span>
              <div class="pfad-sem-toggle" aria-hidden="true" style="background:${pastel}; color:${deep};">
                <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
            </div>
          </button>
          <div class="pfad-sem-aufs" ${isOpen ? "" : "hidden"}></div>
        </div>
      `);
      const list = block.querySelector(".pfad-sem-aufs");
      s.aufträge.forEach((a, i) => {
        const hk = (a.handlungskompetenzen || []).map((c) => hkByCode(c)).filter(Boolean);
        const hkColor = hk[0]?.handlungsfeld?.farbe || deep;
        const icon = auftragIconSvg(a);
        // Zickzack-Side: gerade Indizes links, ungerade rechts
        const cardSide = i % 2 === 0 ? "left" : "right";
        const mini = el(`
          <a class="pfad-mini-card" href="#/auftrag/${a.id}" data-side="${cardSide}" style="grid-row:${i + 1}; --idx:${i};" aria-label="Auftrag ${escapeHtml(a.auftragNummer)} – ${escapeHtml(a.titel)}">
            <div class="pfad-mini-inner">
              <span class="pfad-mini-step" style="color:${deep};">${i + 1}</span>
              <div class="pfad-mini-icon" style="color:${pastel};">${icon}</div>
              <div class="pfad-mini-text">
                <div class="pfad-mini-head">
                  <span class="pfad-mini-num" style="color:${deep};">${escapeHtml(a.auftragNummer)}</span>
                  <h4>${escapeHtml(a.titel)}</h4>
                </div>
                ${a.thema ? `<span class="pfad-mini-thema">${escapeHtml(a.thema)}</span>` : ""}
                ${hk[0] ? `<span class="pfad-mini-hk" style="color:${hkColor};">HK ${escapeHtml(hk[0].code)} · ${escapeHtml(hk[0].titel)}</span>` : ""}
              </div>
            </div>
            <div class="pfad-dot pfad-mini-dot" style="background:${pastel}; box-shadow: 0 0 0 3px var(--bg-warm), 0 0 0 5px ${pastel}66;"></div>
          </a>
        `);
        list.appendChild(mini);
      });
      wrap.appendChild(block);
    }
  });

  // SVG-Pfad nachträglich als Hintergrund-Layer rendern, sobald Layout stabil
  requestAnimationFrame(() => drawPfadLine(wrap));
  // Bei Resize neu zeichnen
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => drawPfadLine(wrap), 120);
  }, { once: false });

  // Akkordeon-Toggle
  wrap.addEventListener("click", (e) => {
    const header = e.target.closest(".pfad-sem-header");
    if (!header) return;
    e.preventDefault();
    const block = header.closest(".pfad-semester-block");
    const sem = Number(block.dataset.sem);
    const list = block.querySelector(".pfad-sem-aufs");
    const isOpenNow = !block.classList.contains("is-open");
    block.classList.toggle("is-open", isOpenNow);
    header.setAttribute("aria-expanded", String(isOpenNow));
    if (isOpenNow) {
      list.removeAttribute("hidden");
      // Animation neu starten (sonst läuft sie beim zweiten Aufklappen nicht mehr)
      list.querySelectorAll(".pfad-mini-card").forEach((c) => {
        c.style.animation = "none";
        void c.offsetHeight; // force reflow
        c.style.animation = "";
      });
    } else {
      list.setAttribute("hidden", "");
    }
    const open = loadPfadOpen();
    if (isOpenNow) open.add(sem); else open.delete(sem);
    savePfadOpen(open);
    updateToggleAllBtn();
    // Pfad zweimal neu zeichnen: erst sofort, dann nach Animation
    requestAnimationFrame(() => drawPfadLine(wrap));
    setTimeout(() => drawPfadLine(wrap), 600);
  });

  // Alle ein-/ausklappen
  const updateToggleAllBtn = () => {
    const btn = $("#pfad-toggle-all");
    if (!btn) return;
    const open = loadPfadOpen();
    const all = open.size >= state.data.semester.length;
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="margin-right:4px; transform:rotate(${all ? "180deg" : "0deg"})"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      ${all ? "Alle einklappen" : "Alle ausklappen"}
    `;
  };
  $("#pfad-toggle-all").addEventListener("click", () => {
    const open = loadPfadOpen();
    const all = open.size >= state.data.semester.length;
    const next = new Set();
    if (!all) state.data.semester.forEach((s) => next.add(s.nummer));
    savePfadOpen(next);
    wrap.querySelectorAll(".pfad-semester-block").forEach((block) => {
      const sem = Number(block.dataset.sem);
      const isOpen = next.has(sem);
      block.classList.toggle("is-open", isOpen);
      const header = block.querySelector(".pfad-sem-header");
      const list = block.querySelector(".pfad-sem-aufs");
      header.setAttribute("aria-expanded", String(isOpen));
      if (isOpen) list.removeAttribute("hidden"); else list.setAttribute("hidden", "");
    });
    updateToggleAllBtn();
    requestAnimationFrame(() => drawPfadLine(wrap));
  });
}

// ---------------------------------------------------------------------------
// Icon-Set für Lernpfad-Mini-Karten (thematisch nach Auftrag)
// ---------------------------------------------------------------------------
function auftragIconKey(a) {
  const t = ((a.thema || "") + " " + (a.kernbegriffe || []).join(" ") + " " + (a.titel || "")).toLowerCase();
  // Reihenfolge ist wichtig: spezifischere Begriffe zuerst
  if (a.id === "1.12" || t.includes("ict") || t.includes("teams") || t.includes("onenote") || t.includes("mygbs")) return "ict";
  if (t.includes("solar") || t.includes("photovoltaik")) return "solar";
  if (t.includes("wärmepumpe")) return "heatpump";
  if (t.includes("enthärtung") || t.includes("wasseraufbereitung")) return "filter";
  if (t.includes("kleinlüftung") || t.includes("lüftung") || t.includes("ventilator")) return "fan";
  if (t.includes("retention") || t.includes("versickerung") || t.includes("regenwasser")) return "rain";
  if (t.includes("erdgas") || t.includes(" gas ") || t.endsWith(" gas") || t.includes("gasleitung")) return "gas";
  if (t.includes("brand") || t.includes("explosion")) return "fire";
  if (t.includes("psa") || t.includes("arbeitssicherheit") || t.includes("schutzausrüstung") || t.includes("baustelle") && t.includes("sicher")) return "safety";
  if (t.includes("strom") || t.includes("elektr")) return "bolt";
  if (t.includes("abfall") || t.includes("recycling") || t.includes("entsorgung von") || t.includes("asbest")) return "recycle";
  if (t.includes("rapport") || t.includes("ausmass")) return "report";
  if (t.includes("vorwand")) return "wall";
  if (t.includes("apparatemontage") || (t.includes("apparat") && !t.includes("entsorgungsapparat"))) return "tap";
  if (t.includes("wartung") || t.includes("service") || t.includes("reparatur")) return "wrench";
  if (t.includes("inbetriebnahme") || t.includes("dichtheitsprüfung") || t.includes("druckprüfung")) return "gauge";
  if (t.includes("hygiene")) return "shield";
  if (t.includes("dämmung") || t.includes("dämmmaterial")) return "insulation";
  if (t.includes("z-mass") || t.includes("zmass")) return "zmass";
  if (t.includes("x-mass") || t.includes("xmass") || t.includes("avor")) return "xmass";
  if (t.includes("werkstattplan") || t.includes("vorfabrikation")) return "ruler";
  if (t.includes("detailplan")) return "blueprint";
  if (t.includes("installationsplan") || t.includes("schemaplan")) return "plan";
  if (t.includes("rohrweite") || t.includes("dimensionierung")) return "measure";
  if (t.includes("technisches zeichnen") || t.includes("isometrie") || t.includes("normprojektion") || t.includes("architekturpläne")) return "draw";
  if (t.includes("bauablauf") || t.includes("schnittstelle") || t.includes("gewerk")) return "buildflow";
  if (t.includes("dreieck") || t.includes("berechnung") || t.includes("masse") || t.includes("fläche")) return "calculator";
  if (t.includes("trinkwasser") || t.includes("wasser") || t.includes("hygiene")) return "water";
  if (t.includes("abwasser") || t.includes("entsorgungs") || t.includes("schmutzwasser")) return "drain";
  if (t.includes("qv") || t.includes("qualifikationsverfahren") || t.includes("position")) return "exam";
  if (t.includes("projekt") || t.includes("semesterarbeit") || t.includes("vernetz")) return "project";
  if (t.includes("wassererwärmer") || t.includes("boiler") || t.includes("speicher")) return "boiler";
  if (t.includes("ver- und entsorgungsapparat") || t.includes("pumpe") || t.includes("hebeanlage")) return "pump";
  if (t.includes("korrosion")) return "rust";
  if (t.includes("repetition")) return "refresh";
  return "auftrag";
}

function auftragIconSvg(a) {
  const key = auftragIconKey(a);
  const stroke = "currentColor";
  // Jedes Icon ist 24x24, stroke=currentColor
  const icons = {
    ict: `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="5" width="18" height="12" rx="1.5" fill="none" stroke="${stroke}" stroke-width="1.6"/><path d="M8 19h8M10 17v2M14 17v2" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    water: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 3c-3 5-6 8-6 12a6 6 0 0 0 12 0c0-4-3-7-6-12z" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
    plan: `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="4" width="18" height="16" rx="1.5" fill="none" stroke="${stroke}" stroke-width="1.6"/><path d="M3 9h18M9 4v16M14 14h4M14 17h3" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    blueprint: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 6l9-3 9 3v12l-9 3-9-3z" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 3v18M3 6l9 3 9-3" stroke="${stroke}" stroke-width="1.4"/></svg>`,
    draw: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 20 L14 10 L18 14 L8 24 Z" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round" transform="translate(0,-2)"/><path d="M14 10 L17 7 L21 11 L18 14" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
    ruler: `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="2" y="9" width="20" height="6" rx="1" fill="none" stroke="${stroke}" stroke-width="1.6"/><path d="M6 9v3M10 9v4M14 9v3M18 9v4" stroke="${stroke}" stroke-width="1.4"/></svg>`,
    zmass: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 6h12M8 12h12M4 18h12" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/><text x="20" y="9" font-size="6" fill="${stroke}" font-family="Arial">Z</text></svg>`,
    xmass: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 5l14 14M19 5L5 19" stroke="${stroke}" stroke-width="2" stroke-linecap="round"/></svg>`,
    measure: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 14h18M5 14v3M9 14v4M13 14v3M17 14v4M21 14v3" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/><path d="M6 10l3-3M12 10l3-3M18 10l3-3" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round"/></svg>`,
    calculator: `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="5" y="3" width="14" height="18" rx="1.5" fill="none" stroke="${stroke}" stroke-width="1.6"/><rect x="7" y="5" width="10" height="3" rx="0.5" fill="none" stroke="${stroke}" stroke-width="1.4"/><circle cx="9" cy="12" r="0.8" fill="${stroke}"/><circle cx="12" cy="12" r="0.8" fill="${stroke}"/><circle cx="15" cy="12" r="0.8" fill="${stroke}"/><circle cx="9" cy="16" r="0.8" fill="${stroke}"/><circle cx="12" cy="16" r="0.8" fill="${stroke}"/><circle cx="15" cy="16" r="0.8" fill="${stroke}"/></svg>`,
    drain: `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="11" r="6" fill="none" stroke="${stroke}" stroke-width="1.6"/><path d="M9 8l6 6M15 8l-6 6M12 5v3M12 14v3" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round"/><path d="M8 20h8" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    pump: `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="5" fill="none" stroke="${stroke}" stroke-width="1.6"/><path d="M12 7v10M7 12h10" stroke="${stroke}" stroke-width="1.6"/><path d="M3 18h4M17 18h4" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    boiler: `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="6" y="3" width="12" height="18" rx="2" fill="none" stroke="${stroke}" stroke-width="1.6"/><circle cx="12" cy="9" r="2" fill="none" stroke="${stroke}" stroke-width="1.4"/><path d="M9 14h6M9 17h6" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round"/></svg>`,
    tap: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 7h6v3a4 4 0 0 1-4 4H4" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/><rect x="10" y="4" width="4" height="6" rx="1" fill="none" stroke="${stroke}" stroke-width="1.6"/><path d="M8 17v3M6 20h4" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    gas: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 3c-1 3 2 3 1 6-1 2-3 2-3 5a4 4 0 0 0 8 0c0-3-4-5-6-11z" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
    fire: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 3c-2 4 2 5 1 8-1 2-4 2-4 6a5 5 0 0 0 10 0c0-3-4-5-7-14z" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
    solar: `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="4" fill="none" stroke="${stroke}" stroke-width="1.6"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2 2M16.4 5.6l-2 2M5.6 18.4l2-2M16.4 18.4l-2-2" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    heatpump: `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="5" width="18" height="11" rx="1.5" fill="none" stroke="${stroke}" stroke-width="1.6"/><circle cx="9" cy="11" r="2.5" fill="none" stroke="${stroke}" stroke-width="1.4"/><circle cx="16" cy="11" r="2.5" fill="none" stroke="${stroke}" stroke-width="1.4"/><path d="M6 19h12" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    fan: `<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="2" fill="${stroke}"/><path d="M12 4c3 0 4 4 0 8M12 20c-3 0-4-4 0-8M4 12c0-3 4-4 8 0M20 12c0 3-4 4-8 0" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
    rain: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 11a4 4 0 1 1 1-7 5 5 0 0 1 10 1 4 4 0 0 1-2 8H7" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 17l-1 3M13 16l-1 4M17 17l-1 3" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    safety: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 12a7 7 0 0 1 14 0v2H5z" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/><path d="M3 16h18M9 12V8M12 12V7M15 12V8" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    bolt: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
    shield: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 12l2.5 2.5L16 10" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    recycle: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M9 5l3-3 3 3M12 2v8M19 11l-2 4-4 0M22 13l-3 2M5 13l3 2M2 13l3-2M5 11l2 4 4 0M11 22l-3-3 3-3" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    report: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 3h9l4 4v14H6z" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v5h5M9 12h6M9 16h6M9 8h2" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round"/></svg>`,
    wall: `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="4" width="18" height="16" fill="none" stroke="${stroke}" stroke-width="1.6"/><path d="M3 10h18M3 16h18M9 4v6M15 10v6M9 16v4M15 4v6" stroke="${stroke}" stroke-width="1.4"/></svg>`,
    wrench: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M15 4a5 5 0 0 0-4.5 7.2L3 18.7 5.3 21l7.5-7.5A5 5 0 1 0 15 4z" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
    gauge: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 16a8 8 0 1 1 16 0" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/><path d="M12 16l5-4" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16" r="1.2" fill="${stroke}"/></svg>`,
    filter: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 4h16l-6 8v8l-4-2v-6z" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
    insulation: `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="6" width="18" height="12" rx="1" fill="none" stroke="${stroke}" stroke-width="1.6"/><path d="M3 9h18M3 12h18M3 15h18" stroke="${stroke}" stroke-width="1" stroke-dasharray="2 2"/></svg>`,
    project: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 21l4-4 5 5M10 11l6-6M14 5h6v6" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    buildflow: `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="3" y="11" width="6" height="9" fill="none" stroke="${stroke}" stroke-width="1.6"/><rect x="9" y="6" width="6" height="14" fill="none" stroke="${stroke}" stroke-width="1.6"/><rect x="15" y="3" width="6" height="17" fill="none" stroke="${stroke}" stroke-width="1.6"/></svg>`,
    exam: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 4h14v16H5z" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 9h6M9 13h6M9 17h4" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round"/><circle cx="17" cy="8" r="2" fill="none" stroke="${stroke}" stroke-width="1.4"/></svg>`,
    refresh: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 12a8 8 0 0 1 14-5l2-2v6h-6l2-2a6 6 0 1 0 1 4" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    rust: `<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5 5l4 0M5 9l3 0M5 13l4 0M5 17l3 0M14 5l5 0M14 9l5 0M14 13l5 0M14 17l5 0M10 6c1 2 3 2 4 0M10 18c1-2 3-2 4 0" stroke="${stroke}" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    auftrag: `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="4" y="3" width="16" height="18" rx="1.5" fill="none" stroke="${stroke}" stroke-width="1.6"/><path d="M8 8h8M8 12h8M8 16h5" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  };
  return icons[key] || icons.auftrag;
}

// Pastellige Farbpalette pro Semester (Pinselstrich-Optik)
// Jeweils ein heller Pastellton + eine kräftigere Variante für Schrift/Akzente
const PFAD_SEM_PALETTE = [
  { pastel: "#BCC9D2", deep: "#5F7484" }, // Sem 1 – Hellgrau-Blau (Wasser)
  { pastel: "#B3CADC", deep: "#4A7A9E" }, // Sem 2 – Hellblau (Wasser tief)
  { pastel: "#EAC7C0", deep: "#A0635A" }, // Sem 3 – Rosé
  { pastel: "#F2E5B5", deep: "#9C8438" }, // Sem 4 – Hellgelb
  { pastel: "#D5D3CF", deep: "#6E6A63" }, // Sem 5 – Hellgrau
  { pastel: "#BFD4C0", deep: "#5A8160" }, // Sem 6 – Mint
  { pastel: "#D4C0D4", deep: "#7E5B85" }, // Sem 7 – Flieder
  { pastel: "#E8D596", deep: "#8E7424" }, // Sem 8 – Sand-Gelb
];
function pfadSemesterColor(num) {
  return PFAD_SEM_PALETTE[(num - 1) % 8].pastel;
}
function pfadSemesterDeep(num) {
  return PFAD_SEM_PALETTE[(num - 1) % 8].deep;
}

function drawPfadLine(wrap) {
  if (!wrap) return;
  // Existierendes SVG entfernen
  const old = wrap.querySelector(":scope > svg.pfad-svg");
  if (old) old.remove();

  // Alle sichtbaren Anker in DOM-Reihenfolge sammeln
  const anchorEls = Array.from(wrap.querySelectorAll(
    ".pfad-flag, .pfad-flag-weiter, .pfad-sem-bubble, .pfad-mini-dot"
  ));
  if (anchorEls.length < 2) return;

  const wrapRect = wrap.getBoundingClientRect();
  const wrapHeight = wrap.scrollHeight;
  const wrapWidth = wrapRect.width;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "pfad-svg");
  svg.setAttribute("width", wrapWidth);
  svg.setAttribute("height", wrapHeight);
  svg.setAttribute("viewBox", `0 0 ${wrapWidth} ${wrapHeight}`);
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.zIndex = "0";
  svg.style.pointerEvents = "none";

  // Punkte sammeln (relativ zum wrap), nur sichtbare Anker
  const points = anchorEls.map((dotEl) => {
    const rect = dotEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null; // hidden
    return {
      x: rect.left + rect.width / 2 - wrapRect.left,
      y: rect.top + rect.height / 2 - wrapRect.top + wrap.scrollTop,
    };
  }).filter(Boolean);

  if (points.length < 2) return;

  // Gradient definieren: heller Wasserton → tiefer Wasserton → Akzent gegen Ende
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const grad = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
  grad.setAttribute("id", "pfad-grad");
  grad.setAttribute("x1", "0%");
  grad.setAttribute("y1", "0%");
  grad.setAttribute("x2", "0%");
  grad.setAttribute("y2", "100%");
  const stops = [
    ["0%", "#7BA7B5"],
    ["55%", "#4C7A8A"],
    ["80%", "#9A7E5A"],
    ["100%", "#C0855A"],
  ];
  stops.forEach(([off, col]) => {
    const st = document.createElementNS("http://www.w3.org/2000/svg", "stop");
    st.setAttribute("offset", off);
    st.setAttribute("stop-color", col);
    grad.appendChild(st);
  });
  defs.appendChild(grad);
  svg.appendChild(defs);

  // Geschwungene Pfad-Linie via kubische Bezier-Kurven (mehr Schwung)
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const p0 = points[i - 1];
    const p1 = points[i];
    const dy = p1.y - p0.y;
    const c1x = p0.x;
    const c1y = p0.y + dy * 0.62;
    const c2x = p1.x;
    const c2y = p1.y - dy * 0.62;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }

  // Schatten/Outline-Pfad (weicher Glow)
  const pathShadow = document.createElementNS("http://www.w3.org/2000/svg", "path");
  pathShadow.setAttribute("d", d);
  pathShadow.setAttribute("fill", "none");
  pathShadow.setAttribute("stroke", "rgba(124, 167, 181, 0.14)");
  pathShadow.setAttribute("stroke-width", "12");
  pathShadow.setAttribute("stroke-linecap", "round");
  pathShadow.setAttribute("stroke-linejoin", "round");
  svg.appendChild(pathShadow);

  // Hauptlinie mit Gradient + Punktmuster
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "url(#pfad-grad)");
  path.setAttribute("stroke-width", "3");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  path.setAttribute("stroke-dasharray", "1 8");
  svg.appendChild(path);

  wrap.appendChild(svg);
}

// ----- Info
function renderInfo() {
  const v = $("#view");
  v.appendChild(el(`
    <header class="section-head"><h1>Info</h1></header>
    <article class="detail" style="grid-template-columns:1fr;">
      <div>
        <h2>So funktioniert die Plattform</h2>
        <p>Diese Webseite zeigt dir das aktuelle Tagesprogramm deiner Klasse sowie alle Lernaufträge des Sanitärinstallateur-EFZ-Lehrgangs an der GBS St.Gallen. Du brauchst keinen Login.</p>
        <ul class="lz-list">
          <li><strong>Tagesprogramm</strong>: Wähle links oben deine Klasse. Du siehst sofort den aktuellen bzw. nächsten Schultag mit seinen 5 Lektionen, Material und Lernaufträgen. Über die Buttons blätterst du zum vorherigen oder nächsten Schultag oder öffnest das ganze Semester.</li>
          <li><strong>Entdecken</strong>: Der Lernweg mit allen 8 Semestern und Lernaufträgen – zum Stöbern unabhängig vom Schultag.</li>
          <li><strong>Suche</strong>: Tippe einen Begriff (z. B. „solar", „z-mass", „hygiene"), drücke <em>Suchen</em>. Es werden Aufträge gefunden, die das Thema behandeln – nicht nur exakte Treffer.</li>
          <li><strong>PDF-Reader</strong>: Im Auftrag öffnet sich der PDF-Reader direkt auf der Seite. Du kannst zoomen und blättern.</li>
        </ul>

        <h2 style="margin-top:24px">Hinweis zu Downloads</h2>
        <p>Aufträge sind nur zur Ansicht hier verfügbar. Die Webseite bietet keinen Download-Button und kein Druckmenü. Bitte respektiere die Lizenzhinweise der Lehrpersonen.</p>

        <h2 style="margin-top:24px">Versionsstand</h2>
        <p>Prototyp Version ${escapeHtml(state.data.version || "1.0")} · Stand ${escapeHtml(state.data.stand)} · Titel und Kernbegriffe sind teilweise als <em>vorläufig</em> markiert und werden noch geprüft.</p>

        <h2 style="margin-top:24px">Für Lehrpersonen</h2>
        <p>Titel, Kurzbeschreibungen, Kernbegriffe und Handlungskompetenz-Zuordnungen aller 73 Aufträge können im Editor korrigiert werden. Änderungen werden lokal im Browser gespeichert und können als JSON exportiert werden.</p>
        <div class="cta-row" style="margin-top:16px">
          <a class="btn btn-primary" href="#/edit">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="margin-right:4px"><path d="M4 20h4l10-10-4-4L4 16v4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
            Auftrags-Editor öffnen
          </a>
        </div>
      </div>
    </article>
  `));
}

// ---------------------------------------------------------------------------
// IndexedDB – ersetzte PDFs (Upload im Editor) lokal speichern
// ---------------------------------------------------------------------------
const PDF_DB_NAME = "sanigbs-pdfs";
const PDF_STORE = "pdfs";
let _pdfDb = null;
function openPdfDb() {
  if (_pdfDb) return Promise.resolve(_pdfDb);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PDF_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PDF_STORE)) db.createObjectStore(PDF_STORE);
    };
    req.onsuccess = () => { _pdfDb = req.result; resolve(_pdfDb); };
    req.onerror = () => reject(req.error);
  });
}
async function idbPutPdf(id, blob, meta) {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_STORE, "readwrite");
    tx.objectStore(PDF_STORE).put({ blob, meta, ts: Date.now() }, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGetPdf(id) {
  try {
    const db = await openPdfDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PDF_STORE, "readonly");
      const r = tx.objectStore(PDF_STORE).get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  } catch { return null; }
}
async function idbDeletePdf(id) {
  const db = await openPdfDb();
  return new Promise((resolve) => {
    const tx = db.transaction(PDF_STORE, "readwrite");
    tx.objectStore(PDF_STORE).delete(id);
    tx.oncomplete = () => resolve();
  });
}
async function idbListPdfIds() {
  try {
    const db = await openPdfDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(PDF_STORE, "readonly");
      const r = tx.objectStore(PDF_STORE).getAllKeys();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => resolve([]);
    });
  } catch { return []; }
}

// Liefert die zu verwendende PDF-Quelle: hochgeladenes (IndexedDB) oder Original-Pfad.
async function resolvePdfSource(auftrag) {
  const rec = await idbGetPdf(auftrag.id);
  if (rec && rec.blob) {
    return { url: URL.createObjectURL(rec.blob), isBlob: true, ts: rec.ts };
  }
  return { url: auftrag.pdfPfad, isBlob: false, ts: 0 };
}

// ---------------------------------------------------------------------------
// PDF-Viewer: eingebetteter Reader (iframe → Live-PDF von sanitaerlernen.ch)
// ---------------------------------------------------------------------------
let pdfjs = null;

async function ensurePdfJs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import(PDFJS_URL);
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  return pdfjs;
}

// Aufträge, die (noch) nicht auf sanitaerlernen.ch liegen → lokales PDF als Fallback
const PDF_NICHT_ONLINE = new Set(["2.11"]);

function openPdf(auftrag) {
  const modal = $("#pdf-modal");
  const frame = $("#pdf-frame");
  const wrap = $("#pdf-frame-wrap");
  const empty = $("#pdf-empty");

  $("#pdf-modal-title").textContent = `${auftrag.auftragNummer} · ${auftrag.titel}`;

  // Live-URL (immer aktuell) – ausser bei nicht-online Aufträgen
  const liveUrl = PDF_NICHT_ONLINE.has(auftrag.id) ? auftrag.pdfPfad : auftragPdfUrl(auftrag);
  // Saubere Anzeige: Toolbar/Seitenleiste aus, an Breite anpassen
  const viewerUrl = liveUrl + "#toolbar=0&navpanes=0&statusbar=0&view=FitH";

  $("#pdf-newtab").href = liveUrl;
  empty.hidden = true;
  wrap.classList.remove("is-error");
  frame.src = viewerUrl;

  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  // Falls das PDF nicht lädt (sehr selten), nach kurzer Zeit Hinweis zeigen
  // (iframe liefert kein zuverlässiges error-Event bei Cross-Origin; daher dezenter Fallback-Link).
}

function closePdf() {
  const modal = $("#pdf-modal");
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  $("#pdf-frame").src = "about:blank";
}

document.addEventListener("click", (e) => {
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.closest("[data-close]")) closePdf();
});
document.addEventListener("keydown", (e) => {
  const modal = $("#pdf-modal");
  if (modal.hidden) return;
  if (e.key === "Escape") closePdf();
});

// ---------------------------------------------------------------------------
// Editor: Titel-/Kurzbeschreibungs-Korrekturen pro Auftrag
// ---------------------------------------------------------------------------
const EDIT_KEY = "sanigbs:edit:v1";

function loadEdits() {
  try { return JSON.parse(localStorage.getItem(EDIT_KEY) || "{}"); }
  catch { return {}; }
}
function saveEdits(map) {
  try { localStorage.setItem(EDIT_KEY, JSON.stringify(map)); }
  catch {}
}
// Liefert Auftrag mit ggf. überlagerten Edits
function mergedAuftrag(a, edits) {
  const e = edits[a.id];
  if (!e) return a;
  return { ...a, ...e };
}

// Einfacher Editor-Passwortschutz (clientseitig – hält Gelegenheitszugriffe ab,
// ist aber kein echter Serverschutz, da der Code im Browser einsehbar ist).
const EDITOR_PW = "sanitaer-gbs";   // bei Bedarf hier ändern
const EDITOR_SESSION_KEY = "sanigbs:editor-unlocked";

function renderEditorGate(v) {
  v.appendChild(el(`
    <div class="editor-gate">
      <div class="editor-gate-card">
        <div class="editor-gate-icon">
          <svg viewBox="0 0 24 24" width="28" height="28"><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="15.5" r="1.4" fill="currentColor"/></svg>
        </div>
        <h1>Editor-Bereich</h1>
        <p>Dieser Bereich ist für Lehrpersonen. Bitte gib das Passwort ein.</p>
        <form id="editor-gate-form">
          <input type="password" id="editor-gate-pw" placeholder="Passwort" autocomplete="current-password" />
          <button class="btn btn-primary" type="submit">Entsperren</button>
        </form>
        <p class="editor-gate-error" id="editor-gate-error" hidden>Falsches Passwort.</p>
        <a class="editor-gate-back" href="#/">← Zurück zur Startseite</a>
      </div>
    </div>
  `));
  const form = $("#editor-gate-form");
  const pw = $("#editor-gate-pw");
  pw.focus();
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (pw.value === EDITOR_PW) {
      sessionStorage.setItem(EDITOR_SESSION_KEY, "1");
      renderEditor();
    } else {
      $("#editor-gate-error").hidden = false;
      pw.value = "";
      pw.focus();
    }
  });
}

function renderEditor() {
  const v = $("#view");

  // Passwort-Gate
  if (sessionStorage.getItem(EDITOR_SESSION_KEY) !== "1") {
    renderEditorGate(v);
    return;
  }

  const edits = loadEdits();
  const merged = state.data.aufträge.map((a) => mergedAuftrag(a, edits));
  const editedCount = Object.keys(edits).length;
  const checkedCount = merged.filter((a) => a.titelStatus === "geprüft").length;

  v.appendChild(el(`
    <p class="breadcrumb"><a href="#/info">Info</a> · Editor</p>
    <header class="section-head">
      <div>
        <h1>Auftrags-Editor</h1>
        <p>Titel, Kurzbeschreibung und Kernbegriffe pro Auftrag korrigieren. Änderungen werden lokal im Browser zwischengespeichert.</p>
      </div>
      <div class="meta">
        <strong>${checkedCount}</strong> / ${merged.length} geprüft<br>
        ${editedCount} lokal bearbeitet
      </div>
    </header>

    <div class="edit-toolbar">
      <button class="btn btn-primary" id="export-json">JSON exportieren</button>
      <label class="btn btn-ghost"><input type="file" id="import-json" accept=".json" hidden>JSON importieren</label>
      <button class="btn btn-ghost" id="clear-edits">Lokale Änderungen löschen</button>
    </div>

    <div class="edit-layout">
      <aside class="edit-list" id="edit-list" aria-label="Auftragsliste"></aside>
      <section class="edit-pane" id="edit-pane" aria-live="polite">
        <div class="empty"><p>Wähle links einen Auftrag, um ihn zu bearbeiten.</p></div>
      </section>
    </div>
  `));

  drawEditList();

  $("#export-json").addEventListener("click", exportEditedJson);
  $("#clear-edits").addEventListener("click", () => {
    if (!confirm("Wirklich alle lokalen Änderungen verwerfen? Das kann nicht rückgängig gemacht werden.")) return;
    localStorage.removeItem(EDIT_KEY);
    drawEditList();
    $("#edit-pane").innerHTML = `<div class="empty"><p>Wähle links einen Auftrag, um ihn zu bearbeiten.</p></div>`;
    // Header neu rendern indem renderEditor erneut aufgerufen wird
    location.hash = "#/edit?_=" + Date.now();
    setTimeout(() => { location.hash = "#/edit"; }, 10);
  });
  $("#import-json").addEventListener("change", async (ev) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const list = parsed.aufträge || parsed["auftraege"] || [];
      const newEdits = loadEdits();
      list.forEach((a) => {
        if (!a.id) return;
        const orig = state.data.aufträge.find((o) => o.id === a.id);
        if (!orig) return;
        const diff = {};
        ["titel", "kurzbeschreibung", "thema", "kernbegriffe", "handlungskompetenzen", "lernziele", "leistungszieleBFS", "leistungsnachweise", "titelStatus"].forEach((f) => {
          if (JSON.stringify(a[f]) !== JSON.stringify(orig[f])) diff[f] = a[f];
        });
        if (Object.keys(diff).length) newEdits[a.id] = diff;
      });
      saveEdits(newEdits);
      alert(`${Object.keys(newEdits).length} Aufträge importiert.`);
      location.hash = "#/edit?_=" + Date.now();
      setTimeout(() => { location.hash = "#/edit"; }, 10);
    } catch (e) {
      alert("Import fehlgeschlagen: " + e.message);
    }
  });
}

function drawEditList() {
  const list = $("#edit-list");
  if (!list) return;
  const edits = loadEdits();
  const merged = state.data.aufträge.map((a) => mergedAuftrag(a, edits));
  list.innerHTML = "";

  // Filter-Buttons
  const filter = el(`
    <div class="edit-filter">
      <input id="edit-search" type="search" placeholder="Filter… (Nummer oder Titel)" />
      <label><input type="checkbox" id="edit-only-pending"> Nur „vorläufig"</label>
    </div>
  `);
  list.appendChild(filter);

  const items = el(`<div class="edit-items"></div>`);
  list.appendChild(items);

  const draw = () => {
    const q = $("#edit-search").value.trim().toLowerCase();
    const onlyPending = $("#edit-only-pending").checked;
    items.innerHTML = "";
    merged
      .filter((a) => {
        if (onlyPending && a.titelStatus === "geprüft") return false;
        if (!q) return true;
        return (
          a.id.toLowerCase().includes(q) ||
          (a.titel || "").toLowerCase().includes(q) ||
          (a.kurzbeschreibung || "").toLowerCase().includes(q)
        );
      })
      .forEach((a) => {
        const isEdited = !!edits[a.id];
        const dot = a.titelStatus === "geprüft" ? "is-checked" : (isEdited ? "is-edited" : "is-pending");
        items.appendChild(el(`
          <button class="edit-item ${dot}" type="button" data-id="${a.id}">
            <span class="edit-num">${escapeHtml(a.auftragNummer)}</span>
            <span class="edit-title">${escapeHtml(a.titel)}</span>
            <span class="edit-dot" title="${dot === "is-checked" ? "geprüft" : dot === "is-edited" ? "bearbeitet" : "vorläufig"}"></span>
          </button>
        `));
      });
  };
  $("#edit-search").addEventListener("input", draw);
  $("#edit-only-pending").addEventListener("change", draw);
  list.addEventListener("click", (e) => {
    const btn = e.target.closest(".edit-item");
    if (btn) drawEditPane(btn.dataset.id);
  });
  draw();
}

function drawEditPane(id) {
  const pane = $("#edit-pane");
  const edits = loadEdits();
  const orig = state.data.aufträge.find((a) => a.id === id);
  if (!orig) return;
  const cur = mergedAuftrag(orig, edits);

  pane.innerHTML = "";
  pane.appendChild(el(`
    <header class="edit-pane-head">
      <h2><span class="auf-num-big">${escapeHtml(cur.auftragNummer)}</span> · Auftrag bearbeiten</h2>
      <div class="meta">Status: <strong>${escapeHtml(cur.titelStatus || "vorläufig")}</strong></div>
    </header>

    <p class="edit-hint">Das PDF kommt automatisch von <code>sanitaerlernen.ch</code> und ist immer aktuell. Hier bearbeitest du nur die Anzeige- und Such-Angaben.</p>

    <form id="edit-form" class="edit-form">
      <label class="ef">
        <span>Titel</span>
        <input name="titel" type="text" value="${escapeHtml(cur.titel || "")}" />
      </label>
      <label class="ef">
        <span>Kurzbeschreibung</span>
        <textarea name="kurzbeschreibung" rows="3">${escapeHtml(cur.kurzbeschreibung || "")}</textarea>
      </label>
      <label class="ef">
        <span>Thema</span>
        <input name="thema" type="text" value="${escapeHtml(cur.thema || "")}" />
      </label>
      <label class="ef">
        <span>Kernbegriffe (Komma-getrennt) — wichtig für die Suche</span>
        <input name="kernbegriffe" type="text" value="${escapeHtml((cur.kernbegriffe || []).join(", "))}" />
      </label>

      <div class="edit-actions">
        <button class="btn btn-primary" type="submit">Speichern</button>
        <button class="btn btn-ghost" type="button" id="mark-checked">Als geprüft markieren</button>
        <button class="btn btn-ghost" type="button" id="revert-auftrag">Änderungen verwerfen</button>
        <a class="btn btn-ghost" href="#/auftrag/${cur.id}">Vorschau →</a>
      </div>
    </form>
  `));

  $("#edit-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const diff = collectDiff(orig, fd);
    const all = loadEdits();
    if (Object.keys(diff).length) all[id] = { ...all[id], ...diff };
    saveEdits(all);
    flashSaved(pane);
    drawEditList();
  });
  $("#mark-checked").addEventListener("click", () => {
    const all = loadEdits();
    all[id] = { ...all[id], titelStatus: "geprüft" };
    saveEdits(all);
    drawEditList();
    drawEditPane(id);
  });
  $("#revert-auftrag").addEventListener("click", () => {
    if (!confirm("Lokale Änderungen für diesen Auftrag verwerfen?")) return;
    const all = loadEdits();
    delete all[id];
    saveEdits(all);
    drawEditList();
    drawEditPane(id);
  });
}

function collectDiff(orig, fd) {
  const split = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const lines = (s) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  // Editor bearbeitet nur noch Anzeige-/Such-Metadaten
  const next = {
    titel: fd.get("titel") || "",
    kurzbeschreibung: fd.get("kurzbeschreibung") || "",
    thema: fd.get("thema") || "",
    kernbegriffe: split(fd.get("kernbegriffe") || ""),
  };
  const diff = {};
  Object.entries(next).forEach(([k, v]) => {
    if (JSON.stringify(v) !== JSON.stringify(orig[k])) diff[k] = v;
  });
  return diff;
}

function flashSaved(pane) {
  const flash = el(`<div class="edit-flash">Gespeichert ✓</div>`);
  pane.appendChild(flash);
  setTimeout(() => flash.remove(), 1400);
}

function exportEditedJson() {
  const edits = loadEdits();
  const out = JSON.parse(JSON.stringify(state.data));
  out.aufträge = out.aufträge.map((a) => mergedAuftrag(a, edits));
  out.version = (out.version || "2.0.0") + "+edited";
  out.stand = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "auftraege.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
