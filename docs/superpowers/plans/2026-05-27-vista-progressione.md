# Vista progressione — grafico carico nel tempo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere un grafico a linea del top-set kg per settimana, aperto dal focus di un esercizio tramite icona 📈.

**Architecture:** Due helper puri in `session.js` (`topSetSeries` per i dati, `chartGeometry` per le coordinate SVG), testati con `node --test`. Rendering SVG inline in `app.js` dentro un `<dialog id="chartDialog">` modale, stesso pattern dei dialog esistenti. Nessuna dipendenza esterna.

**Tech Stack:** Vanilla ES modules, `node --test`, SVG inline, service worker cache.

**Spec:** `docs/superpowers/specs/2026-05-27-vista-progressione-design.md`

---

## File Structure

- **Modify** `session.js` — aggiunge gli export `topSetSeries` e `chartGeometry` (logica pura, vicino a `weekTopKg`/`exerciseTrend`).
- **Modify** `tests/session.test.js` — nuovi test per i due helper.
- **Modify** `index.html` — pulsante `📈` nell'header del focus + nuovo `<dialog id="chartDialog">`.
- **Modify** `style.css` — stile del pulsante e del dialog/grafico.
- **Modify** `app.js` — stato del dialog, `renderChart`, `openChartDialog`/`renderChartDialog`, wiring del pulsante e del dialog in `init`.
- **Modify** `sw.js` — bump `CACHE` a `gymsched-v21`.

Convenzioni del progetto: logica pura testata in Node (`session.js`); rendering/wiring DOM in `app.js` (non testato in Node, verificato in browser). `node --test` è il gate. Commit + push automatici su `main` (no PR), con `git fetch; git pull` prima.

---

## Task 1: Helper dati `topSetSeries`

**Files:**
- Modify: `session.js` (vicino a `weekTopKg`, ~riga 207-221)
- Test: `tests/session.test.js`

- [ ] **Step 1: Aggiungi l'import nel file di test**

In cima a `tests/session.test.js`, estendi l'import dei nomi da `../session.js` (riga 5) aggiungendo `topSetSeries`:

```js
import { bestKg, progressionDelta, withNote, previousNote, previousSetInSession, previousWeekSet, sessionVolume, exerciseTrend, topSetSeries } from "../session.js";
```

- [ ] **Step 2: Scrivi i test che falliscono**

Aggiungi in fondo a `tests/session.test.js`:

```js
test("topSetSeries: top-set per settimana, ordine crescente, normale", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", "e0", { sets: [{ reps: "8", kg: "65", done: true }, { reps: "8", kg: "67.5", done: true }] });
  d = setEntry(d, "2026-W22", "A", "e0", { sets: [{ reps: "8", kg: "72.5", done: true }] });
  assert.deepEqual(topSetSeries(d, "A", "e0", "2026-W22"), [
    { week: "2026-W20", kg: 67.5 }, { week: "2026-W22", kg: 72.5 },
  ]);
});

test("topSetSeries: salta settimane senza kg e quelle oltre weekKey", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", "e0", { sets: [{ reps: "8", kg: "", done: true }] });
  d = setEntry(d, "2026-W21", "A", "e0", { sets: [{ reps: "8", kg: "70", done: true }] });
  d = setEntry(d, "2026-W23", "A", "e0", { sets: [{ reps: "8", kg: "80", done: true }] });
  assert.deepEqual(topSetSeries(d, "A", "e0", "2026-W22"), [{ week: "2026-W21", kg: 70 }]);
});

test("topSetSeries: esclude warmup e serie non riuscite", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "e0", { sets: [
    { reps: "8", kg: "100", done: true, warmup: true },
    { reps: "8", kg: "90", done: true, failed: true },
    { reps: "8", kg: "72.5", done: true },
  ] });
  assert.deepEqual(topSetSeries(d, "A", "e0", "2026-W22"), [{ week: "2026-W22", kg: 72.5 }]);
});

test("topSetSeries: traccia 'a'/'b' di un superset", () => {
  const data = { weeks: {
    "2026-W22": { entries: { A: { ss: {
      a: { sets: [{ reps: "10", kg: "20", done: true }] },
      b: { sets: [{ reps: "10", kg: "15", done: true }] },
    } } } },
  } };
  assert.deepEqual(topSetSeries(data, "A", "ss", "2026-W22", "a"), [{ week: "2026-W22", kg: 20 }]);
  assert.deepEqual(topSetSeries(data, "A", "ss", "2026-W22", "b"), [{ week: "2026-W22", kg: 15 }]);
});

test("topSetSeries: nessuno storico -> array vuoto", () => {
  assert.deepEqual(topSetSeries(emptyData(), "A", "e0", "2026-W22"), []);
});
```

