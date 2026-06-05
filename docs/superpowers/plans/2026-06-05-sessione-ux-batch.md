# Batch "Sessione UX" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementare il batch di 10 richieste UX sulla sessione di allenamento (spec `docs/superpowers/specs/2026-06-05-sessione-ux-batch-design.md`): override volume ×2 e dischi-per-lato per esercizio, media wger + chip REC nel focus, commenti su serie fatte, timer GO auto-dismiss con linea che si scarica, scroll-lock, fix overlap, empty-state Scan a boot-log.

**Architecture:** Logica pura nei moduli testabili (`session.js`, `timer.js`, `body.js`), integrazione UI in `app.js`/`index.html`/`style.css`. Pattern esistenti: override per-traccia stile `unit`/`unitB`, funzioni pure che ritornano stringhe HTML (come `renderBody`), dialog `<dialog>` riusati (`openQcDialog`). Nessun bump di schema dati: campi opzionali con derivazione quando assenti.

**Tech Stack:** Vanilla JS ES modules, `node --test` + `node:assert` per i test, PWA con SW cache-first.

**Branch:** `feat/sessione-ux` (worktree isolato via superpowers:using-git-worktrees).

**Comandi:** test: `npm test` (dalla root del worktree). Niente build step.

---

### Task 1: `volumeMeta` con override `vol2`/`vol2B`

**Files:**
- Modify: `session.js:286-301` (`isDumbbell`, `volumeMeta`)
- Test: `tests/session.test.js` (append)

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in fondo a `tests/session.test.js`:

```js
// ---- Task 1 batch sessione-ux: override vol2/vol2B ----
test("volumeMeta: vol2=true forza factor 2 anche senza 'manubri' nel nome", () => {
  const ex = { name: "Affondo bulgaro", vol2: true };
  assert.equal(volumeMeta(ex, null).factor, 2);
});

test("volumeMeta: vol2=false forza factor 1 anche con 'manubri' nel nome", () => {
  const ex = { name: "Lento avanti manubri", vol2: false };
  assert.equal(volumeMeta(ex, null).factor, 1);
});

test("volumeMeta: vol2 assente -> derivazione dal nome (comportamento attuale)", () => {
  assert.equal(volumeMeta({ name: "Lento avanti manubri" }, null).factor, 2);
  assert.equal(volumeMeta({ name: "Panca piana bilanciere" }, null).factor, 1);
});

test("volumeMeta: vol2B override sulla traccia B del superset", () => {
  const ex = { name: "Pushdown + Curl a corpo libero", superset: true, vol2B: true };
  assert.equal(volumeMeta(ex, "a").factor, 1);
  assert.equal(volumeMeta(ex, "b").factor, 2);
});
```

Verificare che `volumeMeta` sia già negli import in testa al file di test; se manca aggiungerlo all'import da `../session.js`.

- [ ] **Step 2: Eseguire i test e verificarli FAIL**

Run: `npm test`
Expected: i 2 test con override FALLISCONO (factor derivato dal nome, override ignorato); gli altri passano.

- [ ] **Step 3: Implementazione minima**

In `session.js` sostituire `volumeMeta` (righe 292-301) con:

```js
// Nome della singola traccia di un esercizio ("A + B" nei superset).
function trackName(ex, track) {
  const name = String(ex?.name ?? "");
  const [nameA, nameB] = name.includes(" + ") ? name.split(" + ") : [name, name];
  return track === "b" ? nameB : nameA;
}

// Fattore volume (1 o 2) e unità ("reps"|"sec") di una traccia di un esercizio.
// track: null/"a" = traccia normale/A ; "b" = traccia B del superset.
// Override esplicito ex.vol2 / ex.vol2B (boolean); assente -> derivazione dal
// nome traccia (manubri = ×2, regex isDumbbell).
export function volumeMeta(ex, track) {
  const ov = track === "b" ? ex?.vol2B : ex?.vol2;
  const unit = (track === "b" ? ex?.unitB : ex?.unit) === "sec" ? "sec" : "reps";
  const factor = typeof ov === "boolean"
    ? (ov ? 2 : 1)
    : (isDumbbell(trackName(ex, track)) ? 2 : 1);
  return { factor, unit };
}
```

- [ ] **Step 4: Eseguire i test e verificarli PASS**

Run: `npm test`
Expected: tutti PASS (anche i 373 esistenti: la derivazione di default è invariata).

- [ ] **Step 5: Commit**

```bash
git add session.js tests/session.test.js
git commit -m "feat(volume): override vol2/vol2B per esercizio in volumeMeta"
```

---

### Task 2: `platesOn(ex, track)` — quando mostrare la riga "per lato"

**Files:**
- Modify: `session.js` (subito dopo `volumeMeta`)
- Test: `tests/session.test.js` (append)

- [ ] **Step 1: Scrivere i test che falliscono**

```js
// ---- Task 2 batch sessione-ux: platesOn ----
test("platesOn: derivazione dal nome (bilanciere/stacco/squat/EZ)", () => {
  assert.equal(platesOn({ name: "Panca piana bilanciere" }, null), true);
  assert.equal(platesOn({ name: "Stacco rumeno" }, null), true);
  assert.equal(platesOn({ name: "Squat" }, null), true);
  assert.equal(platesOn({ name: "Curl EZ" }, null), true);
  assert.equal(platesOn({ name: "Pulldown presa larga" }, null), false);
  assert.equal(platesOn({ name: "Lento avanti manubri" }, null), false);
});

test("platesOn: bar impostato -> true anche senza match sul nome", () => {
  assert.equal(platesOn({ name: "Curl strano", bar: 10 }, null), true);
});

test("platesOn: override esplicito vince su derivazione", () => {
  assert.equal(platesOn({ name: "Panca piana bilanciere", plates: false }, null), false);
  assert.equal(platesOn({ name: "Affondo bulgaro", plates: true }, null), true);
});

test("platesOn: traccia B del superset con platesB", () => {
  const ex = { name: "Pushdown + Skullcrusher", superset: true, platesB: true };
  assert.equal(platesOn(ex, "a"), false);
  assert.equal(platesOn(ex, "b"), true);
});
```

