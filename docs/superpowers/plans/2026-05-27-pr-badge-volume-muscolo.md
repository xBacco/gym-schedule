# PR badge + Volume per muscolo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere il badge "record personale" (🏆) e il breakdown del volume settimanale per gruppo muscolare alla PWA gym-schedule.

**Architecture:** Logica pura e testabile in `session.js` (record, volume per muscolo) e `editor.js` (migrazione muscoli). Il campo `muscle`/`muscleB` entra nel seed `plan.js` e viene retro-applicato ai dati esistenti via migrazione schema 2→3. Il rendering (🏆 in lista, badge live, volcard espandibile, select nell'editor) sta in `app.js` + `index.html` + `style.css`.

**Tech Stack:** Vanilla ES modules, `node --test` per i test, service worker cache-first (bump versione a ogni rilascio).

---

## File Structure

- `session.js` — nuovi helper puri: `bestKgBefore`, `isWeekRecord`, `isSetRecord`, `volumeByMuscle`.
- `editor.js` — nuova funzione `backfillMuscles(data, seedPlan)` (migrazione schema 2→3).
- `plan.js` — campo `muscle`/`muscleB` nel seed `PLAN`.
- `app.js` — wiring migrazione (boot + conflitto), select muscolo nell'editor esercizio, 🏆 in lista + badge live nell'overlay, volcard espandibile.
- `index.html` — select `#exMuscle`/`#exMuscleB` nell'`#exDialog`.
- `style.css` — stile del breakdown volume-per-muscolo e del badge 🏆.
- `sw.js` — bump cache `v29`→`v30`.
- `tests/session.test.js`, `tests/editor.test.js` — nuovi test.

Le costanti dei gruppi muscolari (`Petto, Dorso, Spalle, Bicipiti, Tricipiti, Gambe, Polpacci, Core`) vivono come array letterale in `index.html` (per le `<option>`) e implicitamente nel seed di `plan.js`. Non serve un modulo condiviso: `volumeByMuscle` accetta qualunque stringa muscolo, quindi non c'è accoppiamento.

---

## Task 1: Helper record in `session.js`

**Files:**
- Modify: `session.js` (aggiunge 3 export dopo `bestKg`, ~riga 132)
- Test: `tests/session.test.js`

- [ ] **Step 1: Scrivi i test che falliscono**

In cima a `tests/session.test.js`, aggiungi gli import al gruppo esistente (riga 5):
```js
import { bestKg, bestKgBefore, isWeekRecord, isSetRecord, progressionDelta, withNote, previousNote, previousSetInSession, previousWeekSet, lastWorkingSet, sessionVolume, exerciseTrend, topSetSeries, chartGeometry } from "../session.js";
```

In fondo al file aggiungi:
```js
// Helper: data con un esercizio "p1" normale, kg per settimana.
function dataKg(perWeek) {
  let d = emptyData();
  for (const [wk, kgs] of Object.entries(perWeek)) {
    const sets = kgs.map((kg) => ({ reps: "8", kg: String(kg), done: true }));
    d = setEntry(d, wk, "A", "p1", { sets, note: "" });
  }
  return d;
}

test("bestKgBefore: massimo escludendo la settimana data", () => {
  const d = dataKg({ "2026-W20": [50, 60], "2026-W21": [70], "2026-W22": [55] });
  assert.equal(bestKgBefore(d, "A", "p1", "2026-W22"), 70);
  assert.equal(bestKgBefore(d, "A", "p1", "2026-W21"), 60);
});

test("bestKgBefore: null se nessuna altra settimana ha dati", () => {
  const d = dataKg({ "2026-W22": [55] });
  assert.equal(bestKgBefore(d, "A", "p1", "2026-W22"), null);
});

test("bestKgBefore: ignora warmup e failed", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", "p1", { sets: [
    { reps: "8", kg: "100", done: true, warmup: true },
    { reps: "8", kg: "90", done: true, failed: true },
    { reps: "8", kg: "60", done: true },
  ], note: "" });
  assert.equal(bestKgBefore(d, "A", "p1", "2026-W22"), 60);
});

test("isWeekRecord: true se la settimana batte strettamente lo storico", () => {
  const d = dataKg({ "2026-W20": [60], "2026-W22": [65] });
  assert.equal(isWeekRecord(d, "A", "p1", "2026-W22"), true);
});

test("isWeekRecord: false se pareggia il massimo (non stretto)", () => {
  const d = dataKg({ "2026-W20": [60], "2026-W22": [60] });
  assert.equal(isWeekRecord(d, "A", "p1", "2026-W22"), false);
});

test("isWeekRecord: true al primo dato in assoluto", () => {
  const d = dataKg({ "2026-W22": [40] });
  assert.equal(isWeekRecord(d, "A", "p1", "2026-W22"), true);
});

test("isWeekRecord: false se la settimana non ha kg working", () => {
  const d = dataKg({ "2026-W20": [60] });
  assert.equal(isWeekRecord(d, "A", "p1", "2026-W22"), false);
});

test("isSetRecord: numerico vs null e maggiore stretto", () => {
  assert.equal(isSetRecord(null, "40"), true);
  assert.equal(isSetRecord(60, "65"), true);
  assert.equal(isSetRecord(60, "60"), false);
  assert.equal(isSetRecord(60, ""), false);
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `npm test`
Atteso: FAIL — `bestKgBefore is not a function` (e simili).

- [ ] **Step 3: Implementa gli helper**

In `session.js`, subito dopo la funzione `bestKg` (finisce a ~riga 132), aggiungi:
```js
// Max kg working escludendo la settimana `weekKey` (per capire se è un nuovo PR).
export function bestKgBefore(data, day, exId, weekKey, track = null) {
  let best = null;
  for (const k of Object.keys(data?.weeks ?? {})) {
    if (k === weekKey) continue;
    const t = entryTrack(getEntry(data, k, day, exId), track);
    for (const s of t.sets) {
      if (s.warmup || s.failed) continue;
      const v = parseNum(s.kg);
      if (v !== null && (best === null || v > best)) best = v;
    }
  }
  return best;
}

// true se il top-set working di `weekKey` supera STRETTAMENTE lo storico precedente.
export function isWeekRecord(data, day, exId, weekKey, track = null) {
  const t = entryTrack(getEntry(data, weekKey, day, exId), track);
  let top = null;
  for (const s of t.sets) {
    if (s.warmup || s.failed) continue;
    const v = parseNum(s.kg);
    if (v !== null && (top === null || v > top)) top = v;
  }
  if (top === null) return false;
  const prev = bestKgBefore(data, day, exId, weekKey, track);
  return prev === null || top > prev;
}

// Micro-helper per il badge live: kg numerico e maggiore stretto del massimo precedente.
export function isSetRecord(prevBest, kg) {
  const v = parseNum(kg);
  if (v === null) return false;
  return prevBest === null || v > prevBest;
}
```
Nota: `entryTrack` e `parseNum` sono già definite (private) in `session.js` e usate da `lastWorkingSet`/`topSetSeries`.

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `npm test`
Atteso: PASS (tutti, inclusi i nuovi).

- [ ] **Step 5: Commit**

```bash
git add session.js tests/session.test.js
git commit -m "feat(session): helper record personale (bestKgBefore, isWeekRecord, isSetRecord)"
```

---

## Task 2: `volumeByMuscle` in `session.js`

**Files:**
- Modify: `session.js` (aggiunge 1 export dopo `sessionVolume`, ~riga 224)
- Test: `tests/session.test.js`

- [ ] **Step 1: Scrivi i test che falliscono**

Aggiungi `volumeByMuscle` all'import (riga 5 di `tests/session.test.js`) e in fondo al file:
```js
test("volumeByMuscle: somma per gruppo, ordina desc, esclude i zero", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "p1", { sets: [{ reps: "10", kg: "50", done: true }], note: "" }); // 500
  d = setEntry(d, "2026-W22", "A", "p2", { sets: [{ reps: "10", kg: "20", done: true }], note: "" }); // 200
  const dayPlan = { day: "A", exercises: [
    { id: "p1", muscle: "Petto", superset: false },
    { id: "p2", muscle: "Spalle", superset: false },
  ] };
  assert.deepEqual(volumeByMuscle(d, "2026-W22", "A", dayPlan), [
    { muscle: "Petto", volume: 500 },
    { muscle: "Spalle", volume: 200 },
  ]);
});

