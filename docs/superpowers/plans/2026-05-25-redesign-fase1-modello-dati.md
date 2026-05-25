# Redesign Fase 1 — Modello dati per-serie (fondazione) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introdurre la logica dati per il logging **per-serie** (rip/kg indipendenti per serie + done), la precompilazione dalla volta scorsa e il calcolatore dischi — tutto come **funzioni pure testabili in Node**, retrocompatibili, senza toccare l'interfaccia.

**Architecture:** Si estende `store.js` (già sede delle funzioni pure). Il modello entry passa da `{kg, reps}` (stringhe, eventualmente slash-encoded come `"8/8/7"`) a `{ sets: [{reps, kg, done}], note }`. `normalizeEntry` viene **spostata da `app.js` a `store.js`** (esportata e testata) e gestisce la migrazione non distruttiva dei dati esistenti. Si aggiungono `normalizeSupersetEntry`, `prefillSets` e `platesPerSide`. Nessun cambiamento di UI in questa fase: l'app continua a funzionare perché le funzioni nuove sono additive e `setEntry/getEntry` restano invariate.

**Tech Stack:** JavaScript ES modules (vanilla), test runner `node:test` + `node:assert/strict` (come `tests/store.test.js`). Nessuna dipendenza nuova.

---

## File Structure

- `store.js` — **modifica**: aggiunge `normalizeEntry`, `normalizeSet`, `normalizeSupersetEntry`, `prefillSets`, `platesPerSide` (più helper interni `splitVals`, `zipSets`). Resta il posto unico delle funzioni pure.
- `tests/store.test.js` — **modifica**: nuovi test per le funzioni aggiunte.
- `app.js` — **modifica minima**: rimuove la `normalizeEntry` locale e importa quella da `store.js` (le firme combaciano: continua a restituire un oggetto, ma ora con `.sets`). NB: l'uso attuale di `cur.kg`/`cur.reps` in `app.js` verrà adeguato nella **Fase 2** (UI); in Fase 1 si mantiene un adattatore di compatibilità per non rompere la UI esistente — vedi Task 6.

Modello dati di riferimento (per settimana, dentro `data.weeks[weekKey].entries[day][idx]`):

```jsonc
// esercizio normale
{ "sets": [ { "reps": "8", "kg": "72.5", "done": true }, { "reps": "7", "kg": "70", "done": false } ], "note": "presa media" }
// superset
{ "a": { "sets": [ ... ], "note": "" }, "b": { "sets": [ ... ], "note": "" }, "note": "" }
```

---

### Task 1: `normalizeEntry` per-serie in `store.js`

**Files:**
- Modify: `store.js` (aggiunta in coda alla sezione "Pure data helpers", dopo `getEntry`)
- Test: `tests/store.test.js`

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in fondo a `tests/store.test.js`:

```javascript
import { normalizeEntry } from "../store.js";

test("normalizeEntry: oggetto già strutturato resta tale (con default done/note)", () => {
  const v = { sets: [{ reps: "8", kg: "72.5", done: true }], note: "presa media" };
  assert.deepEqual(normalizeEntry(v), {
    sets: [{ reps: "8", kg: "72.5", done: true }],
    note: "presa media",
  });
});

test("normalizeEntry: legacy {kg,reps} con reps slash si espande in serie, kg ripetuto", () => {
  const v = { kg: "70", reps: "8/8/7" };
  assert.deepEqual(normalizeEntry(v), {
    sets: [
      { reps: "8", kg: "70", done: false },
      { reps: "8", kg: "70", done: false },
      { reps: "7", kg: "70", done: false },
    ],
    note: "",
  });
});

test("normalizeEntry: legacy {kg,reps} con kg multipli paralleli", () => {
  const v = { kg: "70/72.5", reps: "8/8" };
  assert.deepEqual(normalizeEntry(v).sets, [
    { reps: "8", kg: "70", done: false },
    { reps: "8", kg: "72.5", done: false },
  ]);
});

test("normalizeEntry: stringa legacy = sole ripetizioni", () => {
  assert.deepEqual(normalizeEntry("8/8/7").sets, [
    { reps: "8", kg: "", done: false },
    { reps: "8", kg: "", done: false },
    { reps: "7", kg: "", done: false },
  ]);
});

test("normalizeEntry: vuoto/assente -> nessuna serie", () => {
  assert.deepEqual(normalizeEntry(""), { sets: [], note: "" });
  assert.deepEqual(normalizeEntry(undefined), { sets: [], note: "" });
  assert.deepEqual(normalizeEntry({ kg: "", reps: "" }), { sets: [], note: "" });
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test`
Expected: FAIL — `normalizeEntry` non esportata da `store.js` (`SyntaxError`/`undefined is not a function`).

- [ ] **Step 3: Implementare in `store.js`**