- [ ] **Step 3: Esegui i test per verificare che falliscano**

Run: `node --test` (in `C:\Users\TomasCoro\gym-schedule`)
Expected: FAIL — `topSetSeries is not a function` / export mancante.

- [ ] **Step 4: Implementa `topSetSeries`**

In `session.js`, subito dopo `weekTopKg` (prima di `exerciseTrend`), aggiungi:

```js
// Serie completa [{week, kg}] del top-set per settimana <= weekKey con un kg numerico,
// ordine crescente. track: null = normale, "a"/"b" = traccia del superset.
// Esclude warmup e serie non riuscite (come weekTopKg), ma su una sola traccia.
export function topSetSeries(data, day, exId, weekKey, track = null) {
  const keys = Object.keys(data?.weeks ?? {})
    .filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k) && k <= weekKey).sort();
  const out = [];
  for (const k of keys) {
    const v = getEntry(data, k, day, exId);
    const t = track ? normalizeSupersetEntry(v)[track] : normalizeEntry(v);
    let best = null;
    for (const s of t.sets) {
      if (s.warmup || s.failed) continue;
      const kg = parseNum(s.kg);
      if (kg !== null && (best === null || kg > best)) best = kg;
    }
    if (best !== null) out.push({ week: k, kg: best });
  }
  return out;
}
```

> `getEntry`, `normalizeEntry`, `normalizeSupersetEntry` e `parseNum` sono già disponibili in `session.js` (usati da `weekTopKg`/`previousNote`). Non aggiungere import.

- [ ] **Step 5: Esegui i test per verificare che passino**

Run: `node --test`
Expected: PASS — i 5 nuovi test verdi, nessuna regressione.

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\TomasCoro\gym-schedule
git fetch; git pull
git add session.js tests/session.test.js
git commit -m "feat: topSetSeries — serie storica top-set per esercizio/traccia" -m "Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Task 2: Helper geometria `chartGeometry`

**Files:**
- Modify: `session.js` (dopo `topSetSeries`)
- Test: `tests/session.test.js`

- [ ] **Step 1: Estendi l'import nel test**

Aggiungi `chartGeometry` all'import da `../session.js` (la stessa riga 5 modificata nel Task 1):

```js
import { bestKg, progressionDelta, withNote, previousNote, previousSetInSession, previousWeekSet, sessionVolume, exerciseTrend, topSetSeries, chartGeometry } from "../session.js";
```

- [ ] **Step 2: Scrivi i test che falliscono**

Aggiungi in fondo a `tests/session.test.js`:

```js
test("chartGeometry: serie vuota -> niente punti", () => {
  assert.deepEqual(chartGeometry([]), { points: [], polyline: "", yTicks: [], min: null, max: null });
});

test("chartGeometry: punto singolo a metà altezza, centrato in x", () => {
  const g = chartGeometry([{ week: "2026-W22", kg: 50 }]);
  // default width 260, padX 34, margine destro 8 -> plotW 218 -> x centro = 34 + 109 = 143
  // span 0 -> banda ±1 -> kg a metà -> y = 20 + 0.5*(150-20-26) = 72
  assert.deepEqual(g.points, [{ x: 143, y: 72, week: "2026-W22", kg: 50 }]);
  assert.equal(g.min, 50);
  assert.equal(g.max, 50);
});

test("chartGeometry: due punti, il massimo sta più in alto (y minore)", () => {
  const g = chartGeometry([{ week: "2026-W21", kg: 40 }, { week: "2026-W22", kg: 50 }]);
  // dataMin 40, dataMax 50, span 10, pad 1.5 -> lo 38.5 hi 51.5; plotH 104
  // x: 34 e 252 (34+218); y: 40 -> 112, 50 -> 32
  assert.deepEqual(g.points, [
    { x: 34, y: 112, week: "2026-W21", kg: 40 },
    { x: 252, y: 32, week: "2026-W22", kg: 50 },
  ]);
  assert.equal(g.polyline, "34,112 252,32");
  assert.deepEqual(g.yTicks, [{ value: 50, y: 32 }, { value: 40, y: 112 }]);
});

test("chartGeometry: valori uguali non dividono per zero", () => {
  const g = chartGeometry([{ week: "2026-W21", kg: 50 }, { week: "2026-W22", kg: 50 }]);
  assert.ok(g.points.every((p) => p.y === 72));
  assert.equal(g.polyline, "34,72 252,72");
});
```

- [ ] **Step 3: Esegui i test per verificare che falliscano**

Run: `node --test`
Expected: FAIL — `chartGeometry is not a function`.

- [ ] **Step 4: Implementa `chartGeometry`**

In `session.js`, subito dopo `topSetSeries`:

```js
// Geometria SVG del grafico progressione. series: [{week, kg}] in ordine crescente.
// Scala Y su min/max dei dati con margine (NON parte da 0). Ritorna coordinate pronte.
export function chartGeometry(series, opts = {}) {
  const { width = 260, height = 150, padX = 34, padTop = 20, padBottom = 26, padRight = 8 } = opts;
  if (!Array.isArray(series) || series.length === 0) {
    return { points: [], polyline: "", yTicks: [], min: null, max: null };
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  const kgs = series.map((p) => p.kg);
  const dataMin = Math.min(...kgs), dataMax = Math.max(...kgs);
  const span = dataMax - dataMin;
  const pad = span === 0 ? 1 : span * 0.15;
  const lo = dataMin - pad, hi = dataMax + pad;
  const plotW = width - padX - padRight;
  const plotH = height - padTop - padBottom;
  const n = series.length;
  const xAt = (i) => (n === 1 ? padX + plotW / 2 : padX + (i * plotW) / (n - 1));
  const yAt = (kg) => padTop + (1 - (kg - lo) / (hi - lo)) * plotH;
  const points = series.map((p, i) => ({ x: r2(xAt(i)), y: r2(yAt(p.kg)), week: p.week, kg: p.kg }));
  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
  const yTicks = [
    { value: dataMax, y: r2(yAt(dataMax)) },
    { value: dataMin, y: r2(yAt(dataMin)) },
  ];
  return { points, polyline, yTicks, min: dataMin, max: dataMax };
}
```

- [ ] **Step 5: Esegui i test per verificare che passino**

Run: `node --test`
Expected: PASS — i 4 nuovi test verdi, nessuna regressione.

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\TomasCoro\gym-schedule
git fetch; git pull
git add session.js tests/session.test.js
git commit -m "feat: chartGeometry — coordinate SVG per il grafico progressione" -m "Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Task 3: Markup del pulsante 📈 e del dialog grafico

**Files:**
- Modify: `index.html` (header focus ~riga 77-83; dialog dopo `exDialog` ~riga 164)
- Modify: `style.css`

- [ ] **Step 1: Aggiungi il pulsante 📈 nell'header del focus**

In `index.html`, dentro `<header class="focus-top">` del `#focusOverlay` (righe 77-83), aggiungi il pulsante DOPO il `<div class="focus-id">…</div>`:

```html
    <header class="focus-top">
      <button id="focusBack" class="focus-back" aria-label="Chiudi esercizio">←</button>
      <div class="focus-id">
        <div id="focusName" class="fn"></div>
        <div id="focusSet" class="fs"></div>
      </div>
      <button id="chartBtn" class="focus-chart" type="button" aria-label="Progressione">📈</button>
    </header>
```

