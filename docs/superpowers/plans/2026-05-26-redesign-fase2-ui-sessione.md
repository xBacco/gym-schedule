# Redesign Fase 2 — UI/UX schermata sessione ("A+C, focus C") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Riscrivere la schermata della sessione secondo la direzione "A+C, focus C": un giorno alla volta (tab A/B/C), un esercizio "in focus" con logging **per-serie** via stepper carico (±0.5) e ripetizioni (±1) con **press-and-hold**, confronto con la volta scorsa, CTA "Serie fatta" che chiude la serie e avvia il recupero, prossimi esercizi collassati, superset a due tracce A/B con CTA unica, e barra timer ridisegnata in basso — su fondo scuro con accento verde.

**Architecture:** Le funzioni pure della Fase 1 in `store.js` (`normalizeEntry`, `normalizeSupersetEntry`, `prefillSets`, `platesPerSide`) restano invariate. Si aggiunge **`session.js`**: funzioni pure per la logica di sessione (parsing del target, esercizio/serie attiva, mutazioni di serie, "best", delta di progressione) — Node-testabili in `tests/session.test.js`. `app.js` diventa il controller DOM della nuova schermata (single-day, focus card, up-next, timer): niente unit test (per design del progetto), ma **smoke test obbligatorio in browser** a ogni task DOM. `index.html` e `style.css` vengono riscritti (struttura + tema scuro). Si **rimuove** l'adattatore legacy `flatEntry`/`entrySummary`/`exerciseHistory`/`shortLabel` di `app.js`. Il trigger del recupero passa dal `blur` del campo alla CTA "Serie fatta". La persistenza (`setEntry`/`getEntry`/`GitHubStore`, salvataggio con debounce) resta com'è: la sync batch è Fase 3.

**Tech Stack:** JavaScript ES modules (vanilla), nessun build step. Test `node:test` + `node:assert/strict`. Tipografia via Google Fonts (JetBrains Mono + Inter). Nessuna dipendenza nuova.