Aggiungere dopo `getEntry` (riga ~36):

```javascript
// ---- Entry per-serie: { sets: [{reps, kg, done}], note }. Migra i formati legacy. ----

function splitVals(str) {
  return String(str ?? "").split("/").map((x) => x.trim()).filter((x) => x !== "");
}

function zipSets(repsStr, kgStr) {
  const reps = splitVals(repsStr);
  const kgs = splitVals(kgStr);
  const n = Math.max(reps.length, kgs.length);
  const sets = [];
  for (let i = 0; i < n; i++) {
    sets.push({
      reps: reps[i] ?? reps[reps.length - 1] ?? "",
      kg: kgs[i] ?? kgs[kgs.length - 1] ?? "",
      done: false,
    });
  }
  return sets;
}

export function normalizeSet(s) {
  return { reps: String(s?.reps ?? ""), kg: String(s?.kg ?? ""), done: !!s?.done };
}

export function normalizeEntry(v) {
  if (v && typeof v === "object" && Array.isArray(v.sets)) {
    return { sets: v.sets.map(normalizeSet), note: v.note ?? "" };
  }
  if (v && typeof v === "object") {
    return { sets: zipSets(v.reps, v.kg), note: v.note ?? "" };
  }
  if (typeof v === "string" && v.trim()) {
    return { sets: zipSets(v, ""), note: "" };
  }
  return { sets: [], note: "" };
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test`
Expected: PASS (tutti, inclusi i 13 esistenti).

- [ ] **Step 5: Commit**

```bash
git add store.js tests/store.test.js
git commit -m "feat(data): normalizeEntry per-serie con migrazione legacy"
```

---

### Task 2: `normalizeSupersetEntry` in `store.js`

**Files:**
- Modify: `store.js`
- Test: `tests/store.test.js`

- [ ] **Step 1: Scrivere i test che falliscono**

```javascript
import { normalizeSupersetEntry } from "../store.js";

test("normalizeSupersetEntry: forma {a,b,note} normalizza entrambe le tracce", () => {
  const v = { a: { sets: [{ reps: "15", kg: "25", done: true }] }, b: { reps: "15", kg: "12" }, note: "ok" };
  const out = normalizeSupersetEntry(v);
  assert.deepEqual(out.a.sets, [{ reps: "15", kg: "25", done: true }]);
  assert.deepEqual(out.b.sets, [{ reps: "15", kg: "12", done: false }]);
  assert.equal(out.note, "ok");
});

test("normalizeSupersetEntry: entry legacy singola finisce nella traccia A, B vuota", () => {
  const out = normalizeSupersetEntry({ kg: "", reps: "15/15" });
  assert.equal(out.a.sets.length, 2);
  assert.deepEqual(out.b, { sets: [], note: "" });
});

test("normalizeSupersetEntry: vuoto -> due tracce vuote", () => {
  assert.deepEqual(normalizeSupersetEntry(""), { a: { sets: [], note: "" }, b: { sets: [], note: "" }, note: "" });
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test`
Expected: FAIL — `normalizeSupersetEntry` non esportata.

- [ ] **Step 3: Implementare in `store.js`** (dopo `normalizeEntry`)

```javascript
export function normalizeSupersetEntry(v) {
  if (v && typeof v === "object" && (v.a || v.b)) {
    return { a: normalizeEntry(v.a), b: normalizeEntry(v.b), note: v.note ?? "" };
  }
  const base = normalizeEntry(v);
  return { a: base, b: { sets: [], note: "" }, note: base.note };
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add store.js tests/store.test.js
git commit -m "feat(data): normalizeSupersetEntry per tracce A/B"
```

---

### Task 3: `prefillSets` (precompilazione dalla volta scorsa)

**Files:**
- Modify: `store.js`
- Test: `tests/store.test.js`

- [ ] **Step 1: Scrivere i test che falliscono**

```javascript
import { prefillSets } from "../store.js";

test("prefillSets: copia le serie della settimana precedente con done=false", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "70", done: true }, { reps: "8", kg: "70", done: true }] }, "t1");
  const pre = prefillSets(d, "2026-W22", "A", 0);
  assert.deepEqual(pre, [
    { reps: "8", kg: "70", done: false },
    { reps: "8", kg: "70", done: false },
  ]);
});

test("prefillSets: usa la settimana loggata più recente fra le precedenti", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", 0, { sets: [{ reps: "8", kg: "60" }] }, "t1");
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "65" }] }, "t2");
  assert.deepEqual(prefillSets(d, "2026-W22", "A", 0), [{ reps: "8", kg: "65", done: false }]);
});

test("prefillSets: nessuno storico -> array vuoto", () => {
  assert.deepEqual(prefillSets(emptyData(), "2026-W22", "A", 0), []);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test`
Expected: FAIL — `prefillSets` non esportata.