Aggiungere `platesOn` all'import da `../session.js` in testa al file di test.

- [ ] **Step 2: Eseguire i test e verificarli FAIL**

Run: `npm test`
Expected: FAIL con "platesOn is not a function" (o import error).

- [ ] **Step 3: Implementazione minima**

In `session.js`, subito dopo `volumeMeta`:

```js
// True se la traccia mostra la riga "per lato" (calcolo dischi). Override
// esplicito ex.plates / ex.platesB; assente -> bar impostato oppure nome
// traccia che indica un bilanciere (bilanciere/stacco/squat/EZ).
export function platesOn(ex, track) {
  const ov = track === "b" ? ex?.platesB : ex?.plates;
  if (typeof ov === "boolean") return ov;
  if (typeof ex?.bar === "number" && Number.isFinite(ex.bar) && ex.bar > 0) return true;
  return /bilancier|stacco|squat|\bez\b/i.test(trackName(ex, track));
}
```

- [ ] **Step 4: Eseguire i test e verificarli PASS**

Run: `npm test`
Expected: tutti PASS.

- [ ] **Step 5: Commit**

```bash
git add session.js tests/session.test.js
git commit -m "feat(plates): platesOn per-esercizio con override plates/platesB"
```

---

### Task 3: roundtrip `dehydrate`/`hydrate` dei nuovi campi (regression lock)

**Files:**
- Test: `tests/sheets.test.js` (append)

`dehydrate`/`hydrate` clonano `plan` con `structuredClone`, quindi i campi nuovi sopravvivono già. Questo test è una **characterization** che blocca regressioni future (es. una futura whitelist di campi): passa subito, e va bene così.

- [ ] **Step 1: Scrivere il test**

```js
// ---- Batch sessione-ux: i campi vol2/plates sopravvivono al roundtrip ----
test("dehydrate/hydrate: vol2, vol2B, plates, platesB restano sugli esercizi", () => {
  const mem = hydrate(null); // scheda vuota
  mem.plan = [{ day: "A", title: "Test", exercises: [
    { id: "x1", name: "Affondo bulgaro", setsReps: "3 × 10", recText: "90 sec",
      restSeconds: 90, superset: false, vol2: true, plates: false },
    { id: "x2", name: "Curl + Skull", setsReps: "3 × 10 / 3 × 10", recText: "75 sec",
      restSeconds: 75, superset: true, vol2: false, vol2B: true, plates: true, platesB: true },
  ] }];
  const back = hydrate(dehydrate(mem));
  const [e1, e2] = back.plan[0].exercises;
  assert.equal(e1.vol2, true);
  assert.equal(e1.plates, false);
  assert.equal(e2.vol2, false);
  assert.equal(e2.vol2B, true);
  assert.equal(e2.plates, true);
  assert.equal(e2.platesB, true);
});
```

Verificare gli import di `hydrate`/`dehydrate` in testa a `tests/sheets.test.js` (esistono già per i test attuali).

- [ ] **Step 2: Eseguire i test e verificarli PASS**

Run: `npm test`
Expected: PASS subito (comportamento già garantito da structuredClone).

- [ ] **Step 3: Commit**

```bash
git add tests/sheets.test.js
git commit -m "test(sheets): lock roundtrip dehydrate dei campi vol2/plates"
```

---

### Task 4: `VisibleCountdown` in `timer.js` (8 s a schermo visibile)

**Files:**
- Modify: `timer.js` (append dopo la classe `RestTimer`)
- Test: `tests/timer.test.js` (append)

- [ ] **Step 1: Scrivere i test che falliscono**

```js
// ---- Batch sessione-ux: VisibleCountdown (auto-dismiss GO) ----
// Fake timer: cattura callback+delay, fire manuale.
function fakeTimers() {
  const pending = new Map();
  let seq = 0;
  return {
    setTimer: (fn, ms) => { const id = ++seq; pending.set(id, { fn, ms }); return id; },
    clearTimer: (id) => pending.delete(id),
    pending,
    fire(id) { const p = pending.get(id); pending.delete(id); p.fn(); },
  };
}

test("VisibleCountdown: scade dopo durationMs se visibile", () => {
  const ft = fakeTimers();
  let done = 0;
  const c = new VisibleCountdown({ durationMs: 8000, onDone: () => done++,
    now: () => 1000, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  c.start(true);
  assert.equal(ft.pending.size, 1);
  const [[id, p]] = ft.pending.entries();
  assert.equal(p.ms, 8000);
  ft.fire(id);
  assert.equal(done, 1);
  assert.equal(c.active, false);
});

test("VisibleCountdown: hide congela il tempo residuo, show riparte da lì", () => {
  const ft = fakeTimers();
  let t = 1000;
  let done = 0;
  const c = new VisibleCountdown({ durationMs: 8000, onDone: () => done++,
    now: () => t, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  c.start(true);
  t = 4000; // 3 s passati
  c.hide();
  assert.equal(ft.pending.size, 0); // timer cancellato
  assert.equal(c.remaining, 5000);
  assert.equal(done, 0);
  t = 99000; // il tempo nascosto NON conta
  c.show();
  assert.equal(ft.pending.size, 1);
  const [[, p]] = ft.pending.entries();
  assert.equal(p.ms, 5000);
});

test("VisibleCountdown: start(false) parte in pausa; cancel azzera", () => {
  const ft = fakeTimers();
  const c = new VisibleCountdown({ durationMs: 8000, onDone: () => {},
    now: () => 0, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  c.start(false); // schermo nascosto al via
  assert.equal(ft.pending.size, 0);
  assert.equal(c.active, true);
  c.show();
  assert.equal(ft.pending.size, 1);
  c.cancel();
  assert.equal(ft.pending.size, 0);
  assert.equal(c.active, false);
});
```

Aggiungere `VisibleCountdown` all'import da `../timer.js`.

- [ ] **Step 2: Eseguire i test e verificarli FAIL**

Run: `npm test`
Expected: FAIL con "VisibleCountdown is not a constructor" (o import error).

