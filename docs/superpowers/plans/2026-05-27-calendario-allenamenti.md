# Sezione calendario allenamenti — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una vista calendario mensile che segna i giorni in cui ti sei allenato, con dettaglio (giorno scheda + volume) al tap.

**Architecture:** Si registra la data reale di ogni sessione in `setEntry` (campo additivo `weeks[wk].dates[day]`, set-if-absent). Funzioni pure in `session.js` estraggono le date e costruiscono la griglia del mese. In `app.js` un overlay a schermo intero (stesso pattern history degli altri) rende il calendario. Forward-only: lo storico passato non ha date e non appare nel calendario.

**Tech Stack:** Vanilla JS, `node --test` per la logica pura, History API per l'overlay, CSS con variabili tema. Nessuna dipendenza.

**Prerequisito:** eseguire prima il piano `2026-05-27-fix-back-button-dialog.md` (questo piano modifica il gestore `popstate` nella versione già corretta da quel fix).

Spec: `docs/superpowers/specs/2026-05-27-calendario-allenamenti-design.md`

---

### Task 1: Cattura della data in setEntry

**Files:**
- Modify: `store.js:25-32` (`setEntry`)
- Test: `tests/store.test.js`

- [ ] **Step 1: Test che fallisce**

Aggiungere in `tests/store.test.js` (dopo i test esistenti di `setEntry`):

```js
test("setEntry registra la data della sessione (set-if-absent)", () => {
  let d = setEntry(emptyData(), "2026-W22", "A", 0, "60kg", "2026-05-25T10:00:00Z");
  assert.equal(d.weeks["2026-W22"].dates.A, "2026-05-25");
  // un secondo log lo stesso giorno-scheda NON sovrascrive la prima data
  d = setEntry(d, "2026-W22", "A", 1, "62kg", "2026-05-26T09:00:00Z");
  assert.equal(d.weeks["2026-W22"].dates.A, "2026-05-25");
  // giorno-scheda diverso -> data propria
  d = setEntry(d, "2026-W22", "B", 0, "stacco", "2026-05-27T09:00:00Z");
  assert.equal(d.weeks["2026-W22"].dates.B, "2026-05-27");
});
```

- [ ] **Step 2: Verificare che fallisca**

Run: `cd C:\Users\TomasCoro\gym-schedule; npm test`
Expected: FAIL (`d.weeks[...].dates` è `undefined`).

- [ ] **Step 3: Implementare la cattura**

In `store.js`, sostituire `setEntry`:

```js
export function setEntry(data, weekKey, day, exIndex, value, nowIso) {
  const next = structuredClone(data);
  if (!next.weeks[weekKey]) next.weeks[weekKey] = { label: weekKey, entries: {} };
  if (!next.weeks[weekKey].entries[day]) next.weeks[weekKey].entries[day] = {};
  next.weeks[weekKey].entries[day][String(exIndex)] = value;
  // Data reale della sessione (set-if-absent): resta quella della prima serie
  // loggata per quel giorno-scheda. Campo additivo per il calendario.
  if (nowIso) {
    if (!next.weeks[weekKey].dates) next.weeks[weekKey].dates = {};
    if (next.weeks[weekKey].dates[day] == null) {
      next.weeks[weekKey].dates[day] = nowIso.slice(0, 10);
    }
  }
  next.updatedAt = nowIso ?? new Date().toISOString();
  return next;
}
```

- [ ] **Step 4: Verificare che passi**

Run: `npm test`
Expected: PASS — tutti i test (148+) verdi. (I `deepEqual` esistenti non si rompono: confrontano `emptyData`/`ensureWeek` senza `dates`, o `data` con sé stesso.)

- [ ] **Step 5: Commit**

```bash
git add store.js tests/store.test.js
git commit -m "feat: setEntry registra la data reale della sessione (calendario)"
```

---

### Task 2: Funzione pura sessionDates

**Files:**
- Modify: `session.js` (nuova export)
- Test: `tests/session.test.js`

- [ ] **Step 1: Test che fallisce**

Aggiungere in `tests/session.test.js` l'import e i test. Estendere l'import esistente da `session.js` aggiungendo `sessionDates, monthGrid`:

```js
import { sessionDates, monthGrid } from "../session.js";
```

Test:

```js
test("sessionDates: estrae le date da weeks[].dates, ordinate per data", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", 0, "x", "2026-05-25T08:00:00Z");
  d = setEntry(d, "2026-W21", "B", 0, "y", "2026-05-20T08:00:00Z");
  assert.deepEqual(sessionDates(d), [
    { date: "2026-05-20", weekKey: "2026-W21", day: "B" },
    { date: "2026-05-25", weekKey: "2026-W22", day: "A" },
  ]);
});

test("sessionDates: ignora le settimane senza dates (storico vecchio)", () => {
  const d = { updatedAt: null, weeks: { "2025-W10": { label: "x", entries: { A: { "0": "v" } } } } };
  assert.deepEqual(sessionDates(d), []);
});
```

