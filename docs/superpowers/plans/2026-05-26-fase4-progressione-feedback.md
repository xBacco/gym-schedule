# Fase 4 — Progressione e Feedback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere tre feature di progressione/feedback alla schermata sessione: tag "com'è andata" (RPE light) per serie, scorciatoie "ripeti serie precedente", e volume di sessione + mini-trend 3 settimane per esercizio.

**Architecture:** La logica pura nuova va in `store.js` (normalizzazione del campo `feel`) e `session.js` (lettura storico + aggregazioni), tutta testata con `node --test`. Il rendering/wiring DOM va in `app.js` tramite piccoli helper riusabili chiamati sia dal percorso normale sia da quello superset; gli stili in `style.css`. Nessuna nuova dipendenza, nessun asset.

**Tech Stack:** HTML + CSS + JS vanilla a moduli ES. Test con `node:test` + `node:assert/strict`. Dati in `localStorage` + sync `data.json` via API GitHub (invariati).

**Spec di riferimento:** `docs/superpowers/specs/2026-05-26-fase4-progressione-feedback-design.md`

---

## File Structure

- `store.js` — **Modifica:** `normalizeSet` estesa col campo `feel`. È l'unico punto di normalizzazione delle serie, quindi il campo si propaga ovunque.
- `session.js` — **Modifica:** quattro funzioni pure nuove (`previousSetInSession`, `previousWeekSet`, `sessionVolume`, `exerciseTrend`) + un helper privato `parseNum`.
- `app.js` — **Modifica:** quattro helper DOM nuovi (`buildRpeBar`, `buildRepeatChips`, `buildTrendRow`, `buildVolumeRow`); `setRow` estesa col chip `feel`; wiring nei due percorsi di focus (`renderFocusNormal`, `trackBlock`).
- `style.css` — **Modifica:** classi per tag RPE, chip "ripeti", riga trend, riga volume.
- `tests/store.test.js` — **Modifica:** test per `feel` in `normalizeSet`.
- `tests/session.test.js` — **Modifica:** test per le quattro funzioni nuove.

**Convenzioni progetto (dalla memory):** commit + push automatici su `main` (no PR). `node --test` è il gate. La logica pura si testa in Node; il DOM si verifica in browser (`python -m http.server`).

---

## Task 1: Campo `feel` nella normalizzazione serie

**Files:**
- Modify: `store.js:59-61` (`normalizeSet`)
- Test: `tests/store.test.js`

- [ ] **Step 1: Scrivi i test falliti**