- [ ] **Step 3: Implementazione minima**

In `timer.js`, dopo la classe `RestTimer`:

```js
// ---- Countdown "a tempo visibile": scade dopo durationMs di schermo acceso.
//      hide() congela il residuo (document.hidden), show() riparte. Side effect
//      e clock iniettabili per i test. Usato per l'auto-dismiss dello stato GO. ----
export class VisibleCountdown {
  constructor({ durationMs = 8000, onDone = () => {}, now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) } = {}) {
    this.durationMs = durationMs;
    this.onDone = onDone;
    this._now = now; this._setTimer = setTimer; this._clearTimer = clearTimer;
    this.remaining = durationMs;
    this.active = false;
    this._startedAt = null;
    this._id = null;
  }

  start(visible = true) {
    this.cancel();
    this.active = true;
    this.remaining = this.durationMs;
    if (visible) this._resume();
  }

  show() { if (this.active && this._startedAt === null) this._resume(); }

  hide() {
    if (!this.active || this._startedAt === null) return;
    this.remaining = Math.max(0, this.remaining - (this._now() - this._startedAt));
    this._startedAt = null;
    if (this._id !== null) { this._clearTimer(this._id); this._id = null; }
  }

  cancel() {
    if (this._id !== null) this._clearTimer(this._id);
    this._id = null; this._startedAt = null; this.active = false;
  }

  _resume() {
    this._startedAt = this._now();
    this._id = this._setTimer(() => {
      this._id = null; this._startedAt = null; this.active = false;
      this.onDone();
    }, this.remaining);
  }
}
```

- [ ] **Step 4: Eseguire i test e verificarli PASS**

Run: `npm test`
Expected: tutti PASS.

- [ ] **Step 5: Commit**

```bash
git add timer.js tests/timer.test.js
git commit -m "feat(timer): VisibleCountdown per auto-dismiss a tempo visibile"
```

---

### Task 5: `scanBootLog` in `body.js` (empty-state Scan)

**Files:**
- Modify: `body.js` (append in fondo)
- Test: `tests/body.test.js` (append)

- [ ] **Step 1: Scrivere i test che falliscono**

```js
// ---- Batch sessione-ux: boot-log esplicativo per Scan vuoto ----
test("scanBootLog week: comando, stato e spiegazione reset lunedì", () => {
  const html = scanBootLog("week", { wTag: "W23" });
  assert.ok(html.includes("$ scan --week W23"));
  assert.ok(html.includes("0 serie loggate"));
  assert.ok(html.includes("lunedì"));
  assert.ok(html.includes("scan-boot")); // classe contenitore
});

test("scanBootLog fresh: spiega acceso/spento e tratteggio mai allenato", () => {
  const html = scanBootLog("fresh", {});
  assert.ok(html.includes("$ scan --fresh"));
  assert.ok(html.includes("mai allenato"));
  assert.ok(html.includes("tratteggio"));
});

test("scanBootLog: include la mini legenda primario/secondario", () => {
  const html = scanBootLog("week", { wTag: "W01" });
  assert.ok(html.includes("primario"));
  assert.ok(html.includes("secondario"));
});
```

Aggiungere `scanBootLog` all'import da `../body.js`.

- [ ] **Step 2: Eseguire i test e verificarli FAIL**

Run: `npm test`
Expected: FAIL con import/function error.

- [ ] **Step 3: Implementazione minima**

In fondo a `body.js`:

```js
// Boot-log esplicativo per lo Scan senza dati (mockup scan-empty.html variante B).
// Stringa HTML pura; palette X-ray fissa coerente col pannello. Il chiamante lo
// mostra SOLO quando il tab è vuoto e attenua la figura.
export function scanBootLog(tab, { wTag = "" } = {}) {
  const cmd = tab === "week" ? `$ scan --week ${wTag}` : "$ scan --fresh";
  const stato = tab === "week"
    ? `<span class="sb-amber">▸ 0 serie loggate</span> <span class="sb-dim">— figura in standby</span>`
    : `<span class="sb-amber">▸ nessuno storico recente</span> <span class="sb-dim">— figura in standby</span>`;
  const corpo = tab === "week"
    ? `<span class="sb-dim">▸ come funziona:</span><br>` +
      `&nbsp;&nbsp;completa una serie → il muscolo si accende<br>` +
      `&nbsp;&nbsp;<span class="sb-amber">ambra</span> = volume della settimana <span class="sb-dim">(reset lunedì)</span><br>` +
      `&nbsp;&nbsp;<span class="sb-blue">blu</span> = lavoro secondario`
    : `<span class="sb-dim">▸ come funziona:</span><br>` +
      `&nbsp;&nbsp;acceso = allenato da poco · spento = sta recuperando<br>` +
      `&nbsp;&nbsp;tratteggio rosso = gruppo mai allenato`;
  const legenda =
    `<div class="sb-leg">` +
    `<span><i class="sb-dot" style="background:${X.amber}"></i>primario</span>` +
    `<span><i class="sb-dot" style="background:${X.blue}"></i>secondario</span>` +
    `<span><i class="sb-dot" style="border:1px dashed ${X.down}"></i>mai</span>` +
    `</div>`;
  return `<div class="scan-boot"><div class="sb-cmd">${cmd}</div>` +
    `<div class="sb-body">${stato}<br>${corpo}</div>${legenda}</div>`;
}
```

- [ ] **Step 4: Eseguire i test e verificarli PASS**

Run: `npm test`
Expected: tutti PASS.

- [ ] **Step 5: Commit**

```bash
git add body.js tests/body.test.js
git commit -m "feat(scan): scanBootLog, empty-state esplicativo stile terminale"
```

---

### Task 6: editor — chip-toggle `VOL ×2` / `DISCHI/LATO` nel dialog esercizio

**Files:**
- Modify: `index.html:383-384` (dopo il campo `exBar`, prima del checkbox superset)
- Modify: `app.js:1156-1218` (`toggleMuscleB`, `openExDialog`, `readExDialog`) e `app.js:1139-1144` (`buildPlanRow` riga sub)
- Modify: `style.css` (append)