- [ ] **Step 2: Verificare che fallisca**

Run: `npm test`
Expected: FAIL (`sessionDates` non esportata).

- [ ] **Step 3: Implementare**

In `session.js` aggiungere:

```js
// Tutte le sessioni datate: [{ date:"YYYY-MM-DD", weekKey, day }], ordinate per
// data crescente. Ignora le settimane senza `dates` (storico pre-calendario).
export function sessionDates(data) {
  const out = [];
  for (const [weekKey, week] of Object.entries(data?.weeks ?? {})) {
    if (!week?.dates) continue;
    for (const [day, date] of Object.entries(week.dates)) {
      out.push({ date, weekKey, day });
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}
```

- [ ] **Step 4: Verificare che passi**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add session.js tests/session.test.js
git commit -m "feat: sessionDates pura per estrarre le date di allenamento"
```

---

### Task 3: Funzione pura monthGrid

**Files:**
- Modify: `session.js` (nuova export)
- Test: `tests/session.test.js`

- [ ] **Step 1: Test che fallisce**

Aggiungere in `tests/session.test.js`:

```js
test("monthGrid: maggio 2026 (mese 0-based = 4) inizia di venerdì", () => {
  const g = monthGrid(2026, 4); // 1 maggio 2026 è venerdì (Lun=0 -> col 4)
  for (const w of g) assert.equal(w.length, 7);     // 7 celle per riga
  assert.equal(g[0][3], null);                      // gio = vuoto
  assert.equal(g[0][4], "2026-05-01");              // ven = giorno 1
  const flat = g.flat().filter(Boolean);
  assert.equal(flat.length, 31);                    // maggio ha 31 giorni
  assert.equal(flat[0], "2026-05-01");
  assert.equal(flat[30], "2026-05-31");
});