- [ ] **Step 2: Aggiungi il dialog del grafico**

In `index.html`, subito dopo la chiusura di `</dialog>` di `#exDialog` (~riga 164), aggiungi:

```html
  <!-- Grafico progressione esercizio -->
  <dialog id="chartDialog" class="set-dialog chart-dialog">
    <div class="modal-h">
      <span id="chartTitle" class="t">Progressione</span>
      <button id="chartClose" class="x" type="button" aria-label="Chiudi">✕</button>
    </div>
    <div class="editlabel" style="text-align:left">Top-set · kg per settimana</div>
    <div id="chartBody"></div>
    <div id="chartRange" class="chart-range"></div>
  </dialog>
```

- [ ] **Step 3: Aggiungi gli stili**

In fondo a `style.css`:

```css
/* Vista progressione */
.focus-top { display: flex; align-items: center; gap: 10px; }
.focus-chart {
  margin-left: auto; background: none; border: 0; color: var(--accent, #E8A93C);
  font-size: 22px; line-height: 1; padding: 4px 6px; cursor: pointer;
}
.chart-dialog { width: min(92vw, 360px); }
.chart-svg { width: 100%; height: auto; display: block; }
.chart-empty { color: #9a9385; font-size: 13px; padding: 24px 4px; text-align: center; }
.chart-note { color: #9a9385; font-size: 12px; text-align: center; margin-top: 8px; }
.chart-range { display: flex; gap: 6px; margin-top: 12px; }
.chart-range button {
  background: #1d1913; color: #9a9385; border: 0; border-radius: 99px;
  font: 600 12px system-ui; padding: 5px 12px; cursor: pointer;
}
.chart-range button.on { background: var(--accent, #E8A93C); color: #100E0A; }
```

> Se `style.css` non definisce `--accent`, il fallback `#E8A93C` (amber del progetto) tiene il colore corretto. `.focus-top` qui è ridefinita come flex con il pulsante spinto a destra da `margin-left:auto` su `.focus-chart`; verifica nel Task 5 che ← e nome restino allineati.

- [ ] **Step 4: Commit**

```powershell
cd C:\Users\TomasCoro\gym-schedule
git fetch; git pull
git add index.html style.css
git commit -m "feat: markup pulsante progressione + dialog grafico" -m "Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Task 4: Rendering del grafico e wiring in `app.js`

**Files:**
- Modify: `app.js` (import da `session.js`; stato; nuove funzioni; wiring in `init`)

- [ ] **Step 1: Importa gli helper**

In `app.js`, trova l'import da `./session.js` e aggiungi `topSetSeries` e `chartGeometry` alla lista dei nomi importati. (Cerca `from "./session.js"` e inserisci i due nomi tra le graffe esistenti.)

- [ ] **Step 2: Aggiungi lo stato del dialog**

Vicino alle altre variabili di stato in alto (es. dopo `let supersetTab = "a";`, ~riga 29), aggiungi:

```js
// Stato del dialog progressione
let chartExId = null;   // id esercizio mostrato
let chartTrack = null;  // null | "a" | "b"
let chartAll = false;   // false = ultime 3 settimane, true = tutto lo storico
```

- [ ] **Step 3: Aggiungi le funzioni di rendering**

In `app.js`, vicino alle altre funzioni che costruiscono SVG/DOM (es. prima di `wireSetDialog`), aggiungi:

```js
const SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function shortWeek(key) {
  // "2026-W22" -> "W22"; "2026-W22.1" -> "W22"
  const m = String(key).match(/W\d{2}/);
  return m ? m[0] : String(key);
}