**Decisioni di interazione (fissate con l'utente il 2026-05-26 via mockup interattivi in `mockups/fase2/`):**
1. **Navigazione:** tab segmentate A/B/C in header + selettore settimana esistente; una sola giornata a vista.
2. **Superset in focus:** due blocchi A e B impilati con **CTA unica** ("Serie fatta" chiude la serie corrente di entrambe le tracce e avvia un solo recupero).
3. **Ripetizioni:** **stepper −/+ (step 1)**, coerente con lo stepper carico.
4. **Press-and-hold** su tutti i pulsanti `+/−` (carico ±0.5, reps ±1): un tap = un passo; tenuto premuto = ripetizione che accelera. (Era "fuori scope" nella spec §8 — promosso in scope su richiesta utente.)

**Fuori da questa fase (Fase 3):** Wake Lock, PWA (manifest + service worker), sync batch (commit all'avvio recupero), UI calcolatore dischi (`platesPerSide` esiste già), nota rapida per esercizio (campo nell'UI; il dato `note` è già nel modello), ritocco fine dei grigi.

---

## File Structure

- `session.js` — **nuovo**: funzioni pure di sessione. Importa da `store.js` (`getEntry`, `normalizeEntry`, `normalizeSet`, `normalizeSupersetEntry`). Esporta: `parseTargetTrack`, `parseTarget`, `activeSetIndex`, `isEntryComplete`, `activeExerciseIndex`, `bestKg`, `progressionDelta`, `withSet`, `withoutSet`, `withSupersetSet`, `withoutSupersetSet`.
- `tests/session.test.js` — **nuovo**: test delle funzioni di `session.js`.
- `style.css` — **riscrittura completa**: tema scuro "A+C".
- `index.html` — **riscrittura della struttura**: header (kicker, titolo, tab A/B/C, riga settimana, ⚙), barra progresso, contenitore focus, contenitore up-next, barra timer fissa, dialog impostazioni.
- `app.js` — **riscrittura del render**: stato giorno/settimana/focus, render single-day, focus card normale e superset, steppers con press-and-hold, flusso "Serie fatta", up-next, editing serie chiuse. Rimozione del codice legacy di rendering.
- `store.js`, `plan.js`, `timer.js` — **invariati** (riusati).
- `tests/store.test.js`, `tests/timer.test.js`, `tests/plan.test.js` — invariati.

Modello dati (invariato dalla Fase 1):
```jsonc
// esercizio normale
{ "sets": [ { "reps": "8", "kg": "72.5", "done": true } ], "note": "" }
// superset
{ "a": { "sets": [...], "note": "" }, "b": { "sets": [...], "note": "" }, "note": "" }
```

---

### Task 1: `parseTargetTrack` + `parseTarget` in `session.js`

Parsing del target testuale di `plan.js` (`setsReps`) in `{ sets, reps }`. Per i superset, `setsReps` ha due parti separate da `/`.

**Files:**
- Create: `session.js`
- Test: `tests/session.test.js`

- [ ] **Step 1: Scrivere i test che falliscono**

Creare `tests/session.test.js`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { parseTargetTrack, parseTarget } from "../session.js";

test("parseTargetTrack: 'NxR' con range", () => {
  assert.deepEqual(parseTargetTrack("4 × 6-8"), { sets: 4, reps: "6-8" });
  assert.deepEqual(parseTargetTrack("2×15"), { sets: 2, reps: "15" });
});

test("parseTargetTrack: reps non numeriche ('max')", () => {
  assert.deepEqual(parseTargetTrack("3 × max"), { sets: 3, reps: "max" });
});

test("parseTargetTrack: stringa vuota -> default 1 serie", () => {
  assert.deepEqual(parseTargetTrack(""), { sets: 1, reps: "" });
});

test("parseTarget: normale prende la prima parte", () => {
  assert.deepEqual(parseTarget("4 × 6-8"), { sets: 4, reps: "6-8" });
});

test("parseTarget: superset divide su '/' nelle due tracce", () => {
  assert.deepEqual(parseTarget("3 × 12-15 / 3 × 12-15", true), {
    a: { sets: 3, reps: "12-15" },
    b: { sets: 3, reps: "12-15" },
  });
});

test("parseTarget: superset con una sola parte ricade su quella per la B", () => {
  assert.deepEqual(parseTarget("3 × 10", true), {
    a: { sets: 3, reps: "10" },
    b: { sets: 3, reps: "10" },
  });
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test`
Expected: FAIL — `session.js` non esiste / export mancanti.

- [ ] **Step 3: Implementare in `session.js`**

Creare `session.js` con l'intestazione e le due funzioni:

```javascript
// ---- Logica di sessione (pura, testabile in Node). Render in app.js. ----
import { getEntry, normalizeEntry, normalizeSet, normalizeSupersetEntry } from "./store.js";

// "4 × 6-8" -> { sets: 4, reps: "6-8" } ; tollera 'x'/'×' e reps non numeriche.
export function parseTargetTrack(str) {
  const s = String(str ?? "").trim();
  const m = s.match(/^(\d+)\s*[×x]\s*(.+)$/i);
  if (!m) return { sets: 1, reps: s };
  return { sets: parseInt(m[1], 10), reps: m[2].trim() };
}

// Normale -> { sets, reps }. Superset -> { a:{sets,reps}, b:{sets,reps} }.
export function parseTarget(setsReps, superset = false) {
  const parts = String(setsReps ?? "").split("/");
  if (superset) {
    return {
      a: parseTargetTrack(parts[0] ?? ""),
      b: parseTargetTrack(parts[1] ?? parts[0] ?? ""),
    };
  }
  return parseTargetTrack(parts[0] ?? "");
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test`
Expected: PASS (tutti, inclusi i 36 esistenti).

- [ ] **Step 5: Commit**

```bash
git add session.js tests/session.test.js
git commit -m "feat(session): parseTarget per target normali e superset"
```

---

### Task 2: `activeSetIndex` + `isEntryComplete` + `activeExerciseIndex`

Quale serie è "corrente" (prima non `done`) e quale esercizio è "in focus" (primo non completo).

**Files:**
- Modify: `session.js`
- Test: `tests/session.test.js`

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in fondo a `tests/session.test.js`:

```javascript
import { activeSetIndex, isEntryComplete, activeExerciseIndex } from "../session.js";
import { emptyData, setEntry } from "../store.js";

test("activeSetIndex: prima serie non done", () => {
  assert.equal(activeSetIndex([]), 0);
  assert.equal(activeSetIndex([{ done: true }, { done: false }]), 1);
  assert.equal(activeSetIndex([{ done: true }, { done: true }]), 2);
});

test("isEntryComplete: normale completo solo se ha serie e tutte done", () => {
  assert.equal(isEntryComplete("", false), false);
  assert.equal(isEntryComplete({ sets: [{ reps: "8", kg: "70", done: true }] }, false), true);
  assert.equal(isEntryComplete({ sets: [{ reps: "8", kg: "70", done: false }] }, false), false);
});

test("isEntryComplete: superset considera solo le tracce con serie loggate", () => {
  assert.equal(isEntryComplete("", true), false);
  const v = { a: { sets: [{ reps: "15", kg: "25", done: true }] }, b: { sets: [{ reps: "15", kg: "12", done: true }] } };
  assert.equal(isEntryComplete(v, true), true);
  const half = { a: { sets: [{ reps: "15", kg: "25", done: true }] }, b: { sets: [] } };
  assert.equal(isEntryComplete(half, true), true); // B a corpo libero non loggata -> non blocca
});

test("activeExerciseIndex: primo esercizio non completo", () => {
  const plan = { exercises: [{ superset: false }, { superset: false }, { superset: false }] };
  assert.equal(activeExerciseIndex(emptyData(), "2026-W22", "A", plan), 0);
  let d = setEntry(emptyData(), "2026-W22", "A", 0, { sets: [{ reps: "8", kg: "70", done: true }] }, "t");
  assert.equal(activeExerciseIndex(d, "2026-W22", "A", plan), 1);
});

test("activeExerciseIndex: tutti completi -> 0", () => {
  const plan = { exercises: [{ superset: false }] };
  let d = setEntry(emptyData(), "2026-W22", "A", 0, { sets: [{ reps: "8", kg: "70", done: true }] }, "t");
  assert.equal(activeExerciseIndex(d, "2026-W22", "A", plan), 0);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test`
Expected: FAIL — export mancanti.

- [ ] **Step 3: Implementare in `session.js`** (in coda)

```javascript
// Indice della serie corrente = prima non done (o length se tutte fatte).
export function activeSetIndex(sets) {
  const arr = Array.isArray(sets) ? sets : [];
  const i = arr.findIndex((s) => !s.done);
  return i === -1 ? arr.length : i;
}

function trackDoneOrEmpty(track) {
  return track.sets.length === 0 || track.sets.every((s) => s.done);
}

// Un esercizio è "completo" quando ha serie loggate e sono tutte done.
// Superset: completo se almeno una traccia ha serie e ogni traccia loggata è tutta done.
export function isEntryComplete(entry, isSuperset) {
  if (isSuperset) {
    const e = normalizeSupersetEntry(entry);
    const has = e.a.sets.length > 0 || e.b.sets.length > 0;
    return has && trackDoneOrEmpty(e.a) && trackDoneOrEmpty(e.b);
  }
  const e = normalizeEntry(entry);
  return e.sets.length > 0 && e.sets.every((s) => s.done);
}

// Indice dell'esercizio "in focus" = primo non completo (0 se tutti completi).
export function activeExerciseIndex(data, weekKey, day, dayPlan) {
  const exs = dayPlan?.exercises ?? [];
  for (let i = 0; i < exs.length; i++) {
    if (!isEntryComplete(getEntry(data, weekKey, day, i), exs[i].superset)) return i;
  }
  return 0;
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add session.js tests/session.test.js
git commit -m "feat(session): serie/esercizio attivo e completamento"
```

---

### Task 3: Mutazioni di serie — `withSet`, `withoutSet`, `withSupersetSet`, `withoutSupersetSet`

Costruiscono una nuova entry normalizzata con una serie aggiornata/aggiunta/rimossa (immutabili).

**Files:**
- Modify: `session.js`
- Test: `tests/session.test.js`

- [ ] **Step 1: Scrivere i test che falliscono**

```javascript
import { withSet, withoutSet, withSupersetSet, withoutSupersetSet } from "../session.js";

test("withSet: aggiorna una serie esistente (merge del patch)", () => {
  const e = { sets: [{ reps: "8", kg: "70", done: false }], note: "n" };
  assert.deepEqual(withSet(e, 0, { kg: "72.5", done: true }), {
    sets: [{ reps: "8", kg: "72.5", done: true }],
    note: "n",
  });
});

test("withSet: estende l'array se l'indice supera la lunghezza", () => {
  assert.deepEqual(withSet("", 0, { reps: "8", kg: "70", done: true }), {
    sets: [{ reps: "8", kg: "70", done: true }],
    note: "",
  });
  const e = { sets: [{ reps: "8", kg: "70", done: true }] };
  assert.equal(withSet(e, 2, { reps: "6", kg: "70" }).sets.length, 3);
});

test("withoutSet: rimuove la serie all'indice", () => {
  const e = { sets: [{ reps: "8", kg: "70", done: true }, { reps: "6", kg: "70", done: false }] };
  assert.deepEqual(withoutSet(e, 0).sets, [{ reps: "6", kg: "70", done: false }]);
});

test("withSupersetSet: aggiorna solo la traccia indicata", () => {
  const v = { a: { sets: [{ reps: "15", kg: "25", done: false }] }, b: { sets: [{ reps: "15", kg: "12", done: false }] }, note: "" };
  const out = withSupersetSet(v, "b", 0, { done: true });
  assert.equal(out.a.sets[0].done, false);
  assert.equal(out.b.sets[0].done, true);
});

test("withoutSupersetSet: rimuove dalla traccia indicata", () => {
  const v = { a: { sets: [{ reps: "15", kg: "25", done: true }, { reps: "15", kg: "25", done: false }] }, b: { sets: [] }, note: "" };
  assert.equal(withoutSupersetSet(v, "a", 1).a.sets.length, 1);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test`
Expected: FAIL — export mancanti.

- [ ] **Step 3: Implementare in `session.js`** (in coda)

```javascript
// Entry normale: aggiorna/aggiunge la serie `index` col patch dato (immutabile).
export function withSet(entry, index, patch) {
  const e = normalizeEntry(entry);
  const sets = e.sets.slice();
  while (sets.length <= index) sets.push({ reps: "", kg: "", done: false });
  sets[index] = normalizeSet({ ...sets[index], ...patch });
  return { sets, note: e.note };
}

export function withoutSet(entry, index) {
  const e = normalizeEntry(entry);
  const sets = e.sets.slice();
  if (index >= 0 && index < sets.length) sets.splice(index, 1);
  return { sets, note: e.note };
}

// Superset: stessa cosa sulla traccia "a"/"b".
export function withSupersetSet(entry, track, index, patch) {
  const e = normalizeSupersetEntry(entry);
  const t = track === "b" ? "b" : "a";
  return { ...e, [t]: withSet(e[t], index, patch) };
}

export function withoutSupersetSet(entry, track, index) {
  const e = normalizeSupersetEntry(entry);
  const t = track === "b" ? "b" : "a";
  return { ...e, [t]: withoutSet(e[t], index) };
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add session.js tests/session.test.js
git commit -m "feat(session): mutazioni immutabili di serie (normale + superset)"
```

---

### Task 4: `bestKg` + `progressionDelta`

"Best" (max kg storico) per le righe up-next; delta carico vs volta scorsa per la marcatura `▲ +x`.

**Files:**
- Modify: `session.js`
- Test: `tests/session.test.js`

- [ ] **Step 1: Scrivere i test che falliscono**

```javascript
import { bestKg, progressionDelta } from "../session.js";

test("bestKg: massimo kg su tutte le settimane per quell'esercizio", () => {
  let d = setEntry(emptyData(), "2026-W20", "A", 0, { sets: [{ reps: "8", kg: "60" }] }, "t1");
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "65" }, { reps: "6", kg: "70" }] }, "t2");
  assert.equal(bestKg(d, "A", 0), 70);
});

test("bestKg: nessun dato -> null", () => {
  assert.equal(bestKg(emptyData(), "A", 0), null);
});

test("progressionDelta: differenza arrotondata o null", () => {
  assert.equal(progressionDelta("72.5", "70"), 2.5);
  assert.equal(progressionDelta("70", "72.5"), -2.5);
  assert.equal(progressionDelta("70", "70"), 0);
  assert.equal(progressionDelta("", "70"), null);
  assert.equal(progressionDelta("70", ""), null);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test`
Expected: FAIL — export mancanti.

- [ ] **Step 3: Implementare in `session.js`** (in coda)

```javascript
// Max kg loggato per un esercizio normale su tutte le settimane (null se assente).
export function bestKg(data, day, idx) {
  let best = null;
  for (const k of Object.keys(data?.weeks ?? {})) {
    const e = normalizeEntry(getEntry(data, k, day, idx));
    for (const s of e.sets) {
      const v = parseFloat(String(s.kg).replace(",", "."));
      if (Number.isFinite(v) && (best === null || v > best)) best = v;
    }
  }
  return best;
}

// Delta carico (cur - prev) arrotondato a 2 decimali; null se uno non è numerico.
export function progressionDelta(curKg, prevKg) {
  const c = parseFloat(String(curKg).replace(",", "."));
  const p = parseFloat(String(prevKg).replace(",", "."));
  if (!Number.isFinite(c) || !Number.isFinite(p)) return null;
  return Math.round((c - p) * 100) / 100;
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test`
Expected: PASS (atteso totale ≥ 36 store/timer/plan + i nuovi di session).

- [ ] **Step 5: Commit**

```bash
git add session.js tests/session.test.js
git commit -m "feat(session): bestKg e progressionDelta"
```

---

### Task 5: Tema scuro — riscrittura di `style.css`

Sostituire interamente il tema crema/terracotta col tema scuro "A+C". Questo task non cambia il markup (ancora quello vecchio): serve a posare le variabili e le classi che `index.html`/`app.js` useranno. Lo smoke test verifica solo che il foglio carichi e i font arrivino.

**Files:**
- Modify: `style.css` (sostituzione completa)

- [ ] **Step 1: Sostituire il contenuto di `style.css`**

```css
:root{
  --bg:#0E0F0E; --surf:#151715; --surf2:#1B1E1B; --line:#242824;
  --ink:#ECEAE5; --dim:#8A8E86; --faint:#5C5F57;
  --acc:#3FE0A8; --acc-ink:#07231B; --ok:#3FE0A8; --down:#E0843F;
  --field:#23271f;
}
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent;}
html,body{margin:0;padding:0;}
body{background:#0a0b0a;color:var(--ink);font-family:"Inter",system-ui,-apple-system,sans-serif;
  display:flex;justify-content:center;min-height:100vh;font-size:16px;line-height:1.45;}
.mono{font-family:"JetBrains Mono",monospace;}
.wrap{width:100%;max-width:440px;background:var(--bg);min-height:100vh;padding:20px 16px 132px;position:relative;}
.hidden{display:none !important;}

/* header */
.kicker{font-family:"JetBrains Mono",monospace;font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--dim);}
.kicker b{color:var(--acc);}
h1{font-size:26px;font-weight:800;letter-spacing:-.03em;margin:8px 0 0;}
.day-tabs{display:flex;gap:6px;margin-top:14px;}
.day-tabs button{flex:1;background:var(--surf2);border:1px solid var(--line);border-radius:12px;padding:11px 0;
  font-family:"JetBrains Mono",monospace;font-size:15px;font-weight:700;color:var(--dim);cursor:pointer;letter-spacing:.04em;}
.day-tabs button.on{background:var(--acc);border-color:var(--acc);color:var(--acc-ink);}
.week-row{display:flex;align-items:center;gap:8px;margin-top:11px;}
#weekSelect{flex:1;background:var(--surf2);border:1px solid var(--line);border-radius:12px;padding:10px 12px;
  color:var(--ink);font-family:"JetBrains Mono",monospace;font-size:13px;}
.btn-soft{background:transparent;border:1px solid var(--line);border-radius:12px;padding:10px 12px;
  color:var(--acc);font-family:"JetBrains Mono",monospace;font-size:13px;font-weight:700;cursor:pointer;}
.btn-icon{background:transparent;border:1px solid var(--line);border-radius:12px;padding:9px 12px;font-size:16px;color:var(--ink);cursor:pointer;}
.status{font-family:"JetBrains Mono",monospace;font-size:10px;font-weight:700;padding:5px 9px;border-radius:20px;
  background:var(--surf2);color:var(--dim);border:1px solid var(--line);white-space:nowrap;}
.status.ok{color:var(--acc);border-color:#1e4a3b;}
.status.pending{color:var(--down);}
.status.error{color:#0a0b0a;background:var(--down);border-color:var(--down);}

/* progress bar */
.prog{display:flex;gap:5px;margin-top:14px;align-items:center;}
.prog .seg{flex:1;height:4px;border-radius:2px;background:var(--line);}
.prog .seg.done{background:var(--ink);}
.prog .seg.cur{background:var(--acc);}
.prog .lbl{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--dim);margin-left:8px;white-space:nowrap;}

/* focus card */
.focus{background:var(--surf);border:1px solid var(--line);border-radius:20px;padding:18px 16px;margin-top:18px;}
.exhead{display:flex;justify-content:space-between;align-items:baseline;gap:10px;}
.exn{font-size:19px;font-weight:700;letter-spacing:-.01em;}
.exn .id{font-family:"JetBrains Mono",monospace;color:var(--acc);font-size:14px;margin-right:6px;}
.tgt{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--dim);text-align:right;line-height:1.4;white-space:nowrap;}
.ssbadge{display:inline-block;font-family:"JetBrains Mono",monospace;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--acc);border:1px solid #1e4a3b;border-radius:5px;padding:1px 6px;margin-left:7px;}

/* serie fatte */
.sets{margin-top:14px;}
.srow{display:flex;align-items:center;gap:13px;font-family:"JetBrains Mono",monospace;padding:9px 0;border-bottom:1px solid var(--line);}
.srow .i{font-size:11px;color:var(--faint);width:14px;}
.srow .v{font-size:17px;letter-spacing:-.01em;cursor:pointer;}
.srow .v .x{color:var(--faint);}
.srow .v .u{font-size:11px;color:var(--dim);}
.srow .tag{margin-left:auto;font-size:10px;color:var(--acc);}
.srow .tag.down{color:var(--down);}
.srow .chk{color:var(--ok);font-size:14px;}
.srow .rm{color:var(--faint);font-size:13px;cursor:pointer;padding:0 4px;}
.srow.cur .v{color:var(--ink);}
.srow.cur .tag{color:var(--dim);}

/* track header (superset) */
.track{margin-top:14px;}
.track + .track{border-top:1px solid var(--line);padding-top:12px;}
.track-h{display:flex;align-items:center;gap:9px;}
.track-h .tA{font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:700;color:var(--acc-ink);background:var(--acc);border-radius:7px;padding:3px 9px;}
.track-h .tnm{font-size:15px;font-weight:700;}
.track-h .ttgt{margin-left:auto;font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--dim);}

/* edit block + stepper */
.editblock{margin-top:14px;background:var(--surf2);border:1px solid var(--line);border-radius:16px;padding:13px;}
.editlabel{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);text-align:center;}
.stepper{display:flex;align-items:center;justify-content:space-between;margin-top:9px;}
.mb{min-width:62px;height:52px;padding:0 6px;border-radius:14px;background:var(--field);border:1px solid var(--line);
  display:flex;align-items:center;justify-content:center;font-family:"JetBrains Mono",monospace;font-size:17px;font-weight:700;color:var(--acc);cursor:pointer;user-select:none;touch-action:none;}
.mb:active{background:var(--acc);color:var(--acc-ink);}
.stepper .val{font-family:"JetBrains Mono",monospace;font-size:40px;font-weight:700;letter-spacing:-.03em;line-height:1;text-align:center;}
.stepper .val .u{font-size:15px;color:var(--dim);}
.prefill{font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--dim);text-align:center;margin-top:9px;}
.reprow{display:flex;gap:9px;margin-top:11px;align-items:stretch;}
.repstep{flex:2;display:flex;align-items:center;justify-content:space-between;background:var(--field);border:1px solid var(--line);border-radius:12px;padding:6px 8px;}
.repstep .rmb{min-width:44px;height:42px;border-radius:11px;background:var(--surf);border:1px solid var(--line);
  display:flex;align-items:center;justify-content:center;font-family:"JetBrains Mono",monospace;font-size:18px;font-weight:700;color:var(--acc);cursor:pointer;user-select:none;touch-action:none;}
.repstep .rmb:active{background:var(--acc);color:var(--acc-ink);}
.repstep .rc{text-align:center;}
.repstep .rc .rv{font-family:"JetBrains Mono",monospace;font-size:24px;font-weight:700;}
.repstep .rc .l{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);}
.chip{flex:1;background:var(--field);border:1px solid var(--line);border-radius:12px;padding:9px;text-align:center;display:flex;flex-direction:column;justify-content:center;}
.chip .rv{font-family:"JetBrains Mono",monospace;font-size:16px;font-weight:700;}
.chip .l{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);margin-top:2px;}
.chip.prevbest{background:transparent;border-style:dashed;}
.chip.prevbest .rv{color:var(--ok);}

/* dots + cta */
.dots{display:flex;gap:7px;justify-content:center;margin-top:16px;align-items:center;flex-wrap:wrap;}
.dt{width:9px;height:9px;border-radius:50%;background:var(--line);}
.dt.on{background:var(--ink);}
.dt.cur{background:var(--acc);box-shadow:0 0 0 3px rgba(63,224,168,.22);}
.addset{background:transparent;border:1px dashed var(--line);color:var(--dim);border-radius:10px;padding:4px 9px;
  font-family:"JetBrains Mono",monospace;font-size:11px;cursor:pointer;margin-left:6px;}
.cta{margin-top:15px;width:100%;background:var(--acc);color:var(--acc-ink);border:none;border-radius:14px;padding:15px;
  font-family:inherit;font-size:15px;font-weight:700;cursor:pointer;letter-spacing:.01em;}

/* up next */
.upnext{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim);margin:24px 4px 8px;}
.nrow{display:flex;align-items:center;gap:12px;padding:14px;background:var(--surf);border:1px solid var(--line);border-radius:14px;margin-bottom:9px;cursor:pointer;}
.nrow.done{opacity:.5;}
.nrow .id{font-family:"JetBrains Mono",monospace;font-size:13px;color:var(--faint);}
.nrow .nm{font-weight:600;font-size:15px;}
.nrow .sub{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--dim);margin-top:2px;}
.nrow .right{margin-left:auto;text-align:right;}
.nrow .best{font-family:"JetBrains Mono",monospace;font-size:13px;font-weight:700;}
.nrow .bl{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint);}