test("volumeByMuscle: superset attribuisce A->muscle, B->muscleB", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "s1", {
    a: { sets: [{ reps: "10", kg: "30", done: true }], note: "" }, // 300 -> Tricipiti
    b: { sets: [{ reps: "10", kg: "10", done: true }], note: "" }, // 100 -> Bicipiti
    note: "",
  });
  const dayPlan = { day: "A", exercises: [
    { id: "s1", muscle: "Tricipiti", muscleB: "Bicipiti", superset: true },
  ] };
  assert.deepEqual(volumeByMuscle(d, "2026-W22", "A", dayPlan), [
    { muscle: "Tricipiti", volume: 300 },
    { muscle: "Bicipiti", volume: 100 },
  ]);
});

test("volumeByMuscle: muscolo mancante finisce in 'Altro'", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "p1", { sets: [{ reps: "10", kg: "40", done: true }], note: "" });
  const dayPlan = { day: "A", exercises: [{ id: "p1", superset: false }] };
  assert.deepEqual(volumeByMuscle(d, "2026-W22", "A", dayPlan), [{ muscle: "Altro", volume: 400 }]);
});

test("volumeByMuscle: accumula stesso muscolo da esercizi diversi", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "p1", { sets: [{ reps: "10", kg: "50", done: true }], note: "" }); // 500
  d = setEntry(d, "2026-W22", "A", "p2", { sets: [{ reps: "10", kg: "30", done: true }], note: "" }); // 300
  const dayPlan = { day: "A", exercises: [
    { id: "p1", muscle: "Petto", superset: false },
    { id: "p2", muscle: "Petto", superset: false },
  ] };
  assert.deepEqual(volumeByMuscle(d, "2026-W22", "A", dayPlan), [{ muscle: "Petto", volume: 800 }]);
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `npm test`
Atteso: FAIL — `volumeByMuscle is not a function`.

- [ ] **Step 3: Implementa**