UI senza logica nuova testabile (la logica è `volumeMeta`/`platesOn`, già coperte). Verifica manuale a fine task.

- [ ] **Step 1: Markup chip in `index.html`**

Dopo l'input `exBar` (riga 383) e PRIMA del checkbox superset, inserire:

```html
    <span class="editlabel">Opzioni carico</span>
    <div class="ex-chips">
      <button type="button" id="exVol2" class="ex-chip">VOL ×2</button>
      <button type="button" id="exPlates" class="ex-chip">DISCHI/LATO</button>
    </div>
    <div class="ex-chips" id="exChipsB" style="display:none">
      <button type="button" id="exVol2B" class="ex-chip">B · VOL ×2</button>
      <button type="button" id="exPlatesB" class="ex-chip">B · DISCHI/LATO</button>
    </div>
```

- [ ] **Step 2: Stile chip in `style.css`** (append, sezione editor)

```css
/* Batch sessione-ux: chip-toggle "opzioni carico" nel dialog esercizio */
.ex-chips{display:flex;gap:8px;margin:4px 0 10px;}
.ex-chip{border:1px solid var(--line);background:transparent;color:var(--dim);
  font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.06em;
  padding:7px 10px;border-radius:4px;cursor:pointer;min-height:32px;}
.ex-chip.on{border-color:var(--acc);color:var(--acc);
  background:color-mix(in srgb,var(--acc) 12%,transparent);}
```

- [ ] **Step 3: Wiring in `app.js`**

Sopra `openExDialog` aggiungere helper e stato:

```js
// Chip-toggle "opzioni carico" del dialog esercizio. Finché l'utente non tocca
// una chip, i valori seguono la derivazione automatica dal form (nome/bar/SS).
let exChipsTouched = false;
const setChip = (id, on) => document.getElementById(id).classList.toggle("on", !!on);
const chipOn = (id) => document.getElementById(id).classList.contains("on");
function exDialogProbe() {
  const barRaw = document.getElementById("exBar").value.trim();
  const b = parseFloat(barRaw.replace(",", "."));
  return {
    name: document.getElementById("exName").value.trim(),
    superset: document.getElementById("exSuperset").checked,
    ...(Number.isFinite(b) && b > 0 ? { bar: b } : {}),
  };
}
function applyChipDefaults() {
  if (exChipsTouched) return;
  const probe = exDialogProbe();
  setChip("exVol2", volumeMeta(probe, null).factor === 2);
  setChip("exPlates", platesOn(probe, null));
  setChip("exVol2B", volumeMeta(probe, "b").factor === 2);
  setChip("exPlatesB", platesOn(probe, "b"));
}
```

In `openExDialog`, dopo la riga `toggleMuscleB(...)` aggiungere:

```js
  document.getElementById("exChipsB").style.display = (ex && ex.superset) ? "" : "none";
  if (ex) {
    setChip("exVol2", typeof ex.vol2 === "boolean" ? ex.vol2 : volumeMeta(ex, null).factor === 2);
    setChip("exPlates", typeof ex.plates === "boolean" ? ex.plates : platesOn(ex, null));
    setChip("exVol2B", typeof ex.vol2B === "boolean" ? ex.vol2B : volumeMeta(ex, "b").factor === 2);
    setChip("exPlatesB", typeof ex.platesB === "boolean" ? ex.platesB : platesOn(ex, "b"));
    // Campi espliciti già salvati: la derivazione non li deve più toccare.
    exChipsTouched = [ex.vol2, ex.plates, ex.vol2B, ex.platesB].some((v) => typeof v === "boolean");
  } else {
    exChipsTouched = false;
    applyChipDefaults();
  }
```

In `readExDialog`, prima del `return ex;` aggiungere:

```js
  // Chip "opzioni carico": sempre esplicite al salvataggio (spec §1).
  ex.vol2 = chipOn("exVol2");
  ex.plates = chipOn("exPlates");
  ex.vol2B = superset ? chipOn("exVol2B") : undefined;
  ex.platesB = superset ? chipOn("exPlatesB") : undefined;
```

Nel blocco di init dei listener (dove sono registrati i listener del dialog esercizio — cercare `exDlgSave`), aggiungere una volta:

```js
  for (const id of ["exVol2", "exPlates", "exVol2B", "exPlatesB"]) {
    document.getElementById(id).addEventListener("click", () => {
      document.getElementById(id).classList.toggle("on");
      exChipsTouched = true;
    });
  }
  document.getElementById("exName").addEventListener("input", applyChipDefaults);
  document.getElementById("exBar").addEventListener("input", applyChipDefaults);
  document.getElementById("exSuperset").addEventListener("change", () => {
    document.getElementById("exChipsB").style.display =
      document.getElementById("exSuperset").checked ? "" : "none";
    applyChipDefaults();
  });
```

NOTA: `exSuperset` ha già un listener `change` esistente (per `toggleMuscleB`): aggiungere il nuovo codice a quel listener invece di registrarne un secondo, se presente.

- [ ] **Step 4: Riga sub dell'editor override-aware**

In `buildPlanRow` (app.js:1142) sostituire:

```js
    isDumbbell(ex.name) ? "vol ×2" : "",
```

con:

```js
    (volumeMeta(ex, null).factor === 2 || (ex.superset && volumeMeta(ex, "b").factor === 2)) ? "vol ×2" : "",
```