/* timer bar */
.timerbar{position:fixed;left:50%;transform:translateX(-50%);bottom:0;width:100%;max-width:440px;
  background:var(--surf2);border-top:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;
  padding:13px 16px;backdrop-filter:blur(8px);}
.t-info{display:flex;flex-direction:column;min-width:0;}
.t-label{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);
  max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.t-time{font-family:"JetBrains Mono",monospace;font-size:34px;font-weight:700;letter-spacing:1px;line-height:1;color:var(--acc);}
.t-controls{display:flex;gap:7px;}
.t-btn{background:transparent;border:1px solid var(--line);border-radius:10px;padding:10px 11px;
  font-family:"JetBrains Mono",monospace;font-size:13px;font-weight:600;color:var(--ink);cursor:pointer;}
.t-stop{background:var(--acc);border-color:var(--acc);color:var(--acc-ink);}

/* settings dialog */
dialog{border:none;border-radius:16px;padding:18px;max-width:340px;background:var(--surf);color:var(--ink);}
dialog::backdrop{background:rgba(0,0,0,.6);}
.settings h2{font-size:18px;font-weight:800;margin:0 0 10px;color:var(--acc);}
.settings label{display:block;font-size:13px;font-weight:700;margin-bottom:4px;}
.settings input{width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;font-size:14px;font-family:inherit;background:var(--field);color:var(--ink);}
.hint{font-size:12px;color:var(--dim);margin:6px 0 12px;}
.settings menu{display:flex;gap:8px;padding:0;margin:0;flex-wrap:wrap;}
.settings menu button{border-radius:10px;padding:9px 12px;font-weight:700;font-family:inherit;border:none;cursor:pointer;background:var(--acc);color:var(--acc-ink);}
.settings menu button.btn-soft{background:transparent;color:var(--acc);border:1px solid var(--line);}
```

- [ ] **Step 2: Smoke test (foglio carica, niente errori)**

Run:
```bash
python -m http.server 8000
```
Aprire `http://localhost:8000/` (no cache). La pagina è ancora col vecchio markup ma deve apparire scura, senza errori di console. (È atteso che il layout sia provvisorio finché non si riscrive `index.html` nel Task 6.)

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "feat(ui): tema scuro A+C (riscrittura style.css)"
```

---

### Task 6: Riscrittura della struttura di `index.html`

Nuovo markup: header con tab giorno + riga settimana + ⚙, barra progresso, contenitore focus, contenitore up-next, barra timer fissa (stessi ID del vecchio timer per riusare il wiring), dialog impostazioni. **Dopo questo task `app.js` non funzionerà** finché non si riscrive il render (Task 7): è atteso.

**Files:**
- Modify: `index.html` (sostituzione del `<body>` e del `<head>`)

- [ ] **Step 1: Sostituire il contenuto di `index.html`**

```html
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="theme-color" content="#0E0F0E">
  <title>Gym Schedule</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <div class="wrap">
    <div class="kicker">DAY <b id="kickDay">A</b> · <span id="kickWeek">SETT. —</span></div>
    <h1 id="dayTitle">—</h1>

    <div class="day-tabs" id="dayTabs">
      <button data-day="A" class="on">A</button>
      <button data-day="B">B</button>
      <button data-day="C">C</button>
    </div>

    <div class="week-row">
      <select id="weekSelect" aria-label="Settimana"></select>
      <button id="newWeekBtn" class="btn-soft">+ Sett.</button>
      <span id="status" class="status">—</span>
      <button id="settingsBtn" class="btn-icon" aria-label="Impostazioni">⚙</button>
    </div>

    <div class="prog" id="progBar"></div>

    <div id="focus"></div>
    <div class="upnext" id="upnextLabel"></div>
    <div id="upnext"></div>

    <dialog id="settingsDialog">
      <form method="dialog" class="settings">
        <h2>Impostazioni</h2>
        <label for="tokenInput">Token GitHub (fine-grained, solo questo repo)</label>
        <input id="tokenInput" type="password" placeholder="github_pat_…" autocomplete="off">
        <p class="hint">Il token resta solo in questo browser. Vedi il README per crearlo.</p>
        <menu>
          <button id="tokenSave" value="save">Salva token</button>
          <button id="tokenClear" value="clear" class="btn-soft">Rimuovi</button>
          <button value="cancel" class="btn-soft">Chiudi</button>
        </menu>
      </form>
    </dialog>
  </div>

  <!-- Rest timer -->
  <div id="timerBar" class="timerbar hidden">
    <div class="t-info">
      <span id="timerLabel" class="t-label"></span>
      <span id="timerTime" class="t-time">0:00</span>
    </div>
    <div class="t-controls">
      <button id="tMinus" class="t-btn">−15</button>
      <button id="tToggle" class="t-btn">⏸</button>
      <button id="tPlus" class="t-btn">+15</button>
      <button id="tStop" class="t-btn t-stop">✕</button>
    </div>
  </div>

  <script type="module" src="./app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Smoke test (struttura presente)**