// Costruisce l'SVG del grafico a linea da una serie [{week,kg}].
function renderChart(series) {
  const W = 260, H = 150;
  const g = chartGeometry(series, { width: W, height: H });
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg" });
  // gridlines + label asse Y (dataMax in alto, dataMin in basso)
  for (const tick of g.yTicks) {
    svg.appendChild(svgEl("line", { x1: 34, y1: tick.y, x2: 252, y2: tick.y, stroke: "#241f16", "stroke-width": 1 }));
    const lbl = svgEl("text", { x: 28, y: tick.y + 3, fill: "#6f6857", "font-size": 10, "text-anchor": "end" });
    lbl.textContent = String(tick.value);
    svg.appendChild(lbl);
  }
  // area sfumata sotto la linea
  if (g.points.length > 1) {
    const last = g.points[g.points.length - 1], first = g.points[0];
    const area = svgEl("polyline", {
      points: `${g.polyline} ${last.x},124 ${first.x},124`,
      fill: "#E8A93C", opacity: 0.08,
    });
    svg.appendChild(area);
    svg.appendChild(svgEl("polyline", {
      points: g.polyline, fill: "none", stroke: "#E8A93C",
      "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round",
    }));
  }
  // diradamento label X: al massimo ~6 etichette
  const n = g.points.length;
  const step = Math.max(1, Math.ceil(n / 6));
  g.points.forEach((p, i) => {
    const isLast = i === n - 1;
    svg.appendChild(svgEl("circle", {
      cx: p.x, cy: p.y, r: isLast ? 4.5 : 4,
      fill: isLast ? "#E8A93C" : "#100E0A",
      stroke: "#E8A93C", "stroke-width": isLast ? 0 : 2.5,
    }));
    const val = svgEl("text", {
      x: p.x, y: p.y - 8, fill: isLast ? "#E8A93C" : "#EDE6D8",
      "font-size": isLast ? 11 : 10, "font-weight": isLast ? 700 : 600, "text-anchor": "middle",
    });
    val.textContent = String(p.kg);
    svg.appendChild(val);
    if (i % step === 0 || isLast) {
      const xl = svgEl("text", {
        x: p.x, y: 142, fill: isLast ? "#EDE6D8" : "#9a9385",
        "font-size": 10, "font-weight": isLast ? 600 : 400, "text-anchor": "middle",
      });
      xl.textContent = shortWeek(p.week);
      svg.appendChild(xl);
    }
  });
  return svg;
}

// Ridisegna corpo + controllo intervallo del dialog in base allo stato.
function renderChartDialog() {
  const body = document.getElementById("chartBody");
  const range = document.getElementById("chartRange");
  document.getElementById("chartTitle").textContent = chartTitle();
  body.textContent = "";
  range.textContent = "";
  const full = topSetSeries(data, currentDay, chartExId, currentWeek, chartTrack);
  if (full.length === 0) {
    const p = document.createElement("div");
    p.className = "chart-empty";
    p.textContent = "Nessuno storico ancora";
    body.appendChild(p);
    return;
  }
  const series = chartAll ? full : full.slice(-3);
  body.appendChild(renderChart(series));
  if (series.length === 1) {
    const note = document.createElement("div");
    note.className = "chart-note";
    note.textContent = "Serve più di una settimana per vedere il trend";
    body.appendChild(note);
  }
  // controllo intervallo: solo se c'è più storico delle 3 mostrate
  if (full.length > 3) {
    const mk = (label, all) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (chartAll === all) b.classList.add("on");
      b.addEventListener("click", () => { chartAll = all; renderChartDialog(); });
      return b;
    };
    range.appendChild(mk("3 sett.", false));
    range.appendChild(mk("tutto lo storico", true));
  }
}

function chartTitle() {
  const ex = dayPlan().exercises.find((e) => e.id === chartExId);
  if (!ex) return "Progressione";
  return chartTrack ? `${ex.name} · ${chartTrack.toUpperCase()}` : ex.name;
}

// Apre il dialog progressione per un esercizio/traccia.
function openChartDialog(exId, track) {
  chartExId = exId;
  chartTrack = track;
  chartAll = false;
  renderChartDialog();
  const dlg = document.getElementById("chartDialog");
  if (!dlg.open) dlg.showModal();
}
```

- [ ] **Step 4: Wiring del pulsante e del dialog in `init`**

In `app.js`, dentro `init` accanto agli altri `addEventListener` (es. dopo la riga `document.getElementById("focusBack")...`, ~riga 1610), aggiungi:

```js
  document.getElementById("chartBtn").addEventListener("click", () => {
    if (openIndex === null) return;
    const ex = dayPlan().exercises[openIndex];
    if (!ex) return;
    openChartDialog(ex.id, ex.superset ? supersetTab : null);
  });
  document.getElementById("chartClose").addEventListener("click", () => document.getElementById("chartDialog").close());
  document.getElementById("chartDialog").addEventListener("click", (e) => {
    if (e.target.id === "chartDialog") e.target.close(); // tap sul backdrop
  });
