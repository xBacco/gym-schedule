# Database Esercizi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere un catalogo di esercizi consultabile (diviso per gruppo muscolare, con ricerca, add-if-missing, dettaglio inline con "usato in" + sparkline + nota), persistito nel blob Supabase schema 6.

**Architecture:** Il catalogo è un nuovo campo top-level `catalog` del blob schema 6. La logica pura (mutazioni, seed, raggruppamento, collegamento storico) vive in un nuovo modulo `catalog.js` testabile in Node, sul modello di `sheets.js`. `hydrate`/`dehydrate`/`toSheetsBlob` (sheets.js) e `mergeBlobs` (store.js) vengono estesi per trasportare il campo — costruiscono l'oggetto di ritorno elencando i campi esplicitamente, quindi senza modifica il catalogo verrebbe perso. La UI è un overlay "stile terminale" guidato da `app.js`, sul pattern degli overlay esistenti (`openSheets`).

**Tech Stack:** Vanilla JS ESM, `node --test`, niente build step. Persistenza via blob Supabase. SVG inline per la sparkline.

---

## Invariante critica (vale per tutto il piano)

Ogni salvataggio passa per `dehydrate(data)`. Le mutazioni del catalogo NON scrivono a parte: usano il pattern `mutateSheets` esistente (`data = hydrate(fn(dehydrate(data))); scheduleSave();`), così il `dehydrate`-a-ogni-save è automatico. Mai mutare `data.catalog` in place senza poi `scheduleSave()`.

## File map

- **Create** `catalog.js` — modulo puro: seed, mutazioni, raggruppamento, collegamento storico.
- **Create** `tests/catalog.test.js` — test del modulo puro.
- **Modify** `sheets.js` — `hydrate`/`dehydrate` trasportano `catalog`; seed quando assente.
- **Modify** `tests/sheets.test.js` — round-trip e seed.
- **Modify** `store.js` — `mergeBlobs` fonde `catalog`.
- **Modify** `tests/store.merge.test.js` — merge del catalogo.
- **Modify** `index.html` — overlay "Database esercizi" + modale add/edit/delete + voce drawer.
- **Modify** `app.js` — apertura/chiusura overlay, render albero/ricerca/dettaglio inline, modale, `mutateCatalog`.
- **Modify** `style.css` — classi overlay catalogo (porting da `mockups/db-esercizi-rev5.html`).

`mockups/db-esercizi-rev5.html` è il riferimento visivo/comportamentale definitivo: tienilo aperto mentre fai i task UI.

---

## Task 1: Campo `catalog` in hydrate/dehydrate (sheets.js)

**Files:**
- Modify: `sheets.js:56-86` (hydrate, dehydrate)
- Test: `tests/sheets.test.js`

- [ ] **Step 1: Scrivi i test che falliscono**

Aggiungi in coda a `tests/sheets.test.js`:

```js
test("hydrate: trasporta catalog popolato dal blob", () => {
  const blob = {
    schema: 6, updatedAt: "2026-01-01T00:00:00.000Z", activeSheetId: "s1",
    sheets: [{ id: "s1", name: "A", plan: [], weeks: {} }],
    catalog: [{ id: "c1", name: "Panca piana bilanciere", muscle: "Petto", note: "" }],
  };
  assert.deepEqual(hydrate(blob).catalog, blob.catalog);
});

test("hydrate: catalog vuoto [] resta vuoto (niente seed)", () => {
  const blob = { schema: 6, updatedAt: null, activeSheetId: "s1",
    sheets: [{ id: "s1", name: "A", plan: [], weeks: {} }], catalog: [] };
  assert.deepEqual(hydrate(blob).catalog, []);
});

test("dehydrate∘hydrate: round-trip stabile con catalog", () => {
  const blob = {
    schema: 6, updatedAt: "2026-01-02T00:00:00.000Z", activeSheetId: "s1",
    sheets: [{ id: "s1", name: "A", plan: [], weeks: {} }],
    catalog: [{ id: "c1", name: "Squat bilanciere", muscle: "Gambe", note: "schiena neutra" }],
  };
  assert.deepEqual(dehydrate(hydrate(blob)), blob);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `node --test tests/sheets.test.js`
Expected: FAIL — `hydrate(blob).catalog` è `undefined`.

- [ ] **Step 3: Estendi hydrate e dehydrate**

In `sheets.js`, dentro `hydrate` (return object, dopo `weeks:`):

```js
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
    catalog: structuredClone(blob.catalog ?? []),
  };
}
```

In `dehydrate`, dopo aver impostato `act.weeks`:

```js
export function dehydrate(data) {
  const base = toSheetsBlob(data);
  const out = {
    schema: SHEETS_SCHEMA,
    updatedAt: data.updatedAt ?? base.updatedAt ?? null,
    activeSheetId: data.activeSheetId ?? base.activeSheetId,
    sheets: structuredClone(data.sheets ?? base.sheets),
    catalog: structuredClone(data.catalog ?? base.catalog ?? []),
  };
  const ids = out.sheets.map((s) => s.id);
  if (!ids.includes(out.activeSheetId)) out.activeSheetId = out.sheets[0].id;
  const act = out.sheets.find((s) => s.id === out.activeSheetId);
  act.plan = structuredClone(data.plan ?? []);
  act.weeks = structuredClone(data.weeks ?? {});
  return out;
}
```

Nota: `toSheetsBlob` con `schema >= 6` fa già `structuredClone(data)`, quindi un `catalog` presente è preservato in `base.catalog`. Per il ramo legacy (`schema < 6`) `base.catalog` è `undefined` → il `?? []` lo gestisce. NON aggiungere `catalog` dentro `toSheetsBlob`: va lasciato assente quando assente, così il seed (Task 4) può distinguere "mai inizializzato" da "vuoto".

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `node --test tests/sheets.test.js`
Expected: PASS (inclusi i test preesistenti).

- [ ] **Step 5: Commit**

```bash
git add sheets.js tests/sheets.test.js
git commit -m "feat(catalog): trasporta campo catalog in hydrate/dehydrate"
```

---

## Task 2: Merge del `catalog` in mergeBlobs (store.js)

**Files:**
- Modify: `store.js:252-283` (mergeBlobs)
- Test: `tests/store.merge.test.js`

Regola: unione per `id`. A parità di `id` vince il lato con `updatedAt` (top-level) più recente. Nessuna cancellazione implicita (v1 senza tombstone).

- [ ] **Step 1: Scrivi i test che falliscono**

Aggiungi a `tests/store.merge.test.js`:

```js
test("mergeBlobs: unione catalog, voci solo-locale e solo-remote conservate", () => {
  const local = { schema: 6, updatedAt: "2026-01-01T00:00:00.000Z", activeSheetId: "s1",
    sheets: [{ id: "s1", name: "A", plan: [], weeks: {} }],
    catalog: [{ id: "c1", name: "Panca", muscle: "Petto", note: "" }] };
  const remote = { schema: 6, updatedAt: "2026-01-02T00:00:00.000Z", activeSheetId: "s1",
    sheets: [{ id: "s1", name: "A", plan: [], weeks: {} }],
    catalog: [{ id: "c2", name: "Squat", muscle: "Gambe", note: "" }] };
  const ids = mergeBlobs(local, remote).catalog.map((e) => e.id).sort();
  assert.deepEqual(ids, ["c1", "c2"]);
});

