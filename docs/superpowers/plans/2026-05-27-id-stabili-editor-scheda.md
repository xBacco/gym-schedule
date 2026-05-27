# Editor scheda + ID stabili — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare all'utente un editor della scheda (modifica/aggiungi/elimina/riordina esercizi nei 3 giorni fissi A/B/C) spostando la scheda da codice a dato sincronizzato e ancorando i log a ID di esercizio stabili.

**Architecture:** La scheda si sposta in `data.plan` (sincronizzata via GitHub); `plan.js` resta come seed di default. Ogni esercizio prende un ID opaco stabile e i log passano da chiavi-indice a chiavi-ID. Una migrazione pura e idempotente converte il dato esistente al boot. La logica nuova (genId, mutazioni del piano, migrazione) vive nel modulo puro `editor.js`, testato in Node; la UI dell'editor è un overlay in `app.js`.

**Tech Stack:** Vanilla JS (ES modules), `node --test` per gli unit test, niente framework. Persistenza via GitHub Contents API (già esistente in `store.js`).

**Spec:** `docs/superpowers/specs/2026-05-27-id-stabili-editor-scheda-design.md`

> **Nota verifica:** `app.js` è il layer DOM e non ha unit test. I task su `app.js` si verificano **manualmente** (server locale + browser; opzionalmente Playwright/telefono). I moduli puri (`editor.js`, `store.js`, `session.js`) si verificano coi test Node.
>
> **Comandi base:** test = `npm test` (gira `node --test`). Server locale = `python -m http.server 8780` dalla root del repo, poi `http://localhost:8780`.
>
> **Git su Windows:** usare PowerShell per i comandi git; nei messaggi di commit niente virgolette doppie (usare here-string `@'…'@`). Ogni commit chiude con la riga `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.

---

## File Structure

- **Create `editor.js`** — logica pura: `genId`, `addExercise`, `removeExercise`, `reorderExercise`, `updateExercise`, `migrate`. Nessuna dipendenza (la scheda seed arriva come argomento).
- **Create `tests/editor.test.js`** — unit test del modulo sopra.
- **Modify `store.js`** — `prefillSets`: rinomina parametro `idx`→`exId` (resta key-agnostico). Nessun'altra modifica (`getEntry`/`setEntry` già keyano per la stringa passata).
- **Modify `session.js`** — rinomina parametro `idx`→`exId` nelle funzioni che lo usano come chiave dato; `sessionVolume`/`activeExerciseIndex` leggono `exs[i].id`.
- **Modify `tests/session.test.js` / `tests/store.test.js`** — aggiungono casi con ID-stringa opachi per bloccare il keying-per-ID.
- **Modify `app.js`** — wire `migrate` al boot; tutte le letture/scritture dei log passano l'ID dell'esercizio invece dell'indice; nuovo overlay editor + dialog modifica/aggiungi + riordino drag.
- **Modify `index.html`** — bottone ✎ nell'header, markup overlay editor, markup dialog modifica esercizio.
- **Modify `style.css`** — stili editor (righe, drag handle, dialog).
- **Modify `sw.js`** — bump cache v17→v18.

---

## Task 1: `editor.js` — genId e mutazioni del piano

**Files:**
- Create: `editor.js`
- Test: `tests/editor.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/editor.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { genId, addExercise, removeExercise, reorderExercise, updateExercise } from "../editor.js";

const samplePlan = () => [
  { day: "A", title: "A", exercises: [
    { id: "aaa1", name: "Panca", setsReps: "3 × 8", recText: "2 min", restSeconds: 120, superset: false },
    { id: "aaa2", name: "Lento", setsReps: "3 × 10", recText: "2 min", restSeconds: 120, superset: false },
  ] },
  { day: "B", title: "B", exercises: [
    { id: "bbb1", name: "Stacco", setsReps: "3 × 8", recText: "2 min", restSeconds: 120, superset: false },
  ] },
];

test("genId: stringa breve non collidente e non vuota", () => {
  const id = genId(["aaa1", "aaa2"]);
  assert.equal(typeof id, "string");
  assert.ok(id.length >= 4);
  assert.ok(!["aaa1", "aaa2"].includes(id));
});

test("genId: rigenera se collide con esistenti", () => {
  // forza collisione: con un solo id possibile lo spazio è grande, qui basta che eviti il set
  const existing = Array.from({ length: 50 }, (_, i) => `id${i}`);
  const id = genId(existing);
  assert.ok(!existing.includes(id));
});

test("addExercise: aggiunge in fondo al giorno con id nuovo, immutabile", () => {
  const plan = samplePlan();
  const next = addExercise(plan, "A", { name: "Dips", setsReps: "3 × 10", recText: "90 sec", restSeconds: 90, superset: false });
  assert.equal(plan[0].exercises.length, 2, "originale invariato");
  const exA = next.find((d) => d.day === "A").exercises;
  assert.equal(exA.length, 3);
  assert.equal(exA[2].name, "Dips");
  assert.ok(exA[2].id && !["aaa1", "aaa2"].includes(exA[2].id));
});

test("removeExercise: toglie per id, immutabile", () => {
  const plan = samplePlan();
  const next = removeExercise(plan, "A", "aaa1");
  assert.equal(plan[0].exercises.length, 2, "originale invariato");
  const exA = next.find((d) => d.day === "A").exercises;
  assert.deepEqual(exA.map((e) => e.id), ["aaa2"]);
});