Run: `python -m http.server 8000`
Aprire `http://localhost:8000/`: si vedono header, tab A/B/C, riga settimana, ⚙ e (in basso, nascosta) la barra timer. La console mostrerà errori da `app.js` (cerca ancora `#days`): atteso, si sistema al Task 7.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(ui): nuova struttura index.html (single-day, tab, focus, up-next)"
```

---

### Task 7: `app.js` — stato giorno/settimana/focus, tab, barra progresso e up-next

Riscrive lo scaffolding del render: stato `currentDay`/`focusIndex`, wiring delle tab, `render()` che dipinge header + barra progresso + lista up-next. Il contenitore `#focus` resta vuoto (Task 8/9). Si **rimuove** il codice legacy (`flatEntry`, `entrySummary`, `exerciseHistory`, `shortLabel`, vecchio `renderDays`).

**Files:**
- Modify: `app.js` (import, stato, render, boot)

- [ ] **Step 1: Aggiornare gli import (righe 1-7)**

```javascript
import { PLAN } from "./plan.js";
import {
  isoWeekKey, emptyData, ensureWeek, setEntry, getEntry,
  normalizeEntry, normalizeSupersetEntry, prefillSets,
  GitHubStore, ConflictError, AuthError,
} from "./store.js";
import {
  parseTarget, activeExerciseIndex, activeSetIndex, bestKg, progressionDelta,
  withSet, withoutSet, withSupersetSet, withoutSupersetSet,
} from "./session.js";
import { RestTimer, formatTime } from "./timer.js";
```

- [ ] **Step 2: Sostituire il blocco stato (righe ~14-18)**