test("mergeBlobs: a parità di id vince il lato con updatedAt più recente", () => {
  const local = { schema: 6, updatedAt: "2026-01-01T00:00:00.000Z", activeSheetId: "s1",
    sheets: [{ id: "s1", name: "A", plan: [], weeks: {} }],
    catalog: [{ id: "c1", name: "Panca", muscle: "Petto", note: "vecchia" }] };
  const remote = { schema: 6, updatedAt: "2026-01-09T00:00:00.000Z", activeSheetId: "s1",
    sheets: [{ id: "s1", name: "A", plan: [], weeks: {} }],
    catalog: [{ id: "c1", name: "Panca", muscle: "Petto", note: "nuova" }] };
  const merged = mergeBlobs(local, remote).catalog.find((e) => e.id === "c1");
  assert.equal(merged.note, "nuova");
});
```

(Se il file non importa già `mergeBlobs`, verifica l'import in testa: `import { mergeBlobs } from "../store.js";`)

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `node --test tests/store.merge.test.js`
Expected: FAIL — `merged.catalog` è `undefined`.

- [ ] **Step 3: Estendi mergeBlobs**

In `store.js`, dentro `mergeBlobs`, subito prima del `return`:

```js
  const lCat = Array.isArray(L.catalog) ? L.catalog : [];
  const rCat = Array.isArray(R.catalog) ? R.catalog : [];
  const newerWins = (lUpd ?? "") >= (rUpd ?? "");
  const loser = newerWins ? rCat : lCat;
  const winner = newerWins ? lCat : rCat;
  const catMap = new Map();
  for (const e of loser) catMap.set(e.id, structuredClone(e));
  for (const e of winner) catMap.set(e.id, structuredClone(e)); // a parità di id, il più recente sovrascrive
  const catalog = [...catMap.values()];
```

E aggiorna l'oggetto restituito:

```js
  return { schema: 6, updatedAt, activeSheetId, sheets, catalog };
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `node --test tests/store.merge.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add store.js tests/store.merge.test.js
git commit -m "feat(catalog): fondi catalog in mergeBlobs (union by id, newer wins)"
```

---

## Task 3: Mutazioni pure del catalogo (catalog.js)

**Files:**
- Create: `catalog.js`
- Test: `tests/catalog.test.js`

Tutte le funzioni prendono un `blob` normalizzato (schema 6) e restituiscono un blob NUOVO con `catalog` aggiornato, senza mutare l'input. Operano sul pattern di `sheets.js`.

- [ ] **Step 1: Scrivi i test che falliscono**

Crea `tests/catalog.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCatalogEntry, renameCatalogEntry, deleteCatalogEntry, setCatalogNote,
} from "../catalog.js";

const base = () => ({
  schema: 6, updatedAt: null, activeSheetId: "s1",
  sheets: [{ id: "s1", name: "A", plan: [], weeks: {} }],
  catalog: [{ id: "c1", name: "Panca piana bilanciere", muscle: "Petto", note: "" }],
});

test("addCatalogEntry: aggiunge una voce con id stabile", () => {
  const out = addCatalogEntry(base(), { name: "Croci ai cavi", muscle: "Petto" });
  const added = out.catalog.find((e) => e.name === "Croci ai cavi");
  assert.ok(added && added.id && added.muscle === "Petto" && added.note === "");
  assert.equal(out.catalog.length, 2);
});

test("addCatalogEntry: rifiuta duplicato case-insensitive nello stesso gruppo", () => {
  const out = addCatalogEntry(base(), { name: "panca PIANA bilanciere", muscle: "Petto" });
  assert.equal(out.catalog.length, 1); // invariato
});

test("addCatalogEntry: stesso nome in gruppo diverso è ammesso", () => {
  const out = addCatalogEntry(base(), { name: "Panca piana bilanciere", muscle: "Spalle" });
  assert.equal(out.catalog.length, 2);
});

test("renameCatalogEntry: preserva id e note, cambia nome e gruppo", () => {
  const out = renameCatalogEntry(
    { ...base(), catalog: [{ id: "c1", name: "Panca", muscle: "Petto", note: "cue" }] },
    "c1", { name: "Panca stretta", muscle: "Tricipiti" });
  const e = out.catalog.find((x) => x.id === "c1");
  assert.equal(e.name, "Panca stretta");
  assert.equal(e.muscle, "Tricipiti");
  assert.equal(e.note, "cue");
});

test("deleteCatalogEntry: rimuove per id", () => {
  const out = deleteCatalogEntry(base(), "c1");
  assert.equal(out.catalog.length, 0);
});

test("setCatalogNote: imposta e svuota la nota", () => {
  const set = setCatalogNote(base(), "c1", "  scapole addotte ");
  assert.equal(set.catalog[0].note, "scapole addotte");
  const cleared = setCatalogNote(set, "c1", "   ");
  assert.equal(cleared.catalog[0].note, "");
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `node --test tests/catalog.test.js`
Expected: FAIL — `Cannot find module '../catalog.js'`.

- [ ] **Step 3: Crea catalog.js con le mutazioni**

Crea `catalog.js`:

```js
// catalog.js
// ---- Catalogo esercizi (puro, testabile in Node). Opera sul blob schema 6:
//      blob.catalog = [{ id, name, muscle, note }]. Liste separate dalle schede,
//      collegate per NOME (vedi catalogUsage). ----
import { genId } from "./editor.js";

const norm = (s) => String(s ?? "").trim().toLowerCase();
const clone = (blob) => structuredClone(blob);
const cat = (blob) => (Array.isArray(blob.catalog) ? blob.catalog : []);

// true se esiste già una voce con lo stesso nome (case-insensitive) nello stesso
// gruppo. `exceptId` esclude una voce (per il rename su sé stessa).
export function catalogHasDup(blob, name, muscle, exceptId = null) {
  return cat(blob).some(
    (e) => e.id !== exceptId && e.muscle === muscle && norm(e.name) === norm(name));
}

export function addCatalogEntry(blob, { name, muscle, note = "" }) {
  const n = String(name ?? "").trim();
  if (!n) return blob;
  if (catalogHasDup(blob, n, muscle)) return blob;
  const out = clone(blob);
  const id = genId(cat(out).map((e) => e.id));
  out.catalog = [...cat(out), { id, name: n, muscle, note: String(note ?? "").trim() }];
  return out;
}

export function renameCatalogEntry(blob, id, { name, muscle }) {
  const n = String(name ?? "").trim();
  if (!n) return blob;
  if (catalogHasDup(blob, n, muscle, id)) return blob;
  const out = clone(blob);
  out.catalog = cat(out).map((e) => (e.id === id ? { ...e, name: n, muscle } : e));
  return out;
}

export function deleteCatalogEntry(blob, id) {
  const out = clone(blob);
  out.catalog = cat(out).filter((e) => e.id !== id);
  return out;
}