test("monthGrid: febbraio 2024 (bisestile) ha 29 giorni", () => {
  const flat = monthGrid(2024, 1).flat().filter(Boolean);
  assert.equal(flat.length, 29);
  assert.equal(flat[28], "2024-02-29");
});
```

- [ ] **Step 2: Verificare che fallisca**

Run: `npm test`
Expected: FAIL (`monthGrid` non esportata).

- [ ] **Step 3: Implementare**

In `session.js` aggiungere:

```js
// Griglia del mese: array di righe, ogni riga 7 celle allineate Lun→Dom.
// Cella = "YYYY-MM-DD" per i giorni del mese, null per il padding ai bordi.
// month è 0-based (come Date.getMonth()).
export function monthGrid(year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startCol = (new Date(year, month, 1).getDay() + 6) % 7; // Lun=0..Dom=6
  const mm = String(month + 1).padStart(2, "0");
  const cells = [];
  for (let i = 0; i < startCol; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${year}-${mm}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
```

- [ ] **Step 4: Verificare che passi**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add session.js tests/session.test.js
git commit -m "feat: monthGrid pura per la griglia mensile del calendario"
```

---

### Task 4: Markup e stile dell'overlay calendario

**Files:**
- Modify: `index.html` (pulsante header ~riga 32; nuovo overlay dopo `#planOverlay` ~riga 116)
- Modify: `style.css` (nuovi stili calendario)

- [ ] **Step 1: Aggiungere il pulsante 📅 nell'header**

In `index.html`, nella `.week-row`, dopo `#nutritionBtn` (riga ~32):

```html
      <button id="calendarBtn" class="btn-icon" aria-label="Calendario">📅</button>
```

- [ ] **Step 2: Aggiungere l'overlay calendario**

In `index.html`, dopo la chiusura di `#planOverlay` (riga ~116), prima dei `<dialog>`:

```html
  <!-- Calendario allenamenti a schermo intero -->
  <div id="calendarOverlay" class="focus-ov hidden" aria-hidden="true">
    <header class="focus-top">
      <button id="calendarBack" class="focus-back" aria-label="Chiudi calendario">←</button>
      <div class="focus-id">
        <div class="fn">Calendario</div>
        <div id="calSub" class="fs">i tuoi allenamenti</div>
      </div>
    </header>
    <div class="cal-nav">
      <button id="calPrev" class="btn-soft" aria-label="Mese precedente">‹</button>
      <div id="calTitle" class="cal-title"></div>
      <button id="calNext" class="btn-soft" aria-label="Mese successivo">›</button>
    </div>
    <div id="calGrid" class="cal-grid"></div>
    <div id="calDetail" class="cal-detail"></div>
  </div>
```

- [ ] **Step 3: Aggiungere gli stili**

In `style.css` (in fondo):

```css
.cal-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; }
.cal-title { flex: 1 1 auto; text-align: center; font-weight: 600; text-transform: capitalize; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; padding: 0 12px; }
.cal-dow { text-align: center; font-size: .72rem; color: var(--dim); padding: 4px 0; }
.cal-cell { aspect-ratio: 1 / 1; display: flex; align-items: center; justify-content: center;
  border-radius: 8px; font-size: .85rem; background: var(--surf2); color: var(--fg); }
.cal-cell.empty { background: transparent; }
.cal-cell.trained { background: var(--acc); color: var(--bg); font-weight: 600; cursor: pointer; }
.cal-cell.sel { outline: 2px solid var(--fg); }
.cal-detail { padding: 12px; color: var(--fg); min-height: 1.5em; }
.cal-detail .empty { color: var(--dim); }
```

> Se in `style.css` la variabile del testo non è `--fg`, usare quella reale del tema (controllare le altre regole: es. `--acc/--dim/--surf2/--bg`).

- [ ] **Step 4: Sanity test**

Run: `npm test`
Expected: PASS (nessun test toccato; verifica che nulla si sia rotto).

- [ ] **Step 5: Commit**

```bash
git add index.html style.css
git commit -m "feat: markup e stile dell'overlay calendario"
```

---

### Task 5: Logica overlay calendario in app.js

**Files:**
- Modify: `app.js` (nuove funzioni vicino agli altri overlay ~righe 83-96; wiring nel boot; gestore `popstate`)

- [ ] **Step 1: Aggiungere stato e funzioni open/close/render**

In `app.js`, dopo le funzioni `closePlanEditor`/`renderPlanEditor` (~riga 96+), aggiungere. Verificare che `sessionDates`, `monthGrid` siano importati da `session.js` e `sessionVolume` già lo sia; aggiungerli all'import esistente se mancano:

```js
// ---- Calendario allenamenti: overlay a schermo intero (stessa logica history). ----
let calendarOpen = false;
let calYear = 0, calMonth = 0;   // mese visualizzato (month 0-based)
let calSelected = null;          // "YYYY-MM-DD" del giorno selezionato, o null

function openCalendar() {
  calendarOpen = true;
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  calSelected = null;
  history.pushState({ gymCalendar: true }, "");
  renderCalendar();
}
function closeCalendar() {
  if (!calendarOpen) return;
  if (history.state && history.state.gymCalendar) history.back(); // → popstate chiude
  else { calendarOpen = false; renderCalendar(); }
}
function calShiftMonth(delta) {
  const d = new Date(calYear, calMonth + delta, 1);
  calYear = d.getFullYear();
  calMonth = d.getMonth();
  calSelected = null;
  renderCalendar();
}

const CAL_MONTHS = ["gennaio","febbraio","marzo","aprile","maggio","giugno",
  "luglio","agosto","settembre","ottobre","novembre","dicembre"];

function renderCalendar() {
  const ov = document.getElementById("calendarOverlay");
  if (!calendarOpen) {
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");
    if (openIndex === null && !nutritionOpen && !planOpen) document.body.style.overflow = "";
    return;
  }
  document.getElementById("calTitle").textContent = `${CAL_MONTHS[calMonth]} ${calYear}`;

  const sessions = sessionDates(data);
  const byDate = new Map();
  for (const s of sessions) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }

  const grid = document.getElementById("calGrid");
  grid.textContent = "";
  for (const dow of ["L","M","M","G","V","S","D"]) {
    const h = document.createElement("div");
    h.className = "cal-dow"; h.textContent = dow;
    grid.appendChild(h);
  }
  for (const week of monthGrid(calYear, calMonth)) {
    for (const date of week) {
      const cell = document.createElement("div");
      if (date === null) { cell.className = "cal-cell empty"; grid.appendChild(cell); continue; }
      cell.className = "cal-cell";
      cell.textContent = String(Number(date.slice(8, 10)));
      if (byDate.has(date)) {
        cell.classList.add("trained");
        if (date === calSelected) cell.classList.add("sel");
        cell.addEventListener("click", () => { calSelected = date; renderCalendar(); });
      }
      grid.appendChild(cell);
    }
  }
  renderCalendarDetail(byDate.get(calSelected) || null);

  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function renderCalendarDetail(sessions) {
  const box = document.getElementById("calDetail");
  box.textContent = "";
  if (!sessions || !sessions.length) {
    const p = document.createElement("div");
    p.className = "empty";
    p.textContent = "Tocca un giorno colorato per i dettagli.";
    box.appendChild(p);
    return;
  }
  for (const s of sessions) {
    const dayPlan = planDays().find((d) => d.day === s.day);
    const vol = Math.round(sessionVolume(data, s.weekKey, s.day, dayPlan));
    const row = document.createElement("div");
    row.textContent = `${s.date} — giorno ${s.day} · volume ${vol} kg`;
    box.appendChild(row);
  }
}
```

> Nota: `planDays()` e `sessionVolume(data, weekKey, day, dayPlan)` esistono già in app.js/session.js. Se `sessionVolume` o le funzioni pure non sono nell'import da `session.js` in cima ad app.js, aggiungerle.

- [ ] **Step 2: Wiring del pulsante e delle frecce nel boot**

Nel boot di `app.js`, vicino al wiring di `#nutritionBtn`/`#planEditBtn` (cercare `getElementById("nutritionBtn")`), aggiungere:

```js
  document.getElementById("calendarBtn").addEventListener("click", openCalendar);
  document.getElementById("calendarBack").addEventListener("click", closeCalendar);
  document.getElementById("calPrev").addEventListener("click", () => calShiftMonth(-1));
  document.getElementById("calNext").addEventListener("click", () => calShiftMonth(1));
```

- [ ] **Step 3: Aggiungere calendarOpen al gestore popstate**

Nel gestore `popstate` (già modificato dal fix back-button), aggiungere la chiusura del calendario nella sezione overlay (dopo `planOpen`):

```js
    if (planOpen) { planOpen = false; renderPlanEditor(); }
    if (calendarOpen) { calendarOpen = false; renderCalendar(); }
```

> Il calendario non apre dialog sopra di sé, quindi NON serve aggiungerlo al ramo di ri-push del dialog.

- [ ] **Step 4: Sanity test**

Run: `npm test`
Expected: PASS (logica pura invariata).

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat: overlay calendario con griglia mensile e dettaglio al tap"
```

---

### Task 6: Bump cache service worker

**Files:**
- Modify: `sw.js:5`

- [ ] **Step 1: Bump versione cache**

Cambiare `const CACHE = "gymsched-v22";` in `const CACHE = "gymsched-v23";`
(se il fix back-button non fosse ancora stato shippato, partire dal valore corrente di `CACHE` e incrementarlo di 1).

- [ ] **Step 2: Commit**

```bash
git add sw.js
git commit -m "chore: bump cache a gymsched-v23 (calendario allenamenti)"
```

---

### Task 7: Verifica browser (Playwright MCP)

**Files:** nessuno (solo verifica)

- [ ] **Step 1: Servire l'app su porta pulita**

Run (PowerShell, background): `cd C:\Users\TomasCoro\gym-schedule; python -m http.server 8099`

- [ ] **Step 2: Iniettare uno storico con date e aprire**

`browser_navigate` a `http://localhost:8099/`. Per avere giorni segnati nel mese corrente, loggare almeno una serie tramite la UI (apre un esercizio → conferma una serie con peso/reps), così `setEntry` stampa la data odierna. In alternativa iniettare via `localStorage` `gymsched_pending` un log con l'id canonico letto da `data.json` (vedi memory: `migrate` idempotente su schema 2).

- [ ] **Step 3: Aprire il calendario**

Tap su `📅` (#calendarBtn). Atteso: #calendarOverlay visibile, titolo = mese corrente, il giorno di oggi colorato (`.cal-cell.trained`).

- [ ] **Step 4: Verificare il dettaglio al tap**

Tap sul giorno colorato. Atteso: in #calDetail compare una riga `YYYY-MM-DD — giorno A · volume N kg`, e la cella ha la classe `sel`.

- [ ] **Step 5: Verificare navigazione mese e tasto indietro**

Tap `‹`/`›` → cambia mese, selezione azzerata. Poi `history.back()` (o `←`) → il calendario si chiude tornando alla vista principale.

- [ ] **Step 6: Fermare il server**

Chiudere il processo `http.server`.

---

## Self-Review

- **Spec coverage:** cattura data in setEntry/set-if-absent (Task 1); `sessionDates` forward-only ignora storico (Task 2); `monthGrid` (Task 3); markup+CSS overlay e pulsante 📅 (Task 4); open/close/render+popstate+dettaglio volume via `sessionVolume` (Task 5); cache bump (Task 6); verifica Playwright (Task 7). Tap→dettaglio (A/B/C + volume, sola lettura) coperto. ✓
- **Placeholder scan:** nessun TBD/TODO; codice completo. Le due note "verificare nome variabile tema / import" sono istruzioni di adattamento al codice reale, non placeholder di logica. ✓
- **Type consistency:** `sessionDates`→`{date,weekKey,day}` usato coerentemente in `renderCalendar`/`renderCalendarDetail`; `monthGrid(year, month)` 0-based usato con `calMonth`; id DOM (`calTitle`, `calGrid`, `calDetail`, `calendarBtn`, `calendarBack`, `calPrev`, `calNext`) coerenti tra HTML (Task 4) e JS (Task 5). ✓