```javascript
// ---- App state ----
let data = emptyData();
let sha = null;
let currentWeek = isoWeekKey(new Date());
let currentDay = "A";
let focusIndex = 0;          // esercizio in focus nel giorno corrente
let store = null;
let saveTimer = null;
```

- [ ] **Step 3: Rimuovere il codice legacy di rendering**

In `app.js` eliminare interamente: `flatEntry` (righe ~50-59), `entrySummary` (~60-64), `shortLabel` (~66-73), `exerciseHistory` (~75-85), e il vecchio `renderDays` (~155-284). Lasciare intatti: token/pending helpers, rest-override helpers, `setStatus`, audio/beep, timer wiring (`timer`, `startRest`), `renderWeekSelect`, `prevWeekKey`, editing/saving (`onEdit`, `scheduleSave`, `saveToCloud`), week management, settings, timer controls, `initStore`.

> Nota: dopo questo passaggio restano riferimenti a `renderDays()` in `saveToCloud` (conflict→`renderDays()`), `changeWeek`, `boot`. Verranno rimpiazzati da `render()` nei passi seguenti.

- [ ] **Step 4: Aggiungere gli helper di giorno e il nuovo `render()`**

Aggiungere (es. dopo `prevWeekKey`):

```javascript
const dayPlan = () => PLAN.find((d) => d.day === currentDay) || PLAN[0];

function weekLabel(key) {
  const m = String(key).match(/W(\d+)/i);
  return m ? "SETT. " + m[1] : String(data.weeks[key]?.label || key);
}

function renderHeader() {
  const dp = dayPlan();
  document.getElementById("kickDay").textContent = currentDay;
  document.getElementById("kickWeek").textContent = weekLabel(currentWeek);
  document.getElementById("dayTitle").textContent = dp.title;
  for (const b of document.querySelectorAll("#dayTabs button")) {
    b.classList.toggle("on", b.dataset.day === currentDay);
  }
}

function renderProgress() {
  const dp = dayPlan();
  const bar = document.getElementById("progBar");
  bar.textContent = "";
  dp.exercises.forEach((ex, i) => {
    const seg = document.createElement("span");
    seg.className = "seg";
    if (i === focusIndex) seg.classList.add("cur");
    else if (isComplete(i)) seg.classList.add("done");
    bar.appendChild(seg);
  });
  const lbl = document.createElement("span");
  lbl.className = "lbl";
  lbl.textContent = `${String(focusIndex + 1).padStart(2, "0")}/${String(dp.exercises.length).padStart(2, "0")}`;
  bar.appendChild(lbl);
}

function isComplete(idx) {
  const ex = dayPlan().exercises[idx];
  const v = getEntry(data, currentWeek, currentDay, idx);
  if (ex.superset) {
    const e = normalizeSupersetEntry(v);
    const has = e.a.sets.length || e.b.sets.length;
    const ok = (t) => t.sets.length === 0 || t.sets.every((s) => s.done);
    return !!has && ok(e.a) && ok(e.b);
  }
  const e = normalizeEntry(v);
  return e.sets.length > 0 && e.sets.every((s) => s.done);
}

function renderUpNext() {
  const dp = dayPlan();
  document.getElementById("upnextLabel").textContent =
    `— prossimi · ${dp.exercises.length - 1} esercizi —`;
  const root = document.getElementById("upnext");
  root.textContent = "";
  dp.exercises.forEach((ex, i) => {
    if (i === focusIndex) return;
    const row = document.createElement("div");
    row.className = "nrow" + (isComplete(i) ? " done" : "");
    row.addEventListener("click", () => { focusIndex = i; render(); window.scrollTo({ top: 0, behavior: "smooth" }); });

    const id = document.createElement("span");
    id.className = "id"; id.textContent = String(i + 1).padStart(2, "0");

    const mid = document.createElement("div");
    const nm = document.createElement("div");
    nm.className = "nm"; nm.textContent = ex.name.replace(" + ", " + ");
    if (ex.superset) { const b = document.createElement("span"); b.className = "ssbadge"; b.textContent = "superset"; nm.appendChild(b); }
    const sub = document.createElement("div");
    sub.className = "sub"; sub.textContent = `${ex.setsReps} · rec ${getRest(currentDay, i, ex.restSeconds)}″`;
    mid.append(nm, sub);

    const right = document.createElement("div");
    right.className = "right";
    const best = document.createElement("div");
    best.className = "best";
    const bl = document.createElement("div");
    bl.className = "bl";
    if (ex.superset) { best.textContent = "A·B"; bl.textContent = "2 tracce"; }
    else { const bk = bestKg(data, currentDay, i); best.textContent = bk === null ? "—" : bk + " kg"; bl.textContent = "best"; }
    right.append(best, bl);

    row.append(id, mid, right);
    root.appendChild(row);
  });
}

function renderFocus() {
  // riempito nei Task 8 (normale) e 9 (superset)
  document.getElementById("focus").textContent = "";
}

function render() {
  renderHeader();
  renderProgress();
  renderFocus();
  renderUpNext();
}
```

- [ ] **Step 5: Aggiornare `changeWeek`, `saveToCloud` e aggiungere `changeDay`**

In `saveToCloud`, sostituire la chiamata `renderDays();` (nel ramo ConflictError) con `render();`.

Sostituire `changeWeek` con:

```javascript
function changeWeek(key) {
  currentWeek = key;
  data = ensureWeek(data, currentWeek, data.weeks[currentWeek]?.label);
  focusIndex = activeExerciseIndex(data, currentWeek, currentDay, dayPlan());
  renderWeekSelect();
  render();
}
function changeDay(day) {
  currentDay = day;
  focusIndex = activeExerciseIndex(data, currentWeek, currentDay, dayPlan());
  render();
}
```

- [ ] **Step 6: Aggiornare `boot()` per le tab e il primo render**

In `boot()`, dopo `document.getElementById("newWeekBtn").addEventListener(...)`, aggiungere:

```javascript
  for (const b of document.querySelectorAll("#dayTabs button")) {
    b.addEventListener("click", () => changeDay(b.dataset.day));
  }
```

E sostituire le ultime due righe di `boot` (`renderWeekSelect(); renderDays();`) con:

```javascript
  focusIndex = activeExerciseIndex(data, currentWeek, currentDay, dayPlan());
  renderWeekSelect();
  render();
```

- [ ] **Step 7: Smoke test in browser (OBBLIGATORIO)**

Run: `python -m http.server 8000`
Aprire `http://localhost:8000/` (no cache):
- Header mostra DAY A · SETT. nn · titolo del giorno A.
- Tab A/B/C: cliccando B/C cambiano titolo, barra progresso e up-next.
- Up-next elenca gli altri 6 esercizi del giorno con "best" (o "A·B / 2 tracce" per i superset); cliccando una riga questa diventa il focus (il contenitore focus è ancora vuoto: atteso).
- Nessun errore in console.

> Lezione del progetto: lo smoke test in browser vero non va saltato (un `TypeError: Illegal invocation` era sfuggito ai unit test). Verificare senza cache.

- [ ] **Step 8: Commit**

```bash
git add app.js
git commit -m "feat(ui): app.js single-day — tab, header, progresso, up-next"
```

---

### Task 8: `app.js` — focus card esercizio normale

Card "in focus" per un esercizio non-superset: righe delle serie già fatte (con marcatura `▲ +x` / `✓` e tap-per-rimuovere via Task 10), blocco di editing della serie corrente (stepper carico ±0.5 + stepper reps ±1, entrambi con **press-and-hold**), precompilazione dalla volta scorsa, chip "la volta scorsa", pallini serie, pulsante "+ serie", CTA "Serie fatta · avvia recupero" che salva la serie come `done`, avvia il recupero e avanza.

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Aggiungere l'helper press-and-hold e lo stato draft**

Aggiungere vicino agli helper di render:

```javascript
// Tap = un passo; tenuto premuto = ripetizione che accelera. step() muta e ridipinge il valore.
function bindHold(el, step) {
  let toRepeat = null, repeat = null;
  const fire = () => step();
  const start = (e) => {
    e.preventDefault();
    fire();
    toRepeat = setTimeout(() => { repeat = setInterval(fire, 80); }, 350);
  };
  const stop = () => { clearTimeout(toRepeat); clearInterval(repeat); toRepeat = repeat = null; };
  el.addEventListener("pointerdown", start);
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointerleave", stop);
  el.addEventListener("pointercancel", stop);
}

// Bozza della serie corrente (non salvata finché non si preme "Serie fatta").
let draft = { kg: "", reps: "" };

function repsLow(repsStr) {
  const m = String(repsStr).match(/\d+/);
  return m ? m[0] : "";
}
```