export function setCatalogNote(blob, id, note) {
  const out = clone(blob);
  const t = String(note ?? "").trim();
  out.catalog = cat(out).map((e) => (e.id === id ? { ...e, note: t } : e));
  return out;
}
```

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `node --test tests/catalog.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add catalog.js tests/catalog.test.js
git commit -m "feat(catalog): mutazioni pure add/rename/delete/setNote"
```

---

## Task 4: Seed iniziale one-shot (catalog.js + sheets.js)

**Files:**
- Modify: `catalog.js` (aggiunge `seedCatalog`)
- Modify: `sheets.js:56-67` (hydrate usa il seed quando `catalog` è assente)
- Test: `tests/catalog.test.js`, `tests/sheets.test.js`

Regola one-shot: `hydrate` inietta il seed SOLO quando il blob non ha proprio il campo `catalog` (`undefined`). Un `catalog: []` esplicito resta vuoto. Dopo il primo `dehydrate`, il campo esiste sempre → niente re-seed.

- [ ] **Step 1: Scrivi i test che falliscono**

In `tests/catalog.test.js`:

```js
import { seedCatalog } from "../catalog.js";

test("seedCatalog: lista non vuota, voci ben formate, id univoci", () => {
  const seed = seedCatalog();
  assert.ok(seed.length >= 40);
  const ids = new Set(seed.map((e) => e.id));
  assert.equal(ids.size, seed.length);
  for (const e of seed) {
    assert.ok(e.id && e.name && e.muscle);
    assert.equal(e.note, "");
  }
});

test("seedCatalog: deterministico (stesse chiamate, stessi id)", () => {
  assert.deepEqual(seedCatalog(), seedCatalog());
});
```

In `tests/sheets.test.js`:

```js
test("hydrate: catalog assente → seed iniettato (one-shot)", () => {
  const blob = { schema: 6, updatedAt: null, activeSheetId: "s1",
    sheets: [{ id: "s1", name: "A", plan: [], weeks: {} }] }; // niente catalog
  assert.ok(hydrate(blob).catalog.length > 0);
});
```

- [ ] **Step 2: Esegui i test, verifica che falliscano**

Run: `node --test tests/catalog.test.js tests/sheets.test.js`
Expected: FAIL — `seedCatalog` non esiste; hydrate restituisce `[]` per catalog assente.

- [ ] **Step 3: Implementa seedCatalog e collega in hydrate**

In `catalog.js` aggiungi (in cima, dopo gli import):

```js
// Esercizi comuni per gruppo (8 gruppi fissi, stessi di index.html). Stessa lista
// del mockup di riferimento. Usata SOLO al primo avvio (catalog assente).
const SEED_BY_GROUP = {
  Petto: ["Panca piana bilanciere", "Spinte inclinata manubri", "Croci ai cavi", "Dips", "Pectoral machine", "Chest press", "Panca declinata", "Push-up"],
  Dorso: ["Stacco da terra", "Stacco rumeno", "Rematore bilanciere", "Rematore manubrio", "Pulldown presa larga", "Lat machine presa stretta", "Pullover", "Pulley basso", "Trazioni", "Rematore al cavo", "Hyperextension"],
  Spalle: ["Lento avanti bilanciere", "Lento avanti manubri", "Alzate laterali", "Alzate posteriori", "Face pull", "Arnold press", "Tirate al mento", "Scrollate"],
  Bicipiti: ["Curl bilanciere", "Curl manubri", "Curl alla Scott", "Curl concentrato", "Hammer curl", "Curl ai cavi", "Curl EZ"],
  Tricipiti: ["Pushdown ai cavi", "French press", "Skullcrusher", "Pushdown corda", "Estensioni sopra la testa", "Kickback", "Dips alle parallele"],
  Gambe: ["Squat bilanciere", "Pressa", "Leg extension", "Leg curl", "Affondi manubri", "Hack squat", "Bulgarian split squat", "Goblet squat", "Stacco sumo", "Adductor machine"],
  Polpacci: ["Calf in piedi", "Calf da seduto", "Calf alla pressa", "Donkey calf"],
  Core: ["Crunch a terra", "Plank", "Russian twist", "Leg raise", "Crunch inverso", "Plank laterale", "Ab wheel", "Hanging leg raise", "Mountain climber"],
};

// Costruisce le voci seed con id stabili e univoci. Deterministico (genId è
// progressivo sugli id già assegnati, niente Date/random).
export function seedCatalog() {
  const out = [];
  for (const muscle of Object.keys(SEED_BY_GROUP)) {
    for (const name of SEED_BY_GROUP[muscle]) {
      const id = genId(out.map((e) => e.id));
      out.push({ id, name, muscle, note: "" });
    }
  }
  return out;
}
```

In `sheets.js`, importa il seed e usalo nel fallback di `hydrate`:

```js
import { genId } from "./editor.js";
import { seedCatalog } from "./catalog.js";
```

e nel return di `hydrate` cambia la riga catalog:

```js
    catalog: structuredClone(blob.catalog ?? seedCatalog()),
```

Verifica che `genId` sia deterministico (nessun uso di `Date`/`Math.random`): leggi `editor.js:4`. Se NON lo è, sostituisci nel seed gli id con `String(out.length)` per garantire determinismo dei test; in tal caso aggiorna anche il test "deterministico".

- [ ] **Step 4: Esegui i test, verifica che passino**

Run: `node --test tests/catalog.test.js tests/sheets.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add catalog.js sheets.js tests/catalog.test.js tests/sheets.test.js
git commit -m "feat(catalog): seed one-shot iniettato in hydrate quando assente"
```

---

## Task 5: Raggruppamento per render (catalog.js)

**Files:**
- Modify: `catalog.js` (aggiunge `groupedCatalog`)
- Test: `tests/catalog.test.js`

`groupedCatalog` produce la struttura che la UI rende: gli 8 gruppi nell'ordine fisso, ciascuno con le sue voci ordinate alfabeticamente (locale `it`, case-insensitive). Include i gruppi vuoti? No: la UI mostra solo gruppi con voci, ma in ordine fisso.

- [ ] **Step 1: Scrivi il test che fallisce**

In `tests/catalog.test.js`:

```js
import { groupedCatalog, MUSCLE_GROUPS } from "../catalog.js";

test("MUSCLE_GROUPS: gli 8 gruppi fissi nell'ordine di index.html", () => {
  assert.deepEqual(MUSCLE_GROUPS,
    ["Petto", "Dorso", "Spalle", "Bicipiti", "Tricipiti", "Gambe", "Polpacci", "Core"]);
});