In `tests/store.test.js`, aggiungi in fondo (l'import di `normalizeSet` da `../store.js` esiste già; se manca, aggiungilo alla riga di import esistente):

```javascript
test("normalizeSet: conserva un feel valido", () => {
  assert.equal(normalizeSet({ reps: 8, kg: 70, done: true, feel: "hard" }).feel, "hard");
  assert.equal(normalizeSet({ reps: 8, kg: 70, feel: "easy" }).feel, "easy");
  assert.equal(normalizeSet({ reps: 8, kg: 70, feel: "ok" }).feel, "ok");
});

test("normalizeSet: feel mancante o non valido -> stringa vuota", () => {
  assert.equal(normalizeSet({ reps: 8, kg: 70, done: true }).feel, "");
  assert.equal(normalizeSet({ reps: 8, kg: 70, feel: "boh" }).feel, "");
  assert.equal(normalizeSet({ reps: 8, kg: 70, feel: 5 }).feel, "");
});

test("normalizeSet: non altera reps/kg/done aggiungendo feel", () => {
  assert.deepEqual(normalizeSet({ reps: 8, kg: 72.5, done: true, feel: "ok" }),
    { reps: "8", kg: "72.5", done: true, feel: "ok" });
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `node --test tests/store.test.js`
Expected: FAIL — `feel` è `undefined`, le assert su `.feel` falliscono.

- [ ] **Step 3: Implementa la modifica minima**

In `store.js`, sostituisci `normalizeSet` (righe 59-61) con:

```javascript
const FEELS = new Set(["easy", "ok", "hard"]);

export function normalizeSet(s) {
  const feel = FEELS.has(s?.feel) ? s.feel : "";
  return { reps: String(s?.reps ?? ""), kg: String(s?.kg ?? ""), done: !!s?.done, feel };
}
```

Nota: `zipSets` (righe 44-57) e `prefillSets` (righe 85-96) costruiscono serie senza `feel`; va bene — passano attraverso `normalizeSet` o sono prefill freschi, quindi `feel` resta `""`. **Non** propagare `feel` nel prefill (la valutazione non si eredita tra settimane).

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `node --test tests/store.test.js`
Expected: PASS, 0 fail. Esegui anche `node --test` (intera suite) per confermare nessuna regressione.

- [ ] **Step 5: Commit**

```bash
git add store.js tests/store.test.js
git commit -m "feat(store): campo feel (RPE light) nella normalizzazione serie"
```

---

## Task 2: Lettura storico — `previousSetInSession` e `previousWeekSet`

**Files:**
- Modify: `session.js` (aggiunte in fondo; import già presenti: `getEntry`, `normalizeEntry`, `normalizeSupersetEntry`)
- Test: `tests/session.test.js`

- [ ] **Step 1: Scrivi i test falliti**

In `tests/session.test.js`, estendi la riga di import da `../session.js` per includere `previousSetInSession, previousWeekSet` e aggiungi:

```javascript
test("previousSetInSession: ultima serie done con indice < index", () => {
  const entry = { sets: [
    { reps: "8", kg: "70", done: true },
    { reps: "8", kg: "72.5", done: true },
    { reps: "", kg: "", done: false },
  ] };
  assert.deepEqual(previousSetInSession(entry, 2), { reps: "8", kg: "72.5" });
  assert.deepEqual(previousSetInSession(entry, 1), { reps: "8", kg: "70" });
});

test("previousSetInSession: salta le serie non done", () => {
  const entry = { sets: [
    { reps: "8", kg: "70", done: true },
    { reps: "5", kg: "0", done: false },
  ] };
  assert.deepEqual(previousSetInSession(entry, 2), { reps: "8", kg: "70" });
});

test("previousSetInSession: nessuna serie done precedente -> null", () => {
  assert.equal(previousSetInSession({ sets: [{ reps: "8", kg: "70", done: false }] }, 1), null);
  assert.equal(previousSetInSession({ sets: [] }, 0), null);
});

test("previousSetInSession: traccia superset", () => {
  const entry = { a: { sets: [{ reps: "12", kg: "20", done: true }] },
                  b: { sets: [{ reps: "15", kg: "10", done: true }] } };
  assert.deepEqual(previousSetInSession(entry, 1, "b"), { reps: "15", kg: "10" });
});

test("previousWeekSet: stessa serie della settimana precedente con dato", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", 0, { sets: [
    { reps: "8", kg: "67.5", done: true }, { reps: "8", kg: "70", done: true },
  ] });
  const r = previousWeekSet(d, "A", 0, "2026-W22", 1);
  assert.deepEqual({ reps: r.reps, kg: r.kg, week: r.week }, { reps: "8", kg: "70", week: "2026-W21" });
});

test("previousWeekSet: fallback all'ultima serie se l'indice non esiste", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "67.5", done: true }] });
  const r = previousWeekSet(d, "A", 0, "2026-W22", 3);
  assert.equal(r.kg, "67.5");
});