```

- [ ] **Step 5: Esegui i test (nessuna regressione attesa)**

Run: `node --test`
Expected: PASS — la suite resta verde (la logica pura non è cambiata in questo task).

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\TomasCoro\gym-schedule
git fetch; git pull
git add app.js
git commit -m "feat: rendering grafico progressione + wiring dialog 📈" -m "Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Task 5: Bump cache + verifica browser

**Files:**
- Modify: `sw.js` (riga 5)

- [ ] **Step 1: Bump della cache**

In `sw.js`, cambia la riga 5:

```js
const CACHE = "gymsched-v20";
```

in:

```js
const CACHE = "gymsched-v21";
```

> `SHELL` resta invariato: `session.js` e `app.js` ci sono già, non c'è nessun file nuovo.

- [ ] **Step 2: Esegui i test**

Run: `node --test`
Expected: PASS — suite verde (le 9 prove aggiunte in Task 1-2 incluse, totale 137 → 146).

- [ ] **Step 3: Verifica in browser (Playwright, origine pulita)**

Avvia un server statico su una porta NON usata prima (per evitare il SW vecchio cache-first), es. `npx http-server -p 8801` in `C:\Users\TomasCoro\gym-schedule`, e con Playwright:
- Apri `http://localhost:8801`, vai in un giorno con storico (es. A, Panca con W22).
- Apri l'esercizio (focus), clicca **📈**: il dialog mostra la linea con i kg reali.
- Se ci sono >3 settimane: clicca **"tutto lo storico"** → l'asse X si espande; "3 sett." torna alle ultime 3.
- Apri un superset (es. Curl EZ + Skullcrusher), seleziona sotto-tab **B**, clicca 📈 → titolo `… · B`, grafico della sola traccia B.
- Chiudi con ✕ / Escape / tap-fuori.
- Controlla la console: **0 errori** (404 favicon innocuo).

> Gotcha cache noto: il SW no-skipWaiting può servire `index.html`/moduli vecchi. Usa una porta nuova o deregistra il SW + svuota le cache prima di testare l'app-shell.

- [ ] **Step 4: Commit**

```powershell
cd C:\Users\TomasCoro\gym-schedule
git fetch; git pull
git add sw.js
git commit -m "chore: bump cache a gymsched-v21 (vista progressione)" -m "Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push
```

---

## Self-Review (compilato)

- **Spec coverage:** punto d'accesso 📈 (Task 3+4) · metrica top-set kg (`topSetSeries`, Task 1) · superset traccia attiva (`track` param + wiring `supersetTab`, Task 1+4) · asse X ultime 3 + espansione (`chartAll`/`chart-range`, Task 4) · stile linea variante A (`renderChart`, Task 4) · SVG inline senza dipendenze ✓ · stati 0/1 settimana (Task 4) · test `topSetSeries`/`chartGeometry` (Task 1-2) · cache v21 (Task 5) · verifica browser (Task 5). Nessun requisito scoperto.
- **Placeholder scan:** nessun TBD/TODO; ogni step ha codice/comando concreto.
- **Type consistency:** `topSetSeries(data, day, exId, weekKey, track)` e `chartGeometry(series, opts)` con `{points, polyline, yTicks, min, max}` usati coerentemente in `renderChart`/`renderChartDialog`. Stato `chartExId`/`chartTrack`/`chartAll` e funzioni `openChartDialog`/`renderChartDialog`/`chartTitle`/`renderChart`/`svgEl`/`shortWeek` coerenti tra Task 4 e wiring Task 4 step 4.
