# Controllo sessione + icona graphite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare alla PWA set.log un controllo esplicito della sessione (avvia/pausa/annulla), il tempo totale dentro l'overlay esercizio, un recupero ripristinabile (la ✕ non distrugge ma collassa in chip), e un'icona graphite con safe-area iOS.

**Architecture:** La logica pura del cronometro sessione (normalizzazione voce, tempo trascorso, macchina a stati) vive in `timer.js` (dove già abita `withoutSession`) ed è testata in Node. `app.js` è il glue DOM: legge `gymsched_session` (localStorage, separato da `data`), costruisce lo slot `#sessClock` a 4 stati e aggiorna 1×/s sia la home sia, se aperto, l'overlay. Il timer di recupero riusa `RestTimer.pause/resume` (nessuna modifica logica a `timer.js`): la ✕ collassa in una chip `#timerResume`. L'icona è ricolorata in graphite e i PNG rigenerati via Playwright (niente dipendenze native).

**Tech Stack:** Vanilla JS ESM, `node --test` (test puri), localStorage, Service Worker (cache versionata), Playwright MCP (rasterizzazione icona).

**Spec di riferimento:** `docs/superpowers/specs/2026-06-10-controllo-sessione-design.md`

---

## File Structure

| File | Responsabilità in questo piano |
|---|---|
| `timer.js` | **NUOVE funzioni pure** `normalizeSessionEntry` / `elapsedMs` / `sessionState`, accanto a `withoutSession`. Nessuna modifica a `RestTimer`. |
| `tests/timer.test.js` | Test per le 3 nuove funzioni pure. |
| `app.js` | Glue: forma dati estesa, `startSession`/`pauseSession`/`resumeSession`, `endSessionClock`/`startSessionIfAbsent` aggiornate, `renderSessClock`→`renderSessionControl` (4 stati), `tickSessionDisplays`, `renderFocusOverlay` (⏱ in status bar), `collapseRest`/`expandRest`/`discardRest` + rewire `tStop`, import esteso. |
| `index.html` | `#timerResume` dentro `#timerBar`; viewport `viewport-fit=cover`; `theme-color` graphite. |
| `style.css` | Stati slot (`.sc-start`, `.sc-toggle`, `.sessclock.ready`), chip `.t-resume`/`.tr-*`, safe-area sulla timer bar. |
| `icon.svg` | Riscritto in palette graphite (geometria identica). |
| `icon-180.png` / `icon-192.png` / `icon-512.png` | Rigenerati dal nuovo SVG via Playwright. |
| `manifest.json` | `theme_color`/`background_color` graphite + icone PNG. |
| `sw.js` | Bump `CACHE` v71→v72 + nuovi PNG negli `ASSETS`. |

**Nota deviazione dallo spec:** la formula `elapsedMs` è leggermente più pulita di quella nello spec (usa un singolo "punto di riferimento": `end` se finito, `pausedAt` se in pausa, altrimenti `now`). Risultato identico, ma robusta anche se una sessione viene chiusa mentre è in pausa. `endSessionClock` ripiega `pausedAt` in `pausedMs` prima di scrivere `end` (vedi Task 2).

---

## Task 1: Funzioni pure del cronometro sessione (timer.js)

**Files:**
- Modify: `timer.js` (dopo `withoutSession`, ~riga 111)
- Test: `tests/timer.test.js`

- [ ] **Step 1: Scrivi i test che falliscono**

In `tests/timer.test.js`, **estendi la riga di import** (riga 3) e **aggiungi i test in fondo al file**.

Cambia la riga 3 da:

```js
import { formatTime, remainingSeconds, withoutSession, goSlug, VisibleCountdown } from "../timer.js";
```

a:

```js
import { formatTime, remainingSeconds, withoutSession, goSlug, VisibleCountdown, normalizeSessionEntry, elapsedMs, sessionState } from "../timer.js";
```

Aggiungi in fondo al file:

```js
// ---- Cronometro sessione: voce {start,end,pausedAt,pausedMs} ----
const T0 = Date.parse("2026-06-10T10:00:00.000Z");

test("normalizeSessionEntry: voce assente -> zeri", () => {
  assert.deepEqual(normalizeSessionEntry(undefined), { start: null, end: null, pausedAt: null, pausedMs: 0 });
  assert.deepEqual(normalizeSessionEntry(null), { start: null, end: null, pausedAt: null, pausedMs: 0 });
  assert.deepEqual(normalizeSessionEntry({}), { start: null, end: null, pausedAt: null, pausedMs: 0 });
});

test("normalizeSessionEntry: voce legacy {start,end} -> pausedAt null, pausedMs 0", () => {
  assert.deepEqual(
    normalizeSessionEntry({ start: "2026-06-10T10:00:00.000Z", end: null }),
    { start: "2026-06-10T10:00:00.000Z", end: null, pausedAt: null, pausedMs: 0 },
  );
});

test("normalizeSessionEntry: pausedMs non numerico -> 0; voce completa passa", () => {
  assert.equal(normalizeSessionEntry({ start: "x", pausedMs: "boh" }).pausedMs, 0);
  assert.deepEqual(
    normalizeSessionEntry({ start: "s", end: "e", pausedAt: "p", pausedMs: 123 }),
    { start: "s", end: "e", pausedAt: "p", pausedMs: 123 },
  );
});

test("sessionState deriva i 4 stati dalla voce", () => {
  assert.equal(sessionState(undefined), "PRONTO");
  assert.equal(sessionState({}), "PRONTO");
  assert.equal(sessionState({ start: "2026-06-10T10:00:00.000Z" }), "IN_CORSO");
  assert.equal(sessionState({ start: "2026-06-10T10:00:00.000Z", pausedAt: "2026-06-10T10:05:00.000Z" }), "IN_PAUSA");
  assert.equal(sessionState({ start: "2026-06-10T10:00:00.000Z", end: "2026-06-10T10:30:00.000Z" }), "FINITO");
});

test("elapsedMs: in corso = now - start (meno pause accumulate)", () => {
  const e = { start: "2026-06-10T10:00:00.000Z", end: null, pausedAt: null, pausedMs: 0 };
  assert.equal(elapsedMs(e, T0 + 600_000), 600_000);
  assert.equal(elapsedMs({ ...e, pausedMs: 60_000 }, T0 + 600_000), 540_000);
});

test("elapsedMs: in pausa congela a pausedAt (ignora now)", () => {
  const e = { start: "2026-06-10T10:00:00.000Z", end: null, pausedAt: "2026-06-10T10:05:00.000Z", pausedMs: 0 };
  assert.equal(elapsedMs(e, T0 + 600_000), 300_000); // 5 min, non 10
  assert.equal(elapsedMs(e, T0 + 999_000), 300_000); // resta congelato
  assert.equal(elapsedMs({ ...e, pausedMs: 60_000 }, T0 + 600_000), 240_000);
});

test("elapsedMs: finito = end - start - pausedMs; legacy ok; clamp >=0", () => {
  assert.equal(elapsedMs({ start: "2026-06-10T10:00:00.000Z", end: "2026-06-10T10:30:00.000Z", pausedMs: 120_000 }, T0 + 9e9), 1_680_000);
  assert.equal(elapsedMs({ start: "2026-06-10T10:00:00.000Z", end: "2026-06-10T10:10:00.000Z" }, T0), 600_000); // legacy
  assert.equal(elapsedMs(undefined, T0), 0);
  assert.equal(elapsedMs({ start: "2026-06-10T10:00:00.000Z", pausedMs: 9e12 }, T0 + 1000), 0); // clamp
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `npm test`
Expected: FAIL — `normalizeSessionEntry is not a function` (o simili: `elapsedMs`/`sessionState` non esportate).

- [ ] **Step 3: Implementa le 3 funzioni in timer.js**

In `timer.js`, subito **dopo** la funzione `withoutSession` (dopo la `}` di riga 111), aggiungi:

```js
// ---- Cronometro sessione (gymsched_session): voce { start, end, pausedAt, pausedMs }.
//      Funzioni pure (niente DOM/localStorage) così sono testabili in Node. ----

// Normalizza una voce (anche legacy {start,end}) alla forma canonica a 4 campi.
export function normalizeSessionEntry(entry) {
  if (!entry || typeof entry !== "object" || !entry.start) {
    return { start: null, end: null, pausedAt: null, pausedMs: 0 };
  }
  return {
    start: entry.start,
    end: entry.end ?? null,
    pausedAt: entry.pausedAt ?? null,
    pausedMs: Number(entry.pausedMs) || 0,
  };
}

// Millisecondi di allenamento effettivo: dal start a un "punto di riferimento"
// (end se finito, pausedAt se in pausa, altrimenti now), meno le pause accumulate.
export function elapsedMs(entry, nowMs) {
  const c = normalizeSessionEntry(entry);
  if (!c.start) return 0;
  const ref = c.end ? Date.parse(c.end) : c.pausedAt ? Date.parse(c.pausedAt) : nowMs;
  return Math.max(0, ref - Date.parse(c.start) - c.pausedMs);
}