test("previousWeekSet: salta settimane vuote e senza storico -> null", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", 0, { sets: [{ reps: "8", kg: "65", done: true }] });
  d = setEntry(d, "2026-W21", "A", 0, { sets: [] });
  assert.equal(previousWeekSet(d, "A", 0, "2026-W22", 0).kg, "65");
  assert.equal(previousWeekSet(d, "A", 0, "2026-W20", 0), null);
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `node --test tests/session.test.js`
Expected: FAIL — `previousSetInSession`/`previousWeekSet` non esistono (ReferenceError/import undefined).

- [ ] **Step 3: Implementa le funzioni**

In fondo a `session.js` aggiungi:

```javascript
// Traccia (normale o superset-a/b) di un'entry, normalizzata.
function entryTrack(entry, track) {
  if (track === "a" || track === "b") return normalizeSupersetEntry(entry)[track];
  return normalizeEntry(entry);
}

// {reps,kg} dell'ultima serie done con indice < `index` nella sessione corrente; null se assente.
export function previousSetInSession(entry, index, track = null) {
  const t = entryTrack(entry, track);
  const start = Math.min(index, t.sets.length) - 1;
  for (let i = start; i >= 0; i--) {
    if (t.sets[i].done) return { reps: t.sets[i].reps, kg: t.sets[i].kg };
  }
  return null;
}

// {reps,kg,week} dalla settimana precedente con dato per quell'esercizio; null se assente.
// Ritorna il set a `setIndex`, o l'ultimo disponibile di quella settimana.
export function previousWeekSet(data, day, idx, weekKey, setIndex, track = null) {
  const keys = Object.keys(data?.weeks ?? {})
    .filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k) && k < weekKey).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    const t = entryTrack(getEntry(data, keys[i], day, idx), track);
    if (t.sets.length) {
      const s = t.sets[setIndex] ?? t.sets[t.sets.length - 1];
      return { reps: s.reps, kg: s.kg, week: keys[i] };
    }
  }
  return null;
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `node --test tests/session.test.js`
Expected: PASS, 0 fail. Esegui `node --test` per l'intera suite.

- [ ] **Step 5: Commit**

```bash
git add session.js tests/session.test.js
git commit -m "feat(session): previousSetInSession e previousWeekSet per le scorciatoie ripeti"
```

---

## Task 3: Aggregazioni — `sessionVolume` e `exerciseTrend`

**Files:**
- Modify: `session.js` (aggiunte in fondo)
- Test: `tests/session.test.js`

- [ ] **Step 1: Scrivi i test falliti**

In `tests/session.test.js`, estendi l'import da `../session.js` con `sessionVolume, exerciseTrend` e aggiungi:

```javascript
const PLAN_AB = { exercises: [
  { name: "Panca", setsReps: "4 × 8" },
  { name: "Croci", setsReps: "3 × 12", superset: true },
] };

test("sessionVolume: somma reps*kg delle serie done (normale + superset)", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", 0, { sets: [
    { reps: "8", kg: "70", done: true },   // 560
    { reps: "8", kg: "70", done: false },  // esclusa (non done)
  ] });
  d = setEntry(d, "2026-W22", "A", 1, {
    a: { sets: [{ reps: "12", kg: "20", done: true }] },  // 240
    b: { sets: [{ reps: "15", kg: "10", done: true }] },  // 150
  });
  assert.equal(sessionVolume(d, "2026-W22", "A", PLAN_AB), 560 + 240 + 150);
});

test("sessionVolume: 0 senza serie done e ignora valori non numerici", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", 0, { sets: [{ reps: "max", kg: "", done: true }] });
  assert.equal(sessionVolume(d, "2026-W22", "A", PLAN_AB), 0);
});

test("exerciseTrend: top-set kg delle ultime n settimane, ordine crescente", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", 0, { sets: [{ reps: "8", kg: "65", done: true }, { reps: "8", kg: "67.5", done: true }] });
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "70", done: true }] });
  d = setEntry(d, "2026-W22", "A", 0, { sets: [{ reps: "8", kg: "72.5", done: true }] });
  assert.deepEqual(exerciseTrend(d, "A", 0, "2026-W22", 3), [
    { week: "2026-W20", kg: 67.5 }, { week: "2026-W21", kg: 70 }, { week: "2026-W22", kg: 72.5 },
  ]);
});

test("exerciseTrend: salta settimane senza kg e limita a n", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W19", "A", 0, { sets: [{ reps: "8", kg: "60", done: true }] });
  d = setEntry(d, "2026-W20", "A", 0, { sets: [{ reps: "8", kg: "", done: true }] });
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "70", done: true }] });
  d = setEntry(d, "2026-W22", "A", 0, { sets: [{ reps: "8", kg: "72.5", done: true }] });
  assert.deepEqual(exerciseTrend(d, "A", 0, "2026-W22", 2), [
    { week: "2026-W21", kg: 70 }, { week: "2026-W22", kg: 72.5 },
  ]);
});