test("groupedCatalog: ordina alfabeticamente dentro il gruppo, salta gruppi vuoti", () => {
  const blob = { schema: 6, catalog: [
    { id: "a", name: "Zercher squat", muscle: "Gambe", note: "" },
    { id: "b", name: "affondi", muscle: "Gambe", note: "" },
    { id: "c", name: "Panca", muscle: "Petto", note: "" },
  ] };
  const g = groupedCatalog(blob);
  const gambe = g.find((x) => x.muscle === "Gambe");
  assert.deepEqual(gambe.items.map((e) => e.name), ["affondi", "Zercher squat"]);
  assert.ok(!g.some((x) => x.muscle === "Spalle")); // gruppo vuoto assente
});
```

- [ ] **Step 2: Esegui il test, verifica che fallisca**

Run: `node --test tests/catalog.test.js`
Expected: FAIL — `groupedCatalog`/`MUSCLE_GROUPS` non esistono.

- [ ] **Step 3: Implementa groupedCatalog**

In `catalog.js`:

```js
// Gli 8 gruppi fissi, stesso ordine della <select id="exMuscle"> in index.html.
export const MUSCLE_GROUPS = ["Petto", "Dorso", "Spalle", "Bicipiti", "Tricipiti", "Gambe", "Polpacci", "Core"];

// [{ muscle, items:[voce…] }] nei soli gruppi con voci, ordine gruppi fisso,
// voci ordinate alfabeticamente (it, case/accent-insensitive).
export function groupedCatalog(blob) {
  const list = Array.isArray(blob.catalog) ? blob.catalog : [];
  const byGroup = new Map(MUSCLE_GROUPS.map((m) => [m, []]));
  for (const e of list) {
    if (byGroup.has(e.muscle)) byGroup.get(e.muscle).push(e);
  }
  const out = [];
  for (const muscle of MUSCLE_GROUPS) {
    const items = byGroup.get(muscle);
    if (!items.length) continue;
    items.sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }));
    out.push({ muscle, items });
  }
  return out;
}
```

- [ ] **Step 4: Esegui il test, verifica che passi**

Run: `node --test tests/catalog.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add catalog.js tests/catalog.test.js
git commit -m "feat(catalog): groupedCatalog (gruppi fissi + sort alfabetico)"
```

---

## Task 6: Collegamento storico per nome (catalog.js)

**Files:**
- Modify: `catalog.js` (aggiunge `catalogUsage`)
- Test: `tests/catalog.test.js`

`catalogUsage(blob, name)` cerca, in TUTTE le schede, i giorni il cui plan contiene un esercizio con lo stesso `name` (case-insensitive), e restituisce:
- `usedIn`: `[{ sheet, day }]` (nome scheda + label giorno `title || day`);
- `series`: `[{ week, kg }]` del top-set per la miglior corrispondenza (quella con storico più recente), via `topSetSeries` di `session.js` su uno shim `{ weeks: sheet.weeks }`;
- `lastKg`: ultimo kg della serie, o `null`.

Niente match → `{ usedIn: [], series: [], lastKg: null }`.

- [ ] **Step 1: Scrivi il test che fallisce**

In `tests/catalog.test.js`:

```js
import { catalogUsage } from "../catalog.js";

function blobWithHistory() {
  return {
    schema: 6, updatedAt: null, activeSheetId: "s1",
    sheets: [{
      id: "s1", name: "Push Pull Legs",
      plan: [{ day: "A", title: "Spinta", exercises: [{ id: "e1", name: "Panca piana bilanciere", muscle: "Petto" }] }],
      weeks: {
        "2026-W01": { entries: { A: { e1: { sets: [{ reps: "5", kg: "60", done: true }] } } } },
        "2026-W02": { entries: { A: { e1: { sets: [{ reps: "5", kg: "65", done: true }] } } } },
      },
    }],
    catalog: [{ id: "c1", name: "Panca piana bilanciere", muscle: "Petto", note: "" }],
  };
}

test("catalogUsage: trova usato-in e serie per nome", () => {
  const u = catalogUsage(blobWithHistory(), "Panca piana bilanciere");
  assert.deepEqual(u.usedIn, [{ sheet: "Push Pull Legs", day: "Spinta" }]);
  assert.equal(u.lastKg, 65);
  assert.ok(u.series.length >= 2);
});

test("catalogUsage: match per nome case-insensitive", () => {
  const u = catalogUsage(blobWithHistory(), "PANCA piana bilanciere");
  assert.equal(u.usedIn.length, 1);
});

test("catalogUsage: nessun match → fallback vuoto", () => {
  const u = catalogUsage(blobWithHistory(), "Esercizio inesistente");
  assert.deepEqual(u, { usedIn: [], series: [], lastKg: null });
});
```

- [ ] **Step 2: Esegui il test, verifica che fallisca**

Run: `node --test tests/catalog.test.js`
Expected: FAIL — `catalogUsage` non esiste.

- [ ] **Step 3: Implementa catalogUsage**

In `catalog.js`, aggiungi l'import in testa:

```js
import { topSetSeries } from "./session.js";
```

e la funzione:

```js
// Ultima settimana valida presente nelle weeks (chiave max che matcha il formato).
function latestWeekKey(weeks) {
  const keys = Object.keys(weeks ?? {}).filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k)).sort();
  return keys.length ? keys[keys.length - 1] : null;
}