// Macchina a stati derivata dalla sola voce.
export function sessionState(entry) {
  const c = normalizeSessionEntry(entry);
  if (!c.start) return "PRONTO";
  if (c.end) return "FINITO";
  if (c.pausedAt) return "IN_PAUSA";
  return "IN_CORSO";
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `npm test`
Expected: PASS — tutta la suite verde (i test esistenti + i nuovi).

- [ ] **Step 5: Commit**

```bash
git add timer.js tests/timer.test.js
git commit -m "feat(sessione): helper puri cronometro (normalize/elapsed/state)"
```

---

## Task 2: Forma dati estesa + azioni avvio/pausa/ripresa (app.js)

**Files:**
- Modify: `app.js:33` (import), `app.js:1392-1411` (`startSessionIfAbsent`, `endSessionClock`, `cancelSessionClock`), aggiunta nuove funzioni.

Queste funzioni toccano `localStorage`/DOM: si verificano col run completo della suite (deve restare verde) + verifica manuale finale (Task 9). Nessun test puro nuovo qui.

- [ ] **Step 1: Estendi l'import da timer.js**

`app.js:33`, cambia:

```js
import { RestTimer, formatTime, withoutSession, goSlug, VisibleCountdown } from "./timer.js";
```

in:

```js
import { RestTimer, formatTime, withoutSession, goSlug, VisibleCountdown, normalizeSessionEntry, elapsedMs, sessionState } from "./timer.js";
```

- [ ] **Step 2: Aggiorna `startSessionIfAbsent` (inizializza i nuovi campi)**

`app.js:1392-1395`, sostituisci:

```js
function startSessionIfAbsent() {
  const m = getSessionMap(); const k = sessClockKey();
  if (!m[k] || !m[k].start) { m[k] = { start: new Date().toISOString(), end: null }; setSessionMap(m); }
}
```

con:

```js
function startSessionIfAbsent() {
  const m = getSessionMap(); const k = sessClockKey();
  if (!m[k] || !m[k].start) { m[k] = { start: new Date().toISOString(), end: null, pausedAt: null, pausedMs: 0 }; setSessionMap(m); }
}

// Avvio esplicito dal bottone "Avvia allenamento" (stato PRONTO).
function startSession() {
  const m = getSessionMap(); const k = sessClockKey();
  m[k] = { start: new Date().toISOString(), end: null, pausedAt: null, pausedMs: 0 };
  setSessionMap(m);
  renderSessionControl();
}

// Mette in pausa: marca pausedAt (solo se in corso).
function pauseSession() {
  const m = getSessionMap(); const k = sessClockKey();
  const c = m[k];
  if (c && c.start && !c.end && !c.pausedAt) { c.pausedAt = new Date().toISOString(); setSessionMap(m); renderSessionControl(); }
}

// Riprende: ripiega l'intervallo di pausa in pausedMs e azzera pausedAt.
function resumeSession() {
  const m = getSessionMap(); const k = sessClockKey();
  const c = m[k];
  if (c && c.pausedAt) {
    c.pausedMs = (Number(c.pausedMs) || 0) + (Date.now() - Date.parse(c.pausedAt));
    c.pausedAt = null;
    setSessionMap(m);
    renderSessionControl();
  }
}
```

- [ ] **Step 3: Aggiorna `endSessionClock` (ripiega pausedAt prima di chiudere)**

`app.js:1396-1399`, sostituisci:

```js
function endSessionClock() {
  const m = getSessionMap(); const k = sessClockKey();
  if (m[k] && m[k].start && !m[k].end) { m[k].end = new Date().toISOString(); setSessionMap(m); renderSessClock(); }
}
```

con:

```js
function endSessionClock() {
  const m = getSessionMap(); const k = sessClockKey();
  const c = m[k];
  if (c && c.start && !c.end) {
    if (c.pausedAt) { c.pausedMs = (Number(c.pausedMs) || 0) + (Date.now() - Date.parse(c.pausedAt)); c.pausedAt = null; }
    c.end = new Date().toISOString();
    setSessionMap(m);
    renderSessionControl();
  }
}
```

- [ ] **Step 4: Aggiorna la chiamata in `cancelSessionClock`**

`app.js:1409-1412`, sostituisci:

```js
function cancelSessionClock() {
  setSessionMap(withoutSession(getSessionMap(), sessClockKey()));
  renderSessClock();
}
```

con:

```js
function cancelSessionClock() {
  setSessionMap(withoutSession(getSessionMap(), sessClockKey()));
  renderSessionControl();
}
```

> Nota: `renderSessionControl` è definita nel Task 3. Tra Task 2 e Task 3 il file ha un riferimento a una funzione non ancora rinominata — non eseguire il commit del Task 2 senza il Task 3. **Esegui Task 2 e Task 3 di seguito, un solo commit a fine Task 3.**

- [ ] **Step 5: (Nessun commit qui — prosegui col Task 3)**

---

## Task 3: `renderSessClock` → `renderSessionControl` (4 stati) + CSS

**Files:**
- Modify: `app.js:1413-1437` (la funzione), `app.js:3771` (l'intervallo — vedi Task 4), `style.css:589-597`.

- [ ] **Step 1: Sostituisci `renderSessClock` con `renderSessionControl`**

`app.js:1413-1437`, sostituisci l'intera funzione `renderSessClock` con:

```js
function renderSessionControl() {
  const el = document.getElementById("sessClock");
  if (!el) return;
  // Piano vuoto → nessuno slot (l'empty-state guida la creazione).
  if (planIsEmpty(data)) { el.replaceChildren(); el.classList.add("hidden"); return; }

  const entry = getSessionMap()[sessClockKey()];
  const state = sessionState(entry);
  el.classList.remove("hidden");
  el.classList.toggle("ended", state === "FINITO");
  el.classList.toggle("ready", state === "PRONTO");

  if (state === "PRONTO") {
    const go = document.createElement("button");
    go.type = "button";
    go.className = "sc-start";
    go.textContent = "▶ Avvia allenamento";
    go.addEventListener("click", (e) => { e.stopPropagation(); startSession(); });
    el.replaceChildren(go);
    return;
  }

  const secs = elapsedMs(entry, Date.now()) / 1000;
  const prefix = state === "FINITO" ? "⏱ allenamento " : state === "IN_PAUSA" ? "⏸ in pausa · " : "● in corso · ";
  const txt = document.createElement("span");
  txt.className = "sc-t";
  txt.id = "sessClockText";
  txt.textContent = prefix + fmtDuration(secs);
  el.replaceChildren(txt);

  if (state === "FINITO") return; // congelato, nessun controllo

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "sc-toggle";
  toggle.textContent = state === "IN_PAUSA" ? "▶" : "⏸";
  toggle.setAttribute("aria-label", state === "IN_PAUSA" ? "Riprendi allenamento" : "Pausa allenamento");
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    if (sessionState(getSessionMap()[sessClockKey()]) === "IN_PAUSA") resumeSession();
    else pauseSession();
  });

  const x = document.createElement("button");
  x.type = "button";
  x.className = "sc-x";
  x.textContent = "✕";
  x.setAttribute("aria-label", "Annulla cronometro");
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm("Annullare il cronometro di questo allenamento? Le serie loggate restano salvate.")) cancelSessionClock();
  });

  el.append(toggle, x);
}
```

- [ ] **Step 2: Aggiorna la chiamata dentro `render()`**

`app.js:3060`, cambia:

```js
  renderSessClock();
```

in:

```js
  renderSessionControl();
```

> A questo punto cerca eventuali altri riferimenti residui: `grep -n "renderSessClock" app.js` deve restituire **0 risultati** (tutte le chiamate sono ora `renderSessionControl`; l'intervallo a riga ~3771 viene gestito nel Task 4).

- [ ] **Step 3: CSS per i nuovi stati dello slot**

In `style.css`, **dopo** la riga 597 (`.sc-x:hover,.sc-x:focus-visible{opacity:1;}`), aggiungi:

```css
/* PRONTO: bottone pieno (niente chip attorno) */
.sessclock.ready{background:none;border:none;padding:0;}
.sc-start{font-family:"JetBrains Mono",monospace;font-size:13px;font-weight:700;letter-spacing:.04em;
  color:var(--acc-ink);background:var(--acc);border:none;border-radius:9px;padding:10px 18px;cursor:pointer;min-height:42px;}
.sc-start:active{transform:translateY(1px);}
/* Pausa/Riprendi: stesso stile di .sc-x */
.sc-toggle{margin-left:8px;display:inline-flex;align-items:center;justify-content:center;
  min-width:24px;min-height:24px;padding:2px 4px;border:0;background:none;cursor:pointer;
  color:inherit;font-size:13px;line-height:1;opacity:.8;}
.sc-toggle:hover,.sc-toggle:focus-visible{opacity:1;}
```

- [ ] **Step 4: Verifica che la suite resti verde (regressione)**

Run: `npm test`
Expected: PASS — nessun test importa `app.js` (è l'entry DOM), quindi la suite deve restare invariata e verde. Conferma di non aver rotto `timer.js`/import.

- [ ] **Step 5: Commit (copre Task 2 + Task 3)**

```bash
git add app.js style.css
git commit -m "feat(sessione): avvio/pausa/annulla nello slot cronometro (4 stati)"
```

---

## Task 4: Tempo totale nell'overlay + tick unico 1s (app.js)

**Files:**
- Modify: `app.js:3019-3022` (`renderFocusOverlay`), aggiunta `tickSessionDisplays`, `app.js:3771` (intervallo).

- [ ] **Step 1: Inietta il tempo nella status bar dell'overlay**

`app.js:3019-3022`, sostituisci:

```js
  const ctxEl = document.getElementById("focusSbarCtx");
  const cntEl = document.getElementById("focusSbarCount");
  if (ctxEl) ctxEl.textContent = `◈ LOG · ${currentDay}`;
  if (cntEl) cntEl.textContent = `ex ${String(openIndex + 1).padStart(2, "0")}/${exsForBar.length} · ${currentWeek.split("-").pop()}`;
```

con:

```js
  const ctxEl = document.getElementById("focusSbarCtx");
  const cntEl = document.getElementById("focusSbarCount");
  if (ctxEl) ctxEl.textContent = `◈ LOG · ${currentDay}`;
  if (cntEl) {
    const entry = getSessionMap()[sessClockKey()];
    const clk = document.createElement("span");
    clk.id = "focusSbarClock";
    clk.textContent = sessionState(entry) === "PRONTO" ? "" : "⏱ " + fmtDuration(elapsedMs(entry, Date.now()) / 1000) + " · ";
    const rest = document.createElement("span");
    rest.textContent = `ex ${String(openIndex + 1).padStart(2, "0")}/${exsForBar.length}`;
    cntEl.replaceChildren(clk, rest);
  }
```

- [ ] **Step 2: Aggiungi `tickSessionDisplays` (home + solo-tempo overlay)**

`app.js`, subito **dopo** la fine di `renderSessionControl` (la `}` aggiunta nel Task 3), aggiungi:

```js
// Tick 1s: aggiorna lo slot home e, se l'overlay è aperto, solo il testo del
// tempo nella status bar (niente re-render dell'intero overlay ogni secondo).
function tickSessionDisplays() {
  renderSessionControl();
  if (openIndex !== null) {
    const clk = document.getElementById("focusSbarClock");
    if (clk) {
      const entry = getSessionMap()[sessClockKey()];
      clk.textContent = sessionState(entry) === "PRONTO" ? "" : "⏱ " + fmtDuration(elapsedMs(entry, Date.now()) / 1000) + " · ";
    }
  }
}
```

- [ ] **Step 3: Punta l'intervallo 1s a `tickSessionDisplays`**

`app.js:3771`, cambia:

```js
setInterval(renderSessClock, 1000);
```

in:

```js
setInterval(tickSessionDisplays, 1000);
```

- [ ] **Step 4: Verifica suite + assenza riferimenti orfani**

Run: `npm test`
Expected: PASS.
Run: `grep -n "renderSessClock" app.js`
Expected: **nessun output** (tutto rinominato).

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat(sessione): tempo totale nella status bar dell'overlay (tick 1s unico)"
```

---

## Task 5: Recupero ripristinabile — chip collassabile (index.html, app.js, style.css)

**Files:**
- Modify: `index.html:487-491` (dentro `#timerBar`), `app.js` (`dismissTimerGo` ~1555, `startRest` ~1577, `wireTimerControls` ~3262, nuove funzioni), `style.css` (dopo riga 237).

- [ ] **Step 1: Aggiungi il sotto-stato `#timerResume` nel DOM**

`index.html`, dentro `#timerBar`, **dopo** il blocco `#timerGo` che chiude a riga 491 (`</div>`) e **prima** della `</div>` di chiusura di `#timerBar` (riga 492), inserisci:

```html
    <div id="timerResume" class="t-resume hidden">
      <button id="resumeOpen" class="tr-open" type="button">
        <span class="tr-ic">▸</span> recupero in pausa · <span id="resumeTime">0:00</span>
        <span class="tr-go">riprendi ›</span>
      </button>
      <button id="resumeDiscard" class="tr-x" type="button" aria-label="Chiudi recupero">×</button>
    </div>
```

Risultato (contesto): `#timerBar` contiene ora, nell'ordine, `#timerRun`, `#timerGo`, `#timerResume`.

- [ ] **Step 2: Nascondi la chip negli azzeramenti di stato della barra**

`app.js`, in `dismissTimerGo` (riga 1555-1564), aggiungi una riga prima della `}` finale (dopo `wakeLock.disable();`):

```js
  document.getElementById("timerResume").classList.add("hidden");
```

`app.js`, in `startRest` (riga 1566-1580), **dopo** `document.getElementById("timerRun").classList.remove("hidden");` (riga 1572) aggiungi:

```js
  document.getElementById("timerResume").classList.add("hidden");
```

(così avviare un nuovo recupero non lascia mai una chip "riprendi" orfana.)

- [ ] **Step 3: Aggiungi `collapseRest` / `expandRest` / `discardRest`**

`app.js`, subito **prima** di `function startRest(` (riga 1566), aggiungi:

```js
// ✕ sul recupero: NON distrugge. Mette in pausa il timer e collassa la barra
// nella chip "riprendi" (resti in recupero: wakeLock attivo, barra visibile slim).
function collapseRest() {
  timer.pause(); // no-op se già in pausa (es. arrivati qui da ⏸)
  document.getElementById("timerRun").classList.add("hidden");
  document.getElementById("resumeTime").textContent = formatTime(timer.pausedRemaining);
  document.getElementById("timerResume").classList.remove("hidden");
  document.body.classList.remove("scroll-lock");
}

// Tap sulla chip: riapre il recupero e riprende il conto.
function expandRest() {
  document.getElementById("timerResume").classList.add("hidden");
  document.getElementById("timerRun").classList.remove("hidden");
  document.getElementById("tToggle").textContent = "⏸";
  document.body.classList.add("scroll-lock");
  timer.resume();
}

// × sulla chip: chiusura vera (vecchio comportamento di tStop).
function discardRest() {
  document.getElementById("timerResume").classList.add("hidden");
  timer.stop();
  hideFeelAsk();
  dismissTimerGo();
}
```

- [ ] **Step 4: Riconnetti `tStop` a `collapseRest` e aggiungi i bottoni della chip**

`app.js`, in `wireTimerControls`, sostituisci l'handler di `tStop` (riga 3262-3266):

```js
  document.getElementById("tStop").addEventListener("click", () => {
    timer.stop();
    hideFeelAsk();
    dismissTimerGo();
  });
```

con:

```js
  document.getElementById("tStop").addEventListener("click", collapseRest);
  document.getElementById("resumeOpen").addEventListener("click", expandRest);
  document.getElementById("resumeDiscard").addEventListener("click", discardRest);
```

- [ ] **Step 5: CSS della chip**

In `style.css`, **dopo** la riga 237 (fine del blocco graphite `.timerbar.go-on::after`), aggiungi:

```css
/* Recupero collassato: chip "riprendi" (la ✕ non distrugge) */
.t-resume{display:flex;align-items:center;gap:10px;}
.tr-open{flex:1;display:flex;align-items:center;gap:8px;min-height:40px;padding:4px 0;
  background:transparent;border:none;cursor:pointer;text-align:left;
  font-family:"JetBrains Mono",monospace;font-size:13px;color:var(--ink);}
.tr-open .tr-ic{color:var(--acc);font-weight:700;}
.tr-open .tr-go{margin-left:auto;color:var(--acc);font-weight:700;}
.tr-x{background:transparent;border:none;color:var(--dim);font-size:18px;line-height:1;cursor:pointer;
  padding:4px 8px;min-width:36px;min-height:36px;}
```

- [ ] **Step 6: Verifica suite**

Run: `npm test`
Expected: PASS (nessuna logica pura toccata; conferma niente errori di sintassi in `app.js`).

- [ ] **Step 7: Commit**

```bash
git add index.html app.js style.css
git commit -m "feat(timer): recupero ripristinabile (la x collassa in chip riprendi)"
```

---

## Task 6: Icona graphite — riscrittura SVG

**Files:**
- Modify: `icon.svg` (riscrittura completa, geometria identica)

- [ ] **Step 1: Riscrivi `icon.svg` con la palette graphite**

Sostituisci l'intero contenuto di `icon.svg` con (stessa geometria dell'attuale, solo colori cambiati):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <radialGradient id="vign" cx="50%" cy="44%" r="62%">
      <stop offset="44%" stop-color="#222831"/>
      <stop offset="100%" stop-color="#12151a"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#vign)"/>
  <g fill="#f0a73c">
    <rect x="150" y="191" width="40" height="130" rx="16"/>
    <rect x="322" y="191" width="40" height="130" rx="16"/>
    <rect x="104" y="215" width="30" height="82" rx="12"/>
    <rect x="378" y="215" width="30" height="82" rx="12"/>
  </g>
  <g stroke="#f0a73c" stroke-width="7" stroke-linecap="round">
    <line x1="190" y1="244" x2="228" y2="244"/>
    <line x1="190" y1="268" x2="228" y2="268"/>
    <line x1="284" y1="244" x2="322" y2="244"/>
    <line x1="284" y1="268" x2="322" y2="268"/>
  </g>
  <g fill="#f0a73c">
    <rect x="236" y="214" width="8" height="14" rx="2"/>
    <rect x="252" y="214" width="8" height="14" rx="2"/>
    <rect x="268" y="214" width="8" height="14" rx="2"/>
    <rect x="236" y="284" width="8" height="14" rx="2"/>
    <rect x="252" y="284" width="8" height="14" rx="2"/>
    <rect x="268" y="284" width="8" height="14" rx="2"/>
  </g>
  <rect x="228" y="228" width="56" height="56" rx="6" fill="#12151a" stroke="#f0a73c" stroke-width="7"/>
  <rect x="246" y="246" width="20" height="20" rx="4" fill="#f0a73c"/>
</svg>
```

- [ ] **Step 2: Commit**

```bash
git add icon.svg
git commit -m "feat(icona): segno graphite (palette scura, geometria invariata)"
```

---

## Task 7: Rigenera i PNG dell'icona (180/192/512) — SESSIONE PRINCIPALE (Playwright)

> **⚠️ NON delegare a subagent senza Playwright.** Questo task usa il browser MCP per rasterizzare `icon.svg` a dimensioni esatte (canvas → PNG, indipendente dal devicePixelRatio). Eseguilo nella sessione principale.

**Files:**
- Create (temporaneo, gitignored): `mockups/_icon-gen.html`
- Create/Modify: `icon-180.png`, `icon-192.png`, `icon-512.png`

- [ ] **Step 1: Crea la pagina generatrice**

Scrivi `mockups/_icon-gen.html` (incolla **dentro** il file il contenuto esatto del nuovo `icon.svg` dal Task 6, al posto di `<!-- SVG QUI -->`):

```html
<!doctype html><meta charset="utf-8">
<body style="margin:0;background:#000">
<div id="src" hidden><!-- SVG QUI --></div>
<script>
window.renderIcon = async (n) => {
  const svg = document.getElementById('src').innerHTML.trim();
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas'); c.width = n; c.height = n;
  c.getContext('2d').drawImage(img, 0, 0, n, n);
  URL.revokeObjectURL(url);
  return c.toDataURL('image/png').split(',')[1]; // base64 puro
};
</script>
```

- [ ] **Step 2: Avvia un server statico e aprilo in Playwright**

Run (background): `python -m http.server 8777`
Poi con Playwright MCP: `browser_navigate` → `http://127.0.0.1:8777/mockups/_icon-gen.html`

- [ ] **Step 3: Per ogni dimensione, estrai il base64 e scrivi il PNG**

Per `n` in `180`, `192`, `512`:
1. `browser_evaluate` con funzione: `async () => await window.renderIcon(180)` (poi 192, poi 512).
2. Salva la stringa base64 restituita in un file temporaneo (Write tool) `mockups/_b64.txt`.
3. Decodifica in PNG con Node:

```bash
node -e "const fs=require('fs');fs.writeFileSync('icon-180.png',Buffer.from(fs.readFileSync('mockups/_b64.txt','utf8').trim(),'base64'))"
```

(ripeti cambiando `180`→`192`→`512` e il nome file di output).

- [ ] **Step 4: Verifica le dimensioni dei PNG**

```bash
node -e "for(const f of['icon-180.png','icon-192.png','icon-512.png']){const b=require('fs').readFileSync(f);console.log(f,'w',b.readUInt32BE(16),'h',b.readUInt32BE(20))}"
```

Expected:
```
icon-180.png w 180 h 180
icon-192.png w 192 h 192
icon-512.png w 512 h 512
```

- [ ] **Step 5: Pulisci i temporanei e commit**

```bash
rm -f mockups/_b64.txt
git add icon-180.png icon-192.png icon-512.png
git commit -m "feat(icona): rigenera PNG graphite 180/192/512"
```

(`mockups/` è gitignored: `_icon-gen.html` non finisce nel commit.)

---

## Task 8: Wiring icona + safe-area iOS (manifest, index.html, sw.js, style.css)

**Files:**
- Modify: `manifest.json:10-14`, `index.html:5-6`, `sw.js:5,26`, `style.css:207`.

- [ ] **Step 1: `manifest.json` — colori graphite + icone PNG**

Sostituisci `manifest.json:10-14`:

```json
  "background_color": "#ece3d0",
  "theme_color": "#ece3d0",
  "icons": [
    { "src": "./icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }
  ]
```

con:

```json
  "background_color": "#131517",
  "theme_color": "#131517",
  "icons": [
    { "src": "./icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" },
    { "src": "./icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "./icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
```

- [ ] **Step 2: `index.html` — viewport `viewport-fit=cover` + theme-color graphite**

`index.html:5`, cambia:

```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
```

in:

```html
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
```

`index.html:6`, cambia:

```html
  <meta name="theme-color" content="#ece3d0">
```

in:

```html
  <meta name="theme-color" content="#131517">
```

- [ ] **Step 3: `style.css` — safe-area sulla timer bar**

`style.css:206-207`, cambia:

```css
.timerbar{position:relative;background:var(--surf2);border-top:1px solid var(--line);
  padding:14px 18px 16px;backdrop-filter:blur(8px);}
```

in:

```css
.timerbar{position:relative;background:var(--surf2);border-top:1px solid var(--line);
  padding:14px 18px calc(16px + env(safe-area-inset-bottom,0px));backdrop-filter:blur(8px);}
```

- [ ] **Step 4: `sw.js` — bump cache + nuovi asset**

`sw.js:5`, cambia:

```js
const CACHE = "gymsched-v71";
```

in:

```js
const CACHE = "gymsched-v72";
```

`sw.js:26`, dopo `"./icon-180.png",` aggiungi:

```js
  "./icon-192.png",
  "./icon-512.png",
```

- [ ] **Step 5: Verifica JSON valido + suite**

```bash
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'));console.log('manifest OK')"
npm test
```

Expected: `manifest OK` + suite verde.

- [ ] **Step 6: Commit**

```bash
git add manifest.json index.html sw.js style.css
git commit -m "feat(icona): theme graphite + safe-area iOS + bump SW v72"
```

---

## Task 9: Verifica manuale end-to-end (Playwright, cache SW svuotata)

> Verifica nel browser reale. **Trappola nota del repo:** svuotare la cache del Service Worker prima di verificare, altrimenti gira codice stantio.

- [ ] **Step 1: Avvia il server e apri l'app**

`python -m http.server 8777` (se non già attivo), poi `browser_navigate` → `http://127.0.0.1:8777/`.
In DevTools/Application: **Unregister** il SW e **Clear storage**, poi ricarica (per servire `app.js`/`sw.js` v72 freschi).

- [ ] **Step 2: Checklist comportamentale**

- [ ] Home con piano non vuoto, nessuna sessione → slot mostra **▶ Avvia allenamento**.
- [ ] Tap Avvia → stato **● in corso · MM:SS** che scorre, con **⏸** e **✕**.
- [ ] **⏸** → **⏸ in pausa · MM:SS** congelato; **▶** riprende e il tempo riparte dal valore congelato (non salta avanti).
- [ ] **✕** annulla → conferma → slot torna a **▶ Avvia** (le serie loggate restano).
- [ ] Apri un esercizio (overlay): status bar mostra **⏱ MM:SS · ex NN/NN** che scorre senza glitch (niente flicker dell'intero overlay).
- [ ] Avvia un recupero, premi **✕** sulla barra → collassa in **▸ recupero in pausa · M:SS · riprendi ›**; il tempo resta congelato.
- [ ] Tap sulla chip → la barra si riapre e il recupero **riprende** dal valore congelato.
- [ ] **×** sulla chip → recupero chiuso davvero (barra via).
- [ ] ⏸ sulla barra, poi ✕ → collassa comunque in chip (no crash).
- [ ] Completa tutti gli esercizi del giorno → slot passa a **⏱ allenamento MM:SS** (FINITO, congelato).
- [ ] Icona: home screen / favicon graphite (ambra su fondo scuro); su iPhone la timer bar non finisce sotto la home-indicator.

- [ ] **Step 3: Niente da committare** (solo verifica). Se emergono bug → `superpowers:systematic-debugging`.

---

## Self-Review (eseguito in fase di scrittura)

**1. Copertura spec:**
- A1 avvio/pausa/annulla → Task 1 (helper), Task 2 (azioni), Task 3 (UI 4 stati). ✓
- A2 tempo totale overlay → Task 4. ✓
- A3 recupero ripristinabile → Task 5. ✓
- A4 icona graphite → Task 6 (SVG), Task 7 (PNG), Task 8 (manifest/theme); safe-area → Task 8 Step 3; viewport-fit → Task 8 Step 2. ✓
- SW bump v71→v72 → Task 8 Step 4. ✓
- Test puri (`elapsedMs`/`normalize`/stato) → Task 1. ✓
- Verifica manuale → Task 9. ✓
- Rete di sicurezza (auto-start al primo recupero) → preservata: `startRest` continua a chiamare `startSessionIfAbsent` (non toccato), aggiornato solo per inizializzare i nuovi campi (Task 2 Step 2). ✓

**2. Placeholder:** nessuno — ogni step ha codice/comandi completi e output atteso. L'unico `<!-- SVG QUI -->` è un'istruzione esplicita di incollare il blocco del Task 6.

**3. Coerenza tipi/nomi:** `renderSessionControl` usato ovunque (Task 3 rinomina, Task 2/4 lo chiamano); `tickSessionDisplays` definito (Task 4) e cablato all'intervallo; `collapseRest`/`expandRest`/`discardRest` definiti e cablati (Task 5); `#focusSbarClock`, `#timerResume`, `#resumeOpen`, `#resumeDiscard`, `#resumeTime` coerenti tra DOM, CSS e JS; voce dati `{start,end,pausedAt,pausedMs}` coerente tra `normalizeSessionEntry`/azioni/`endSessionClock`.

**Rischio chiave:** ordine Task 2→3 (un solo commit a fine Task 3) per non lasciare `app.js` con un riferimento a `renderSessClock` rinominato a metà.
