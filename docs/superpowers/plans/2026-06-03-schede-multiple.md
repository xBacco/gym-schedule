# Schede multiple Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere all'utente di salvare più schede con un nome, crearne di nuove (vuota o duplicando l'attiva) e cambiare quella attiva, ognuna con il proprio storico (plan + weeks), senza perdere la scheda corrente.

**Architecture:** Il blob persistito passa da schema 5 (`{plan, weeks}` top-level) a schema 6 (`{activeSheetId, sheets:[{id,name,plan,weeks}]}`, normalizzato). In memoria `data` resta in forma "idratata" — `plan`/`weeks` top-level = scheda attiva — così le centinaia di letture esistenti `data.plan`/`data.weeks` non cambiano. Due funzioni pure di confine, `hydrate`/`dehydrate`, traducono tra blob normalizzato e forma in-memory ai punti load/save. Tutto ciò che è globale (tema, bilanciere, dischi, commenti rapidi, nutrizione) vive già fuori dal blob (localStorage / statico) e resta condiviso senza modifiche. La UI aggiunge una voce drawer "Schede" che apre un gestore full-screen (stesso pattern overlay di calendario/nutrizione); la vecchia voce "Modifica scheda" sparisce dal drawer e diventa un bottone nella card della scheda attiva del gestore.

**Tech Stack:** Vanilla JS ES modules, `node --test` (test runner), Supabase (persistenza blob con optimistic locking), localStorage profile storage.

---

## File Structure

- **Create `sheets.js`** — modulo puro per il modello multi-scheda: costanti, migrazione 5→6, hydrate/dehydrate, operazioni CRUD su schede (add/rename/delete/setActive), summaries per la UI. Nessun import DOM. Testabile in Node.
- **Create `tests/sheets.test.js`** — test del modulo `sheets.js`.
- **Modify `store.js`** — `mergeBlobs` deve fondere per-scheda (match per id) invece che `plan`/`weeks` top-level. Riusa `mergeWeekEntries`/`mergeWeekDates` esistenti.
- **Modify `tests/store.merge.test.js`** — nuovi test per il merge multi-scheda + retro-compatibilità schema 5.
- **Modify `app.js`** — boot/load: idrata dopo la catena migrazioni; persist/push: deidrata prima di andare al cloud; nuovo overlay gestore schede (`openSheets`/`renderSheets`); dispatch drawer; rimozione handler "plan" dal drawer; bottone "Modifica scheda" dentro la card attiva.
- **Modify `index.html`** — voce drawer "Schede" (sostituisce "Modifica scheda"); markup overlay `sheetsOverlay`.

> Decisione architetturale chiave: `sheets.js` opera **solo su blob normalizzati** (sheets[] autoritativo, niente plan/weeks top-level). `hydrate`/`dehydrate` sono l'unico ponte verso la forma in-memory usata da `app.js`. Questo tiene il modulo puro e i test semplici, e confina la complessità "proiezione attiva" a due funzioni.

---

## Phase 1 — Data layer (modulo puro `sheets.js`)

### Task 1: Costanti e `defaultSheetName`

**Files:**
- Create: `sheets.js`
- Test: `tests/sheets.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/sheets.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHEETS_SCHEMA, defaultSheetName } from "../sheets.js";

test("SHEETS_SCHEMA è 6", () => {
  assert.equal(SHEETS_SCHEMA, 6);
});

test("defaultSheetName: progressivo sul numero di schede", () => {
  assert.equal(defaultSheetName([]), "Scheda 1");
  assert.equal(defaultSheetName([{ id: "a", name: "X" }]), "Scheda 2");
  assert.equal(defaultSheetName([{ id: "a" }, { id: "b" }]), "Scheda 3");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sheets.test.js`
Expected: FAIL — `Cannot find module '../sheets.js'`

- [ ] **Step 3: Write minimal implementation**

```js
// sheets.js
// ---- Modello multi-scheda (puro, testabile in Node). Opera su BLOB NORMALIZZATI:
//      { schema:6, updatedAt, activeSheetId, sheets:[{ id, name, plan, weeks }] }.
//      hydrate/dehydrate traducono da/verso la forma in-memory usata da app.js. ----
import { genId } from "./editor.js";

export const SHEETS_SCHEMA = 6;

// Nome di default "Scheda N", progressivo sul numero di schede esistenti.
// L'utente può rinominare in qualsiasi momento (renameSheet).
export function defaultSheetName(sheets) {
  return `Scheda ${(Array.isArray(sheets) ? sheets.length : 0) + 1}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sheets.test.js`
Expected: PASS (3 test)

- [ ] **Step 5: Commit**

```bash
git add sheets.js tests/sheets.test.js
git commit -m "feat(schede): costanti + defaultSheetName"
```

---

### Task 2: `toSheetsBlob` — migrazione 5→6 idempotente

**Files:**
- Modify: `sheets.js`
- Test: `tests/sheets.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append a tests/sheets.test.js
import { toSheetsBlob } from "../sheets.js";

test("toSheetsBlob: avvolge plan/weeks legacy in Scheda 1", () => {
  const legacy = { schema: 5, updatedAt: "2026-01-01", plan: [{ day: "A", title: "A", exercises: [] }], weeks: { "2026-W01": { label: "W1", entries: {} } } };
  const b = toSheetsBlob(legacy);
  assert.equal(b.schema, 6);
  assert.equal(b.sheets.length, 1);
  assert.equal(b.sheets[0].name, "Scheda 1");
  assert.equal(b.activeSheetId, b.sheets[0].id);
  assert.deepEqual(b.sheets[0].plan, legacy.plan);
  assert.deepEqual(b.sheets[0].weeks, legacy.weeks);
  assert.equal(b.updatedAt, "2026-01-01");
  assert.equal("plan" in b, false);   // normalizzato: niente plan/weeks top-level
  assert.equal("weeks" in b, false);
});

test("toSheetsBlob: idempotente su blob già schema 6", () => {
  const b1 = toSheetsBlob({ schema: 5, plan: [], weeks: {}, updatedAt: null });
  const b2 = toSheetsBlob(b1);
  assert.deepEqual(b2, b1);
});