// Collega una voce di catalogo allo storico delle schede PER NOME.
// usedIn: dove compare; series/lastKg: andamento del top-set della miglior
// corrispondenza (storico più recente). Liste separate: se il nome non combacia
// con nessun esercizio nei plan, fallback vuoto.
export function catalogUsage(blob, name) {
  const target = norm(name);
  const sheets = Array.isArray(blob.sheets) ? blob.sheets : [];
  const usedIn = [];
  const matches = []; // { weeks, day, exId, superset, lastWeek }
  for (const s of sheets) {
    for (const d of (Array.isArray(s.plan) ? s.plan : [])) {
      for (const ex of (Array.isArray(d.exercises) ? d.exercises : [])) {
        if (norm(ex.name) !== target) continue;
        usedIn.push({ sheet: s.name, day: d.title || d.day });
        matches.push({ weeks: s.weeks ?? {}, day: d.day, exId: ex.id,
          superset: !!ex.superset, lastWeek: latestWeekKey(s.weeks) });
      }
    }
  }
  if (!matches.length) return { usedIn: [], series: [], lastKg: null };
  // miglior corrispondenza = quella con la settimana loggata più recente
  const best = matches
    .filter((m) => m.lastWeek)
    .sort((a, b) => (a.lastWeek < b.lastWeek ? 1 : -1))[0];
  if (!best) return { usedIn, series: [], lastKg: null };
  const series = topSetSeries({ weeks: best.weeks }, best.day, best.exId, best.lastWeek);
  const lastKg = series.length ? series[series.length - 1].kg : null;
  return { usedIn, series, lastKg };
}
```

Nota: `topSetSeries(data, day, exId, weekKey, track=null)` legge solo `data.weeks`, quindi lo shim `{ weeks }` è sufficiente. Per gli esercizi superset usiamo la traccia normale (track `null`): limitazione accettata per la v1.

- [ ] **Step 4: Esegui il test, verifica che passi**

Run: `node --test tests/catalog.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add catalog.js tests/catalog.test.js
git commit -m "feat(catalog): catalogUsage (link storico per nome, usedIn + sparkline)"
```

---

## Task 7: Stili overlay catalogo (style.css)

**Files:**
- Modify: `style.css` (append in coda)

Porta le classi dal mockup `mockups/db-esercizi-rev5.html` (blocco `<style>`), adattando i nomi con prefisso `db-` per non collidere con le classi app esistenti. Usa le variabili tema GIÀ presenti in `style.css` (`--surf`, `--line`, `--acc`, ecc.): NON ridefinire `:root`.

- [ ] **Step 1: Verifica le variabili tema disponibili**

Run: `grep -n "\-\-acc\|\-\-surf\|\-\-line\|\-\-tx\|\-\-dim" style.css | head`
Expected: le variabili esistono (l'app è già "terminale"). Annota i nomi reali; se differiscono da quelli del mockup (`--acc-soft`, `--line-acc`, `--surf2`, `--field`, `--faint`, `--ac2`, `--down`, `--line-warm`), mappali ai più vicini esistenti o aggiungile al blocco tema esistente.

- [ ] **Step 2: Aggiungi le classi del catalogo**

Append in coda a `style.css` (porting da rev5, prefisso `db-`; copia le regole `.gnode/.ghd/.kids/.k/.krow/.det/.scan/.reveal/.spark/.note/.dacts/.prompt/.nores` rinominando con prefisso `db-` e usando le variabili tema reali). Includi le keyframe dell'animazione scanline CRT:

```css
/* ===== Database esercizi — overlay (porting da mockup rev5) ===== */
#dbOverlay .db-prompt{display:flex;align-items:center;gap:7px;background:var(--field);border:1px solid var(--line);border-radius:9px;padding:8px 11px;margin-bottom:13px;position:sticky;top:0;z-index:5;}
#dbOverlay .db-prompt .ps{color:var(--acc);font-weight:700;}
#dbOverlay .db-prompt input{flex:1;background:transparent;border:none;outline:none;color:var(--tx);font:600 13px var(--mono);}
#dbOverlay .db-gnode{margin-bottom:9px;}
#dbOverlay .db-ghd{display:flex;align-items:baseline;cursor:pointer;padding:3px 0;user-select:none;}
#dbOverlay .db-ghd .car{color:var(--acc);width:15px;flex:none;}
#dbOverlay .db-ghd .nm{color:var(--tx);font-weight:800;text-transform:uppercase;letter-spacing:.05em;font-size:12.5px;}
#dbOverlay .db-gnode.closed .nm,#dbOverlay .db-gnode.closed .car{color:var(--dim);}
#dbOverlay .db-ghd .fill{flex:1;border-bottom:1px dotted var(--line);margin:0 7px 4px;}
#dbOverlay .db-ghd .ct{color:var(--acc);font-weight:700;font-size:12px;flex:none;}
#dbOverlay .db-kids{padding-left:9px;margin-top:2px;}
#dbOverlay .db-gnode.closed .db-kids{display:none;}
#dbOverlay .db-k{border-radius:8px;}
#dbOverlay .db-k.open{background:var(--surf);border:1px solid var(--line);position:relative;overflow:hidden;margin:3px 0;}
#dbOverlay .db-k.open::before{content:"";position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--acc);}
#dbOverlay .db-krow{display:flex;align-items:center;gap:7px;padding:5px 0;cursor:pointer;}
#dbOverlay .db-k.open .db-krow{padding:9px 11px 7px;}
#dbOverlay .db-krow .br{color:var(--dim);flex:none;}
#dbOverlay .db-k.open .db-krow .br{display:none;}
#dbOverlay .db-krow .knm{flex:1;color:var(--tx);font-size:12.5px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#dbOverlay .db-k.open .db-krow .knm{font-weight:800;white-space:normal;}
#dbOverlay .db-krow .car2{color:var(--dim);font-size:11px;flex:none;transition:transform .15s;width:14px;text-align:center;}
#dbOverlay .db-k.open .db-krow .car2{transform:rotate(90deg);color:var(--acc);}
#dbOverlay .db-krow .knm mark{background:var(--acc);color:var(--bg);border-radius:3px;padding:0 1px;}
/* dettaglio inline — apertura scanline CRT */
#dbOverlay .db-det{display:none;padding:0 12px 12px;position:relative;}
#dbOverlay .db-k.open .db-det{display:block;}
#dbOverlay .db-det .reveal{clip-path:inset(0 0 100% 0);animation:dbReveal .6s ease forwards;}
@keyframes dbReveal{to{clip-path:inset(0 0 0 0);}}
#dbOverlay .db-det .scan{position:absolute;left:0;right:0;height:20px;pointer-events:none;z-index:3;background:linear-gradient(var(--acc),transparent);opacity:0;top:0;animation:dbScan .62s ease forwards;}
@keyframes dbScan{0%{opacity:.9;top:0;}90%{opacity:.9;}100%{opacity:0;top:100%;}}
#dbOverlay .db-k.open{animation:dbFlick .5s steps(1);}
@keyframes dbFlick{0%,100%{filter:none;}10%{filter:brightness(1.25);}20%{filter:brightness(.9);}35%{filter:brightness(1.1);}}
#dbOverlay .db-det .cmd{color:var(--dim);font-size:11.5px;margin:1px 0 7px;}
#dbOverlay .db-det .cmd .c1{color:var(--acc);font-weight:700;}
#dbOverlay .db-det .sec{font:700 9px var(--mono);letter-spacing:.13em;text-transform:uppercase;color:var(--dim);}
#dbOverlay .db-det .uin{display:flex;align-items:baseline;gap:7px;font-size:12px;padding:2px 0;}
#dbOverlay .db-det .uin .pf{color:var(--acc);}
#dbOverlay .db-det .uin .sc{color:var(--tx);font-weight:700;}
#dbOverlay .db-det .uin .dy{color:var(--dim);font-size:11px;}
#dbOverlay .db-det .none{color:var(--dim);font-style:italic;font-size:11.5px;padding:2px 0;}
#dbOverlay .db-det .spark{background:var(--surf);border:1px solid var(--line);border-radius:9px;padding:8px 10px;margin-top:4px;}
#dbOverlay .db-det .spark .top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px;}
#dbOverlay .db-det .spark .lastv{font:700 13px var(--mono);color:var(--acc);}
#dbOverlay .db-det polyline.spk{stroke-dasharray:340;stroke-dashoffset:340;animation:dbDraw .5s ease .15s forwards;}
@keyframes dbDraw{to{stroke-dashoffset:0;}}
#dbOverlay .db-det textarea.note{width:100%;background:var(--field);border:1px solid var(--line);border-radius:8px;padding:8px 10px;color:var(--tx);font:600 12.5px var(--mono);line-height:1.5;min-height:46px;resize:vertical;outline:none;margin-top:4px;}
#dbOverlay .db-det .dacts{display:flex;gap:7px;margin-top:11px;}
#dbOverlay .db-det .dacts button{border-radius:8px;padding:8px 10px;font:700 10px var(--mono);cursor:pointer;border:1px solid var(--line);background:var(--surf);color:var(--ink);}
#dbOverlay .db-det .dacts .edit{flex:1;background:var(--acc);color:var(--bg);border-color:var(--acc);}
#dbOverlay .db-det .dacts .del{color:var(--down,#c0442e);}
#dbOverlay .db-nores{color:var(--dim);text-align:center;padding:30px 0;font-size:12px;}
#dbOverlay .db-nores .mk{margin-top:12px;background:var(--acc);color:var(--bg);border:none;border-radius:8px;font:700 11px var(--mono);padding:9px 16px;cursor:pointer;}
```

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "style(catalog): classi overlay db-* + animazione scanline CRT"
```