In `session.js`, subito dopo `sessionVolume` (finisce a ~riga 224), aggiungi:
```js
// Volume settimanale per gruppo muscolare: [{muscle, volume}] ordinato desc.
// Traccia normale/A -> ex.muscle, traccia B del superset -> ex.muscleB. Muscolo
// assente -> "Altro". Riusa trackVolume (serie done, no warmup/failed).
export function volumeByMuscle(data, weekKey, day, dayPlan) {
  const exs = dayPlan?.exercises ?? [];
  const map = new Map();
  const add = (muscle, vol) => {
    if (vol <= 0) return;
    const key = muscle && String(muscle).trim() ? String(muscle) : "Altro";
    map.set(key, (map.get(key) ?? 0) + vol);
  };
  for (const ex of exs) {
    const v = getEntry(data, weekKey, day, ex.id);
    if (ex?.superset) {
      const e = normalizeSupersetEntry(v);
      add(ex.muscle, trackVolume(e.a));
      add(ex.muscleB, trackVolume(e.b));
    } else {
      add(ex?.muscle, trackVolume(normalizeEntry(v)));
    }
  }
  return [...map.entries()]
    .map(([muscle, volume]) => ({ muscle, volume }))
    .sort((a, b) => b.volume - a.volume);
}
```
Nota: `normalizeEntry`/`normalizeSupersetEntry` sono già importate da `store.js` in cima a `session.js`; `trackVolume` è già definita (private).

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `npm test`
Atteso: PASS.

- [ ] **Step 5: Commit**

```bash
git add session.js tests/session.test.js
git commit -m "feat(session): volumeByMuscle (breakdown volume settimanale per gruppo)"
```

---

## Task 3: Migrazione `backfillMuscles` in `editor.js`

**Files:**
- Modify: `editor.js` (nuovo export dopo `migrate`, ~riga 87)
- Test: `tests/editor.test.js`

- [ ] **Step 1: Scrivi i test che falliscono**