- [ ] **Step 3: Implementare in `store.js`**

```javascript
export function prefillSets(data, weekKey, day, idx) {
  const keys = Object.keys(data?.weeks ?? {}).filter((k) => k < weekKey).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    const e = normalizeEntry(getEntry(data, keys[i], day, idx));
    if (e.sets.length) return e.sets.map((s) => ({ reps: s.reps, kg: s.kg, done: false }));
  }
  return [];
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add store.js tests/store.test.js
git commit -m "feat(data): prefillSets precompila dalla volta scorsa"
```

---

### Task 4: `platesPerSide` (calcolatore dischi)

**Files:**
- Modify: `store.js`
- Test: `tests/store.test.js`

- [ ] **Step 1: Scrivere i test che falliscono**

```javascript
import { platesPerSide } from "../store.js";

test("platesPerSide: 72.5 kg con bilanciere 20 -> 20+5+1.25 per lato", () => {
  assert.deepEqual(platesPerSide(72.5), { perSide: [20, 5, 1.25], leftover: 0 });
});

test("platesPerSide: 60 kg -> 20 per lato", () => {
  assert.deepEqual(platesPerSide(60), { perSide: [20], leftover: 0 });
});

test("platesPerSide: carico <= bilanciere -> nessun disco", () => {
  assert.deepEqual(platesPerSide(20), { perSide: [], leftover: 0 });
  assert.deepEqual(platesPerSide(15), { perSide: [], leftover: 0 });
});

test("platesPerSide: set dischi personalizzato e resto non coperto", () => {
  const out = platesPerSide(63, { bar: 20, plates: [10, 5] }); // perSide target 21.5 -> 10+10+... resto
  assert.deepEqual(out.perSide, [10, 10]);
  assert.equal(out.leftover, 1.5);
});
```

- [ ] **Step 2: Eseguire i test e verificare che falliscano**

Run: `node --test`
Expected: FAIL — `platesPerSide` non esportata.

- [ ] **Step 3: Implementare in `store.js`**

```javascript
export function platesPerSide(targetKg, { bar = 20, plates = [20, 15, 10, 5, 2.5, 1.25] } = {}) {
  let remaining = (Number(targetKg) - bar) / 2;
  if (!Number.isFinite(remaining) || remaining <= 0) return { perSide: [], leftover: 0 };
  const sorted = [...plates].sort((a, b) => b - a);
  const perSide = [];
  for (const p of sorted) {
    while (remaining + 1e-9 >= p) { perSide.push(p); remaining -= p; }
  }
  return { perSide, leftover: Math.round(remaining * 100) / 100 };
}
```

- [ ] **Step 4: Eseguire i test e verificare che passino**

Run: `node --test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add store.js tests/store.test.js
git commit -m "feat(data): platesPerSide calcolatore dischi"
```

---

### Task 5: Esporre la struttura nel salvataggio (smoke pure)

Nessuna modifica di codice: `setEntry`/`getEntry` salvano già un valore qualsiasi (anche `{sets,note}`), e `GitHubStore.save` serializza con `JSON.stringify(data, null, 2)`. Questo task verifica solo che il round-trip regga.

**Files:**
- Test: `tests/store.test.js`

- [ ] **Step 1: Scrivere il test che fallisce**

```javascript
test("setEntry/getEntry reggono il valore per-serie e il round-trip base64", () => {
  const val = { sets: [{ reps: "8", kg: "72.5", done: true }], note: "ok" };
  let d = setEntry(emptyData(), "2026-W22", "A", 0, val, "t1");
  assert.deepEqual(getEntry(d, "2026-W22", "A", 0), val);
  // round-trip come fa GitHubStore.save/load
  const round = JSON.parse(fromBase64(toBase64(JSON.stringify(d, null, 2))));
  assert.deepEqual(getEntry(round, "2026-W22", "A", 0), val);
});
```

- [ ] **Step 2: Eseguire e verificare**

Run: `node --test`
Expected: PASS (è già supportato dal codice attuale — il test blinda il comportamento).

- [ ] **Step 3: Commit**

```bash
git add tests/store.test.js
git commit -m "test(data): blinda round-trip per-serie su setEntry/getEntry"
```

---

### Task 6: Adattatore di compatibilità in `app.js` (non rompere la UI attuale)

La UI attuale (Fase 2 la sostituirà) legge `cur.kg`/`cur.reps`. Per non romperla mentre il modello diventa per-serie, `app.js` importa `normalizeEntry` da `store.js` e mantiene un piccolo adattatore che ricava `kg`/`reps` "appiattiti" dalle serie.

**Files:**
- Modify: `app.js:2-6` (import) e `app.js:49-59` (rimozione `normalizeEntry` locale + adattatore)

- [ ] **Step 1: Aggiornare gli import in `app.js`**