(Nessun test automatico: la resa va verificata nel browser ai Task 8-10.)

---

## Task 8: Overlay + voce drawer (index.html + app.js)

**Files:**
- Modify: `index.html` (markup overlay + modale + voce drawer)
- Modify: `app.js` (apertura/chiusura con history, `mutateCatalog`, render scheletro)

Riusa il pattern overlay di `openSheets` (app.js:249) e la voce drawer in `renderDrawer` (app.js:355). Studia entrambi prima di scrivere.

- [ ] **Step 1: Aggiungi il markup overlay in index.html**

Vicino all'overlay Schede esistente (cerca l'id dell'overlay schede, ~`index.html:275`), aggiungi:

```html
<div id="dbOverlay" class="overlay hidden" aria-hidden="true">
  <div class="ov">
    <div class="wbar">
      <button class="back" id="dbBack">←</button>
      <span class="dot"></span>
      <span class="ttl">EXERCISE.DB</span>
      <span class="meta" id="dbMeta">—</span>
    </div>
    <div class="body">
      <div class="db-prompt"><span class="ps">grep&gt;</span>
        <input id="dbQ" placeholder="filtra esercizio…" autocomplete="off">
        <button class="add" id="dbAddInline">+ NEW</button></div>
      <div id="dbTree"></div>
    </div>
  </div>
</div>
```

Usa le stesse classi struttura overlay (`.overlay/.ov/.wbar/.body`) dell'overlay Schede; se hanno nomi diversi, allinea ai reali. Il modale add/edit/delete è il Task 10 — per ora niente.

- [ ] **Step 2: Aggiungi la voce nel drawer (index.html o renderDrawer)**

In `renderDrawer` (app.js:355) aggiungi una voce "Database esercizi" che lancia `drawerLaunch(openCatalog)`, sullo stesso modello della voce che apre le Schede. Se le voci drawer sono in `index.html`, aggiungi lì il bottone e collega l'handler in `app.js`.

- [ ] **Step 3: Implementa open/close con history in app.js**

Studia `openSheets`/`closeSheets` (app.js:249 in poi) e replica il pattern (pushState/popstate) per il catalogo:

```js
// ---- Overlay Database esercizi ----
let dbFilter = "";
let dbOpenGroups = {}; // muscle -> bool (default: tutti aperti)
let dbOpenEx = null;   // id voce espansa (uno per volta)

function openCatalog() {
  document.getElementById("dbOverlay").classList.remove("hidden");
  document.getElementById("dbOverlay").setAttribute("aria-hidden", "false");
  history.pushState({ db: true }, "");
  renderCatalog();
}
function closeCatalog() {
  document.getElementById("dbOverlay").classList.add("hidden");
  document.getElementById("dbOverlay").setAttribute("aria-hidden", "true");
}
```

Aggancia `closeCatalog` allo stesso meccanismo `popstate`/back usato dagli altri overlay (segui esattamente come fa `closeSheets`), e il bottone `#dbBack` a `history.back()`.

- [ ] **Step 4: Aggiungi mutateCatalog (pattern mutateSheets)**

Vicino a `mutateSheets` (app.js:264):

```js
// Applica una funzione pura sul blob (vedi catalog.js) e ripersiste, rispettando
// l'invariante dehydrate-a-ogni-save.
function mutateCatalog(fn) {
  data = hydrate(fn(dehydrate(data)));
  scheduleSave();
  renderCatalog();
}
```

Importa le funzioni catalogo in testa ad `app.js`:

```js
import { addCatalogEntry, renameCatalogEntry, deleteCatalogEntry, setCatalogNote,
  groupedCatalog, catalogUsage, MUSCLE_GROUPS } from "./catalog.js";
```

- [ ] **Step 5: Scheletro renderCatalog (solo conteggio, per ora)**

```js
function renderCatalog() {
  const tree = document.getElementById("dbTree");
  const meta = document.getElementById("dbMeta");
  const groups = groupedCatalog(dehydrate(data));
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  meta.textContent = total + " rec";
  tree.innerHTML = ""; // riempito al Task 9
}
```

- [ ] **Step 6: Verifica nel browser**

Avvia l'app (o usa `/run`), fai login, apri il drawer → "Database esercizi". Atteso: l'overlay si apre, header `EXERCISE.DB`, meta mostra "N rec" (N = numero seed), il back lo chiude. Albero ancora vuoto (Task 9).

- [ ] **Step 7: Commit**

```bash
git add index.html app.js
git commit -m "feat(catalog): overlay + voce drawer + mutateCatalog (scheletro)"
```

---

## Task 9: Albero, ricerca, dettaglio inline con sparkline (app.js)

**Files:**
- Modify: `app.js` (`renderCatalog` completo + helper)

Porta la logica di render da `mockups/db-esercizi-rev5.html` (funzioni `render`, `detHTML`, `sparkSVG`, `hl`), adattata: i dati vengono da `groupedCatalog`/`catalogUsage` invece che dal `DB`/`NOTES` del mockup, e le classi hanno prefisso `db-`.

- [ ] **Step 1: Helper di supporto (esc, highlight, sparkline SVG)**

In `app.js`:

```js
const dbEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const dbNorm = (s) => String(s ?? "").toLowerCase().trim();
function dbHL(name) {
  if (!dbFilter) return dbEsc(name);
  const i = dbNorm(name).indexOf(dbNorm(dbFilter));
  if (i < 0) return dbEsc(name);
  return dbEsc(name.slice(0, i)) + "<mark>" + dbEsc(name.slice(i, i + dbFilter.length)) +
    "</mark>" + dbEsc(name.slice(i + dbFilter.length));
}
function dbSparkSVG(series) {
  if (!series.length) return "";
  const a = series.map((p) => p.kg), w = 260, h = 42;
  const mn = Math.min(...a), mx = Math.max(...a), rg = (mx - mn) || 1;
  const pts = a.map((v, i) => [8 + i * (w - 16) / (Math.max(1, a.length - 1)), h - 6 - ((v - mn) / rg) * (h - 13)]);
  const ln = pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const lp = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">` +
    `<polygon points="8,${h - 6} ${ln} ${w - 8},${h - 6}" fill="var(--acc)" opacity=".18"/>` +
    `<polyline class="spk" points="${ln}" fill="none" stroke="var(--acc)" stroke-width="2" stroke-linejoin="round"/>` +
    `<circle class="spk-dot" cx="${lp[0].toFixed(1)}" cy="${lp[1].toFixed(1)}" r="3" fill="var(--acc)"/></svg>`;
}
```

- [ ] **Step 2: detHTML — dettaglio inline (scan + reveal)**

```js
function dbDetHTML(entry) {
  const blob = dehydrate(data);
  const u = catalogUsage(blob, entry.name);
  let h = `<div class="db-det"><div class="scan"></div><div class="reveal">`;
  h += `<div class="cmd"><span class="c1">$</span> stat "${dbEsc(entry.name)}"</div>`;
  h += `<div><span class="sec">usato in</span></div>`;
  if (u.usedIn.length) {
    u.usedIn.forEach((x) => h += `<div class="uin"><span class="pf">›</span><span class="sc">${dbEsc(x.sheet)}</span><span class="dy">· giorno ${dbEsc(x.day)}</span></div>`);
  } else {
    h += `<div class="none">— non presente in nessuna scheda —</div>`;
  }
  h += `<div style="margin-top:9px"><span class="sec">andamento</span></div>`;
  if (u.series.length) {
    h += `<div class="spark"><div class="top"><span class="lastv">${u.lastKg}<span class="u"> kg ult.</span></span><span class="cap">${u.series.length} sessioni</span></div>${dbSparkSVG(u.series)}</div>`;
  } else {
    h += `<div class="none">— ancora nessuno storico —</div>`;
  }
  h += `<div style="margin-top:9px"><span class="sec">nota</span></div>`;
  h += `<textarea class="note" data-id="${entry.id}" placeholder="cue tecnico, presa, link…">${dbEsc(entry.note || "")}</textarea>`;
  h += `<div class="dacts"><button class="edit">✎ modifica</button><button class="del">× elimina</button></div>`;
  h += `</div></div>`;
  return h;
}
```

- [ ] **Step 3: renderCatalog completo (albero + ricerca + add-if-missing)**

Sostituisci lo scheletro del Task 8:

```js
function renderCatalog() {
  const tree = document.getElementById("dbTree");
  const meta = document.getElementById("dbMeta");
  const blob = dehydrate(data);
  const groups = groupedCatalog(blob);
  meta.textContent = groups.reduce((n, g) => n + g.items.length, 0) + " rec";
  tree.innerHTML = "";
  const f = dbNorm(dbFilter);
  let any = false;

  groups.forEach(({ muscle, items }) => {
    const shown = items.filter((e) => !f || dbNorm(e.name).includes(f));
    if (f && !shown.length) return;
    any = any || shown.length > 0;
    const isOpen = f ? true : (dbOpenGroups[muscle] !== false);
    const node = document.createElement("div");
    node.className = "db-gnode" + (isOpen ? "" : " closed");
    const hd = document.createElement("div");
    hd.className = "db-ghd";
    hd.innerHTML = `<span class="car">${isOpen ? "▾" : "▸"}</span><span class="nm">${muscle.toLowerCase()}</span><span class="fill"></span><span class="ct">${String(items.length).padStart(2, "0")}</span>`;
    if (!f) hd.onclick = () => { dbOpenGroups[muscle] = !(dbOpenGroups[muscle] !== false); renderCatalog(); };
    node.appendChild(hd);
    const kids = document.createElement("div");
    kids.className = "db-kids";
    shown.forEach((entry, idx) => {
      const last = idx === shown.length - 1;
      const isExOpen = dbOpenEx === entry.id;
      const k = document.createElement("div");
      k.className = "db-k" + (isExOpen ? " open" : "");
      const noteDot = entry.note ? '<span class="nb" title="ha una nota"> ✎·</span>' : '';
      k.innerHTML = `<div class="db-krow"><span class="br">${last ? "└─" : "├─"}</span>` +
        `<span class="knm">${dbHL(entry.name)}${noteDot}</span><span class="car2">▸</span></div>` +
        (isExOpen ? dbDetHTML(entry) : "");
      k.querySelector(".db-krow").onclick = () => { dbOpenEx = isExOpen ? null : entry.id; renderCatalog(); };
      if (isExOpen) wireDetail(k, entry);
      kids.appendChild(k);
    });
    node.appendChild(kids);
    tree.appendChild(node);
  });

  if (f && !any) {
    tree.innerHTML = `<div class="db-nores">nessun match per "<b>${dbEsc(dbFilter)}</b>"<br>` +
      `<button class="mk" id="dbMkNew">+ aggiungi "${dbEsc(dbFilter)}"</button></div>`;
    document.getElementById("dbMkNew").onclick = () => openCatalogForm(null, dbFilter);
  }
}
```

- [ ] **Step 4: wireDetail (nota on-blur, edit, delete) — edit/delete stub fino al Task 10**

```js
function wireDetail(k, entry) {
  const ta = k.querySelector(".note");
  ta.onclick = (e) => e.stopPropagation();
  ta.onblur = () => mutateCatalog((b) => setCatalogNote(b, entry.id, ta.value));
  k.querySelector(".edit").onclick = (e) => { e.stopPropagation(); openCatalogForm(entry); };
  k.querySelector(".del").onclick = (e) => { e.stopPropagation(); openCatalogDelete(entry); };
}
```

`openCatalogForm`/`openCatalogDelete` arrivano al Task 10: per ora definiscile come stub vuoti in cima così il file carica:

```js
function openCatalogForm(entry, prefill) { /* Task 10 */ }
function openCatalogDelete(entry) { /* Task 10 */ }
```

- [ ] **Step 5: Aggancia la ricerca**

```js
document.getElementById("dbQ").oninput = (e) => { dbFilter = e.target.value; renderCatalog(); };
document.getElementById("dbAddInline").onclick = () => openCatalogForm(null, dbFilter);
```

(Mettilo dove si agganciano gli altri handler statici al boot, una volta sola.)

- [ ] **Step 6: Verifica nel browser**

Apri l'overlay. Atteso: gli 8 gruppi (non vuoti) con conteggi, voci ordinate, gruppi collassabili; digitando in `grep>` filtra ed evidenzia; tap su una voce → dettaglio inline con **animazione scanline CRT**, "usato in" (se il nome combacia con un esercizio in scheda) o fallback, sparkline se c'è storico, nota editabile che persiste; ricerca senza match → bottone "aggiungi «…»". I bottoni modifica/elimina non fanno ancora nulla (Task 10).

- [ ] **Step 7: Commit**

```bash
git add app.js
git commit -m "feat(catalog): albero + ricerca + dettaglio inline CRT con usato-in/sparkline/nota"
```

---

## Task 10: Modale add / edit / delete (index.html + app.js)

**Files:**
- Modify: `index.html` (markup modale)
- Modify: `app.js` (`openCatalogForm`, `openCatalogDelete` reali)

Riusa il pattern del modale `exDialog` (index.html ~322) e dei form esercizio (app.js ~660-723).

- [ ] **Step 1: Markup modale in index.html**

Dentro `#dbOverlay`, dopo `.ov`:

```html
<div class="scrim hidden" id="dbScrim">
  <div class="modal">
    <div class="mbar"><span class="dot"></span><span class="mttl" id="dbMTtl">NUOVO</span>
      <button class="x" id="dbMx">✕</button></div>
    <div class="mbody" id="dbMBody"></div>
  </div>
</div>
```