test("exerciseTrend: nessuno storico -> array vuoto", () => {
  assert.deepEqual(exerciseTrend(emptyData(), "A", 0, "2026-W22", 3), []);
});
```

- [ ] **Step 2: Esegui i test e verifica che falliscano**

Run: `node --test tests/session.test.js`
Expected: FAIL — `sessionVolume`/`exerciseTrend` non definite.

- [ ] **Step 3: Implementa le funzioni**

In fondo a `session.js` aggiungi:

```javascript
// Parsing numerico tollerante alla virgola decimale; null se non numerico.
function parseNum(x) {
  const v = parseFloat(String(x).replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

function trackVolume(track) {
  let v = 0;
  for (const s of track.sets) {
    if (!s.done) continue;
    const r = parseNum(s.reps), k = parseNum(s.kg);
    if (r !== null && k !== null) v += r * k;
  }
  return v;
}

// Volume totale (Σ reps*kg sulle serie done) del giorno; somma entrambe le tracce superset.
export function sessionVolume(data, weekKey, day, dayPlan) {
  const exs = dayPlan?.exercises ?? [];
  let total = 0;
  for (let i = 0; i < exs.length; i++) {
    const v = getEntry(data, weekKey, day, i);
    if (exs[i]?.superset) {
      const e = normalizeSupersetEntry(v);
      total += trackVolume(e.a) + trackVolume(e.b);
    } else {
      total += trackVolume(normalizeEntry(v));
    }
  }
  return total;
}

// Top-set (kg max) di una settimana per quell'esercizio; null se nessun kg numerico.
function weekTopKg(data, weekKey, day, idx, superset) {
  const v = getEntry(data, weekKey, day, idx);
  const tracks = superset
    ? [normalizeSupersetEntry(v).a, normalizeSupersetEntry(v).b]
    : [normalizeEntry(v)];
  let best = null;
  for (const t of tracks) {
    for (const s of t.sets) {
      const k = parseNum(s.kg);
      if (k !== null && (best === null || k > best)) best = k;
    }
  }
  return best;
}

// Ultime n settimane <= weekKey con dato: [{week, kg}] in ordine crescente. Salta le vuote.
export function exerciseTrend(data, day, idx, weekKey, n = 3, superset = false) {
  const keys = Object.keys(data?.weeks ?? {})
    .filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k) && k <= weekKey).sort();
  const out = [];
  for (let i = keys.length - 1; i >= 0 && out.length < n; i--) {
    const kg = weekTopKg(data, keys[i], day, idx, superset);
    if (kg !== null) out.unshift({ week: keys[i], kg });
  }
  return out;
}
```

- [ ] **Step 4: Esegui i test e verifica che passino**

Run: `node --test tests/session.test.js`
Expected: PASS, 0 fail. Poi `node --test` sull'intera suite.

- [ ] **Step 5: Commit**

```bash
git add session.js tests/session.test.js
git commit -m "feat(session): sessionVolume ed exerciseTrend (volume sessione + trend 3 settimane)"
```

---

## Task 4: UI Feature A — Tag "com'è andata" (RPE light)

Le task di UI non hanno unit test (convenzione progetto: il DOM si verifica in browser). Ogni task fornisce il codice completo, poi una verifica manuale.

**Files:**
- Modify: `app.js` (`setRow`, `renderFocusNormal`, `trackBlock`)
- Modify: `style.css`

- [ ] **Step 1: Aggiungi gli stili dei tag RPE**

In fondo a `style.css` aggiungi:

```css
/* Tag "com'è andata" (RPE light) */
.rpebar{display:flex;gap:8px;margin:12px 0 2px;}
.rpebar .rb{flex:1;background:transparent;border:1px solid var(--line);border-radius:11px;padding:10px 0;
  font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:700;color:var(--dim);cursor:pointer;min-height:44px;}