- [ ] **Step 2: Implementare `buildEditBlock` (stepper carico + reps, riutilizzabile anche dai superset)**

```javascript
// Costruisce il blocco di editing per una serie. `state` = {kg, reps} mutato in place.
// prev = {reps, kg} della volta scorsa per quella serie (o null). Ritorna l'elemento.
function buildEditBlock(label, state, prev) {
  const block = document.createElement("div");
  block.className = "editblock";

  const lab = document.createElement("div");
  lab.className = "editlabel"; lab.textContent = label;
  block.appendChild(lab);

  const stepper = document.createElement("div");
  stepper.className = "stepper";
  const minus = document.createElement("span"); minus.className = "mb"; minus.textContent = "−0.5";
  const valWrap = document.createElement("span"); valWrap.className = "val";
  const num = document.createElement("span"); num.className = "num";
  const unit = document.createElement("span"); unit.className = "u"; unit.textContent = " kg";
  valWrap.append(num, unit);
  const plus = document.createElement("span"); plus.className = "mb"; plus.textContent = "+0.5";
  stepper.append(minus, valWrap, plus);
  block.appendChild(stepper);

  const renderKg = () => {
    const n = parseFloat(String(state.kg).replace(",", "."));
    num.textContent = Number.isFinite(n) ? n.toFixed(1) : "—";
  };
  const stepKg = (delta) => {
    const n = parseFloat(String(state.kg).replace(",", "."));
    const base = Number.isFinite(n) ? n : 0;
    state.kg = String(Math.max(0, Math.round((base + delta) * 100) / 100));
    renderKg();
  };
  renderKg();
  bindHold(minus, () => stepKg(-0.5));
  bindHold(plus, () => stepKg(0.5));

  if (prev && (prev.kg || prev.reps)) {
    const pf = document.createElement("div");
    pf.className = "prefill"; pf.textContent = "↳ precompilato dalla volta scorsa · aggiusta col +/−";
    block.appendChild(pf);
  }

  const reprow = document.createElement("div");
  reprow.className = "reprow";
  const repstep = document.createElement("div");
  repstep.className = "repstep";
  const rdec = document.createElement("span"); rdec.className = "rmb"; rdec.textContent = "−";
  const rc = document.createElement("div"); rc.className = "rc";
  const rv = document.createElement("div"); rv.className = "rv";
  const rl = document.createElement("div"); rl.className = "l"; rl.textContent = "Ripetizioni";
  rc.append(rv, rl);
  const rinc = document.createElement("span"); rinc.className = "rmb"; rinc.textContent = "+";
  repstep.append(rdec, rc, rinc);
  reprow.appendChild(repstep);

  const renderReps = () => { rv.textContent = state.reps === "" ? "—" : String(state.reps); };
  const stepReps = (delta) => {
    const n = parseInt(state.reps, 10);
    const base = Number.isFinite(n) ? n : 0;
    state.reps = String(Math.max(0, base + delta));
    renderReps();
  };
  renderReps();
  bindHold(rdec, () => stepReps(-1));
  bindHold(rinc, () => stepReps(1));

  const chip = document.createElement("div");
  chip.className = "chip prevbest";
  const cv = document.createElement("div"); cv.className = "rv";
  cv.textContent = prev && (prev.reps || prev.kg) ? `${prev.reps || "—"}×${prev.kg || "—"}` : "—";
  const cl = document.createElement("div"); cl.className = "l"; cl.textContent = "la volta scorsa";
  chip.append(cv, cl);
  reprow.appendChild(chip);
  block.appendChild(reprow);

  return block;
}
```

- [ ] **Step 3: Implementare `renderFocusNormal` e collegarla in `renderFocus`**

```javascript
function setRow(i, set, prev, isCurrent, onRemove) {
  const row = document.createElement("div");
  row.className = "srow" + (isCurrent ? " cur" : "");
  const idx = document.createElement("span"); idx.className = "i"; idx.textContent = String(i + 1);
  const v = document.createElement("span"); v.className = "v";
  if (set.reps || set.kg) {
    v.append(document.createTextNode(set.reps || "—"));
    const x = document.createElement("span"); x.className = "x"; x.textContent = " × ";
    const u = document.createElement("span"); u.className = "u"; u.textContent = " kg";
    v.append(x, document.createTextNode(set.kg || "—"), u);
  } else {
    const x = document.createElement("span"); x.className = "x"; x.textContent = " × ";
    v.append(document.createTextNode("—"), x, document.createTextNode("—"));
  }
  row.append(idx, v);

  const delta = prev ? progressionDelta(set.kg, prev.kg) : null;
  if (set.done && delta !== null && delta > 0) {
    const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = `▲ +${delta}`;
    row.appendChild(tag);
  } else if (set.done && delta !== null && delta < 0) {
    const tag = document.createElement("span"); tag.className = "tag down"; tag.textContent = `▼ ${delta}`;
    row.appendChild(tag);
  } else if (set.done) {
    const chk = document.createElement("span"); chk.className = "chk"; chk.textContent = "✓";
    chk.style.marginLeft = "auto";
    row.appendChild(chk);
  } else if (isCurrent) {
    const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "in corso"; tag.style.marginLeft = "auto";
    row.appendChild(tag);
  }
  if (onRemove) {
    const rm = document.createElement("span"); rm.className = "rm"; rm.textContent = "✕";
    rm.addEventListener("click", (e) => { e.stopPropagation(); onRemove(); });
    row.appendChild(rm);
  }
  return row;
}

function renderFocusNormal(ex) {
  const root = document.getElementById("focus");
  const v = getEntry(data, currentWeek, currentDay, focusIndex);
  const entry = normalizeEntry(v);
  const tgt = parseTarget(ex.setsReps, false);
  const prev = prefillSets(data, currentWeek, currentDay, focusIndex); // [{reps,kg,done:false}]
  const curIdx = activeSetIndex(entry.sets);

  // init draft per la serie corrente
  draft = {
    kg: prev[curIdx]?.kg ?? "",
    reps: prev[curIdx]?.reps ?? repsLow(tgt.reps),
  };

  const card = document.createElement("div");
  card.className = "focus";

  const head = document.createElement("div");
  head.className = "exhead";
  const exn = document.createElement("div");
  exn.className = "exn";
  const id = document.createElement("span"); id.className = "id"; id.textContent = String(focusIndex + 1).padStart(2, "0");
  exn.append(id, document.createTextNode(ex.name));
  const tg = document.createElement("div");
  tg.className = "tgt"; tg.textContent = `obj ${tgt.sets}×${tgt.reps}`;
  head.append(exn, tg);
  card.appendChild(head);

  // serie: max fra quelle loggate e il target
  const setsBox = document.createElement("div");
  setsBox.className = "sets";
  const total = Math.max(entry.sets.length, tgt.sets, curIdx + 1);
  for (let i = 0; i < total; i++) {
    const set = entry.sets[i] || { reps: "", kg: "", done: false };
    const isCurrent = i === curIdx;
    const canRemove = i < entry.sets.length && entry.sets.length > 0;
    setsBox.appendChild(setRow(i, set, prev[i] || null, isCurrent, canRemove ? () => {
      data = setEntry(data, currentWeek, currentDay, focusIndex, withoutSet(v, i), new Date().toISOString());
      persist(); render();
    } : null));
  }
  card.appendChild(setsBox);

  // blocco editing serie corrente
  card.appendChild(buildEditBlock(`Serie ${curIdx + 1} — carico · step 0.5 kg`, draft, prev[curIdx] || null));

  // pallini + "+ serie"
  const dots = document.createElement("div");
  dots.className = "dots";
  for (let i = 0; i < total; i++) {
    const d = document.createElement("span");
    d.className = "dt" + (i < curIdx ? " on" : i === curIdx ? " cur" : "");
    dots.appendChild(d);
  }
  const add = document.createElement("button");
  add.className = "addset"; add.textContent = "+ serie";
  add.addEventListener("click", () => {
    data = setEntry(data, currentWeek, currentDay, focusIndex, withSet(v, entry.sets.length, { reps: "", kg: "", done: false }), new Date().toISOString());
    persist(); render();
  });
  dots.appendChild(add);
  card.appendChild(dots);

  // CTA
  const cta = document.createElement("button");
  cta.className = "cta"; cta.textContent = "Serie fatta · avvia recupero ▸";
  cta.addEventListener("click", () => {
    data = setEntry(data, currentWeek, currentDay, focusIndex,
      withSet(v, curIdx, { reps: draft.reps, kg: draft.kg, done: true }), new Date().toISOString());
    persist();
    startRest(getRest(currentDay, focusIndex, ex.restSeconds), ex.name);
    if (isComplete(focusIndex)) focusIndex = activeExerciseIndex(data, currentWeek, currentDay, dayPlan());
    render();
  });
  card.appendChild(cta);

  root.appendChild(card);
}
```