test("toSheetsBlob: dati vuoti/null → una Scheda 1 vuota", () => {
  const b = toSheetsBlob(null);
  assert.equal(b.sheets.length, 1);
  assert.deepEqual(b.sheets[0].plan, []);
  assert.deepEqual(b.sheets[0].weeks, {});
});

test("toSheetsBlob: activeSheetId orfano → ripiega sulla prima scheda", () => {
  const b = toSheetsBlob({ schema: 6, updatedAt: null, activeSheetId: "ghost", sheets: [{ id: "real", name: "X", plan: [], weeks: {} }] });
  assert.equal(b.activeSheetId, "real");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sheets.test.js`
Expected: FAIL — `toSheetsBlob is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// append a sheets.js

// Coercizione a blob normalizzato schema 6. Idempotente. Gestisce:
// - legacy schema <6: avvolge { plan, weeks } in un'unica "Scheda 1";
// - già schema 6: clona, ripara activeSheetId orfano, garantisce sheets non vuoto;
// - null/undefined: una Scheda 1 vuota.
export function toSheetsBlob(input) {
  const data = input || {};
  if (data.schema >= SHEETS_SCHEMA && Array.isArray(data.sheets)) {
    const out = structuredClone(data);
    if (!out.sheets.length) {
      out.sheets = [{ id: genId([]), name: defaultSheetName([]), plan: [], weeks: {} }];
    }
    const ids = out.sheets.map((s) => s.id);
    if (!ids.includes(out.activeSheetId)) out.activeSheetId = out.sheets[0].id;
    out.schema = SHEETS_SCHEMA;
    return out;
  }
  const id = genId([]);
  return {
    schema: SHEETS_SCHEMA,
    updatedAt: data.updatedAt ?? null,
    activeSheetId: id,
    sheets: [{
      id,
      name: "Scheda 1",
      plan: Array.isArray(data.plan) ? structuredClone(data.plan) : [],
      weeks: data.weeks ? structuredClone(data.weeks) : {},
    }],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sheets.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sheets.js tests/sheets.test.js
git commit -m "feat(schede): toSheetsBlob migrazione 5->6 idempotente"
```

---

### Task 3: `hydrate` / `dehydrate` — ponte blob ⇄ forma in-memory

**Files:**
- Modify: `sheets.js`
- Test: `tests/sheets.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append a tests/sheets.test.js
import { hydrate, dehydrate } from "../sheets.js";

test("hydrate: proietta plan/weeks della scheda attiva al top-level", () => {
  const blob = {
    schema: 6, updatedAt: "t", activeSheetId: "b",
    sheets: [
      { id: "a", name: "A", plan: [{ day: "A" }], weeks: { w1: {} } },
      { id: "b", name: "B", plan: [{ day: "B" }], weeks: { w2: {} } },
    ],
  };
  const d = hydrate(blob);
  assert.deepEqual(d.plan, [{ day: "B" }]);   // scheda attiva = b
  assert.deepEqual(d.weeks, { w2: {} });
  assert.equal(d.activeSheetId, "b");
  assert.equal(d.schema, 6);
  assert.equal(d.sheets.length, 2);
});

test("dehydrate: riscrive plan/weeks top-level nella scheda attiva, normalizza", () => {
  const data = hydrate({
    schema: 6, updatedAt: "t", activeSheetId: "b",
    sheets: [
      { id: "a", name: "A", plan: [{ day: "A" }], weeks: {} },
      { id: "b", name: "B", plan: [], weeks: {} },
    ],
  });
  data.plan = [{ day: "B", title: "nuovo" }];        // simula edit in-memory
  data.weeks = { wX: { label: "wX", entries: {} } };
  const blob = dehydrate(data);
  assert.equal("plan" in blob, false);
  assert.equal("weeks" in blob, false);
  const b = blob.sheets.find((s) => s.id === "b");
  assert.deepEqual(b.plan, [{ day: "B", title: "nuovo" }]);
  assert.deepEqual(b.weeks, { wX: { label: "wX", entries: {} } });
  const a = blob.sheets.find((s) => s.id === "a");
  assert.deepEqual(a.plan, [{ day: "A" }]);          // scheda inattiva intatta
});

test("hydrate∘dehydrate è round-trip stabile", () => {
  const blob = toSheetsBlob({ schema: 5, plan: [{ day: "A" }], weeks: { w: { label: "w", entries: {} } }, updatedAt: "t" });
  assert.deepEqual(dehydrate(hydrate(blob)), blob);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sheets.test.js`
Expected: FAIL — `hydrate is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// append a sheets.js

// Scheda attiva di un blob normalizzato (fallback: prima scheda).
export function activeSheet(blob) {
  const sheets = blob?.sheets ?? [];
  return sheets.find((s) => s.id === blob.activeSheetId) ?? sheets[0] ?? null;
}

// Blob normalizzato → forma in-memory: plan/weeks della scheda attiva proiettati
// al top-level, così tutto il codice esistente che legge data.plan/data.weeks
// funziona invariato. sheets[]/activeSheetId restano disponibili per il gestore.
export function hydrate(input) {
  const blob = toSheetsBlob(input);
  const act = activeSheet(blob);
  return {
    schema: blob.schema,
    updatedAt: blob.updatedAt ?? null,
    activeSheetId: blob.activeSheetId,
    sheets: blob.sheets,
    plan: structuredClone(act.plan ?? []),
    weeks: structuredClone(act.weeks ?? {}),
  };
}

// Forma in-memory → blob normalizzato: i plan/weeks top-level (la scheda attiva)
// vengono riscritti nella relativa entry di sheets[], poi plan/weeks top-level
// vengono rimossi. updatedAt propagato.
export function dehydrate(data) {
  const base = toSheetsBlob(data); // garantisce sheets[]/activeSheetId/schema
  const out = {
    schema: SHEETS_SCHEMA,
    updatedAt: data.updatedAt ?? base.updatedAt ?? null,
    activeSheetId: data.activeSheetId ?? base.activeSheetId,
    sheets: structuredClone(data.sheets ?? base.sheets),
  };
  const ids = out.sheets.map((s) => s.id);
  if (!ids.includes(out.activeSheetId)) out.activeSheetId = out.sheets[0].id;
  const act = out.sheets.find((s) => s.id === out.activeSheetId);
  act.plan = structuredClone(data.plan ?? []);
  act.weeks = structuredClone(data.weeks ?? {});
  return out;
}
```

> Nota: `toSheetsBlob(data)` chiamato dentro `dehydrate` su una forma in-memory (che HA `sheets`/`schema:6`) entra nel ramo idempotente e clona — i `plan`/`weeks` top-level in-memory vengono ignorati lì e riscritti esplicitamente subito dopo. Corretto.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sheets.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sheets.js tests/sheets.test.js
git commit -m "feat(schede): hydrate/dehydrate ponte blob<->in-memory"
```

---

### Task 4: Operazioni CRUD su blob — `addSheet`, `renameSheet`, `deleteSheet`, `setActiveSheet`

**Files:**
- Modify: `sheets.js`
- Test: `tests/sheets.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append a tests/sheets.test.js
import { addSheet, renameSheet, deleteSheet, setActiveSheet } from "../sheets.js";

const base = () => toSheetsBlob({ schema: 5, plan: [{ day: "A" }], weeks: { w: { label: "w", entries: {} } }, updatedAt: "t" });

test("addSheet vuota: appende, attiva la nuova, plan/weeks vuoti", () => {
  const b = addSheet(base(), { duplicateActive: false });
  assert.equal(b.sheets.length, 2);
  assert.equal(b.sheets[1].name, "Scheda 2");
  assert.equal(b.activeSheetId, b.sheets[1].id);
  assert.deepEqual(b.sheets[1].plan, []);
  assert.deepEqual(b.sheets[1].weeks, {});
  assert.notEqual(b.sheets[1].id, b.sheets[0].id);
});

test("addSheet duplica attiva: copia plan, storico vuoto, attiva la copia", () => {
  const b = addSheet(base(), { duplicateActive: true });
  assert.equal(b.sheets.length, 2);
  assert.deepEqual(b.sheets[1].plan, b.sheets[0].plan); // stesso contenuto
  assert.notEqual(b.sheets[1].plan, b.sheets[0].plan);  // clone, non riferimento
  assert.deepEqual(b.sheets[1].weeks, {});              // storico NON copiato
  assert.equal(b.activeSheetId, b.sheets[1].id);
});

test("renameSheet: rinomina per id, trim, vuoto ignorato", () => {
  const b0 = base();
  const id = b0.sheets[0].id;
  assert.equal(renameSheet(b0, id, "  Push/Pull  ").sheets[0].name, "Push/Pull");
  assert.equal(renameSheet(b0, id, "   ").sheets[0].name, b0.sheets[0].name); // invariato
});

test("deleteSheet: rimuove; se era attiva attiva la prima rimasta", () => {
  const b = addSheet(base(), { duplicateActive: false }); // attiva = sheets[1]
  const activeId = b.activeSheetId;
  const after = deleteSheet(b, activeId);
  assert.equal(after.sheets.length, 1);
  assert.equal(after.sheets.find((s) => s.id === activeId), undefined);
  assert.equal(after.activeSheetId, after.sheets[0].id);
});

test("deleteSheet: l'ultima scheda non è eliminabile (no-op)", () => {
  const b0 = base();
  const after = deleteSheet(b0, b0.sheets[0].id);
  assert.deepEqual(after, b0);
});

test("setActiveSheet: cambia attiva; id ignoto è no-op", () => {
  const b = addSheet(base(), { duplicateActive: false });
  const firstId = b.sheets[0].id;
  assert.equal(setActiveSheet(b, firstId).activeSheetId, firstId);
  assert.equal(setActiveSheet(b, "ghost").activeSheetId, b.activeSheetId);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sheets.test.js`
Expected: FAIL — `addSheet is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// append a sheets.js

// Crea una nuova scheda e la rende attiva. duplicateActive=true copia il plan
// della scheda attiva (storico SEMPRE vuoto); altrimenti scheda completamente vuota.
export function addSheet(blob, { duplicateActive = false } = {}) {
  const out = toSheetsBlob(blob);
  const id = genId(out.sheets.map((s) => s.id));
  const src = duplicateActive ? activeSheet(out) : null;
  out.sheets.push({
    id,
    name: defaultSheetName(out.sheets),
    plan: src ? structuredClone(src.plan ?? []) : [],
    weeks: {},
  });
  out.activeSheetId = id;
  return out;
}

// Rinomina per id. Trim; nome vuoto → invariato.
export function renameSheet(blob, id, name) {
  const out = toSheetsBlob(blob);
  const t = String(name ?? "").trim();
  if (!t) return out;
  const s = out.sheets.find((x) => x.id === id);
  if (s) s.name = t;
  return out;
}

// Elimina per id. Rifiuta (no-op) se è l'ultima scheda. Se elimina l'attiva,
// attiva la prima rimasta.
export function deleteSheet(blob, id) {
  const out = toSheetsBlob(blob);
  if (out.sheets.length <= 1) return out;
  const idx = out.sheets.findIndex((s) => s.id === id);
  if (idx === -1) return out;
  out.sheets.splice(idx, 1);
  if (out.activeSheetId === id) out.activeSheetId = out.sheets[0].id;
  return out;
}

// Cambia la scheda attiva. id ignoto → no-op.
export function setActiveSheet(blob, id) {
  const out = toSheetsBlob(blob);
  if (out.sheets.some((s) => s.id === id)) out.activeSheetId = id;
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sheets.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sheets.js tests/sheets.test.js
git commit -m "feat(schede): CRUD add/rename/delete/setActive su blob"
```

---

### Task 5: `sheetSummaries` — dati pre-calcolati per la UI del gestore

**Files:**
- Modify: `sheets.js`
- Test: `tests/sheets.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append a tests/sheets.test.js
import { sheetSummaries } from "../sheets.js";

test("sheetSummaries: conta giorni, esercizi, settimane, ultima data", () => {
  const blob = {
    schema: 6, updatedAt: "t", activeSheetId: "a",
    sheets: [
      { id: "a", name: "PPL", plan: [
          { day: "A", exercises: [{ id: "1" }, { id: "2" }] },
          { day: "B", exercises: [{ id: "3" }] },
        ],
        weeks: {
          "2026-W01": { label: "w1", entries: {}, dates: { A: "2026-01-05" } },
          "2026-W02": { label: "w2", entries: {}, dates: { B: "2026-01-12" } },
        } },
      { id: "b", name: "Vuota", plan: [], weeks: {} },
    ],
  };
  const sums = sheetSummaries(blob);
  assert.equal(sums.length, 2);
  assert.deepEqual(
    { ...sums[0], id: undefined },
    { id: undefined, name: "PPL", active: true, days: 2, exercises: 3, weeks: 2, lastDate: "2026-01-12" }
  );
  assert.equal(sums[0].id, "a");
  assert.deepEqual(
    { ...sums[1], id: undefined },
    { id: undefined, name: "Vuota", active: false, days: 0, exercises: 0, weeks: 0, lastDate: null }
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sheets.test.js`
Expected: FAIL — `sheetSummaries is not a function`

- [ ] **Step 3: Write minimal implementation**

```js
// append a sheets.js

// Riepilogo per la UI del gestore: una riga per scheda con conteggi e ultima data
// loggata. lastDate = max tra tutte le weeks[*].dates[*] della scheda (o null).
export function sheetSummaries(blob) {
  const b = toSheetsBlob(blob);
  return b.sheets.map((s) => {
    const plan = Array.isArray(s.plan) ? s.plan : [];
    const exercises = plan.reduce((n, d) => n + (Array.isArray(d.exercises) ? d.exercises.length : 0), 0);
    const weekKeys = Object.keys(s.weeks ?? {});
    let lastDate = null;
    for (const wk of weekKeys) {
      const dates = s.weeks[wk]?.dates ?? {};
      for (const day of Object.keys(dates)) {
        const dt = dates[day];
        if (dt && (lastDate === null || dt > lastDate)) lastDate = dt;
      }
    }
    return {
      id: s.id,
      name: s.name,
      active: s.id === b.activeSheetId,
      days: plan.length,
      exercises,
      weeks: weekKeys.length,
      lastDate,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sheets.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add sheets.js tests/sheets.test.js
git commit -m "feat(schede): sheetSummaries per la UI del gestore"
```

---

## Phase 2 — Merge multi-device (`store.js`)

### Task 6: `mergeBlobs` fonde per-scheda (match per id)

**Files:**
- Modify: `store.js:236-264` (funzione `mergeBlobs`)
- Test: `tests/store.merge.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append a tests/store.merge.test.js
import { toSheetsBlob, activeSheet } from "../sheets.js";

test("mergeBlobs: fonde le weeks per scheda con id corrispondente", () => {
  const local = toSheetsBlob({ schema: 5, plan: [{ day: "A" }], weeks: { "2026-W01": { label: "w1", entries: { A: { "0": { sets: [{ reps: "5", kg: "100" }] } } }, dates: { A: "2026-01-05" } } }, updatedAt: "2026-01-05" });
  const id = local.sheets[0].id;
  // remoto: stessa scheda (stesso id), settimana diversa
  const remote = structuredClone(local);
  remote.sheets[0].weeks = { "2026-W02": { label: "w2", entries: { A: { "0": { sets: [{ reps: "5", kg: "105" }] } } }, dates: { A: "2026-01-12" } } };
  remote.updatedAt = "2026-01-12";
  const merged = mergeBlobs(local, remote);
  const s = merged.sheets.find((x) => x.id === id);
  assert.deepEqual(Object.keys(s.weeks).sort(), ["2026-W01", "2026-W02"]);
});

test("mergeBlobs: union di schede presenti solo su un lato", () => {
  const local = toSheetsBlob({ schema: 5, plan: [], weeks: {}, updatedAt: "a" });
  const remote = structuredClone(local);
  remote.sheets.push({ id: "remote-only", name: "Remota", plan: [{ day: "Z" }], weeks: {} });
  const merged = mergeBlobs(local, remote);
  assert.equal(merged.sheets.length, 2);
  assert.ok(merged.sheets.some((s) => s.id === "remote-only"));
});

test("mergeBlobs: retro-compat — fonde un blob schema 5 con uno schema 6", () => {
  const legacy = { schema: 5, plan: [{ day: "A" }], weeks: { "2026-W01": { label: "w1", entries: {} } }, updatedAt: "2026-01-01" };
  const sheeted = toSheetsBlob({ schema: 5, plan: [{ day: "A" }], weeks: { "2026-W02": { label: "w2", entries: {} } }, updatedAt: "2026-01-02" });
  // id diversi (legacy genera id nuovo) → due schede; nessun crash
  const merged = mergeBlobs(legacy, sheeted);
  assert.equal(merged.schema, 6);
  assert.ok(Array.isArray(merged.sheets));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/store.merge.test.js`
Expected: FAIL — `merged.sheets is undefined` (mergeBlobs ancora top-level)

- [ ] **Step 3: Write minimal implementation**

Aggiungi l'import in cima a `store.js` (dopo gli altri, vicino riga 1):

```js
import { toSheetsBlob } from "./sheets.js";
```

Sostituisci la funzione `mergeBlobs` (store.js:236-264) con la versione per-scheda. Le helper `mergeWeekEntries` e `mergeWeekDates` esistenti (store.js:209-234) restano invariate e vengono riusate:

```js
function mergeSheetWeeks(localWeeks, remoteWeeks, lUpd, rUpd) {
  const wkKeys = new Set([...Object.keys(localWeeks ?? {}), ...Object.keys(remoteWeeks ?? {})]);
  const weeks = {};
  for (const wk of wkKeys) {
    const lw = localWeeks?.[wk];
    const rw = remoteWeeks?.[wk];
    weeks[wk] = {
      label: lw?.label ?? rw?.label ?? wk,
      entries: mergeWeekEntries(lw, rw, lUpd, rUpd),
      dates: mergeWeekDates(lw?.dates, rw?.dates),
    };
  }
  return weeks;
}

export function mergeBlobs(local, remote) {
  const L = toSheetsBlob(local);
  const R = toSheetsBlob(remote);
  const lUpd = L.updatedAt;
  const rUpd = R.updatedAt;

  const byId = new Map();
  for (const s of L.sheets) byId.set(s.id, { local: s, remote: null });
  for (const s of R.sheets) {
    const e = byId.get(s.id);
    if (e) e.remote = s; else byId.set(s.id, { local: null, remote: s });
  }

  const sheets = [];
  for (const { local: ls, remote: rs } of byId.values()) {
    if (ls && !rs) { sheets.push(structuredClone(ls)); continue; }
    if (rs && !ls) { sheets.push(structuredClone(rs)); continue; }
    // Stesso id su entrambi: plan vince il non-vuoto (local prioritario); weeks union.
    const localPlanFilled = Array.isArray(ls.plan) && ls.plan.length > 0;
    sheets.push({
      id: ls.id,
      name: ls.name ?? rs.name,
      plan: localPlanFilled ? ls.plan : (rs.plan ?? []),
      weeks: mergeSheetWeeks(ls.weeks, rs.weeks, lUpd, rUpd),
    });
  }

  const updatedAt = (lUpd ?? "") > (rUpd ?? "") ? lUpd : rUpd;
  const ids = sheets.map((s) => s.id);
  let activeSheetId = (lUpd ?? "") >= (rUpd ?? "") ? L.activeSheetId : R.activeSheetId;
  if (!ids.includes(activeSheetId)) activeSheetId = ids[0];
  return { schema: 6, updatedAt, activeSheetId, sheets };
}
```

- [ ] **Step 4: Run tutti i test del merge per assicurarsi nessuna regressione**

Run: `node --test tests/store.merge.test.js`
Expected: PASS (nuovi + eventuali esistenti adattati)

> Se test esistenti in `store.merge.test.js` asserivano su `merged.plan`/`merged.weeks` top-level, aggiornali a `activeSheet(merged).plan` / `activeSheet(merged).weeks` importando `activeSheet` da `../sheets.js`. NON cambiare la logica di merge delle entry: è la stessa, solo annidata per scheda.

- [ ] **Step 5: Commit**

```bash
git add store.js tests/store.merge.test.js
git commit -m "feat(schede): mergeBlobs fonde per-scheda (match per id)"
```

---

## Phase 3 — Wiring persistenza in `app.js` (nessuna UI nuova ancora)

> Obiettivo fase: dopo questa fase l'app si comporta **identica a oggi** con una sola scheda, ma internamente gira su schema 6 (hydrate al load, dehydrate al save). Verificabile aprendo l'app: la scheda attuale resta, lo storico c'è, i log si salvano.

### Task 7: Idrata al boot dopo la catena migrazioni

**Files:**
- Modify: `app.js` (import in testa; punti di idratazione boot — vedi sotto)

- [ ] **Step 1: Aggiungi l'import**

In cima a `app.js`, vicino all'import di `store.js` (app.js:6-7), aggiungi:

```js
import { hydrate, dehydrate } from "./sheets.js";
```

- [ ] **Step 2: Idrata dopo OGNI punto in cui la catena migrazioni produce `data`**

Ci sono 3 punti che terminano con `data = patchPlanV5(patchPlanV4(backfillMuscles(migrate(...), ...)))`:
`app.js:2683`, `app.js:2775`, `app.js:2848`. Avvolgi ciascuno con `hydrate(...)`.

app.js:2683 — da:
```js
    data = patchPlanV5(patchPlanV4(backfillMuscles(migrate(data), PLAN)));
```
a:
```js
    data = hydrate(patchPlanV5(patchPlanV4(backfillMuscles(migrate(data), PLAN))));
```

app.js:2775 — da:
```js
  data = patchPlanV5(patchPlanV4(backfillMuscles(migrate(withPending, PLAN), PLAN)));
```
a:
```js
  data = hydrate(patchPlanV5(patchPlanV4(backfillMuscles(migrate(withPending, PLAN), PLAN))));
```

app.js:2848 — da:
```js
  data = patchPlanV5(patchPlanV4(backfillMuscles(migrate(merged), PLAN)));
```
a:
```js
  data = hydrate(patchPlanV5(patchPlanV4(backfillMuscles(migrate(merged), PLAN))));
```

- [ ] **Step 3: node --check**

Run: `node --check app.js`
Expected: nessun output (sintassi ok)

- [ ] **Step 4: Verifica manuale**

Avvia il server statico e apri l'app loggato. Atteso: la scheda attuale e lo storico sono presenti come prima (la migrazione 5→6 è trasparente). Controlla in console: `JSON.parse(localStorage.getItem(...)).schema` — non necessario, ma `data.sheets` deve esistere.

Run: `python -m http.server 8794` poi apri `http://localhost:8794/`

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat(schede): idrata data al boot (schema 6 trasparente)"
```

---

### Task 8: Deidrata prima del push cloud

**Files:**
- Modify: `app.js` — funzione push e reconcile (riga ~2552-2557, ~2660-2667, ~2861-2869) usano `mergeBlobs(merged, remote.data)` / `store.save(...)`. Il blob che va al cloud deve essere **normalizzato** (dehydrate).

- [ ] **Step 1: Individua i punti di save al cloud**

`mergeBlobs` ora restituisce un blob **già normalizzato** (Task 6). Resta da garantire che il primo argomento (lo stato locale in-memory) sia deidratato, così gli edit della scheda attiva (plan/weeks top-level) rientrino nella scheda giusta PRIMA del merge. I call-site esatti (verificati nel sorgente):

`app.js:2553` e `app.js:2865` — entrambi `const merged = mergeBlobs(data, remote.data);` → sostituisci `data` con `dehydrate(data)`:
```js
      const merged = mergeBlobs(dehydrate(data), remote.data);
```

`app.js:2663` — `const merged = mergeBlobs(cached, remote.data);` dove `cached` viene da `profileStorage.get("data")`. Se `cached` è la forma in-memory (idratata), deidratalo: `mergeBlobs(dehydrate(cached), remote.data)`. `mergeBlobs` tollera comunque input non-normalizzati (li passa per `toSheetsBlob`), quindi anche senza dehydrate non crasha — ma applicalo per coerenza.

> NON toccare `app.js:2769` (`mergeBlobs(legacy ?? emptyData(), data ?? emptyData())`) né `app.js:2847` (`mergeBlobs(data ?? emptyData(), seed)`): sono i merge di onboarding/seed, già coperti dall'idratazione del Task 7 (il risultato viene passato dentro la catena `migrate(...)` → `hydrate(...)`). `mergeBlobs` li normalizza via `toSheetsBlob`.

- [ ] **Step 2: Idrata il risultato del merge quando ridiventa `data` in memoria**

Dove il risultato del merge viene riassegnato a `data` in memoria dopo il save (es. reconcile che aggiorna la vista), avvolgilo in `hydrate`. Cerca assegnazioni `data = merged` o riletture post-save: se presenti, diventano `data = hydrate(merged)`. Se il flusso salva e basta senza riassegnare `data`, nessuna modifica qui.

- [ ] **Step 3: node --check**

Run: `node --check app.js`
Expected: nessun output

- [ ] **Step 4: Verifica manuale push**

Apri l'app, logga una serie, attendi il push (o forzalo). Atteso nessun errore in console; ricaricando, il log persiste.

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat(schede): deidrata prima del push cloud, idrata il merge"
```

---

## Phase 4 — UI gestore schede

### Task 9: Markup overlay `sheetsOverlay` + voce drawer "Schede"

**Files:**
- Modify: `index.html:381` (voce drawer); `index.html` (nuovo overlay, accanto a `calendarOverlay`)

- [ ] **Step 1: Sostituisci la voce drawer "Modifica scheda" con "Schede"**

index.html:381 — da:
```html
      <button class="dr-item" data-act="plan" role="menuitem"><span class="e">✎</span><span class="t">Modifica scheda</span></button>
```
a:
```html
      <button class="dr-item" data-act="sheets" role="menuitem"><span class="e">📒</span><span class="t">Schede</span></button>
```

- [ ] **Step 2: Aggiungi l'overlay gestore schede**

Dopo il blocco `calendarOverlay` (index.html, cerca `id="calendarOverlay"` … fino al `</div>` di chiusura, intorno a riga 273), inserisci:

```html
  <!-- Gestore schede: overlay a schermo intero (stessa logica history degli altri) -->
  <div id="sheetsOverlay" class="focus-ov hidden" aria-hidden="true">
    <div class="focus-bar">
      <button id="sheetsBack" class="focus-back" aria-label="Chiudi schede">←</button>
      <div class="fs-titles">
        <div class="fs-name">Schede</div>
        <div id="sheetsSub" class="fs">programma attivo e archivio</div>
      </div>
    </div>
    <div id="sheetsBody" class="sheets-body"></div>
  </div>
```

> Usa le stesse classi `focus-ov`/`focus-bar`/`focus-back`/`fs-titles`/`fs-name`/`fs` di `calendarOverlay` per coerenza visiva. `sheets-body` è il contenitore renderizzato da JS (stile aggiunto al Task 11).

- [ ] **Step 3: node --check (HTML non si checka, salta) — verifica apertura pagina**

Run: `python -m http.server 8794` poi apri `http://localhost:8794/` — la pagina carica senza errori console (l'overlay è `hidden`).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(schede): voce drawer Schede + markup overlay gestore"
```

---

### Task 10: `openSheets`/`renderSheets` + dispatch drawer

**Files:**
- Modify: `app.js` — nuove funzioni overlay; dispatch map (app.js:2512); rimozione voce "plan" dal drawer; listener back.

- [ ] **Step 1: Aggiungi import delle operazioni schede**

Aggiorna l'import da `./sheets.js` (aggiunto al Task 7) per includere le operazioni:

```js
import {
  hydrate, dehydrate, addSheet, renameSheet, deleteSheet, setActiveSheet, sheetSummaries,
} from "./sheets.js";
```

- [ ] **Step 2: Aggiungi le funzioni overlay (vicino a openCalendar, app.js:~216-240)**

```js
// ---- Gestore schede: overlay a schermo intero (stessa logica history degli altri). ----
let sheetsOpen = false;

function openSheets() {
  sheetsOpen = true;
  history.pushState({ gymSheets: true }, "");
  renderSheets();
}

function closeSheets() {
  if (!sheetsOpen) return;
  if (history.state && history.state.gymSheets) history.back();
  else { sheetsOpen = false; renderSheets(); }
}

// Applica una mutazione (blob→blob) alla scheda corrente, deidratando/idratando
// attorno, poi salva e ridisegna gestore + home.
function mutateSheets(fn) {
  data = hydrate(fn(dehydrate(data)));
  scheduleSave();
  renderSheets();
  render();
}
```

- [ ] **Step 3: Registra il dispatch e i listener (app.js:2512)**

app.js:2512 — da:
```js
    const map = { nutrition: openNutrition, calendar: openCalendar, plan: openPlanEditor, settings: openSettings };
```
a:
```js
    const map = { nutrition: openNutrition, calendar: openCalendar, sheets: openSheets, settings: openSettings };
```

Aggiungi il listener del back dell'overlay (vicino a dove sono registrati `calendarBack`/`nutritionBack`; cerca `getElementById("calendarBack")`):
```js
  document.getElementById("sheetsBack").addEventListener("click", closeSheets);
```

Nel gestore `popstate` (cerca `planOpen`/`gymPlan` a app.js:~2647), aggiungi la chiusura simmetrica dell'overlay schede:
```js
    if (sheetsOpen && !(history.state && history.state.gymSheets)) { sheetsOpen = false; renderSheets(); }
```

- [ ] **Step 4: Stub `renderSheets` (riempito al Task 11)**

Aggiungi sotto `openSheets`:
```js
function renderSheets() {
  const ov = document.getElementById("sheetsOverlay");
  if (!sheetsOpen) { ov.classList.add("hidden"); ov.setAttribute("aria-hidden", "true"); return; }
  ov.classList.remove("hidden"); ov.setAttribute("aria-hidden", "false");
  // corpo: Task 11
}
```

- [ ] **Step 5: node --check**

Run: `node --check app.js`
Expected: nessun output

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat(schede): openSheets/closeSheets + dispatch drawer + mutateSheets"
```

---

### Task 11: Corpo del gestore — lista schede, card attiva con "Modifica scheda", azioni

**Files:**
- Modify: `app.js` — corpo `renderSheets`
- Modify: `style.css` (cerca dove sono definite `.cal-*` per mettere accanto le `.sheets-*`)

- [ ] **Step 1: Implementa il corpo di `renderSheets`**

Sostituisci il commento `// corpo: Task 11` con:

```js
  const body = document.getElementById("sheetsBody");
  body.innerHTML = "";
  const sums = sheetSummaries(dehydrate(data));
  document.getElementById("sheetsSub").textContent =
    `${sums.length} scheda${sums.length === 1 ? "" : "e"} · attiva + archivio`;

  for (const s of sums) {
    const card = document.createElement("div");
    card.className = "sheet-card" + (s.active ? " active" : "");

    const head = document.createElement("div");
    head.className = "sheet-nm";
    const nm = document.createElement("span");
    nm.className = "sheet-name";
    nm.textContent = s.name;
    head.appendChild(nm);
    if (s.active) {
      const badge = document.createElement("span");
      badge.className = "sheet-badge";
      badge.textContent = "attiva";
      head.appendChild(badge);
    }
    card.appendChild(head);

    const meta = document.createElement("div");
    meta.className = "sheet-meta";
    const last = s.lastDate ? `ult. ${s.lastDate}` : "mai usata";
    meta.textContent = `${s.days} giorni · ${s.exercises} es · ${s.weeks} sett. · ${last}`;
    card.appendChild(meta);

    const acts = document.createElement("div");
    acts.className = "sheet-acts";

    if (s.active) {
      // Card attiva: bottone "Modifica scheda" (apre l'editor del piano) + rinomina + elimina.
      acts.appendChild(mkBtn("✎ Modifica scheda", "edit", () => { closeSheets(); openPlanEditor(); }));
      acts.appendChild(mkBtn("rinomina", "", () => renameSheetPrompt(s)));
    } else {
      acts.appendChild(mkBtn("↪ attiva", "go", () => mutateSheets((b) => setActiveSheet(b, s.id))));
      acts.appendChild(mkBtn("rinomina", "", () => renameSheetPrompt(s)));
      acts.appendChild(mkBtn("⧉ duplica", "", () => mutateSheets((b) => addSheet(setActiveSheet(b, s.id), { duplicateActive: true }))));
    }
    if (sums.length > 1) {
      acts.appendChild(mkBtn("🗑", "dl", () => deleteSheetConfirm(s)));
    }
    card.appendChild(acts);
    body.appendChild(card);
  }

  const newrow = document.createElement("div");
  newrow.className = "sheet-newrow";
  newrow.appendChild(mkBtn("+ Nuova vuota", "empty", () => mutateSheets((b) => addSheet(b, { duplicateActive: false }))));
  newrow.appendChild(mkBtn("⧉ Duplica attiva", "dup", () => mutateSheets((b) => addSheet(b, { duplicateActive: true }))));
  body.appendChild(newrow);
```

Aggiungi le helper sotto `renderSheets`:

```js
function mkBtn(label, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "sheet-btn" + (cls ? " " + cls : "");
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function renameSheetPrompt(s) {
  const name = window.prompt("Nome scheda:", s.name);
  if (name === null) return;            // annullato
  const t = name.trim();
  if (!t) return;                        // vuoto ignorato (coerente con renameSheet)
  mutateSheets((b) => renameSheet(b, s.id, t));
}

function deleteSheetConfirm(s) {
  if (!window.confirm(`Eliminare "${s.name}"? Verrà cancellato anche lo storico di questa scheda.`)) return;
  mutateSheets((b) => deleteSheet(b, s.id));
}
```

> `mkBtn` riusa lo stile a bottoni del mockup. `renameSheetPrompt`/`deleteSheetConfirm` usano `prompt`/`confirm` nativi per la v1 (coerenti col fatto che il rename è raro); si potranno sostituire con dialog a tema in un secondo momento — NON è in scope qui.

- [ ] **Step 2: Aggiungi gli stili `.sheet-*`**

Trova in `style.css` la sezione `.cal-*` (gestore calendario) e aggiungi accanto, riusando le variabili tema già definite nel `:root` (`--surf`, `--surf2`, `--line`, `--acc`, `--acc-ink`, `--acc-soft`, `--line-acc`, `--down`, `--ac2`, `--dim`, `--tx`, `--ink`). Tutte verificate presenti in `style.css:8-43`:

```css
.sheets-body{padding:14px 14px 28px;max-width:480px;margin:0 auto;}
.sheet-card{background:var(--surf);border:1px solid var(--line);border-radius:12px;padding:11px 12px;margin-bottom:9px;}
.sheet-card.active{border-color:var(--acc);box-shadow:0 0 0 1.5px var(--acc) inset;background:var(--acc-soft);}
.sheet-nm{display:flex;align-items:center;gap:8px;}
.sheet-name{font:800 15px Inter,system-ui,sans-serif;color:var(--tx);}
.sheet-badge{font:700 8px "JetBrains Mono",monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--acc-ink);background:var(--acc);border-radius:6px;padding:2px 6px;}
.sheet-meta{font-size:10.5px;color:var(--dim);margin-top:5px;}
.sheet-acts{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;}
.sheet-btn{flex:1;min-width:64px;background:var(--surf2);border:1px solid var(--line);color:var(--ink);font:600 10px "JetBrains Mono",monospace;padding:7px 4px;border-radius:7px;cursor:pointer;}
.sheet-btn.go{background:var(--acc);color:var(--acc-ink);border-color:var(--acc);font-weight:700;}
.sheet-btn.edit{flex:2;background:var(--acc);color:var(--acc-ink);border-color:var(--acc);font-weight:700;}
.sheet-btn.dl{flex:0 0 auto;min-width:0;padding:7px 10px;color:var(--down);border-color:color-mix(in srgb,var(--down) 40%,var(--line));}
.sheet-newrow{display:flex;gap:9px;margin-top:13px;}
.sheet-newrow .sheet-btn{padding:11px;font-size:11px;}
.sheet-newrow .empty{background:var(--acc);color:var(--acc-ink);border-color:var(--acc);font-weight:700;}
.sheet-newrow .dup{background:var(--surf);color:var(--acc);border:1px solid var(--line-acc);font-weight:700;}
```

> `--mono` nel mockup → in `style.css` il monospace è `"JetBrains Mono",monospace` letterale (non c'è var `--mono`); usa quella stringa dove serve il monospace, oppure ometti `font-family` ed eredita.

- [ ] **Step 3: node --check + verifica manuale completa**

Run: `node --check app.js`
Expected: nessun output

Poi avvia il server e prova il flusso end-to-end:
- Menu → Schede → vedi "Scheda 1" attiva con i tuoi conteggi reali.
- "Modifica scheda" sulla card attiva → apre l'editor del piano di oggi.
- "+ Nuova vuota" → appare "Scheda 2" attiva, vuota; la Home mostra il piano vuoto.
- "↪ attiva" su Scheda 1 → torna la scheda originale con il suo storico.
- "⧉ Duplica attiva" → copia il piano, storico vuoto.
- "rinomina" → cambia nome; ricarica pagina → nome persiste.
- "🗑" su una scheda non-ultima → conferma → sparisce. L'ultima non mostra il cestino.

- [ ] **Step 4: Commit**

```bash
git add app.js style.css
git commit -m "feat(schede): gestore completo - lista, attiva/duplica/rinomina/elimina"
```

---

### Task 12: Rimuovi i riferimenti morti a "Modifica scheda" come voce drawer

**Files:**
- Modify: `app.js` — la funzione `openPlanEditor` RESTA (ora chiamata dalla card attiva), ma verifica che non ci siano altri ingressi orfani.

- [ ] **Step 1: Cerca riferimenti residui all'azione "plan" del drawer**

Run: `grep -n "data-act=\"plan\"\|act: plan\|\"plan\":" app.js index.html`
Expected: nessun risultato nel drawer (il dispatch ora usa `sheets`). `openPlanEditor` resta referenziata solo da: il bottone "✎ Modifica scheda" della card attiva (Task 11) e da `btnCreatePlan` (onboarding, app.js:2585) — entrambi legittimi.

- [ ] **Step 2: Verifica che `btnCreatePlan` (onboarding scheda vuota) funzioni ancora**

L'onboarding crea la prima scheda. Con schema 6, `data` è già idratato con una "Scheda 1" (eventualmente vuota). `openPlanEditor` edita `data.plan` top-level = scheda attiva. Nessuna modifica necessaria; conferma manualmente che da utente nuovo (plan vuoto) il flusso "crea scheda" apre l'editor e salva nella Scheda 1.

- [ ] **Step 3: Run dell'intera suite**

Run: `node --test`
Expected: tutti i test passano (vecchi + nuovi di `sheets.test.js` e `store.merge.test.js`).

- [ ] **Step 4: Commit (se ci sono state pulizie)**

```bash
git add app.js
git commit -m "chore(schede): verifica nessun ingresso orfano a openPlanEditor"
```

---

## Self-Review (checklist eseguita in fase di scrittura)

**1. Spec coverage:**
- Schede multiple con nome → `sheets[]` + `name` (Task 2,4). ✓
- Crea nuova senza cancellare la corrente → `addSheet` (Task 4,11). ✓
- Storico per-scheda → `weeks` dentro ogni sheet; merge per-scheda (Task 6). ✓
- Impostazioni globali condivise → fuori dal blob, nessuna modifica (documentato in Architecture). ✓
- Scheda attuale → "Scheda 1" attiva → `toSheetsBlob` migrazione (Task 2) + hydrate al boot (Task 7). ✓
- Nuova vuota / Duplica attiva → `addSheet({duplicateActive})` (Task 4,11). ✓
- Nome default "Scheda N" progressivo, rinominabile sempre → `defaultSheetName` + `renameSheet` (Task 1,4,11). ✓
- Ultima non eliminabile, elimina chiede conferma → `deleteSheet` no-op su length≤1 (Task 4) + `deleteSheetConfirm` (Task 11). ✓
- Accesso A (voce drawer) + Accorpa (no "Modifica scheda" nel drawer, bottone nella card attiva) → Task 9,10,11. ✓
- Nessuna pill in Home → Home invariata (nessun task la tocca). ✓

**2. Placeholder scan:** nessun TODO/TBD; ogni step di codice mostra il codice completo. ✓

**3. Type consistency:** blob normalizzato `{schema, updatedAt, activeSheetId, sheets:[{id,name,plan,weeks}]}` usato coerentemente in `toSheetsBlob`, `hydrate`, `dehydrate`, CRUD, `sheetSummaries`, `mergeBlobs`. Forma in-memory = blob + `plan`/`weeks` top-level. Nomi funzione coerenti tra Phase 1 e UI (Task 11 usa esattamente `addSheet`/`renameSheet`/`deleteSheet`/`setActiveSheet`/`sheetSummaries`/`hydrate`/`dehydrate`). ✓

---

## Note di rischio per chi esegue

- **`structuredClone`** è già usato in `store.js`/`editor.js`: disponibile in Node ≥17 e nei browser target. OK.
- **`genId`** importato da `editor.js`: usa `Math.random` — va bene nel browser e in `node --test` (non sotto Workflow). I test NON devono fissare gli id attesi; asseriscono su unicità/relazioni, non sul valore.
- **Punto più delicato:** i 3 punti di idratazione boot (Task 7) e i 3 di dehydrate/merge (Task 8). Se uno viene saltato, sintomo tipico = log che "spariscono" dopo reload o scheda attiva che si resetta. Verifica manuale obbligatoria dopo Task 7 e Task 8.
- **CSS**: il foglio è `style.css` (singolare). Variabili tema usate dagli stili `.sheet-*` (`--acc-soft`, `--line-acc`, `--surf2`, ecc.) verificate presenti in `style.css:8-43`, sia tema chiaro sia `graphite`. Non esiste `var(--mono)`: per il monospace usa la stringa letterale `"JetBrains Mono",monospace`.