.rpebar .rb.easy.on{color:#7FC8FF;border-color:#244a63;background:rgba(127,200,255,.07);}
.rpebar .rb.ok.on{color:var(--acc);border-color:#1e4a3b;background:rgba(63,224,168,.07);}
.rpebar .rb.hard.on{color:#FFB37F;border-color:#633a24;background:rgba(255,179,127,.07);}
.rpe{font-family:"JetBrains Mono",monospace;font-size:9px;letter-spacing:.07em;text-transform:uppercase;
  border-radius:5px;padding:2px 7px;margin-left:auto;cursor:pointer;}
.rpe.easy{color:#7FC8FF;border:1px solid #244a63;}
.rpe.ok{color:var(--acc);border:1px solid #1e4a3b;}
.rpe.hard{color:#FFB37F;border:1px solid #633a24;}
```

- [ ] **Step 2: Aggiungi l'helper `buildRpeBar` in `app.js`**

Subito **prima** di `function buildEditBlock` (app.js:236) aggiungi:

```javascript
const RPE_OPTS = [["easy", "facile"], ["ok", "giusta"], ["hard", "dura"]];

// Barra a 3 pulsanti per il "feel" della serie corrente. `current` = feel attuale ("" se nessuno).
// onPick(feel) riceve "" quando si ri-tocca il tag già attivo (toggle off).
function buildRpeBar(current, onPick) {
  const bar = document.createElement("div");
  bar.className = "rpebar";
  for (const [val, label] of RPE_OPTS) {
    const b = document.createElement("button");
    b.className = "rb " + val + (current === val ? " on" : "");
    b.textContent = label;
    b.addEventListener("click", () => onPick(current === val ? "" : val));
    bar.appendChild(b);
  }
  return bar;
}
```

- [ ] **Step 3: Mostra il chip `feel` sulle serie già fatte (in `setRow`)**

In `setRow`, estendi la firma per accettare un callback `onFeel` e renderizza il chip. Sostituisci la riga 348 `function setRow(i, set, prev, isCurrent, onRemove, onEditSet) {` con:

```javascript
function setRow(i, set, prev, isCurrent, onRemove, onEditSet, onFeel) {
```

Poi, **prima** del blocco `if (onRemove) {` (app.js:389), inserisci:

```javascript
  if (set.done && set.feel && onFeel) {
    const fl = document.createElement("span");
    fl.className = "rpe " + set.feel;
    fl.textContent = set.feel === "easy" ? "facile" : set.feel === "hard" ? "dura" : "giusta";
    fl.title = "Tocca per cambiare";
    fl.addEventListener("click", (e) => { e.stopPropagation(); onFeel(); });
    row.appendChild(fl);
  }
```

E aggiorna la `marginLeft:"auto"` esistente: quando c'è un chip feel a destra, il check/tag non deve più spingere. Lascia invariata la logica del check (app.js:381-388) — il chip feel si accoda dopo e va bene visivamente perché `.rpe` ha `margin-left:auto` solo se è il primo elemento spinto; se confligge, rimuovi `chk.style.marginLeft = "auto"` quando `set.feel` è presente. Per semplicità e robustezza, sostituisci la riga `chk.style.marginLeft = "auto";` (app.js:383) con:

```javascript
    if (!set.feel) chk.style.marginLeft = "auto";
```

- [ ] **Step 4: Wira la barra RPE e il chip nel percorso normale (`renderFocusNormal`)**

In `renderFocusNormal`, alla chiamata `setRow(...)` (app.js:440-446) aggiungi il 7° argomento `onFeel` che cicla il feel della serie `i`. Sostituisci l'intera chiamata `setsBox.appendChild(setRow(...))` con:

```javascript
    setsBox.appendChild(setRow(i, set, prev[i] || null, isCurrent, canRemove ? () => {
      data = setEntry(data, currentWeek, currentDay, focusIndex, withoutSet(v, i), new Date().toISOString());
      persist(); render();
    } : null, (patch) => {
      data = setEntry(data, currentWeek, currentDay, focusIndex, withSet(v, i, { ...patch, done: true }), new Date().toISOString());
      persist(); render();
    }, set.done ? () => {
      const order = ["", "easy", "ok", "hard"];
      const next = order[(order.indexOf(set.feel) + 1) % order.length];
      data = setEntry(data, currentWeek, currentDay, focusIndex, withSet(v, i, { feel: next }), new Date().toISOString());
      persist(); render();
    } : null));
```

Poi, subito **dopo** `card.appendChild(buildEditBlock(...))` (app.js:450), inserisci la barra RPE per la serie corrente:

```javascript
  card.appendChild(buildRpeBar(entry.sets[curIdx]?.feel ?? "", (feel) => {
    data = setEntry(data, currentWeek, currentDay, focusIndex,
      withSet(v, curIdx, { ...draft, feel }), new Date().toISOString());
    persist(); render();
  }));
```

- [ ] **Step 5: Wira RPE nel percorso superset (`trackBlock`)**

`trackBlock(trackKey, trackName, trackEntry, tgtTrack, prevSets, state)` (app.js:488-519) appende tutto a `wrap` e ritorna `{ wrap, curIdx }`. `state` è `draftA`/`draftB`. `withSupersetSet` è già importata in app.js (usata a riga 510).

(a) Nella chiamata `setRow(...)` dentro `trackBlock` (app.js:509-513), aggiungi il 7° argomento `onFeel` per le serie chiuse. Sostituiscila con:

```javascript
    setsBox.appendChild(setRow(i, set, prevSets[i] || null, i === curIdx, null, (patch) => {
      const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, focusIndex), trackKey, i, { ...patch, done: true });
      data = setEntry(data, currentWeek, currentDay, focusIndex, nv, new Date().toISOString());
      persist(); render();
    }, set.done ? () => {
      const order = ["", "easy", "ok", "hard"];
      const next = order[(order.indexOf(set.feel) + 1) % order.length];
      const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, focusIndex), trackKey, i, { feel: next });
      data = setEntry(data, currentWeek, currentDay, focusIndex, nv, new Date().toISOString());
      persist(); render();
    } : null));
```

(b) Subito **dopo** `wrap.appendChild(buildEditBlock(...))` (app.js:517) e **prima** di `return { wrap, curIdx };`, aggiungi la barra RPE della traccia:

```javascript
  wrap.appendChild(buildRpeBar(trackEntry.sets[curIdx]?.feel ?? "", (feel) => {
    const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, focusIndex), trackKey, curIdx, { ...state, feel });
    data = setEntry(data, currentWeek, currentDay, focusIndex, nv, new Date().toISOString());
    persist(); render();
  }));
```

- [ ] **Step 6: Verifica in browser**

Run (in `C:\Users\TomasCoro\gym-schedule`): `python -m http.server 8036`
Apri `http://localhost:8036`. Verifica:
- Sotto lo stepper della serie corrente compaiono i 3 pulsanti `facile / giusta / dura`; un tap evidenzia, ri-tap deseleziona.
- Completando la serie (CTA), il feel scelto resta e appare come chip colorato sulla riga della serie chiusa.
- Tap sul chip di una serie chiusa cicla facile→giusta→dura→(nessuno).
- Ricaricando la pagina il feel persiste (è in `localStorage`).
- Su un esercizio superset, ogni traccia (A/B) ha la sua barra RPE.
Console del browser: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add app.js style.css
git commit -m "feat(ui): tag com'e andata (RPE light) per serie, normale e superset"
```

---

## Task 5: UI Feature B — Scorciatoie "ripeti serie precedente"

**Files:**
- Modify: `app.js` (helper `buildRepeatChips`, wiring in `renderFocusNormal` e `trackBlock`; import da `./session.js`)
- Modify: `style.css`

- [ ] **Step 1: Aggiorna gli import in `app.js`**

Verifica la riga di import da `./session.js` in cima a `app.js`. Aggiungi `previousSetInSession, previousWeekSet` se mancanti.

- [ ] **Step 2: Aggiungi gli stili delle chip**

In fondo a `style.css` aggiungi:

```css
/* Scorciatoie "ripeti serie precedente" */
.repeats{display:flex;gap:8px;margin:12px 0 2px;}
.repeats .rchip{flex:1;background:var(--surf2);border:1px solid var(--line);border-radius:11px;
  padding:8px 6px;text-align:center;cursor:pointer;min-height:44px;}
.repeats .rchip .rl{font-family:"JetBrains Mono",monospace;font-size:9px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--dim);}
.repeats .rchip .rv{font-family:"JetBrains Mono",monospace;font-size:14px;font-weight:700;color:var(--ink);margin-top:3px;}
.repeats .rchip.scorsa .rv{color:var(--acc);}
```

- [ ] **Step 3: Aggiungi l'helper `buildRepeatChips`**

Subito **prima** di `function buildEditBlock` (app.js:236) aggiungi:

```javascript
// Fino a due chip: "↑ serie sopra" (stessa sessione) e "↶ scorsa Wxx" (settimana precedente).
// inSession/prevWeek = {reps,kg[,week]} o null. onPick({reps,kg}) precompila lo stepper.
function buildRepeatChips(inSession, prevWeek, onPick) {
  if (!inSession && !prevWeek) return null;
  const row = document.createElement("div");
  row.className = "repeats";
  const make = (cls, label, val) => {
    const c = document.createElement("div");
    c.className = "rchip" + cls;
    const l = document.createElement("div"); l.className = "rl"; l.textContent = label;
    const v = document.createElement("div"); v.className = "rv";
    v.textContent = `${val.reps || "—"} × ${val.kg || "—"}`;
    c.append(l, v);
    c.addEventListener("click", () => onPick({ reps: val.reps, kg: val.kg }));
    row.appendChild(c);
  };
  if (inSession) make("", "↑ serie sopra", inSession);
  if (prevWeek) {
    const wk = prevWeek.week ? prevWeek.week.split("-").pop() : "scorsa";
    make(" scorsa", `↶ ${wk}`, prevWeek);
  }
  return row;
}
```

- [ ] **Step 4: Wira le chip nel percorso normale (`renderFocusNormal`)**

In `renderFocusNormal`, subito **dopo** la barra RPE aggiunta nel Task 4 (cioè dopo `card.appendChild(buildRpeBar(...))`), inserisci:

```javascript
  const repInSession = previousSetInSession(v, curIdx);
  const repPrevWeek = previousWeekSet(data, currentDay, focusIndex, currentWeek, curIdx);
  const repChips = buildRepeatChips(repInSession, repPrevWeek, ({ reps, kg }) => {
    draft.reps = reps; draft.kg = kg;
    render();
  });
  if (repChips) card.appendChild(repChips);
```

Nota: impostare `draft` e richiamare `render()` ridisegna la card con i nuovi valori già nello stepper (lo stesso percorso della precompilazione esistente).

- [ ] **Step 5: Wira le chip nel percorso superset (`trackBlock`)**

Dentro `trackBlock`, subito **dopo** la barra RPE aggiunta nel Task 4 (b) e **prima** di `return { wrap, curIdx };`, aggiungi le chip. `trackEntry` è già la traccia normalizzata, quindi `previousSetInSession` si chiama su di essa senza `track`; `previousWeekSet` invece legge da `data` e richiede `trackKey`:

```javascript
  const inSess = previousSetInSession(trackEntry, curIdx);
  const prevWk = previousWeekSet(data, currentDay, focusIndex, currentWeek, curIdx, trackKey);
  const chips = buildRepeatChips(inSess, prevWk, ({ reps, kg }) => { state.reps = reps; state.kg = kg; render(); });
  if (chips) wrap.appendChild(chips);
```

- [ ] **Step 6: Verifica in browser**

`python -m http.server 8036` → `http://localhost:8036`. Verifica:
- Alla prima serie senza storico né serie sopra: nessuna chip.
- Dopo aver chiuso la serie 1, sulla serie 2 compare `↑ serie sopra` con i valori della serie 1; un tap li mette nello stepper.
- Con dati di una settimana precedente, compare `↶ Wxx`; un tap precompila reps+kg.
- Le chip precompilano e basta (non chiudono la serie); il +/− continua ad aggiustare.
- Console: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add app.js style.css
git commit -m "feat(ui): scorciatoie ripeti serie (sessione corrente + settimana scorsa)"
```

---

## Task 6: UI Feature C — Volume di sessione + mini-trend

**Files:**
- Modify: `app.js` (helper `buildVolumeRow`, `buildTrendRow`; import da `./session.js`; wiring nei due percorsi)
- Modify: `style.css`

- [ ] **Step 1: Aggiorna gli import in `app.js`**

Aggiungi `sessionVolume, exerciseTrend` alla riga di import da `./session.js`.

- [ ] **Step 2: Aggiungi gli stili**

In fondo a `style.css` aggiungi:

```css
/* Volume di sessione + mini-trend */
.volcard{display:flex;justify-content:space-between;align-items:center;background:var(--surf2);
  border:1px solid var(--line);border-radius:11px;padding:10px 13px;margin-top:14px;}
.volcard .vl{font-family:"JetBrains Mono",monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--dim);}
.volcard .vv{font-family:"JetBrains Mono",monospace;font-size:14px;font-weight:700;color:var(--ink);}
.volcard .vv .acc{color:var(--acc);margin-left:6px;}
.volcard .vv .neg{color:#FFB37F;margin-left:6px;}
.trend{display:flex;gap:12px;flex-wrap:wrap;font-family:"JetBrains Mono",monospace;font-size:11px;
  color:var(--dim);margin:8px 0 2px;}
.trend .tw{color:var(--faint);}
.trend .tk{color:var(--ink);font-weight:700;margin-left:4px;}
.trend .cur .tk{color:var(--acc);}
```

- [ ] **Step 3: Aggiungi gli helper `buildVolumeRow` e `buildTrendRow`**

Subito **prima** di `function buildEditBlock` (app.js:236) aggiungi:

```javascript
function fmtKg(n) { return Math.round(n).toLocaleString("it-IT").replace(/ /g, " "); }

// Riga volume di sessione con delta % vs stessa giornata della settimana precedente.
function buildVolumeRow(vol, prevVol) {
  const row = document.createElement("div");
  row.className = "volcard";
  const l = document.createElement("span"); l.className = "vl"; l.textContent = "Volume sessione";
  const v = document.createElement("span"); v.className = "vv";
  v.appendChild(document.createTextNode(`${fmtKg(vol)} kg`));
  if (prevVol > 0) {
    const pct = Math.round(((vol - prevVol) / prevVol) * 100);
    const d = document.createElement("span");
    d.className = pct >= 0 ? "acc" : "neg";
    d.textContent = `${pct >= 0 ? "▲ +" : "▼ "}${pct}%`;
    v.appendChild(d);
  }
  row.append(l, v);
  return row;
}

// Riga mini-trend: "W20 67.5 · W21 70 · W22 72.5" (ultima evidenziata). null se < 1 dato.
function buildTrendRow(trend, weekKey) {
  if (!trend.length) return null;
  const row = document.createElement("div");
  row.className = "trend";
  for (const { week, kg } of trend) {
    const cell = document.createElement("span");
    if (week === weekKey) cell.className = "cur";
    const w = document.createElement("span"); w.className = "tw"; w.textContent = week.split("-").pop();
    const k = document.createElement("span"); k.className = "tk"; k.textContent = String(kg);
    cell.append(w, k);
    row.appendChild(cell);
  }
  return row;
}
```

- [ ] **Step 4: Wira trend e volume nel percorso normale (`renderFocusNormal`)**

In `renderFocusNormal`, subito **dopo** `head` (`card.appendChild(head)`, app.js:431), inserisci la riga trend sotto nome/target:

```javascript
  const trendRow = buildTrendRow(exerciseTrend(data, currentDay, focusIndex, currentWeek, 3), currentWeek);
  if (trendRow) card.appendChild(trendRow);
```

Poi, subito **dopo** `card.appendChild(buildNoteField(false))` (app.js:479), inserisci la riga volume in fondo alla card:

```javascript
  const vol = sessionVolume(data, currentWeek, currentDay, dayPlan());
  const prevVol = sessionVolume(data, prevWeekKey(), currentDay, dayPlan());
  card.appendChild(buildVolumeRow(vol, prevVol));
```

Nota: `prevWeekKey()` esiste già in app.js (riga 128) e `dayPlan()` è usata altrove (es. app.js:475).

- [ ] **Step 5: Wira il trend nel percorso superset (`renderFocusSuperset`)**

In `renderFocusSuperset` (app.js:521-563), subito **dopo** `card.appendChild(head)` (app.js:542), aggiungi la riga trend (il superset è per-esercizio, quindi un solo trend con `superset = true`):

```javascript
  const trendRow = buildTrendRow(exerciseTrend(data, currentDay, focusIndex, currentWeek, 3, true), currentWeek);
  if (trendRow) card.appendChild(trendRow);
```

Il volume di sessione è globale (somma tutti gli esercizi del giorno), quindi va aggiunto una sola volta anche qui. Subito **dopo** `card.appendChild(buildNoteField(true))` (app.js:560), inserisci:

```javascript
  const vol = sessionVolume(data, currentWeek, currentDay, dayPlan());
  const prevVol = sessionVolume(data, prevWeekKey(), currentDay, dayPlan());
  card.appendChild(buildVolumeRow(vol, prevVol));
```

- [ ] **Step 6: Verifica in browser**

`python -m http.server 8036` → `http://localhost:8036`. Verifica:
- In cima alla focus card, sotto nome/target, la riga trend mostra fino a 3 settimane `Wxx kg` con la corrente in verde (assente se non c'è storico con kg).
- In fondo alla card, "Volume sessione" mostra il totale running in kg; cresce a ogni serie chiusa.
- Con dati nella stessa giornata della settimana precedente, appare il delta % (verde se ≥ 0, ambra se < 0).
- Numeri grandi col separatore migliaia (es. `3 480 kg`).
- Funziona sia su esercizio normale sia superset; volume identico nei due (è globale di giornata).
- Console: nessun errore.

- [ ] **Step 7: Commit**

```bash
git add app.js style.css
git commit -m "feat(ui): volume di sessione + mini-trend 3 settimane per esercizio"
```

---

## Verifica finale

- [ ] **Suite completa verde**

Run: `node --test`
Expected: tutti i test passano (76 esistenti + i nuovi di Task 1-3), 0 fail.

- [ ] **Smoke browser end-to-end**

`python -m http.server 8036` → percorri una sessione: chiudi qualche serie con feel diversi, usa le chip ripeti, osserva volume e trend aggiornarsi e persistere dopo reload. Nessun errore in console.

- [ ] **Push**

```bash
git push
```

- [ ] **Aggiorna la memory di progetto**

Aggiorna `gym-schedule-phases.md`: Fase 4 completata (RPE feel, ripeti serie, volume+trend); aggiorna il conteggio test; resta in backlog la distinzione warmup vs working set.