Aggiornare `renderFocus` (sostituendo lo stub del Task 7):

```javascript
function renderFocus() {
  const root = document.getElementById("focus");
  root.textContent = "";
  const ex = dayPlan().exercises[focusIndex];
  if (!ex) return;
  if (ex.superset) renderFocusSuperset(ex);  // Task 9
  else renderFocusNormal(ex);
}
```

- [ ] **Step 4: Aggiungere l'helper `persist()` (buffer + salvataggio con debounce)**

`onEdit` faceva buffer+save su `{kg,reps}`. Ora salviamo l'intera entry con `setEntry` direttamente nel render; serve solo bufferizzare e schedulare il salvataggio. Aggiungere:

```javascript
// Bufferizza l'entry corrente del focus e schedula il salvataggio cloud.
function persist() {
  const value = getEntry(data, currentWeek, currentDay, focusIndex);
  bufferEdit(currentWeek, currentDay, focusIndex, value);
  setStatus("in attesa ⧗", "pending");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToCloud, 1500);
}
```

> Nota: per i superset (Task 9) `focusIndex` è lo stesso indice esercizio, quindi `persist()` bufferizza l'intera entry `{a,b,note}`. Va bene così.

- [ ] **Step 5: Stub temporaneo di `renderFocusSuperset`**

Per non rompere il render finché non si fa il Task 9, aggiungere uno stub:

```javascript
function renderFocusSuperset(ex) {
  const root = document.getElementById("focus");
  const card = document.createElement("div");
  card.className = "focus";
  const p = document.createElement("div");
  p.className = "tgt"; p.textContent = `superset "${ex.name}" — in arrivo`;
  card.appendChild(p);
  root.appendChild(card);
}
```

- [ ] **Step 6: Smoke test in browser (OBBLIGATORIO)**

Run: `python -m http.server 8000`
Su un giorno/esercizio **normale** (es. A·01 Panca piana) verificare, senza cache:
- La card focus mostra nome, `obj 4×6-8`, righe serie (placeholder "— × —" se vuote), blocco editing.
- Stepper carico: tap `+0.5`/`−0.5` cambia il valore; **tenendo premuto** scorre veloce. Idem stepper reps con `+`/`−`.
- Se esistono dati della settimana precedente, il carico parte precompilato e il chip "la volta scorsa" mostra `reps×kg`.
- "Serie fatta": la serie diventa `✓` (o `▲ +x` se il carico è salito vs prima), parte il timer in basso, lo stato passa a "in attesa ⧗", il pallino avanza. A serie completate l'esercizio avanza al successivo.
- "+ serie" aggiunge una riga; la ✕ su una serie la rimuove.
- Niente errori in console. Con token configurato, lo stato torna "salvato ✓".

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat(ui): focus card normale — serie, stepper hold, Serie fatta"
```

---

### Task 9: `app.js` — focus card superset (due tracce A/B, CTA unica)

Sostituisce lo stub: due blocchi A e B impilati, ciascuno con le proprie serie fatte e il proprio blocco editing; un'unica CTA "Serie fatta (A+B)" chiude la serie corrente di entrambe le tracce e avvia un solo recupero.

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Sostituire `renderFocusSuperset` con l'implementazione completa**

```javascript
// Bozze separate per traccia A e B della serie corrente.
let draftA = { kg: "", reps: "" };
let draftB = { kg: "", reps: "" };

function trackBlock(trackKey, trackName, trackEntry, tgtTrack, prevSets, state) {
  const wrap = document.createElement("div");
  wrap.className = "track";

  const h = document.createElement("div");
  h.className = "track-h";
  const tA = document.createElement("span"); tA.className = "tA"; tA.textContent = trackKey.toUpperCase();
  const nm = document.createElement("span"); nm.className = "tnm"; nm.textContent = trackName;
  const tt = document.createElement("span"); tt.className = "ttgt"; tt.textContent = tgtTrack.reps;
  h.append(tA, nm, tt);
  wrap.appendChild(h);

  const curIdx = activeSetIndex(trackEntry.sets);
  state.kg = prevSets[curIdx]?.kg ?? "";
  state.reps = prevSets[curIdx]?.reps ?? repsLow(tgtTrack.reps);

  const setsBox = document.createElement("div");
  setsBox.className = "sets";
  const total = Math.max(trackEntry.sets.length, tgtTrack.sets, curIdx + 1);
  for (let i = 0; i < total; i++) {
    const set = trackEntry.sets[i] || { reps: "", kg: "", done: false };
    setsBox.appendChild(setRow(i, set, prevSets[i] || null, i === curIdx, null));
  }
  wrap.appendChild(setsBox);

  wrap.appendChild(buildEditBlock(`Serie ${curIdx + 1} ${trackKey.toUpperCase()} — step 0.5 kg`, state, prevSets[curIdx] || null));
  return { wrap, curIdx };
}

function renderFocusSuperset(ex) {
  const root = document.getElementById("focus");
  const v = getEntry(data, currentWeek, currentDay, focusIndex);
  const e = normalizeSupersetEntry(v);
  const tgt = parseTarget(ex.setsReps, true);
  const [nameA, nameB] = ex.name.includes(" + ") ? ex.name.split(" + ") : [ex.name, ex.name];

  // la "volta scorsa" per traccia: prendo le sets della settimana precedente più recente
  const prev = previousSupersetSets(currentWeek, currentDay, focusIndex);

  const card = document.createElement("div");
  card.className = "focus";

  const head = document.createElement("div");
  head.className = "exhead";
  const exn = document.createElement("div");
  exn.className = "exn";
  const id = document.createElement("span"); id.className = "id"; id.textContent = String(focusIndex + 1).padStart(2, "0");
  exn.append(id, document.createTextNode(ex.name));
  const badge = document.createElement("span"); badge.className = "ssbadge"; badge.textContent = "superset";
  exn.appendChild(badge);
  head.appendChild(exn);
  card.appendChild(head);

  const a = trackBlock("a", nameA.trim(), e.a, tgt.a, prev.a, draftA);
  const b = trackBlock("b", nameB.trim(), e.b, tgt.b, prev.b, draftB);
  card.append(a.wrap, b.wrap);

  const cta = document.createElement("button");
  cta.className = "cta"; cta.textContent = "Serie fatta (A+B) · avvia recupero ▸";
  cta.addEventListener("click", () => {
    let nv = withSupersetSet(v, "a", a.curIdx, { reps: draftA.reps, kg: draftA.kg, done: true });
    nv = withSupersetSet(nv, "b", b.curIdx, { reps: draftB.reps, kg: draftB.kg, done: true });
    data = setEntry(data, currentWeek, currentDay, focusIndex, nv, new Date().toISOString());
    persist();
    startRest(getRest(currentDay, focusIndex, ex.restSeconds), ex.name);
    if (isComplete(focusIndex)) focusIndex = activeExerciseIndex(data, currentWeek, currentDay, dayPlan());
    render();
  });
  card.appendChild(cta);

  root.appendChild(card);
}

// Sets della settimana loggata più recente, per entrambe le tracce ({a:[...], b:[...]}).
function previousSupersetSets(weekKey, day, idx) {
  const keys = Object.keys(data?.weeks ?? {})
    .filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k) && k < weekKey).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    const e = normalizeSupersetEntry(getEntry(data, keys[i], day, idx));
    if (e.a.sets.length || e.b.sets.length) {
      return {
        a: e.a.sets.map(({ reps, kg }) => ({ reps, kg })),
        b: e.b.sets.map(({ reps, kg }) => ({ reps, kg })),
      };
    }
  }
  return { a: [], b: [] };
}
```

- [ ] **Step 2: Smoke test in browser (OBBLIGATORIO)**

Run: `python -m http.server 8000`
Portare in focus un **superset** (es. A·05 Pushdown + Curl — toccarlo in up-next), senza cache:
- La card mostra due blocchi A e B con nome traccia, target, righe serie e due stepper indipendenti.
- Modificare kg/reps in A e B; "Serie fatta (A+B)" chiude la serie corrente di entrambe (✓ su A e B), avvia **un solo** recupero, avanza il pallino di entrambe.
- Con storico, ogni traccia precompila dal proprio valore della volta scorsa.
- Nessun errore in console.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat(ui): focus card superset A/B con CTA unica"
```