(import `volumeMeta` già presente in app.js; `platesOn` va aggiunto all'import da `./session.js`.)

- [ ] **Step 5: Test + verifica manuale**

Run: `npm test` → tutti PASS (nessuna logica pura toccata).
Verifica browser (server `python -m http.server 8035`): aprire l'editor scheda →
✎ su un esercizio → le chip riflettono nome/bar; digitare "manubri" nel nome
→ `VOL ×2` si accende da sola; toccare una chip → smette di seguire il nome;
salvare → riaprire → stato conservato. Spuntare Superset → compare la riga B.

- [ ] **Step 6: Commit**

```bash
git add index.html style.css app.js
git commit -m "feat(editor): chip-toggle VOL x2 / DISCHI-LATO per esercizio"
```

---

### Task 7: riga "per lato" condizionata da `platesOn`

**Files:**
- Modify: `app.js` — `buildEditBlock` (def. ~riga 1768) + chiamanti: `renderFocusNormal` (~2417) e `trackBlock`/`renderFocusSuperset` (~2529+)

- [ ] **Step 1: Parametro `showPlates` in `buildEditBlock`**

Alla firma di `buildEditBlock` aggiungere il parametro finale `showPlates = true`.
Dentro, il blocco che crea `platesLine` + `renderPlates` (app.js:1793-1802) diventa condizionale:

```js
    let renderPlates = () => {};
    if (showPlates) {
      const platesLine = document.createElement("div");
      platesLine.className = "plates";
      block.appendChild(platesLine);
      renderPlates = () => {
        const n = parseFloat(String(state.kg).replace(",", "."));
        if (!Number.isFinite(n) || n <= 0) { platesLine.textContent = ""; return; }
        const { perSide, leftover } = platesPerSide(n, { bar, plates: getPlateSet() });
        if (!perSide.length) { platesLine.textContent = `per lato: — (≤ bilanciere ${bar} kg)`; return; }
        platesLine.textContent = `per lato: ${perSide.join(" + ")}` + (leftover > 0 ? `  (+${leftover} scoperto)` : "");
      };
    }
```

(le chiamate interne a `renderPlates()` restano invariate: ora è no-op quando nascosta).

- [ ] **Step 2: Chiamanti**

`renderFocusNormal` (app.js:2417):

```js
    const edit = buildEditBlock(editLabel, draft, prev[curIdx] || null, exerciseBar(ex, getBar()), meta.unit, platesOn(ex, null));
```

`trackBlock`: aggiungere parametro finale `showPlates = true` alla firma e passarlo
alla `buildEditBlock` interna (cercare `buildEditBlock(` dentro `trackBlock`).
In `renderFocusSuperset` (il chiamante di `trackBlock`, subito sotto): passare
`platesOn(ex, "a")` per la traccia A e `platesOn(ex, "b")` per la traccia B.

- [ ] **Step 3: Test + verifica manuale**

Run: `npm test` → PASS.
Browser: "Panca piana bilanciere" mostra "per lato: …"; "Pulldown presa larga"
NON la mostra; attivando la chip `DISCHI/LATO` dall'editor ricompare.

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "fix(plates): riga per-lato solo dove platesOn e' true"
```

---

### Task 8: 💬 fantasma sulle serie fatte (commenti a posteriori)

**Files:**
- Modify: `app.js` — `setRow` (def. ~riga 2250, fine ~2338), chiamanti in `renderFocusNormal` (~2411) e `trackBlock` (loop serie del superset)
- Modify: `style.css` (append)

- [ ] **Step 1: `setRow` accetta `onComment`**

Firma: `setRow(i, set, prev, isCurrent, onRemove, onOpen, meta, onComment = null)`.
Subito PRIMA del blocco `if (set.done && Array.isArray(set.comments) ...)` (app.js:2319) inserire:

```js
  if (set.done && !set.warmup && onComment) {
    const cb = document.createElement("span");
    cb.className = "cmt-btn" + ((set.comments && set.comments.length) ? " on" : "");
    cb.textContent = "💬";
    cb.title = "Commenti serie";
    cb.addEventListener("click", (e) => { e.stopPropagation(); onComment(); });
    row.appendChild(cb);
  }
```

- [ ] **Step 2: CSS** (append in `style.css`)

```css
/* Batch sessione-ux: 💬 fantasma sulle serie fatte */
.srow .cmt-btn{opacity:.28;font-size:12px;cursor:pointer;padding:4px 6px;
  margin-left:4px;min-width:28px;text-align:center;-webkit-user-select:none;user-select:none;}
.srow .cmt-btn.on{opacity:.95;}
```

- [ ] **Step 3: Chiamante normale**

In `renderFocusNormal`, nel loop delle serie (prima della chiamata `setRow`, app.js:2411):

```js
    const onCommentSet = set.done && !set.warmup ? () => openQcDialog((set.comments ?? []).slice(), (next) => {
      data = setEntry(data, currentWeek, currentDay, exId, withSet(v, i, { comments: next }), new Date().toISOString());
      persist(idx); render();
    }) : null;
    setsBox.appendChild(setRow(i, set, prev[i] || null, isCurrent, onRemove, onOpen, meta, onCommentSet));
```

- [ ] **Step 4: Chiamante superset**

In `trackBlock`, nel loop serie (cercare la chiamata `setRow(` dentro `trackBlock`),
costruire analogamente:

```js
    const onCommentSet = set.done && !set.warmup ? () => openQcDialog((set.comments ?? []).slice(), (next) => {
      data = setEntry(data, currentWeek, currentDay, exId,
        withSupersetSet(getEntry(data, currentWeek, currentDay, exId), trackKey, i, { comments: next }),
        new Date().toISOString());
      persist(idx); render();
    }) : null;
```

e passarlo come 8° argomento alla `setRow` interna.

- [ ] **Step 5: Test + verifica manuale**

Run: `npm test` → PASS (`withSet` fa merge del patch: `{ comments }` non tocca reps/kg/done — già coperto dai test esistenti di withSet).
Browser: completare una serie → 💬 spenta a destra; tap → dialog commenti; scegliere
una chip → il testo compare sotto la serie e la 💬 si accende; funziona anche su
una traccia superset; il ✎ modifica-serie continua a funzionare.

- [ ] **Step 6: Commit**

```bash
git add app.js style.css
git commit -m "feat(serie): commenti modificabili sulle serie fatte via chip 💬"
```

---

### Task 9: focus top — media wger + chip REC / VOL ×2

**Files:**
- Modify: `app.js` — nuova `buildFocusTop` + inserimento in `renderFocusNormal` (~2379) e `renderFocusSuperset`
- Modify: `style.css` (append)

- [ ] **Step 1: Helper in `app.js`** (vicino a `renderFocusNormal`)

Verificare che `mediaFor` sia importato da `./media-map.js` in app.js (lo è per il DB esercizi; altrimenti aggiungerlo).

```js
// Voce di catalogo con lo stesso nome (normalizzato) dell'esercizio, per
// l'override img per-voce. Null se assente.
function catalogByName(name) {
  const n = String(name ?? "").trim().toLowerCase();
  return (dehydrate(data).catalog ?? []).find((e) => String(e.name ?? "").trim().toLowerCase() === n) ?? null;
}

// Pannello in testa al focus (spec §2, mockup focus-media.html variante A):
// chip REC/VOL×2 + i 2 frame wger se disponibili. Null se non c'è nulla.
function buildFocusTop(ex) {
  const wrap = document.createElement("div");
  wrap.className = "focus-top";
  const chips = document.createElement("div");
  chips.className = "f-chips";
  const rec = Number.isFinite(ex.restSeconds) ? formatTime(ex.restSeconds) : (ex.recText || "");
  if (rec) {
    const c = document.createElement("span"); c.className = "f-chip rec";
    c.textContent = `REC ${rec}`; chips.appendChild(c);
  }
  const addVol = (label) => {
    const c = document.createElement("span"); c.className = "f-chip";
    c.textContent = label; chips.appendChild(c);
  };
  if (ex.superset) {
    if (volumeMeta(ex, "a").factor === 2) addVol("A ×2");
    if (volumeMeta(ex, "b").factor === 2) addVol("B ×2");
  } else if (volumeMeta(ex, null).factor === 2) addVol("VOL ×2");
  if (chips.children.length) wrap.appendChild(chips);

  // Media: prova ogni traccia (superset "A + B"), primo hit vince.
  const names = ex.superset && String(ex.name).includes(" + ")
    ? String(ex.name).split(" + ") : [ex.name];
  for (const nm of names) {
    const m = mediaFor(catalogByName(nm) ?? { name: nm });
    if (!m) continue;
    const box = document.createElement("div");
    box.className = "f-media";
    for (const src of [m.img1, m.img2].filter(Boolean)) {
      const img = document.createElement("img");
      img.src = src; img.loading = "lazy"; img.alt = nm; img.decoding = "async";
      img.addEventListener("error", () => box.remove()); // hotlink rotto → via tutto
      box.appendChild(img);
    }
    wrap.appendChild(box);
    break;
  }
  return wrap.children.length ? wrap : null;
}
```

- [ ] **Step 2: Inserimento nei due render**

`renderFocusNormal`, subito PRIMA di `const trendRow = buildTrendRow(...)` (app.js:2379):

```js
  const top = buildFocusTop(ex);
  if (top) container.appendChild(top);
```

Stesso inserimento all'inizio del corpo di `renderFocusSuperset` (nel punto in cui
inizia ad appendere contenuto al `container`).

- [ ] **Step 3: CSS** (append)

```css
/* Batch sessione-ux: testa del focus con chip e media wger */
.focus-top{margin-bottom:10px;}
.focus-top .f-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;}
.focus-top .f-chip{border:1px solid var(--line);border-radius:3px;padding:2px 7px;
  font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.08em;color:var(--dim);}
.focus-top .f-chip.rec{border-color:var(--acc);color:var(--acc);}
.focus-top .f-media{display:flex;gap:8px;}
.focus-top .f-media img{flex:1;min-width:0;aspect-ratio:4/3;object-fit:contain;
  background:#101418;border:1px solid var(--line);border-radius:6px;}
```

- [ ] **Step 4: Test + verifica manuale**

Run: `npm test` → PASS.
Browser: aprire "Panca piana bilanciere" → chip `REC 2:00` + 2 frame wger (già in MAP);
"Affondi con manubri" → chip `REC` + `VOL ×2`, nessun pannello media (non in MAP, nessun buco).

- [ ] **Step 5: Commit**

```bash
git add app.js style.css
git commit -m "feat(focus): media wger e chip REC/VOLx2 in testa al focus"
```

---

### Task 10: popolare `media-map.js` (voci verificate HEAD 200)

**Files:**
- Modify: `media-map.js` (MAP)
- Test: `tests/media-map.test.js` (se esiste, append; altrimenti crearlo)

- [ ] **Step 1: Trovare le immagini wger per gli esercizi della scheda**

Procedura per OGNI nome (seed `plan.js` + nomi scheda utente noti: panca piana bilanciere,
spinte manubri panca piana, spinte su panca inclinata (manubri), croci ai cavi, dips,
pulldown presa larga, rematore bilanciere, rematore manubrio, rematore al cavo,
pullover con manubrio, stacco rumeno, affondi con manubri, affondo bulgaro,
lento avanti bilanciere, lento avanti manubri, alzate laterali, alzate posteriori,
face pull, curl manubri, curl EZ, curl concentrato, skullcrusher/french press,
pushdown, polpacci in piedi, plank, leg raise, russian twist, crunch inverso):

1. Cercare l'esercizio sull'API wger (termine inglese):
   `curl -s "https://wger.de/api/v2/exercise/search/?term=bench+press&language=english&format=json"`
2. Dalle immagini candidate (`https://wger.de/api/v2/exerciseimage/?exercise_base=<id>&format=json`)
   ricavare i path `exercise-images/<id>/<File>`.
3. Verificare ENTRAMBI i frame:
   `curl -s -o /dev/null -w "%{http_code}" "https://wger.de/media/exercise-images/<id>/<Nome>-1.png"`
   e idem `-2.png`. Aggiungere alla MAP **solo se entrambi 200**.

- [ ] **Step 2: Aggiornare la MAP**

In `media-map.js` estendere `MAP` con le voci verificate, formato esistente:

```js
const MAP = {
  "panca piana bilanciere": "192/Bench-press",
  "crunch a terra": "91/Crunches",
  // + nuove voci verificate, una per riga, nome seed normalizzato → "<id>/<File>"
};
```

Le voci senza riscontro wger NON si aggiungono (fallback già gestito).
Loggare nel messaggio di commit quante voci sono state aggiunte e quante scartate.

- [ ] **Step 3: Test**

In `tests/media-map.test.js` (creare se assente, stile degli altri test):

```js
import test from "node:test";
import assert from "node:assert/strict";
import { mediaFor } from "../media-map.js";

test("mediaFor: ogni voce MAP produce due URL wger ben formati", () => {
  // smoke sul formato della mappa attraverso la API pubblica
  const m = mediaFor({ name: "Panca piana bilanciere" });
  assert.ok(m.img1.startsWith("https://wger.de/media/exercise-images/"));
  assert.ok(m.img1.endsWith("-1.png"));
  assert.ok(m.img2.endsWith("-2.png"));
});

test("mediaFor: nome non mappato -> null", () => {
  assert.equal(mediaFor({ name: "Esercizio inventato xyz" }), null);
});
```

Run: `npm test` → PASS.

- [ ] **Step 4: Commit**

```bash
git add media-map.js tests/media-map.test.js
git commit -m "feat(media): MAP wger popolata con voci verificate HEAD 200"
```

---

### Task 11: timer — GO auto-dismiss + linea drain + scroll-lock + padding dinamico

**Files:**
- Modify: `index.html:463-466` (`#timerGo`)
- Modify: `app.js` — `showTimerGo`/`dismissTimerGo`/`startRest` (~1470-1510), handler `tToggle`/`tStop`, init
- Modify: `style.css` (append + sostituzione padding fissi a riga 600-602)

- [ ] **Step 1: Markup drain**

In `index.html`, dentro `#timerGo` DOPO il div `.g2` (riga 465):

```html
      <div class="g-drain"><i id="goDrain"></i></div>
```

- [ ] **Step 2: CSS**

Append:

```css
/* Batch sessione-ux: linea che si scarica sotto il GO (auto-dismiss 8s) */
.g-drain{height:2px;background:var(--line);margin-top:10px;overflow:hidden;}
.g-drain i{display:block;height:100%;width:100%;background:var(--acc);}
/* scroll bloccato mentre il countdown del recupero corre */
body.scroll-lock{overflow:hidden;}
```

Sostituire le righe 600-602 di `style.css`:

```css
body.timer-on .focus-body{padding-bottom:196px;}
body.feel-on .focus-body{padding-bottom:160px;}
body.timer-on.feel-on .focus-body{padding-bottom:300px;}
```

con (padding misurato sull'altezza reale dello stack, fallback ai valori storici):

```css
body.timer-on .focus-body{padding-bottom:calc(var(--bottom-pad,196px) + 28px);}
body.feel-on .focus-body{padding-bottom:calc(var(--bottom-pad,160px) + 28px);}
body.timer-on.feel-on .focus-body{padding-bottom:calc(var(--bottom-pad,300px) + 28px);}
/* anche la LISTA esercizi non deve finire sotto la barra (bug overlap) */
body.timer-on .wrap{padding-bottom:calc(var(--bottom-pad,140px) + 16px);}
```

- [ ] **Step 3: Misura dinamica dello stack** (app.js, nel blocco di init dei listener)

```js
  // Altezza reale dello stack fisso in basso → CSS var per i padding (fix overlap).
  const _bs = document.getElementById("bottomStack");
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--bottom-pad", _bs.offsetHeight + "px");
  }).observe(_bs);
```

- [ ] **Step 4: Auto-dismiss GO** (app.js)

Import: aggiungere `VisibleCountdown` all'import da `./timer.js`.
Sopra `showTimerGo`:

```js
// Auto-dismiss dello stato GO: 8s di schermo visibile (spec §3, mockup go-dismiss B).
const goDismiss = new VisibleCountdown({ durationMs: 8000, onDone: () => dismissTimerGo() });
function goDrainRun() {
  const d = document.getElementById("goDrain");
  d.style.transition = "none";
  d.style.width = Math.round((goDismiss.remaining / goDismiss.durationMs) * 100) + "%";
  void d.offsetWidth; // reflow: parte dallo stato corrente
  d.style.transition = `width ${goDismiss.remaining}ms linear`;
  d.style.width = "0%";
}
function goDrainFreeze() {
  const d = document.getElementById("goDrain");
  d.style.width = getComputedStyle(d).width; // congela il valore animato
  d.style.transition = "none";
}
```

In `showTimerGo`, in fondo alla funzione:

```js
  document.body.classList.remove("scroll-lock"); // GO = scroll di nuovo libero
  goDismiss.start(!document.hidden);
  if (!document.hidden) goDrainRun();
```

In `dismissTimerGo`, in testa:

```js
  goDismiss.cancel();
```

In `startRest`, dopo `document.body.classList.add("timer-on");`:

```js
  goDismiss.cancel();
  document.body.classList.add("scroll-lock");
```

- [ ] **Step 5: visibilitychange + pausa/stop**

Nel listener `visibilitychange` esistente (cercare `visibilitychange` in app.js — c'è
già per `timer.sync()`), aggiungere:

```js
    if (document.hidden) { goDismiss.hide(); goDrainFreeze(); }
    else if (goDismiss.active) { goDismiss.show(); goDrainRun(); }
```

Nel handler di `tToggle` (pausa/riprendi recupero): quando mette in pausa →
`document.body.classList.remove("scroll-lock")`; quando riprende →
`document.body.classList.add("scroll-lock")`.
Nel handler di `tStop` e in `dismissTimerGo`:
`document.body.classList.remove("scroll-lock");`

- [ ] **Step 6: Test + verifica manuale**

Run: `npm test` → PASS.
Browser (mobile viewport): avviare un recupero corto (10s) → pagina non scrolla,
⏸ la sblocca; allo 0:00 GO con linea ambra che si scarica in 8s poi sparisce da solo;
tap chiude subito; con timer attivo il prossimo esercizio in lista resta leggibile
sopra la barra (niente overlap).

- [ ] **Step 7: Commit**

```bash
git add index.html style.css app.js
git commit -m "feat(timer): GO auto-dismiss 8s con drain, scroll-lock, fix overlap"
```

---

### Task 12: Scan — integrazione boot-log negli empty-state

**Files:**
- Modify: `app.js` — `renderScan` (~788-828)
- Modify: `style.css` (append)

- [ ] **Step 1: Integrazione week** (app.js:808-811)

Import: aggiungere `scanBootLog` all'import da `./body.js`. Sostituire l'assegnazione
`body.innerHTML` del ramo week con:

```js
    const empty = contribs.length === 0;
    body.innerHTML =
      `<div class="crt-panel big${empty ? " scan-dim" : ""}">${CRT_RULER}${renderBody({ zones, w: 108 })}` +
      `${scanLegendWeek()}${CRT_CORNERS}<span class="crt-tag">SCAN·${wTag}</span></div>` +
      (empty ? scanBootLog("week", { wTag }) : "");
```

- [ ] **Step 2: Integrazione fresh** (app.js:813-823)

Prima del render del ramo fresh calcolare `const lastBy = lastTrainedByGroup(data);`
(già chiamata alla riga 814 — riusare la variabile) e:

```js
    const emptyF = Object.keys(lastBy).length === 0;
    body.innerHTML =
      `<div class="crt-panel big${emptyF ? " scan-dim" : ""}">${CRT_RULER}${renderBody({ zones, cold: never, w: 108 })}` +
      `${warnTxt}${neverTxt}${CRT_CORNERS}<span class="crt-tag">SCAN·FRESH</span></div>` +
      (emptyF ? scanBootLog("fresh", {}) : `<div class="scan-cap">acceso = allenato da poco · spento = sta recuperando</div>`);
```

(adattare: la chiamata `freshnessByGroup(lastTrainedByGroup(data), todayIso)` diventa
`freshnessByGroup(lastBy, todayIso)`).

- [ ] **Step 3: CSS** (append)

```css
/* Batch sessione-ux: empty-state Scan a boot-log */
.crt-panel.scan-dim .bd-pair{opacity:.3;}
.scan-boot{margin-top:10px;border:1px solid #2c343c;border-radius:8px;background:#06080a;
  padding:12px;font-family:"JetBrains Mono",monospace;font-size:11px;line-height:1.8;}
.scan-boot .sb-cmd{color:#4a545e;}
.scan-boot .sb-body{color:#69d18b;}
.scan-boot .sb-dim{color:#4a545e;}
.scan-boot .sb-amber{color:#f0a73c;}
.scan-boot .sb-blue{color:#7FC8FF;}
.scan-boot .sb-leg{display:flex;gap:14px;justify-content:center;margin-top:8px;
  font-size:9.5px;color:#6b7682;}
.scan-boot .sb-dot{display:inline-block;width:8px;height:8px;border-radius:50%;
  vertical-align:middle;margin-right:4px;}
```

(palette fissa X-ray come il pannello, fuori dai temi — coerente con `body.js`.)

- [ ] **Step 4: Test + verifica manuale**

Run: `npm test` → PASS.
Browser: con settimana nuova senza serie → tab Settimana mostra figura attenuata +
boot-log con legenda; tab Freschezza con storico esistente resta normale; in un
profilo pulito (localStorage vuoto, trucco verifica) anche Freschezza mostra il boot-log.

- [ ] **Step 5: Commit**

```bash
git add app.js style.css
git commit -m "feat(scan): boot-log esplicativo quando il tab e' vuoto"
```

---

### Task 13: SW v66, suite completa, verifica browser

**Files:**
- Modify: `sw.js` (versione cache)

- [ ] **Step 1: Bump cache**

In `sw.js` portare la costante di versione cache da `v65` a `v66` (cercare `v65`).

- [ ] **Step 2: Suite completa**

Run: `npm test`
Expected: TUTTI i test PASS (≥ 373 + i nuovi). Se un test fallisce, fermarsi e
sistemare prima di proseguire.

- [ ] **Step 3: Verifica end-to-end nel browser**

Server statico dalla root del worktree: `python -m http.server 8035`.
Checklist (mobile viewport, cache SW svuotata — trappola nota: Application →
Storage → Clear site data prima di verificare):

1. Focus "Panca piana bilanciere": media wger visibili, chip REC, riga per-lato presente.
2. Focus "Pulldown presa larga": niente riga per-lato.
3. Editor → "Affondo bulgaro" (o crearlo): chip `VOL ×2` ON manualmente → salva →
   il volume serie raddoppia (8×10 → 160 kg).
4. Serie fatta → 💬 → aggiungere commento → testo sotto la riga.
5. Recupero: scroll bloccato, ⏸ sblocca; GO si scarica in 8s e sparisce; nessun
   overlap con l'ultimo/prossimo esercizio.
6. Scan su settimana vuota: boot-log; con serie loggate: figura normale.

- [ ] **Step 4: Commit**

```bash
git add sw.js
git commit -m "chore(sw): bump cache v66 per batch sessione-ux"
```

---

### Task 14 (post-merge, contenuto): nomi giornate

Nessun codice. Dopo il merge, dall'app (editor scheda → rinomina giornata) applicare:
**A «Petto + Spinta»**, **B «Gambe + Dorso»**, **C «Spalle + Braccia»**.
Lo fa l'utente o lo si ritocca insieme in verifica; i `day` code (A/B/C) NON cambiano,
solo i `title` (la rinomina esistente già lo garantisce, editor.js:65).

---

## Note per l'esecutore

- **Ordine:** Task 1→13 in sequenza; 1-5 sono pure-logic (veloci), 6-12 UI.
- **`npm test` dopo OGNI task**, non solo alla fine.
- **Invariante storica:** ogni save passa da `dehydrate(data)` (pattern `scheduleSave`/`persist` esistenti — non introdurre salvataggi diretti).
- **`exSuperset`**: ha già un listener per `toggleMuscleB` — estendere quello, non duplicare.
- **Riferimenti riga** indicativi (main @ 868f8ac): verificare con grep prima di editare.
- I mockup approvati sono in `.superpowers/brainstorm/42786-1780647213/content/` (gitignored): `focus-media.html`, `scan-empty.html`, `go-dismiss.html`, `set-comments.html`, `editor-toggles.html`.