Aggiungi `backfillMuscles` all'import (riga 3 di `tests/editor.test.js`) e in fondo al file:
```js
const seedWithMuscles = () => [
  { day: "A", title: "A", exercises: [
    { name: "Panca", setsReps: "3 × 8", muscle: "Petto", superset: false },
    { name: "Curl+Push", setsReps: "3 × 10 / 3 × 10", muscle: "Bicipiti", muscleB: "Tricipiti", superset: true },
  ] },
];

test("backfillMuscles: copia muscle/muscleB dal seed per (day,name)", () => {
  const data = { schema: 2, weeks: {}, plan: [
    { day: "A", title: "A", exercises: [
      { id: "x1", name: "Panca", setsReps: "3 × 8", superset: false },
      { id: "x2", name: "Curl+Push", setsReps: "3 × 10 / 3 × 10", superset: true },
    ] },
  ] };
  const out = backfillMuscles(data, seedWithMuscles());
  assert.equal(out.schema, 3);
  assert.equal(out.plan[0].exercises[0].muscle, "Petto");
  assert.equal(out.plan[0].exercises[1].muscle, "Bicipiti");
  assert.equal(out.plan[0].exercises[1].muscleB, "Tricipiti");
});

test("backfillMuscles: idempotente (schema >= 3 -> no-op)", () => {
  const data = { schema: 3, weeks: {}, plan: [
    { day: "A", title: "A", exercises: [{ id: "x1", name: "Panca", superset: false }] },
  ] };
  const out = backfillMuscles(data, seedWithMuscles());
  assert.equal(out.plan[0].exercises[0].muscle, undefined);
});

test("backfillMuscles: esercizio rinominato non abbinato resta senza muscle", () => {
  const data = { schema: 2, weeks: {}, plan: [
    { day: "A", title: "A", exercises: [{ id: "x1", name: "Panca custom", superset: false }] },
  ] };
  const out = backfillMuscles(data, seedWithMuscles());
  assert.equal(out.schema, 3);
  assert.equal(out.plan[0].exercises[0].muscle, undefined);
});

test("backfillMuscles: non muta l'input", () => {
  const data = { schema: 2, weeks: {}, plan: [
    { day: "A", title: "A", exercises: [{ id: "x1", name: "Panca", superset: false }] },
  ] };
  backfillMuscles(data, seedWithMuscles());
  assert.equal(data.schema, 2);
  assert.equal(data.plan[0].exercises[0].muscle, undefined);
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `npm test`
Atteso: FAIL — `backfillMuscles is not a function`.

- [ ] **Step 3: Implementa**

In `editor.js`, dopo `migrate` (finisce a ~riga 87, prima di `keepLocalPlan`), aggiungi:
```js
// Migrazione schema 2 -> 3: backfill di muscle/muscleB su data.plan esistente,
// abbinando per (day, name) al seed. Idempotente (guard schema >= 3), non muta
// l'input. Va invocata DOPO migrate (che crea data.plan). Esercizi non abbinati
// (rinominati/custom) restano senza muscle -> bucket "Altro" nel breakdown.
export function backfillMuscles(data, seedPlan) {
  if (data && data.schema >= 3) return data;
  const out = structuredClone(data || { updatedAt: null, weeks: {} });
  const seedIdx = new Map();
  for (const d of seedPlan) {
    for (const e of d.exercises) seedIdx.set(`${d.day} ${e.name}`, { muscle: e.muscle, muscleB: e.muscleB });
  }
  if (Array.isArray(out.plan)) {
    for (const d of out.plan) {
      for (const e of d.exercises) {
        if (e.muscle != null) continue;
        const seed = seedIdx.get(`${d.day} ${e.name}`);
        if (!seed) continue;
        if (seed.muscle != null) e.muscle = seed.muscle;
        if (seed.muscleB != null) e.muscleB = seed.muscleB;
      }
    }
  }
  out.schema = 3;
  return out;
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `npm test`
Atteso: PASS.

- [ ] **Step 5: Commit**

```bash
git add editor.js tests/editor.test.js
git commit -m "feat(editor): backfillMuscles (migrazione schema 2->3 dei gruppi muscolari)"
```

---

## Task 4: Muscoli nel seed `plan.js`

**Files:**
- Modify: `plan.js` (aggiunge `muscle`/`muscleB` a ogni esercizio)

- [ ] **Step 1: Aggiorna il commento dello schema**

In `plan.js` riga 2, cambia:
```js
// Each exercise: { name, setsReps, recText, restSeconds, superset }
```
in:
```js
// Each exercise: { name, setsReps, recText, restSeconds, superset, muscle, muscleB? }
// muscle = gruppo della traccia normale/A; muscleB = traccia B del superset.
```

- [ ] **Step 2: Aggiungi muscle/muscleB a ogni esercizio**

Sostituisci i tre array `exercises` con questi (aggiunge solo i campi muscolo, nient'altro cambia):

Giorno A:
```js
      { name: "Panca piana bilanciere", setsReps: "3 × 6-8", recText: "2 min", restSeconds: 120, superset: false, muscle: "Petto" },
      { name: "Lento avanti manubri", setsReps: "3 × 8-10", recText: "2 min", restSeconds: 120, superset: false, muscle: "Spalle" },
      { name: "Croci ai cavi", setsReps: "3 × 12-15", recText: "75 sec", restSeconds: 75, superset: false, muscle: "Petto" },
      { name: "Dips", setsReps: "3 × 8-12", recText: "90 sec", restSeconds: 90, superset: false, muscle: "Petto" },
      { name: "Pulldown presa larga", setsReps: "3 × 10-12", recText: "90 sec", restSeconds: 90, superset: false, muscle: "Dorso" },
      { name: "Pushdown tricipiti + Curl manubri", setsReps: "3 × 10 / 3 × 10", recText: "75 sec", restSeconds: 75, superset: true, muscle: "Tricipiti", muscleB: "Bicipiti" },
      { name: "Polpacci in piedi", setsReps: "3 × 12-15", recText: "60 sec", restSeconds: 60, superset: false, muscle: "Polpacci" },
      { name: "Crunch a terra + Plank", setsReps: "3 × 15-20 / 3 × max", recText: "60 sec", restSeconds: 60, superset: true, muscle: "Core", muscleB: "Core" },
```

Giorno B:
```js
      { name: "Stacco rumeno", setsReps: "3 × 8-10", recText: "2 min", restSeconds: 120, superset: false, muscle: "Gambe" },
      { name: "Rematore bilanciere", setsReps: "3 × 8-10", recText: "2 min", restSeconds: 120, superset: false, muscle: "Dorso" },
      { name: "Pullover con manubrio", setsReps: "3 × 12-15", recText: "75 sec", restSeconds: 75, superset: false, muscle: "Dorso" },
      { name: "Affondi con manubri", setsReps: "3 × 10-12", recText: "90-120 s", restSeconds: 120, superset: false, muscle: "Gambe" },
      { name: "Spinte su panca inclinata (manubri)", setsReps: "3 × 8-10", recText: "90 sec", restSeconds: 90, superset: false, muscle: "Petto" },
      { name: "Curl EZ + Skullcrusher", setsReps: "3 × 10 / 3 × 10", recText: "75 sec", restSeconds: 75, superset: true, bar: 10, muscle: "Bicipiti", muscleB: "Tricipiti" },
      { name: "Face pull", setsReps: "3 × 12", recText: "60 sec", restSeconds: 60, superset: false, muscle: "Spalle" },
      { name: "Leg raise + Russian twist", setsReps: "3 × 12-15 / 3 × 20", recText: "60 sec", restSeconds: 60, superset: true, muscle: "Core", muscleB: "Core" },
```

Giorno C:
```js
      { name: "Lento avanti bilanciere", setsReps: "3 × 6-8", recText: "2 min", restSeconds: 120, superset: false, muscle: "Spalle" },
      { name: "Alzate laterali (manubri o cavo)", setsReps: "3 × 12-15", recText: "60 sec", restSeconds: 60, superset: false, muscle: "Spalle" },
      { name: "Alzate posteriori (reverse fly)", setsReps: "3 × 15-20", recText: "60 sec", restSeconds: 60, superset: false, muscle: "Spalle" },
      { name: "Spinte manubri panca piana (o chest press)", setsReps: "3 × 10-12", recText: "90 sec", restSeconds: 90, superset: false, muscle: "Petto" },
      { name: "Rematore al cavo, presa neutra", setsReps: "3 × 10-12", recText: "90 sec", restSeconds: 90, superset: false, muscle: "Dorso" },
      { name: "Curl EZ + Skullcrusher", setsReps: "3 × 10 / 3 × 10", recText: "75 sec", restSeconds: 75, superset: true, bar: 10, muscle: "Bicipiti", muscleB: "Tricipiti" },
      { name: "Curl concentrato + Pushdown", setsReps: "3 × 10 / 3 × 10", recText: "60 sec", restSeconds: 60, superset: true, muscle: "Bicipiti", muscleB: "Tricipiti" },
      { name: "Crunch inverso + Plank laterale", setsReps: "3 × 15 / 3 × max/lato", recText: "60 sec", restSeconds: 60, superset: true, muscle: "Core", muscleB: "Core" },
```

- [ ] **Step 2b: Verifica sintassi**

Run: `node -e "import('./plan.js').then(m => console.log(m.PLAN.flatMap(d => d.exercises).every(e => e.muscle) ? 'OK tutti hanno muscle' : 'MANCA muscle'))"`
Atteso: `OK tutti hanno muscle`

- [ ] **Step 3: Esegui i test (nessuna regressione)**

Run: `npm test`
Atteso: PASS (plan.test.js non controlla i muscoli, ma verifica struttura).

- [ ] **Step 4: Commit**

```bash
git add plan.js
git commit -m "feat(plan): assegna gruppo muscolare a ogni esercizio del seed"
```

---

## Task 5: Wiring migrazione in `app.js`

**Files:**
- Modify: `app.js` (import riga 2; chiamata dopo migrate a riga ~1747 e ~1993)

- [ ] **Step 1: Aggiungi l'import**

In `app.js` riga 2, aggiungi `backfillMuscles`:
```js
import { migrate, backfillMuscles, addExercise, removeExercise, reorderExercise, updateExercise, keepLocalPlan } from "./editor.js";
```

- [ ] **Step 2: Wiring nel boot (dopo riga 1993)**

Trova:
```js
  // Migrazione schema 1->2 (indice->id) dopo applyPending, su entrambi i rami.
  data = migrate(data, PLAN);
```
Sostituisci con:
```js
  // Migrazione schema 1->2 (indice->id) dopo applyPending, su entrambi i rami.
  data = migrate(data, PLAN);
  // Migrazione schema 2->3: backfill dei gruppi muscolari sul plan esistente.
  data = backfillMuscles(data, PLAN);
```

- [ ] **Step 3: Wiring nel ramo conflitto (riga ~1747)**

Trova:
```js
        data = keepLocalPlan(migrate(applyPending(remote.data), PLAN), localPlan);
```
Sostituisci con:
```js
        data = keepLocalPlan(backfillMuscles(migrate(applyPending(remote.data), PLAN), PLAN), localPlan);
```

- [ ] **Step 4: Verifica che il boot non sia rotto (smoke test del modulo)**

Run: `node -e "import('./editor.js').then(async m => { const d = await import('./plan.js'); let x = { schema: 2, weeks: {}, plan: [{ day: 'A', title: 'A', exercises: [{ id: 'a', name: 'Panca piana bilanciere', superset: false }] }] }; const out = m.backfillMuscles(x, d.PLAN); console.log('muscle:', out.plan[0].exercises[0].muscle, 'schema:', out.schema); })"`
Atteso: `muscle: Petto schema: 3`

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat(app): invoca backfillMuscles nel boot e nel merge-conflitto"
```

---

## Task 6: Select muscolo nell'editor esercizio

**Files:**
- Modify: `index.html` (`#exDialog`, dopo riga 178)
- Modify: `app.js` (`openExDialog` ~285, `readExDialog` ~300)

- [ ] **Step 1: Aggiungi le select nell'HTML**

In `index.html`, dopo la riga del superset (riga 178, `<label class="notifyrow">...exSuperset...</label>`) e prima del bottone Salva (riga 179), inserisci:
```html
    <label class="editlabel" for="exMuscle">Gruppo muscolare</label>
    <select id="exMuscle" class="ex-inp">
      <option value="">— nessuno —</option>
      <option>Petto</option><option>Dorso</option><option>Spalle</option><option>Bicipiti</option>
      <option>Tricipiti</option><option>Gambe</option><option>Polpacci</option><option>Core</option>
    </select>
    <label class="editlabel" for="exMuscleB" id="exMuscleBLabel">Gruppo traccia B</label>
    <select id="exMuscleB" class="ex-inp">
      <option value="">— nessuno —</option>
      <option>Petto</option><option>Dorso</option><option>Spalle</option><option>Bicipiti</option>
      <option>Tricipiti</option><option>Gambe</option><option>Polpacci</option><option>Core</option>
    </select>
```

- [ ] **Step 2: Popola le select in `openExDialog`**

In `app.js`, dentro `openExDialog` dopo la riga `document.getElementById("exSuperset").checked = ...;` (riga 296), aggiungi:
```js
  document.getElementById("exMuscle").value = ex && ex.muscle != null ? ex.muscle : "";
  document.getElementById("exMuscleB").value = ex && ex.muscleB != null ? ex.muscleB : "";
  toggleMuscleB(!!(ex && ex.superset));
```

Subito PRIMA di `function openExDialog` (riga 285), aggiungi l'helper e il listener di toggle:
```js
// Mostra/nasconde la select del muscolo della traccia B (solo per i superset).
function toggleMuscleB(on) {
  document.getElementById("exMuscleB").style.display = on ? "" : "none";
  document.getElementById("exMuscleBLabel").style.display = on ? "" : "none";
}
```

- [ ] **Step 3: Aggancia il toggle al checkbox superset**

In `app.js`, dentro `boot()` vicino agli altri wiring dell'exDialog (cerca `exDlgSave` a riga 1947), aggiungi dopo quella riga:
```js
  document.getElementById("exSuperset").addEventListener("change", (e) => toggleMuscleB(e.target.checked));
```

- [ ] **Step 4: Leggi le select in `readExDialog`**

In `app.js`, dentro `readExDialog`, dopo la costruzione di `const ex = { ... }` e prima del `return ex;` (riga ~313), aggiungi:
```js
  const muscle = document.getElementById("exMuscle").value;
  if (muscle) ex.muscle = muscle;
  const muscleB = document.getElementById("exMuscleB").value;
  if (superset && muscleB) ex.muscleB = muscleB;
```

- [ ] **Step 5: Verifica manuale rapida (browser)**

Verrà fatta nella verifica finale (Task 9). Per ora basta il boot pulito.

- [ ] **Step 6: Commit**

```bash
git add index.html app.js
git commit -m "feat(editor): select gruppo muscolare (e traccia B) nell'editor esercizio"
```

---

## Task 7: PR badge — 🏆 in lista + badge live nell'overlay

**Files:**
- Modify: `app.js` (`renderList` ~1632-1634; logica conferma serie nell'overlay)
- Modify: `style.css` (stile badge)

- [ ] **Step 1: Import degli helper record in `app.js`**

In `app.js`, nel blocco import da `session.js` (riga 9, dove c'è già `bestKg`), aggiungi `bestKgBefore, isWeekRecord, isSetRecord`:
```js
  parseTarget, activeSetIndex, isEntryComplete, bestKg, bestKgBefore, isWeekRecord, isSetRecord, progressionDelta,
```

- [ ] **Step 2: 🏆 persistente in lista**

In `app.js` `renderList`, le righe 1632-1634 gestiscono la colonna destra. Sostituisci il blocco:
```js
    if (isComplete(i)) { const c = document.createElement("span"); c.className = "chk"; c.textContent = "✓"; right.appendChild(c); }
    else if (ex.superset) { const best = document.createElement("div"); best.className = "best"; best.textContent = "A·B"; const bl = document.createElement("div"); bl.className = "bl"; bl.textContent = "2 tracce"; right.append(best, bl); }
    else { const bk = bestKg(data, currentDay, exIdAt(i)); const best = document.createElement("div"); best.className = "best"; best.textContent = bk === null ? "—" : bk + " kg"; const bl = document.createElement("div"); bl.className = "bl"; bl.textContent = "best"; right.append(best, bl); }
```
con:
```js
    const exIdL = exIdAt(i);
    const isRec = ex.superset
      ? (isWeekRecord(data, currentDay, exIdL, currentWeek, "a") || isWeekRecord(data, currentDay, exIdL, currentWeek, "b"))
      : isWeekRecord(data, currentDay, exIdL, currentWeek);
    if (isComplete(i)) { const c = document.createElement("span"); c.className = "chk"; c.textContent = "✓"; right.appendChild(c); }
    else if (ex.superset) { const best = document.createElement("div"); best.className = "best"; best.textContent = "A·B"; const bl = document.createElement("div"); bl.className = "bl"; bl.textContent = "2 tracce"; right.append(best, bl); }
    else { const bk = bestKg(data, currentDay, exIdL); const best = document.createElement("div"); best.className = "best"; best.textContent = bk === null ? "—" : bk + " kg"; const bl = document.createElement("div"); bl.className = "bl"; bl.textContent = "best"; right.append(best, bl); }
    if (isRec) { const t = document.createElement("span"); t.className = "rec-badge"; t.textContent = "🏆"; t.title = "Record personale questa settimana"; right.appendChild(t); }
```

- [ ] **Step 3: Badge live nella conferma serie NORMALE (riga ~1382-1384)**

In `app.js`, dentro il listener della CTA "Serie fatta · avvia recupero ▸", subito PRIMA della riga `data = setEntry(currentWeek...withSet(v, curIdx, { ... done: true ... }))` (riga 1383, così `bestKgBefore` non vede ancora la serie corrente), inserisci:
```js
      const _prevBest = bestKgBefore(data, currentDay, exId, currentWeek);
      if (isSetRecord(_prevBest, draft.kg)) showRecordToast();
```
(`exId`, `draft`, `currentDay`, `currentWeek` sono già nello scope di `renderFocusNormal`.)

- [ ] **Step 4: Badge live nella conferma serie SUPERSET (riga ~1560-1562)**

In `app.js`, dentro il listener della CTA "Serie fatta (A+B) · avvia recupero ▸", subito PRIMA della riga `let nv = withSupersetSet(v, "a", ...)` (riga 1561), inserisci:
```js
      const _pa = bestKgBefore(data, currentDay, exId, currentWeek, "a");
      const _pb = bestKgBefore(data, currentDay, exId, currentWeek, "b");
      if (isSetRecord(_pa, draftA.kg) || isSetRecord(_pb, draftB.kg)) showRecordToast();
```
(`exId`, `draftA`, `draftB`, `currentDay`, `currentWeek` sono già nello scope di `renderFocusSuperset`.)

Aggiungi la funzione del toast (vicino alle altre util di rendering, es. dopo `renderFocusOverlay`):
```js
// Badge transitorio "record" sopra l'overlay esercizio. Si auto-rimuove.
function showRecordToast() {
  const host = document.getElementById("focusOverlay");
  if (!host || host.classList.contains("hidden")) return;
  let t = document.getElementById("recToast");
  if (!t) { t = document.createElement("div"); t.id = "recToast"; t.className = "rec-toast"; host.appendChild(t); }
  t.textContent = "🏆 record!";
  t.classList.remove("show"); void t.offsetWidth; t.classList.add("show");
  clearTimeout(showRecordToast._t);
  showRecordToast._t = setTimeout(() => t.classList.remove("show"), 1800);
}
```

- [ ] **Step 5: Stile in `style.css`**

Aggiungi in fondo a `style.css`:
```css
.rec-badge { font-size: 1.1rem; line-height: 1; margin-left: 6px; }
.rec-toast {
  position: absolute; top: 64px; left: 50%; transform: translateX(-50%) translateY(-8px);
  background: var(--acc); color: #1a1205; font-weight: 700; padding: 8px 16px;
  border-radius: 999px; box-shadow: 0 4px 16px rgba(0,0,0,.35); z-index: 40;
  opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s;
}
.rec-toast.show { opacity: 1; transform: translateX(-50%) translateY(0); }
```

- [ ] **Step 6: Esegui i test (nessuna regressione logica)**

Run: `npm test`
Atteso: PASS.

- [ ] **Step 7: Commit**

```bash
git add app.js style.css
git commit -m "feat(app): badge record personale (🏆 in lista + toast live nell'overlay)"
```

---

## Task 8: Volcard espandibile col breakdown per muscolo

**Files:**
- Modify: `app.js` (`buildVolumeRow` ~716, `renderVolRow` ~1712, import `volumeByMuscle`)
- Modify: `style.css`

- [ ] **Step 1: Import `volumeByMuscle` in `app.js`**

In `app.js`, nel blocco import da `session.js` (riga 12, dove c'è già `sessionVolume`), aggiungi `volumeByMuscle`:
```js
  sessionVolume, volumeByMuscle, exerciseTrend, nextExercisePreview,
```

- [ ] **Step 2: Stato espanso + render del breakdown**

In `app.js`, subito prima di `function buildVolumeRow` (riga 716), aggiungi la variabile di stato:
```js
let volExpanded = false;
```

Sostituisci `buildVolumeRow` (righe 716-735) con la versione che accetta il breakdown ed è tappabile:
```js
function buildVolumeRow(vol, prevVol, byMuscle) {
  const wrap = document.createElement("div");
  const row = document.createElement("div");
  row.className = "volcard";
  row.setAttribute("role", "button");
  row.tabIndex = 0;
  const l = document.createElement("span"); l.className = "vl"; l.textContent = "Volume sessione";
  const right = document.createElement("div"); right.className = "vright";
  const v = document.createElement("span"); v.className = "vv"; v.textContent = `${fmtKg(vol)} kg`;
  right.appendChild(v);
  if (prevVol > 0) {
    const sub = document.createElement("span"); sub.className = "vsub";
    const pct = Math.round(((vol - prevVol) / prevVol) * 100);
    const p = document.createElement("span");
    p.className = pct >= 0 ? "acc" : "neg";
    p.textContent = `${pct >= 0 ? "+" : ""}${pct}%`;
    sub.appendChild(p);
    sub.appendChild(document.createTextNode(` · sett. scorsa ${fmtKg(prevVol)} kg`));
    right.appendChild(sub);
  }
  const car = document.createElement("span"); car.className = "vcaret"; car.textContent = volExpanded ? "▴" : "▾";
  right.appendChild(car);
  row.append(l, right);
  row.addEventListener("click", () => { volExpanded = !volExpanded; renderVolRow(); });
  wrap.appendChild(row);
  if (volExpanded) wrap.appendChild(buildMuscleBreakdown(byMuscle));
  return wrap;
}

// Pannello barre orizzontali per gruppo muscolare (settimana corrente).
function buildMuscleBreakdown(byMuscle) {
  const box = document.createElement("div");
  box.className = "muscbreak";
  if (!byMuscle || !byMuscle.length) {
    const e = document.createElement("div"); e.className = "empty"; e.textContent = "Nessun volume registrato.";
    box.appendChild(e);
    return box;
  }
  const max = byMuscle[0].volume || 1;
  for (const { muscle, volume } of byMuscle) {
    const r = document.createElement("div"); r.className = "mb-row";
    const nm = document.createElement("span"); nm.className = "mb-nm"; nm.textContent = muscle;
    const barwrap = document.createElement("div"); barwrap.className = "mb-barwrap";
    const bar = document.createElement("div"); bar.className = "mb-bar"; bar.style.width = `${Math.round((volume / max) * 100)}%`;
    barwrap.appendChild(bar);
    const kg = document.createElement("span"); kg.className = "mb-kg"; kg.textContent = `${fmtKg(volume)} kg`;
    r.append(nm, barwrap, kg);
    box.appendChild(r);
  }
  return box;
}
```

- [ ] **Step 3: Passa il breakdown da `renderVolRow`**

In `app.js` `renderVolRow` (riga 1712), sostituisci:
```js
function renderVolRow() {
  const root = document.getElementById("volRow");
  root.textContent = "";
  const vol = sessionVolume(data, currentWeek, currentDay, dayPlan());
  const prevVol = sessionVolume(data, prevWeekKey(), currentDay, dayPlan());
  root.appendChild(buildVolumeRow(vol, prevVol));
}
```
con:
```js
function renderVolRow() {
  const root = document.getElementById("volRow");
  root.textContent = "";
  const vol = sessionVolume(data, currentWeek, currentDay, dayPlan());
  const prevVol = sessionVolume(data, prevWeekKey(), currentDay, dayPlan());
  const byMuscle = volumeByMuscle(data, currentWeek, currentDay, dayPlan());
  root.appendChild(buildVolumeRow(vol, prevVol, byMuscle));
}
```

- [ ] **Step 4: Stile in `style.css`**

Aggiungi in fondo a `style.css`:
```css
.volcard { cursor: pointer; }
.vcaret { margin-left: 8px; opacity: .6; font-size: .8rem; }
.muscbreak { padding: 8px 12px 4px; display: flex; flex-direction: column; gap: 6px; }
.mb-row { display: flex; align-items: center; gap: 8px; font-size: .85rem; }
.mb-nm { flex: 0 0 76px; color: var(--ink); }
.mb-barwrap { flex: 1 1 auto; height: 8px; background: rgba(255,255,255,.08); border-radius: 999px; overflow: hidden; }
.mb-bar { height: 100%; background: var(--acc); border-radius: 999px; }
.mb-kg { flex: 0 0 auto; color: var(--ink); opacity: .8; min-width: 56px; text-align: right; }
```
> Nota: usa `var(--ink)` per il testo (NON `--fg`), come da convenzione del progetto.

- [ ] **Step 5: Esegui i test**

Run: `npm test`
Atteso: PASS.

- [ ] **Step 6: Commit**

```bash
git add app.js style.css
git commit -m "feat(app): volcard espandibile con breakdown volume per gruppo muscolare"
```

---

## Task 9: Bump cache, verifica browser, push

**Files:**
- Modify: `sw.js` (riga 5)

- [ ] **Step 1: Bump versione cache**

In `sw.js` riga 5, cambia:
```js
const CACHE = "gymsched-v29";
```
in:
```js
const CACHE = "gymsched-v30";
```

- [ ] **Step 2: Suite completa verde**

Run: `npm test`
Atteso: PASS, 0 fail (≈162 + nuovi test).

- [ ] **Step 3: Verifica browser (Playwright)**

Servi la cartella su una porta locale e guida un Chromium headless (come nelle sessioni precedenti). Verifica, iniettando uno storico via `localStorage` `gymsched_pending` con gli id canonici da `data.json`:
- **Editor**: apri ✎ scheda → modifica un esercizio → la select "Gruppo muscolare" mostra il valore migrato; per un superset compare anche "Gruppo traccia B"; salva e riapri → persiste.
- **🏆 lista**: con una settimana il cui top-set supera lo storico, la riga mostra 🏆 accanto a "best"; pareggio → niente 🏆.
- **Volcard**: tap sulla riga volume → si espande col breakdown per gruppo; ri-tap → si chiude.
- **0 errori console**.

- [ ] **Step 4: Commit + push**

```bash
git add sw.js
git commit -m "chore(sw): bump cache gymsched-v30 (PR badge + volume per muscolo)"
git push
```

---

## Self-review (fatto in fase di scrittura)

- **Copertura spec**: §A modello dati → Task 4 (seed) + Task 3 (migrazione) + Task 6 (editor). §B PR badge → Task 1 (helper) + Task 7 (render). §C volume muscolo → Task 2 (helper) + Task 8 (display) + Task 6 (editor). §D test+rilascio → test in ogni task + Task 9. Tutto coperto.
- **Type/nomi**: `bestKgBefore`, `isWeekRecord`, `isSetRecord`, `volumeByMuscle`, `backfillMuscles`, `toggleMuscleB`, `showRecordToast`, `buildMuscleBreakdown`, `volExpanded` — coerenti tra definizione e uso.
- **Task 7 Step 3-4**: righe e nomi locali (`exId`, `draft`/`draftA`/`draftB`) verificati in `renderFocusNormal` (~1383) e `renderFocusSuperset` (~1561). Nessun placeholder residuo.
- **Placeholder scan**: nessun TBD/TODO; ogni step che tocca codice mostra il codice completo.