---

### Task 10: Editing delle serie chiuse + wiring finale + pulizia

Tap su una serie già `done` per correggerne reps/kg al volo (spec §9.4). Rimozione definitiva del trigger recupero dal `blur` (ora è solo sulla CTA) e del residuo `onEdit`/`scheduleSave` non più usati per i campi. Pulizia import e review olistica.

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Rendere editabili le serie chiuse in `setRow`**

In `setRow`, la `v` (valore della serie) è già `cursor:pointer`. Aggiungere un callback `onEdit` opzionale e, se la serie è `done`, al click aprire un prompt per correggere. Modificare la firma e il corpo:

Sostituire la riga della firma:
```javascript
function setRow(i, set, prev, isCurrent, onRemove) {
```
con:
```javascript
function setRow(i, set, prev, isCurrent, onRemove, onEditSet) {
```
e, dopo aver creato `v`, aggiungere:
```javascript
  if (set.done && onEditSet) {
    v.addEventListener("click", () => {
      const reps = prompt("Ripetizioni:", set.reps);
      if (reps === null) return;
      const kg = prompt("Carico (kg):", set.kg);
      if (kg === null) return;
      onEditSet({ reps: reps.trim(), kg: kg.trim() });
    });
  }
```

- [ ] **Step 2: Passare `onEditSet` dalle due card**

In `renderFocusNormal`, nella creazione di ogni `setRow`, passare il sesto argomento:
```javascript
    setsBox.appendChild(setRow(i, set, prev[i] || null, isCurrent, canRemove ? () => {
      data = setEntry(data, currentWeek, currentDay, focusIndex, withoutSet(v, i), new Date().toISOString());
      persist(); render();
    } : null, (patch) => {
      data = setEntry(data, currentWeek, currentDay, focusIndex, withSet(v, i, { ...patch, done: true }), new Date().toISOString());
      persist(); render();
    }));
```

In `trackBlock` (superset), passare l'editor per traccia:
```javascript
    setsBox.appendChild(setRow(i, set, prevSets[i] || null, i === curIdx, null, (patch) => {
      const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, focusIndex), trackKey, i, { ...patch, done: true });
      data = setEntry(data, currentWeek, currentDay, focusIndex, nv, new Date().toISOString());
      persist(); render();
    }));
```

- [ ] **Step 3: Rimuovere `onEdit` e `scheduleSave` se non più referenziati**

Verificare con una ricerca che `onEdit(` e `scheduleSave(` non siano più chiamati (la CTA usa `setEntry` + `persist`; `newWeek` usava `scheduleSave` → sostituire lì con `persist()` se necessario, oppure mantenere `scheduleSave` solo per `newWeek`). Concretamente:

Run: `grep -n "onEdit\|scheduleSave" app.js`
- Se `onEdit` non è più chiamato, eliminarne la definizione.
- `scheduleSave` è ancora usato in `newWeek`: mantenerlo. (Non è legato al focus, va bene.)

- [ ] **Step 4: Verifica finale dei test unitari**

Run: `node --test`
Expected: PASS — tutti (store + timer + plan + session). Nessuna regressione.

- [ ] **Step 5: Smoke test olistico in browser (OBBLIGATORIO)**

Run: `python -m http.server 8000`
Percorso completo senza cache:
1. Giorno A normale: logga 3-4 serie con "Serie fatta", verifica timer, avanzamento, `▲ +x` se carico sale.
2. Tap su una serie chiusa → correggi reps/kg → si aggiorna.
3. Passa al superset A·05: logga A+B con CTA unica.
4. Cambia giorno (B, C) e settimana: lo stato si ricarica, il focus va al primo esercizio incompleto.
5. Crea "+ Sett.": nuova settimana, precompilazione dalla precedente attiva.
6. Con token: lo stato arriva a "salvato ✓"; ricaricando la pagina i dati restano (round-trip GitHub).
7. Console pulita su tutto il percorso.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat(ui): correzione serie chiuse + pulizia wiring legacy"
```

- [ ] **Step 7: Review olistica**

Usare `superpowers:requesting-code-review` sul diff completo della Fase 2 (`git diff <commit prima della Task 1>..HEAD`). Verificare in particolare: nessun residuo di `flatEntry`/`entrySummary`/`exerciseHistory`; coerenza dei nomi delle funzioni session; nessun `innerHTML` con contenuto non statico; tap target ≥ 44px; `inputmode` dove si digita; contrasto dei grigi (`--dim`/`--faint`) leggibile su fondo scuro.

---

## Self-Review (fatto in fase di scrittura)

**Copertura spec (Fase 2):**
- Header kicker + titolo + barra progresso a segmenti + `0X/0N` → Task 6, 7. ✓
- Esercizio in focus con serie già fatte (righe mono) → Task 8 (`setRow`). ✓
- Stepper carico step 0.5 precompilato + press-and-hold → Task 8 (`buildEditBlock`, `bindHold`). ✓ (decisione utente)
- Ripetizioni stepper ±1 → Task 8. ✓ (decisione utente D3)
- Pallini serie + CTA "Serie fatta" che avvia recupero (trigger spostato dal blur) → Task 8, 10. ✓ (spec §4.5, §5.5)
- Confronto "la volta scorsa" + `▲ +x` → Task 8 (`prefillSets`, `progressionDelta`). ✓ (spec §4.4)
- Prossimi esercizi collassati + best + superset marcati → Task 7 (`renderUpNext`, `bestKg`). ✓ (spec §3.3)
- Superset due tracce A/B con CTA unica → Task 9. ✓ (decisione utente D2, spec §4.3)
- Tab A/B/C + selettore settimana → Task 6, 7. ✓ (decisione utente D1)
- Timer barra fissa in basso ridisegnata → Task 5, 6 (riusa `RestTimer`). ✓ (spec §3.4)
- Serie chiuse modificabili al tocco → Task 10. ✓ (spec §9.4)
- Tema scuro A+C (colori, font) → Task 5. ✓ (spec §2)

**Fuori scope (Fase 3), volutamente non coperti:** Wake Lock, PWA, sync batch, UI calcolatore dischi, nota rapida nell'UI, ritocco fine contrasto. La logica già pronta in `store.js` (`platesPerSide`) e nel modello (`note`) resta inutilizzata fino alla Fase 3: atteso.

**Placeholder:** nessuno; ogni step di codice ha il codice completo.

**Coerenza nomi:** `parseTarget`/`parseTargetTrack`, `activeSetIndex`, `activeExerciseIndex`, `isEntryComplete`, `bestKg`, `progressionDelta`, `withSet`/`withoutSet`/`withSupersetSet`/`withoutSupersetSet` (session.js); `render`/`renderHeader`/`renderProgress`/`renderFocus`/`renderFocusNormal`/`renderFocusSuperset`/`renderUpNext`, `buildEditBlock`, `setRow`, `trackBlock`, `bindHold`, `persist`, `changeDay`/`changeWeek` (app.js) usati coerentemente. `isComplete` (app.js, DOM) e `isEntryComplete` (session.js, puro) sono due cose distinte di proposito.

**Rischi noti / da sorvegliare nei smoke test:**
- `bindHold` usa Pointer Events: verificare su touch reale (telefono) oltre che desktop.
- Il `draft` è uno stato singolo: ricalcolato a ogni `render()` dalla serie corrente — non deve "perdersi" tra un tap stepper e la CTA (nessun `render()` parziale tra i due).
- `previousSupersetSets` replica il filtro chiavi di `prefillSets` (`^\d{4}-W\d{2}(\.\d+)?$`): tenerli coerenti.
- Round-trip GitHub di `{a,b,note}`: già blindato a livello pure dalla Fase 1, ma confermarlo nel smoke con token (punto 6 del Task 10).

---

## Fase successiva (piano separato, da scrivere dopo la Fase 2)

**Fase 3 — Piattaforma & extra.** Wake Lock durante la sessione; PWA (`manifest.json` + service worker, installabile/offline); **sync batch** (commit all'avvio recupero invece che a ogni edit); UI del **calcolatore dischi** (usa `platesPerSide`, set dischi configurabile in ⚙); **nota rapida per esercizio** (campo che scrive `entries[...].note`); ritocco contrasto dei grigi deboli. Doc dedicato in `docs/superpowers/plans/`.