Usa le classi modale esistenti (`.scrim/.modal/.mbar/.mbody/.fld/.mfoot`); se i nomi reali differiscono, allinea.

- [ ] **Step 2: openCatalogForm reale (add + edit)**

Sostituisci lo stub:

```js
function dbCloseModal() {
  document.getElementById("dbScrim").classList.add("hidden");
}
function openCatalogForm(entry, prefill = "") {
  const scrim = document.getElementById("dbScrim");
  const mttl = document.getElementById("dbMTtl");
  const mbody = document.getElementById("dbMBody");
  const isEdit = !!entry;
  mttl.textContent = isEdit ? "MODIFICA ESERCIZIO" : "NUOVO ESERCIZIO";
  const name0 = isEdit ? entry.name : prefill;
  const grp0 = isEdit ? entry.muscle : MUSCLE_GROUPS[0];
  mbody.innerHTML =
    `<div class="fld"><label>nome esercizio</label>` +
    `<input id="dbFNm" value="${dbEsc(name0).replace(/"/g, "&quot;")}" placeholder="es. Panca piana bilanciere" autocomplete="off"></div>` +
    `<div class="warn" id="dbFWarn"></div>` +
    `<div class="fld"><label>gruppo muscolare</label><select id="dbFGrp">` +
    MUSCLE_GROUPS.map((m) => `<option ${m === grp0 ? "selected" : ""}>${m}</option>`).join("") +
    `</select></div>` +
    `<div class="mfoot"><button class="cancel" id="dbFCancel">annulla</button>` +
    `<button class="ok" id="dbFOk">salva</button></div>`;
  const nm = document.getElementById("dbFNm");
  const grp = document.getElementById("dbFGrp");
  const ok = document.getElementById("dbFOk");
  const warn = document.getElementById("dbFWarn");
  const blob = dehydrate(data);
  function check() {
    const v = nm.value.trim();
    if (!v) { ok.disabled = true; warn.textContent = ""; return; }
    const dup = blob.catalog.some((e) =>
      e.muscle === grp.value && dbNorm(e.name) === dbNorm(v) && (!isEdit || e.id !== entry.id));
    ok.disabled = dup; warn.textContent = dup ? "già presente in " + grp.value : "";
  }
  nm.oninput = check; grp.onchange = check; check();
  document.getElementById("dbFCancel").onclick = dbCloseModal;
  ok.onclick = () => {
    const name = nm.value.trim(), muscle = grp.value;
    if (isEdit) mutateCatalog((b) => renameCatalogEntry(b, entry.id, { name, muscle }));
    else { mutateCatalog((b) => addCatalogEntry(b, { name, muscle })); dbOpenGroups[muscle] = true; dbFilter = ""; document.getElementById("dbQ").value = ""; }
    dbCloseModal(); renderCatalog();
  };
  scrim.classList.remove("hidden");
  setTimeout(() => nm.focus(), 30);
}
document.getElementById("dbMx").onclick = dbCloseModal;
document.getElementById("dbScrim").onclick = (e) => { if (e.target.id === "dbScrim") dbCloseModal(); };
```

- [ ] **Step 3: openCatalogDelete reale**

```js
function openCatalogDelete(entry) {
  const scrim = document.getElementById("dbScrim");
  document.getElementById("dbMTtl").textContent = "ELIMINA";
  document.getElementById("dbMBody").innerHTML =
    `<div class="delmsg">Eliminare <b>${dbEsc(entry.name)}</b> da <b>${dbEsc(entry.muscle)}</b>?` +
    `<br>Non tocca lo storico delle schede.</div>` +
    `<div class="mfoot"><button class="cancel" id="dbFCancel">annulla</button>` +
    `<button class="ok" id="dbFOk" style="background:var(--down,#c0442e);border-color:var(--down,#c0442e);color:#fff;">elimina</button></div>`;
  document.getElementById("dbFCancel").onclick = dbCloseModal;
  document.getElementById("dbFOk").onclick = () => {
    mutateCatalog((b) => deleteCatalogEntry(b, entry.id));
    dbOpenEx = null; dbCloseModal(); renderCatalog();
  };
  scrim.classList.remove("hidden");
}
```

- [ ] **Step 4: Verifica nel browser**

Atteso: "+ nuovo"/"+ NEW"/"aggiungi «…»" aprono il form, salva aggiunge la voce (con flash/scroll opzionale), duplicato nello stesso gruppo è bloccato col warning; "✎ modifica" rinomina/cambia gruppo preservando la nota; "× elimina" chiede conferma e rimuove. Ogni operazione persiste al reload (verifica ricaricando la pagina).

- [ ] **Step 5: Commit**

```bash
git add index.html app.js
git commit -m "feat(catalog): modale add/edit/delete collegato a mutateCatalog"
```

---

## Task 11: Verifica finale

**Files:** nessuno (solo verifica)

- [ ] **Step 1: Suite completa verde**

Run: `node --test`
Expected: tutti i test passano (i 289 preesistenti + i nuovi di catalog/sheets/store.merge). Nessun fail.

- [ ] **Step 2: Lint/sanity import**

Verifica che non ci siano cicli di import problematici: `catalog.js` importa da `session.js` ed `editor.js`; `sheets.js` importa da `catalog.js`. Conferma che `session.js` NON importi da `catalog.js` (eviti il ciclo). Run: `grep -n "from \"./catalog.js\"" session.js` → atteso: nessun risultato.

- [ ] **Step 3: Verifica end-to-end nel browser (la fa l'utente, dietro auth Supabase)**

Checklist: apertura overlay dal drawer; seed visibile al primo avvio; ricerca + add-if-missing; dettaglio inline con animazione CRT; usato-in/sparkline su un esercizio che esiste in una scheda con storico; nota persistente; add/edit/delete persistenti dopo reload; sync cross-device (il catalogo riappare su un altro device dopo login).

- [ ] **Step 4: Commit finale (se restano aggiustamenti)**

```bash
git add -A
git commit -m "chore(catalog): rifiniture post-verifica"
```

---

## Self-review (coverage spec → task)

- Scopo/voce drawer → Task 8. ✓
- Modello `{id,name,muscle,note}` → Task 3. ✓
- Persistenza campo top-level + hydrate/dehydrate/toSheetsBlob → Task 1. ✓
- mergeBlobs union by id, newer wins, no tombstone → Task 2. ✓
- Seed one-shot → Task 4. ✓
- Gruppi fissi + sort alfabetico → Task 5. ✓
- Collegamento storico per nome (usato-in + sparkline + fallback) → Task 6 + Task 9. ✓
- UI terminale: albero, box-drawing, dot-leader, conteggi, ricerca grep>, add-if-missing → Task 9. ✓
- Dettaglio inline + animazione scanline CRT → Task 7 (CSS) + Task 9 (markup). ✓
- Modale solo per add/edit/delete → Task 10. ✓
- Invariante dehydrate-a-ogni-save (mutateCatalog) → Task 8. ✓
- Eliminare non tocca lo storico (testo nel dialog) → Task 10. ✓
- Test sul pattern sheets.test → Task 1-6. ✓

Nessun requisito della spec resta scoperto.