Sostituire il blocco import (righe 2-5) con:

```javascript
import {
  isoWeekKey, emptyData, ensureWeek, setEntry, getEntry,
  normalizeEntry,
  GitHubStore, ConflictError, AuthError,
} from "./store.js";
```

- [ ] **Step 2: Rimuovere la `normalizeEntry` locale e aggiungere l'adattatore**

In `app.js` eliminare la funzione locale `normalizeEntry` (righe ~50-54) e sostituirla con un adattatore che appiattisce le serie nel vecchio formato `{kg, reps}` slash-encoded, così il render esistente continua a funzionare:

```javascript
// Adattatore Fase 1: appiattisce {sets} nel vecchio {kg, reps} slash per la UI attuale.
// (La Fase 2 sostituirà il render e userà direttamente le serie.)
function flatEntry(v) {
  const { sets } = normalizeEntry(v);
  if (!sets.length) return { kg: "", reps: "" };
  const reps = sets.map((s) => s.reps).filter(Boolean).join("/");
  const kgs = [...new Set(sets.map((s) => s.kg).filter(Boolean))];
  const kg = kgs.length <= 1 ? (kgs[0] ?? "") : sets.map((s) => s.kg).join("/");
  return { kg, reps };
}
```

- [ ] **Step 3: Aggiornare i 2 punti d'uso**

In `app.js`, sostituire le 2 chiamate a `normalizeEntry(...)` rimaste (riga ~207 `const cur = normalizeEntry(getEntry(...))` e riga ~76 dentro `exerciseHistory`, `const e = normalizeEntry(getEntry(...))`) con `flatEntry(...)`:

```javascript
const cur = flatEntry(getEntry(data, currentWeek, day.day, ei));
```
```javascript
const e = flatEntry(getEntry(data, k, day, idx));
```

- [ ] **Step 4: Smoke test in browser (OBBLIGATORIO per il frontend)**

Avviare un server statico locale e aprire l'app; verificare che i dati `2026-W22` esistenti si vedano ancora e che scrivere reps/kg funzioni come prima.

Run:
```bash
python -m http.server 8000
```
Aprire `http://localhost:8000/`, controllare: i campi reps/kg mostrano i valori salvati; modificarli aggiorna lo stato (badge "in attesa ⧗" → "salvato ✓" con token). Nessun errore in console.

> Lezione dal progetto: lo smoke test in browser non va saltato (vedi memoria progetto: un `TypeError: Illegal invocation` sfuggito ai unit test). Verificare in un browser vero, no cache.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "refactor(app): normalizeEntry da store.js + adattatore flatEntry"
```

---

## Self-Review (fatto in fase di scrittura)

- **Copertura spec (Fase 1):** modello per-serie ✓ (Task 1), superset A/B ✓ (Task 2), precompilazione volta scorsa ✓ (Task 3), calcolatore dischi (logica) ✓ (Task 4), persistenza/round-trip ✓ (Task 5), retrocompat senza rompere UI ✓ (Task 6). Le parti **UI** (stepper, focus card, timer su "Serie fatta", note nell'interfaccia) e **piattaforma** (Wake Lock, PWA, sync batch) sono **fuori da questa fase** — vedi sotto.
- **Placeholder:** nessuno; ogni step ha codice/comando reale.
- **Coerenza nomi:** `normalizeEntry`, `normalizeSet`, `normalizeSupersetEntry`, `prefillSets`, `platesPerSide`, `flatEntry` usati coerentemente; `splitVals`/`zipSets` sono interni (non esportati).

---

## Fasi successive (piani separati, da scrivere dopo aver eseguito la Fase 1)

**Fase 2 — Redesign UI/UX (il grosso del lavoro visivo).** Riscrive `index.html` + `style.css` + il render di `app.js` secondo la direzione "A+C, focus C" (fonte visiva: `.superpowers/brainstorm/.../candidato-AC.html`): header + barra progresso, esercizio attivo in focus con righe-serie mono, **stepper carico step 0.5 kg precompilato** (usa `prefillSets`), pallini serie, CTA "Serie fatta" che **avvia il recupero** (sposta il trigger dal blur del campo), confronto "volta scorsa", prossimi esercizi collassati, **superset A/B**, timer barra fissa in basso ridisegnato. Serie già fatte modificabili al tocco.

**Fase 3 — Piattaforma & extra.** Wake Lock durante la sessione; PWA (`manifest.json` + service worker, installabile/offline); **sync batch** (commit all'avvio recupero invece che a ogni tasto/blur); UI del **calcolatore dischi** (usa `platesPerSide`, set dischi configurabile in ⚙); **nota rapida per esercizio** (campo persistito in `entries[...].note`); ritocco contrasto dei grigi deboli.

Ognuna avrà il proprio doc in `docs/superpowers/plans/`.