test("removeExercise: id inesistente -> piano invariato (clone)", () => {
  const plan = samplePlan();
  const next = removeExercise(plan, "A", "zzz9");
  assert.deepEqual(next.find((d) => d.day === "A").exercises.map((e) => e.id), ["aaa1", "aaa2"]);
});

test("reorderExercise: sposta da fromIdx a toIdx, immutabile", () => {
  const plan = samplePlan();
  const next = reorderExercise(plan, "A", 0, 1);
  assert.deepEqual(plan[0].exercises.map((e) => e.id), ["aaa1", "aaa2"], "originale invariato");
  assert.deepEqual(next.find((d) => d.day === "A").exercises.map((e) => e.id), ["aaa2", "aaa1"]);
});

test("reorderExercise: indici fuori range -> clamp/no-op senza crash", () => {
  const plan = samplePlan();
  const next = reorderExercise(plan, "A", 0, 9);
  assert.equal(next.find((d) => d.day === "A").exercises.length, 2);
});

test("updateExercise: applica patch per id, preserva l'id, immutabile", () => {
  const plan = samplePlan();
  const next = updateExercise(plan, "A", "aaa1", { name: "Panca piana", restSeconds: 150 });
  assert.equal(plan[0].exercises[0].name, "Panca", "originale invariato");
  const ex = next.find((d) => d.day === "A").exercises[0];
  assert.equal(ex.id, "aaa1", "id preservato");
  assert.equal(ex.name, "Panca piana");
  assert.equal(ex.restSeconds, 150);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../editor.js'` (modulo non ancora creato).

- [ ] **Step 3: Write minimal implementation**

Create `editor.js`:

```js
// ---- Editor della scheda: mutazioni pure su `plan` + identità stabile + migrazione. ----

// ID opaco breve (base36). Rigenera finché non è univoco rispetto a `existingIds`.
export function genId(existingIds = []) {
  const taken = new Set(existingIds);
  let id;
  do {
    id = Math.random().toString(36).slice(2, 7); // 5 char base36
  } while (id.length < 4 || taken.has(id));
  return id;
}

// Tutti gli id di esercizio già usati nel piano (per evitare collisioni).
function allIds(plan) {
  const ids = [];
  for (const d of plan) for (const e of d.exercises) if (e.id) ids.push(e.id);
  return ids;
}

function mapDay(plan, day, fn) {
  return plan.map((d) => (d.day === day ? { ...d, exercises: fn(d.exercises.slice()) } : d));
}

export function addExercise(plan, day, ex) {
  const id = genId(allIds(plan));
  return mapDay(plan, day, (exs) => { exs.push({ ...ex, id }); return exs; });
}

export function removeExercise(plan, day, id) {
  return mapDay(plan, day, (exs) => exs.filter((e) => e.id !== id));
}

export function reorderExercise(plan, day, fromIdx, toIdx) {
  return mapDay(plan, day, (exs) => {
    if (fromIdx < 0 || fromIdx >= exs.length) return exs;
    const to = Math.max(0, Math.min(toIdx, exs.length - 1));
    const [moved] = exs.splice(fromIdx, 1);
    exs.splice(to, 0, moved);
    return exs;
  });
}

export function updateExercise(plan, day, id, patch) {
  return mapDay(plan, day, (exs) => exs.map((e) => (e.id === id ? { ...e, ...patch, id: e.id } : e)));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (tutti i nuovi test di `editor.test.js` verdi; i 119 preesistenti restano verdi).

- [ ] **Step 5: Commit**

```
git add editor.js tests/editor.test.js
git commit -m @'
feat: editor.js con genId e mutazioni pure del piano

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 2: `editor.js` — `migrate(data, seedPlan)`

**Files:**
- Modify: `editor.js`
- Test: `tests/editor.test.js`

- [ ] **Step 1: Write the failing tests**

Aggiungi in fondo a `tests/editor.test.js`:

```js
import { migrate } from "../editor.js";

// PLAN seed minimale a 2 giorni; gli indici dei log mappano l'ordine di questo seed.
const seed = () => [
  { day: "A", title: "Petto", exercises: [
    { name: "Panca", setsReps: "3 × 8", recText: "2 min", restSeconds: 120, superset: false },
    { name: "Lento", setsReps: "3 × 10", recText: "2 min", restSeconds: 120, superset: false },
  ] },
  { day: "B", title: "Dorso", exercises: [
    { name: "Stacco", setsReps: "3 × 8", recText: "2 min", restSeconds: 120, superset: false },
  ] },
];

test("migrate: dato vuoto -> crea plan dal seed con id, schema 2", () => {
  const out = migrate({ updatedAt: null, weeks: {} }, seed());
  assert.equal(out.schema, 2);
  assert.equal(out.plan.length, 2);
  assert.ok(out.plan[0].exercises[0].id, "id assegnato");
  assert.ok(out.plan[0].exercises[1].id !== out.plan[0].exercises[0].id, "id distinti");
});

test("migrate: riscrive le entry da chiavi-indice a chiavi-id", () => {
  const data = {
    updatedAt: null,
    weeks: { "2026-W22": { label: "W22", entries: {
      A: { "0": { sets: [{ reps: "8", kg: "50", done: true }], note: "" },
           "1": { sets: [{ reps: "10", kg: "20", done: true }], note: "" } },
      B: { "0": { sets: [{ reps: "8", kg: "80", done: true }], note: "" } },
    } } },
  };
  const out = migrate(data, seed());
  const idA0 = out.plan.find((d) => d.day === "A").exercises[0].id;
  const idA1 = out.plan.find((d) => d.day === "A").exercises[1].id;
  const entA = out.weeks["2026-W22"].entries.A;
  assert.ok(entA[idA0] && entA[idA0].sets[0].kg === "50");
  assert.ok(entA[idA1] && entA[idA1].sets[0].kg === "20");
  assert.ok(!("0" in entA) && !("1" in entA), "vecchie chiavi-indice rimosse");
});

test("migrate: indici orfani (oltre il piano) conservati sotto _orphan_<i>", () => {
  const data = {
    updatedAt: null,
    weeks: { "2026-W22": { label: "W22", entries: {
      A: { "0": { sets: [], note: "x" }, "5": { sets: [{ reps: "1", kg: "1", done: true }], note: "" } },
    } } },
  };
  const out = migrate(data, seed());
  const entA = out.weeks["2026-W22"].entries.A;
  assert.ok(entA["_orphan_5"], "log orfano conservato");
  assert.equal(entA["_orphan_5"].sets[0].kg, "1");
});

test("migrate: idempotente -> se schema>=2 ritorna invariato", () => {
  const data = { schema: 2, plan: seed().map((d) => ({ ...d, exercises: d.exercises.map((e, i) => ({ ...e, id: `x${i}` })) })), weeks: {} };
  const out = migrate(data, seed());
  assert.equal(out, data, "stesso riferimento: nessun lavoro");
});

test("migrate: non muta l'input (clona)", () => {
  const data = { updatedAt: null, weeks: { W: { label: "W", entries: { A: { "0": { sets: [], note: "" } } } } } };
  const snapshot = JSON.stringify(data);
  migrate(data, seed());
  assert.equal(JSON.stringify(data), snapshot, "input invariato");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `migrate is not a function` / export mancante.

- [ ] **Step 3: Write minimal implementation**

Aggiungi a `editor.js`:

```js
// Migrazione una-tantum schema 1 -> 2: crea `data.plan` dal seed (assegnando id),
// riscrive le entry da chiavi-indice a chiavi-id. Idempotente (guard su schema),
// non muta l'input. `seedPlan` è il PLAN di plan.js (così editor.js resta puro).
export function migrate(data, seedPlan) {
  if (data && data.schema >= 2) return data; // già migrato, no-op
  const out = structuredClone(data || { updatedAt: null, weeks: {} });

  // 1. plan dal seed, con id stabili (ordine = ordine storico dei log).
  const used = [];
  out.plan = seedPlan.map((d) => ({
    day: d.day,
    title: d.title,
    exercises: d.exercises.map((e) => {
      const id = genId(used);
      used.push(id);
      return { ...e, id };
    }),
  }));

  // 2. mappa giorno -> [id per indice], per riscrivere le entry.
  const idsByDay = {};
  for (const d of out.plan) idsByDay[d.day] = d.exercises.map((e) => e.id);

  // 3. riscrive le entry indice->id; gli indici senza esercizio diventano orfani.
  for (const wk of Object.values(out.weeks || {})) {
    const entries = wk.entries || {};
    for (const day of Object.keys(entries)) {
      const ids = idsByDay[day] || [];
      const remapped = {};
      for (const key of Object.keys(entries[day])) {
        const i = Number(key);
        if (Number.isInteger(i) && ids[i]) remapped[ids[i]] = entries[day][key];
        else remapped[`_orphan_${key}`] = entries[day][key];
      }
      entries[day] = remapped;
    }
  }

  out.schema = 2;
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (nuovi test verdi; tutto il resto invariato).

- [ ] **Step 5: Commit**

```
git add editor.js tests/editor.test.js
git commit -m @'
feat: migrate(data, seedPlan) schema 1->2, indice->id, idempotente

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 3: Bloccare il keying-per-ID in `store.js` e `session.js`

Le funzioni pure usano già il parametro `idx` *come chiave* passata a `getEntry`/`setEntry`, quindi funzionano con qualunque stringa. Questo task rende esplicito il contratto (rinomina `idx`→`exId`) e aggiunge test con ID opachi per bloccarne il comportamento.

**Files:**
- Modify: `store.js` (`prefillSets`)
- Modify: `session.js` (`bestKg`, `previousNote`, `previousWeekSet`, `exerciseTrend`, `weekTopKg`, `sessionVolume`, `activeExerciseIndex`)
- Test: `tests/session.test.js`

- [ ] **Step 1: Write the failing test**

Aggiungi in fondo a `tests/session.test.js`:

```js
import { bestKg as bestKgId, exerciseTrend as trendId } from "../session.js";

test("bestKg: funziona con chiavi-id opache (non numeriche)", () => {
  const data = { weeks: {
    "2026-W21": { entries: { A: { "k7m2": { sets: [{ reps: "8", kg: "40", done: true }] } } } },
    "2026-W22": { entries: { A: { "k7m2": { sets: [{ reps: "8", kg: "45", done: true }] } } } },
  } };
  assert.equal(bestKgId(data, "A", "k7m2"), 45);
});

test("exerciseTrend: traccia per id opaco su più settimane", () => {
  const data = { weeks: {
    "2026-W21": { entries: { A: { "zz9": { sets: [{ reps: "8", kg: "40", done: true }] } } } },
    "2026-W22": { entries: { A: { "zz9": { sets: [{ reps: "8", kg: "42", done: true }] } } } },
  } };
  const t = trendId(data, "A", "zz9", "2026-W22", 3, false);
  assert.deepEqual(t.map((x) => x.kg), [40, 42]);
});
```

- [ ] **Step 2: Run tests to verify they pass (già verdi: comportamento già corretto)**

Run: `npm test`
Expected: PASS — le funzioni keyano già per la stringa passata. (Se per qualche motivo fallisce, c'è un bug di keying da correggere prima di proseguire.)

- [ ] **Step 3: Rinomina i parametri per chiarezza (refactor senza cambio di comportamento)**

In `session.js`, rinomina il parametro `idx`→`exId` in: `bestKg(data, day, exId)`, `previousNote(data, day, exId, weekKey, superset)`, `previousWeekSet(data, day, exId, weekKey, setIndex, track)`, `exerciseTrend(data, day, exId, weekKey, n, superset)`, e nella funzione interna `weekTopKg(data, weekKey, day, exId, superset)`. Aggiorna i corpi di conseguenza (sostituendo `idx` con `exId` ovunque compaia in quelle funzioni).

In `session.js`, `sessionVolume` e `activeExerciseIndex` iterano gli esercizi: cambia la chiave dato da indice a id dell'esercizio in quella posizione.

`sessionVolume` — sostituisci:
```js
    const v = getEntry(data, weekKey, day, i);
```
con:
```js
    const v = getEntry(data, weekKey, day, exs[i].id);
```

`activeExerciseIndex` — sostituisci:
```js
    if (!isEntryComplete(getEntry(data, weekKey, day, i), exs[i])) return i;
```
con:
```js
    if (!isEntryComplete(getEntry(data, weekKey, day, exs[i].id), exs[i])) return i;
```

In `store.js`, `prefillSets(data, weekKey, day, idx)` → rinomina il parametro `idx`→`exId` e aggiorna il corpo (`getEntry(data, keys[i], day, exId)`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (119 + nuovi). I test che chiamano queste funzioni posizionalmente non cambiano firma di chiamata, quindi restano verdi.

- [ ] **Step 5: Commit**

```
git add store.js session.js tests/session.test.js
git commit -m @'
refactor: keying log per exId opaco (session.js, store.js) + test

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 4: Wire `migrate` al boot e passare gli ID nelle chiamate dato di `app.js`

Questo task NON aggiunge UI: rende l'app funzionante sul nuovo schema (scheda da `data.plan`, log keyati per ID). Verifica **manuale**.

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Import di editor.js e seed del piano**

In `app.js`, dopo gli import esistenti, aggiungi:
```js
import { migrate, addExercise, removeExercise, reorderExercise, updateExercise } from "./editor.js";
```

- [ ] **Step 2: `dayPlan()` legge da `data.plan` (con fallback al PLAN seed)**

Sostituisci (riga ~222):
```js
const dayPlan = () => PLAN.find((d) => d.day === currentDay) || PLAN[0];
```
con:
```js
// La scheda vive in data.plan dopo la migrazione; PLAN resta solo da seed.
const planDays = () => (Array.isArray(data.plan) && data.plan.length ? data.plan : PLAN);
const dayPlan = () => planDays().find((d) => d.day === currentDay) || planDays()[0];
// ID dell'esercizio in posizione i del giorno corrente (chiave dei log).
const exIdAt = (i) => { const e = dayPlan().exercises[i]; return e ? e.id : String(i); };
```

- [ ] **Step 3: Wire `migrate` nel boot**

In `boot()`, subito dopo il blocco `try/catch` che imposta `data` e prima di `data = ensureWeek(...)` (riga ~1420), inserisci:
```js
  data = migrate(data, PLAN);
```
(così la migrazione gira sia sul ramo caricato sia su quello offline/emptyData; `applyPending` è già stato applicato a monte e usa le chiavi del momento.)

- [ ] **Step 4: Sostituire l'indice con l'ID in tutte le chiamate dato**

Regola meccanica: dove una funzione di log riceve l'indice dell'esercizio del **giorno/settimana correnti**, passa `exIdAt(idx)` al posto dell'indice. Punti da cambiare in `app.js` (cerca `currentDay`):

- `renderList` (riga ~1140): `bestKg(data, currentDay, i)` → `bestKg(data, currentDay, exIdAt(i))`.
- `buildNoteField` (righe ~666, ~668, ~680-681): `getEntry/previousNote/setEntry(... currentDay, idx ...)` → usa `exIdAt(idx)`.
- `persist` (riga ~767): `bufferEdit(currentWeek, currentDay, idx, getEntry(data, currentWeek, currentDay, idx))` → entrambe le occorrenze usano `exIdAt(idx)`.
- `renderFocusNormal` (riga ~774 in poi): `getEntry`, `prefillSets`, `setEntry`, `previousWeekSet`, `exerciseTrend` chiamate con `idx`/`currentDay` → `exIdAt(idx)`. Anche il `draftKey` (riga ~783) può restare basato su `idx` (è solo una chiave UI locale).
- `renderFocusNormal` blocco "ho fallito l'ultima" (righe ~641-649, dentro `showFeelAsk`/affini se usano `lastDone.idx`): usa `exIdAt(...)` per la chiave dato.
- `trackBlock` / `renderFocusSuperset` / `previousSupersetSets` (righe ~931, ~1049, ~1105): tutte le `getEntry/setEntry/previousWeekSet/exerciseTrend` per superset → `exIdAt(idx)`.

> Mantieni invariati `openIndex`, `openFocus(i)`, `i`/`idx` come **indice di posizione** per la navigazione UI: cambia solo l'argomento che fa da **chiave dato**.

- [ ] **Step 5: Rest override keyato per ID**

In `getRest`/`setRest` (righe ~95-103) la mappa locale usa `${day}-${idx}`. Cambia i call site nell'overlay (`buildRestEditor`, `renderList`) per passare `exIdAt(idx)` come terzo argomento al posto di `idx`. Le vecchie chiavi `day-idx` locali diventano stale e cadono sul default `restSeconds` (accettabile: override locale per-dispositivo).

- [ ] **Step 6: Verifica manuale**

Avvia: `python -m http.server 8780` (dalla root del repo), apri `http://localhost:8780`.
Verifica (senza token, sola lettura, sui dati reali della W22):
1. La lista del giorno A mostra gli stessi esercizi di prima, con i `best kg` corretti dallo storico.
2. Apri un esercizio: la "settimana precedente" e il prefill mostrano i valori attesi.
3. In console: `JSON.parse(...)` non necessario — controlla che non ci siano errori JS.
4. (Con token di test, su un profilo non di produzione) logga una serie e verifica che venga scritta sotto la chiave-ID in `data.weeks[...].entries`.

Conferma a voce/terminale che i 4 punti tornano prima di committare.

- [ ] **Step 7: Commit**

```
git add app.js
git commit -m @'
refactor: app.js usa data.plan e log keyati per exId; migrate al boot

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 5: Markup e stili dell'editor (`index.html`, `style.css`)

**Files:**
- Modify: `index.html`
- Modify: `style.css`

- [ ] **Step 1: Bottone ✎ nell'header**

In `index.html`, nella `.week-row` (riga ~32-33), aggiungi il bottone editor prima del ⚙:
```html
      <button id="planEditBtn" class="btn-icon" aria-label="Modifica scheda">✎</button>
```
(L'ordine risultante: 🥗 alimentazione, ✎ scheda, ⚙ impostazioni.)

- [ ] **Step 2: Overlay editor**

In `index.html`, dopo l'overlay alimentazione (dopo riga ~97), aggiungi:
```html
  <!-- Editor scheda a schermo intero -->
  <div id="planOverlay" class="focus-ov hidden" aria-hidden="true">
    <header class="focus-top">
      <button id="planBack" class="focus-back" aria-label="Chiudi editor">←</button>
      <div class="focus-id">
        <div class="fn">Modifica scheda</div>
        <div id="planSub" class="fs">giorno —</div>
      </div>
    </header>
    <div class="plan-tabs" id="planTabs">
      <button data-day="A" class="on">A</button>
      <button data-day="B">B</button>
      <button data-day="C">C</button>
    </div>
    <div id="planBody" class="plan-body"></div>
  </div>
```

- [ ] **Step 3: Dialog modifica/aggiungi esercizio**

In `index.html`, dopo il `setDialog` (dopo riga ~126), aggiungi:
```html
  <!-- Popup modifica/aggiungi esercizio -->
  <dialog id="exDialog" class="set-dialog">
    <div class="modal-h">
      <span id="exDlgTitle" class="t">Esercizio</span>
      <button id="exDlgClose" class="x" type="button" aria-label="Chiudi">✕</button>
    </div>
    <label class="editlabel" for="exName">Nome</label>
    <input id="exName" type="text" class="ex-inp" placeholder="es. Panca piana bilanciere" autocomplete="off">
    <label class="editlabel" for="exSetsReps">Serie × ripetizioni</label>
    <input id="exSetsReps" type="text" class="ex-inp" placeholder="es. 3 × 8-10" autocomplete="off">
    <label class="editlabel" for="exRecText">Recupero (testo)</label>
    <input id="exRecText" type="text" class="ex-inp" placeholder="es. 90 sec" autocomplete="off">
    <label class="editlabel" for="exRestSeconds">Recupero (secondi)</label>
    <input id="exRestSeconds" type="number" inputmode="numeric" class="ex-inp" placeholder="90" min="0" step="5">
    <label class="editlabel" for="exBar">Bilanciere kg (vuoto = default)</label>
    <input id="exBar" type="number" inputmode="decimal" class="ex-inp" placeholder="" min="0" step="0.5">
    <label class="notifyrow"><input type="checkbox" id="exSuperset"> Superset (formato serie×reps: <code>A / B</code>)</label>
    <button id="exDlgSave" type="button" class="confirm">✓ Salva</button>
  </dialog>
```

- [ ] **Step 4: Stili editor**

In `style.css`, in fondo, aggiungi (riusa le variabili/colori del tema esistente; adatta i nomi-variabile a quelli già presenti nel file):
```css
/* ---- Editor scheda ---- */
.plan-tabs { display: flex; gap: 6px; padding: 0 16px 10px; }
.plan-tabs button { flex: 1; padding: 8px 0; border-radius: 8px; border: 1px solid var(--line, #36302a); background: var(--card, #241f1a); color: var(--muted, #9a9088); font: inherit; }
.plan-tabs button.on { background: var(--accent-dim, #6b5a2e); color: var(--accent-fg, #ffe9b0); border-color: var(--accent-dim, #6b5a2e); }
.plan-body { padding: 0 16px 24px; overflow-y: auto; }
.pe-row { display: flex; align-items: center; gap: 8px; background: var(--card, #241f1a); border: 1px solid var(--line, #36302a); border-radius: 10px; padding: 10px 8px; margin-bottom: 8px; touch-action: none; }
.pe-row.dragging { opacity: .55; border-style: dashed; border-color: var(--accent, #c9a24a); }
.pe-grip { color: var(--accent, #c9a24a); font-size: 20px; padding: 0 4px; cursor: grab; touch-action: none; }
.pe-meta { flex: 1; min-width: 0; }
.pe-name { color: var(--fg, #ece6dd); font-size: 14px; }
.pe-sub { color: var(--muted, #9a9088); font-size: 12px; margin-top: 2px; }
.pe-badge { font-size: 9px; color: var(--accent-fg, #ffd98a); background: var(--accent-dim, #4a3d22); border-radius: 4px; padding: 1px 5px; margin-left: 6px; }
.pe-ic { font-size: 16px; padding: 4px 6px; background: none; border: none; color: var(--accent, #c9a24a); }
.pe-ic.del { color: #c46a5a; }
.pe-add { width: 100%; padding: 12px; border: 1px dashed var(--accent-dim, #5a4d2e); border-radius: 10px; color: var(--accent, #c9a24a); background: transparent; font: inherit; margin-top: 4px; }
.ex-inp { width: 100%; box-sizing: border-box; margin-bottom: 4px; }
```

> Prima di scrivere il blocco, apri `style.css` e usa i **nomi-variabile/colori reali** già definiti nel tema Amber (cerca `--` o i selettori `.focus-ov`, `.item`, `.set-dialog`) per restare coerente. I valori dopo la virgola sono solo fallback.

- [ ] **Step 5: Verifica manuale (solo markup/stili)**

Ricarica `http://localhost:8780`. Verifica che l'header mostri la ✎ tra 🥗 e ⚙ e che non rompa il layout. L'overlay e il dialog sono ancora nascosti (nessun wiring). Nessun errore in console.

- [ ] **Step 6: Commit**

```
git add index.html style.css
git commit -m @'
feat: markup e stili editor scheda (header ✎, overlay, dialog esercizio)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 6: Render e apertura/chiusura dell'overlay editor (`app.js`)

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Stato + apertura/chiusura (pattern history come gli altri overlay)**

In `app.js`, vicino agli altri stati overlay (dopo `nutritionOpen`, riga ~51), aggiungi:
```js
let planOpen = false;
let planEditDay = "A";   // giorno selezionato nell'editor
function openPlanEditor() {
  planOpen = true;
  planEditDay = currentDay;
  history.pushState({ gymPlan: true }, "");
  renderPlanEditor();
}
function closePlanEditor() {
  if (!planOpen) return;
  if (history.state && history.state.gymPlan) history.back(); // -> popstate chiude
  else { planOpen = false; renderPlanEditor(); }
}
```

- [ ] **Step 2: Render dell'overlay**

Aggiungi in `app.js` (vicino a `renderNutritionOverlay`):
```js
function renderPlanEditor() {
  const ov = document.getElementById("planOverlay");
  if (!planOpen) {
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");
    if (openIndex === null && !nutritionOpen) document.body.style.overflow = "";
    return;
  }
  const day = planEditDay;
  document.getElementById("planSub").textContent = `giorno ${day}`;
  for (const b of document.querySelectorAll("#planTabs button")) b.classList.toggle("on", b.dataset.day === day);
  const body = document.getElementById("planBody");
  body.textContent = "";
  const dp = planDays().find((d) => d.day === day) || planDays()[0];
  dp.exercises.forEach((ex, i) => body.appendChild(buildPlanRow(ex, i, dp.exercises.length)));
  const add = document.createElement("button");
  add.type = "button"; add.className = "pe-add"; add.textContent = "＋ Aggiungi esercizio";
  add.addEventListener("click", () => openExDialog(day, null));
  body.appendChild(add);
  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

// Riga esercizio nell'editor: grip drag, nome+sub, modifica, elimina.
function buildPlanRow(ex, i, count) {
  const row = document.createElement("div");
  row.className = "pe-row";
  row.dataset.idx = String(i);
  const grip = document.createElement("span"); grip.className = "pe-grip"; grip.textContent = "⠿";
  const meta = document.createElement("div"); meta.className = "pe-meta";
  const nm = document.createElement("div"); nm.className = "pe-name"; nm.textContent = ex.name;
  if (ex.superset) { const b = document.createElement("span"); b.className = "pe-badge"; b.textContent = "SUPERSET"; nm.appendChild(b); }
  const sub = document.createElement("div"); sub.className = "pe-sub";
  sub.textContent = `${ex.setsReps} · ${ex.recText}` + (ex.bar ? ` · bilanciere ${ex.bar}kg` : "");
  meta.append(nm, sub);
  const edit = document.createElement("button"); edit.type = "button"; edit.className = "pe-ic"; edit.textContent = "✎";
  edit.addEventListener("click", () => openExDialog(planEditDay, ex.id));
  const del = document.createElement("button"); del.type = "button"; del.className = "pe-ic del"; del.textContent = "🗑";
  del.addEventListener("click", () => deletePlanExercise(planEditDay, ex.id, ex.name));
  row.append(grip, meta, edit, del);
  attachDragHandle(row, grip, planEditDay);   // definita nel Task 8
  return row;
}
```

> `openExDialog`, `deletePlanExercise` e `attachDragHandle` sono definite nei Task 7 e 8. Per far girare questo task senza errori, aggiungi subito stub no-op che verranno sostituiti:
> ```js
> function openExDialog() {}
> function deletePlanExercise() {}
> function attachDragHandle() {}
> ```
> (Verranno implementate — non lasciare gli stub dopo il Task 8.)

- [ ] **Step 3: Wiring bottoni e popstate**

In `boot()`, insieme agli altri wiring (dopo la riga del `nutritionBack`, ~1400), aggiungi:
```js
  document.getElementById("planEditBtn").addEventListener("click", openPlanEditor);
  document.getElementById("planBack").addEventListener("click", () => closePlanEditor());
  for (const b of document.querySelectorAll("#planTabs button")) {
    b.addEventListener("click", () => { planEditDay = b.dataset.day; renderPlanEditor(); });
  }
```
Nel gestore `popstate` (riga ~1405) aggiungi la chiusura dell'editor:
```js
    if (planOpen) { planOpen = false; renderPlanEditor(); }
```

- [ ] **Step 4: Verifica manuale**

Ricarica. Tap su ✎ → si apre l'overlay con gli esercizi del giorno corrente; i tab A/B/C cambiano lista; ← e il "indietro" del telefono chiudono. `＋ Aggiungi` e ✎/🗑 non fanno ancora nulla (stub). Nessun errore console.

- [ ] **Step 5: Commit**

```
git add app.js
git commit -m @'
feat: overlay editor scheda con tab giorno e righe esercizio (no azioni)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 7: Dialog modifica/aggiungi esercizio (`app.js`)

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Apertura del dialog (precompila in modifica, vuoto in aggiunta)**

Sostituisci lo stub `openExDialog` con:
```js
// day: giorno; id: id esercizio da modificare, oppure null per aggiungerne uno nuovo.
let exDlgDay = "A";
let exDlgId = null;
function openExDialog(day, id) {
  exDlgDay = day; exDlgId = id;
  const dlg = document.getElementById("exDialog");
  const dp = planDays().find((d) => d.day === day);
  const ex = id ? dp.exercises.find((e) => e.id === id) : null;
  document.getElementById("exDlgTitle").textContent = ex ? "Modifica esercizio" : "Nuovo esercizio";
  document.getElementById("exName").value = ex ? ex.name : "";
  document.getElementById("exSetsReps").value = ex ? ex.setsReps : "";
  document.getElementById("exRecText").value = ex ? ex.recText : "";
  document.getElementById("exRestSeconds").value = ex ? ex.restSeconds : "";
  document.getElementById("exBar").value = ex && ex.bar != null ? ex.bar : "";
  document.getElementById("exSuperset").checked = !!(ex && ex.superset);
  dlg.showModal();
}
```

- [ ] **Step 2: Salvataggio**

Aggiungi:
```js
function readExDialog() {
  const name = document.getElementById("exName").value.trim();
  const setsReps = document.getElementById("exSetsReps").value.trim();
  const recText = document.getElementById("exRecText").value.trim();
  const restSeconds = parseInt(document.getElementById("exRestSeconds").value, 10);
  const barRaw = document.getElementById("exBar").value.trim();
  const superset = document.getElementById("exSuperset").checked;
  const ex = {
    name, setsReps, recText,
    restSeconds: Number.isFinite(restSeconds) ? restSeconds : 60,
    superset,
  };
  if (barRaw !== "") { const b = parseFloat(barRaw.replace(",", ".")); if (Number.isFinite(b) && b > 0) ex.bar = b; }
  return ex;
}

function saveExDialog() {
  const patch = readExDialog();
  if (!patch.name) return; // nome obbligatorio: non salva un esercizio senza nome
  if (exDlgId) data = { ...data, plan: updateExercise(data.plan, exDlgDay, exDlgId, patch) };
  else data = { ...data, plan: addExercise(data.plan, exDlgDay, patch) };
  scheduleSave();
  document.getElementById("exDialog").close();
  renderPlanEditor();
  render(); // la lista principale riflette i cambi
}
```

- [ ] **Step 3: Wiring del dialog**

In `boot()` aggiungi:
```js
  document.getElementById("exDlgSave").addEventListener("click", saveExDialog);
  document.getElementById("exDlgClose").addEventListener("click", () => document.getElementById("exDialog").close());
  document.getElementById("exDialog").addEventListener("click", (e) => { if (e.target.id === "exDialog") e.target.close(); });
```

- [ ] **Step 4: Verifica manuale**

Ricarica. Nell'editor: `＋ Aggiungi` apre il dialog vuoto → compila nome + serie×reps + recupero → Salva → l'esercizio appare in fondo alla lista del giorno e nella schermata principale. ✎ su una riga apre il dialog precompilato → cambia il nome → Salva → il nome si aggiorna. Apri un esercizio modificato nella schermata principale: lo **storico** (best/settimana precedente) è ancora corretto (l'id non è cambiato). Con token: verifica che `data.plan` venga salvato su GitHub.

- [ ] **Step 5: Commit**

```
git add app.js
git commit -m @'
feat: dialog modifica/aggiungi esercizio (updateExercise/addExercise)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 8: Elimina + riordino drag (`app.js`)

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Elimina con conferma**

Sostituisci lo stub `deletePlanExercise` con:
```js
function deletePlanExercise(day, id, name) {
  if (!confirm(`Eliminare “${name}” dal giorno ${day}?\nLo storico resta salvato ma non sarà più mostrato.`)) return;
  data = { ...data, plan: removeExercise(data.plan, day, id) };
  scheduleSave();
  renderPlanEditor();
  render();
}
```

- [ ] **Step 2: Riordino via pointer events**

Sostituisci lo stub `attachDragHandle` con un'implementazione basata su pointer events. Il grip avvia il drag; durante il movimento si individua la riga sotto il puntatore e si riordina al rilascio. Usa `reorderExercise` per applicare.

```js
// Drag-to-reorder col grip (pointer events, no HTML5 DnD: affidabile su mobile).
function attachDragHandle(row, grip, day) {
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const body = document.getElementById("planBody");
    const rows = () => [...body.querySelectorAll(".pe-row")];
    const fromIdx = rows().indexOf(row);
    row.classList.add("dragging");
    grip.setPointerCapture(e.pointerId);

    const onMove = (ev) => {
      const y = ev.clientY;
      let target = fromIdx;
      rows().forEach((r, idx) => {
        const rect = r.getBoundingClientRect();
        if (y > rect.top + rect.height / 2) target = idx;
      });
      // feedback visivo minimale: sposta il nodo nel DOM (l'ordine reale si applica al rilascio)
      const list = rows();
      if (target !== list.indexOf(row)) {
        const ref = list[target];
        if (ref && ref !== row) {
          if (target > list.indexOf(row)) ref.after(row); else ref.before(row);
        }
      }
    };
    const onUp = () => {
      grip.releasePointerCapture(e.pointerId);
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      row.classList.remove("dragging");
      const toIdx = [...document.getElementById("planBody").querySelectorAll(".pe-row")].indexOf(row);
      if (toIdx !== fromIdx && toIdx >= 0) {
        data = { ...data, plan: reorderExercise(data.plan, day, fromIdx, toIdx) };
        scheduleSave();
      }
      renderPlanEditor();
      render();
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
  });
}
```

- [ ] **Step 3: Rimuovi gli stub**

Verifica che gli stub `function openExDialog(){}`, `function deletePlanExercise(){}`, `function attachDragHandle(){}` introdotti nel Task 6 siano stati **tutti** sostituiti dalle implementazioni reali (nessuno stub residuo).

- [ ] **Step 4: Verifica manuale (incl. lo scenario critico dello storico)**

Ricarica. Nell'editor del giorno A:
1. **Elimina** un esercizio → sparisce dalla lista e dalla schermata principale; conferma annullabile.
2. **Riordino**: trascina col ⠿ un esercizio in una nuova posizione → l'ordine cambia e resta dopo la ricarica (se c'è token, dopo il sync).
3. **Scenario critico:** prendi un esercizio con storico (es. il 1°, con dati W22), **trascinalo** in fondo. Aprilo dalla schermata principale → il suo **best kg / settimana precedente** deve essere ancora il suo, non quello dell'esercizio che ora occupa la vecchia posizione. (Questo dimostra che i log seguono l'ID, non l'indice.)
4. Nessun errore console; lo scroll della pagina non interferisce col drag.

Conferma i 4 punti prima di committare.

- [ ] **Step 5: Commit**

```
git add app.js
git commit -m @'
feat: elimina esercizio + riordino drag (pointer events) nell'editor

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Task 9: Bump cache service worker + verifica finale

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: Bump versione cache**

In `sw.js`, trova la costante della versione cache (es. `gymsched-v17`) e portala a `gymsched-v18`. Se `editor.js` va elencato tra gli asset pre-cache, aggiungilo all'array degli URL.

- [ ] **Step 2: Verifica che editor.js sia servito/cache-ato**

Controlla nell'array di pre-cache di `sw.js`: deve includere `./editor.js` (oltre a `./app.js`, `./store.js`, ecc.). Se manca, aggiungilo.

- [ ] **Step 3: Run test suite completa**

Run: `npm test`
Expected: PASS — tutti i test verdi (119 preesistenti + nuovi di editor/session).

- [ ] **Step 4: Verifica manuale finale (regressione)**

Ricarica con hard refresh. Checklist:
1. Logging normale di una serie funziona (schermata principale).
2. Editor: aggiungi / modifica / elimina / riordina funzionano e persistono.
3. Storico (best/settimana precedente) corretto dopo un riordino.
4. Sync GitHub (con token): `data.plan` e i log keyati-ID arrivano nel repo; un secondo dispositivo li vede dopo reload.
5. Nessun errore console.

- [ ] **Step 5: Commit**

```
git add sw.js
git commit -m @'
chore: bump cache gymsched-v18 (editor scheda)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

## Self-review (coperta dalla spec)

- **Modello dati** (spec §Modello) → Task 2 (plan+id+schema), Task 4 (data.plan in app).
- **Migrazione** (spec §Migrazione) → Task 2 + wire Task 4 Step 3.
- **ID opachi** (spec decisione 2) → Task 1 `genId`.
- **Refactor keying** (spec §Refactor) → Task 3 + Task 4.
- **UI editor / drag pointer events** (spec §UI, decisione 3) → Task 5/6/7/8.
- **Eliminare = log conservati** (spec decisione 4) → Task 8 Step 1 (removeExercise non tocca le entry).
- **Editor da ✎ header** (spec decisione 5) → Task 5 Step 1 + Task 6.
- **Test & cache v18** (spec §Test) → Task 1/2/3 (unit) + Task 9 (cache + regressione).
