# "Ultima volta" nel sottotitolo della lista — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrare nel sottotitolo di ogni esercizio in lista la serie working più pesante dell'ultima sessione registrata (`ult. 8×70`; superset `ult. A20 B15`), display-only.

**Architecture:** Un nuovo helper puro `lastWorkingSet` in `session.js` (testato con `node --test`, stile identico a `previousWeekSet`/`topSetSeries`) calcola la serie più pesante dell'ultima settimana precedente con dato. `renderList()` in `app.js` lo usa per appendere uno `<span class="ult">` al `.sub`. CSS dedicato + bump cache service worker.

**Tech Stack:** Vanilla JS (ES modules), `node:test`, service worker cache, CSS custom properties. No build step.

Spec: `docs/superpowers/specs/2026-05-27-ultima-volta-lista-design.md`.

---

### Task 1: Helper `lastWorkingSet` in session.js

**Files:**
- Modify: `session.js` (aggiungere export dopo `previousWeekSet`, ~riga 172)
- Test: `tests/session.test.js` (aggiungere import + test in coda al blocco `previousWeekSet`)

- [ ] **Step 1: Aggiungere `lastWorkingSet` all'import del test**

In `tests/session.test.js:5`, aggiungere `lastWorkingSet` alla lista importata da `../session.js`:

```js
import { bestKg, progressionDelta, withNote, previousNote, previousSetInSession, previousWeekSet, lastWorkingSet, sessionVolume, exerciseTrend, topSetSeries, chartGeometry } from "../session.js";
```

- [ ] **Step 2: Scrivere i test che falliscono**

Aggiungere in fondo a `tests/session.test.js` (dopo il test `"failed escluso da previousWeekSet"`, ~riga 460):

```js
test("lastWorkingSet: serie più pesante dell'ultima settimana precedente", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", 0, { sets: [
    { reps: "8", kg: "67.5", done: true },
    { reps: "6", kg: "72.5", done: true },
    { reps: "8", kg: "70", done: true },
  ] });
  assert.deepEqual(lastWorkingSet(d, "A", 0, "2026-W22"), { reps: "6", kg: "72.5", week: "2026-W21" });
});

test("lastWorkingSet: esclude warmup e serie failed dal max", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", 0, { sets: [
    { reps: "10", kg: "90", warmup: true },        // warmup escluso
    { reps: "1", kg: "100", done: true, failed: true }, // failed escluso
    { reps: "8", kg: "70", done: true },
  ] });
  assert.deepEqual(lastWorkingSet(d, "A", 0, "2026-W22"), { reps: "8", kg: "70", week: "2026-W21" });
});

test("lastWorkingSet: salta settimane senza kg numerico e quelle >= weekKey", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", 0, { sets: [{ reps: "8", kg: "65", done: true }] });
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "max", kg: "", done: true }] }); // nessun kg numerico
  d = setEntry(d, "2026-W22", "A", 0, { sets: [{ reps: "8", kg: "80", done: true }] }); // == weekKey, escluso
  assert.deepEqual(lastWorkingSet(d, "A", 0, "2026-W22"), { reps: "8", kg: "65", week: "2026-W20" });
});

test("lastWorkingSet: nessuno storico utile -> null", () => {
  assert.equal(lastWorkingSet(emptyData(), "A", 0, "2026-W22"), null);
});

test("lastWorkingSet: traccia 'a'/'b' di un superset", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", "ss", {
    a: { sets: [{ reps: "12", kg: "20", done: true }, { reps: "10", kg: "22.5", done: true }] },
    b: { sets: [{ reps: "15", kg: "10", done: true }] },
  });
  assert.deepEqual(lastWorkingSet(d, "A", "ss", "2026-W22", "a"), { reps: "10", kg: "22.5", week: "2026-W21" });
  assert.deepEqual(lastWorkingSet(d, "A", "ss", "2026-W22", "b"), { reps: "15", kg: "10", week: "2026-W21" });
});
```

- [ ] **Step 3: Eseguire i test → devono fallire**

Run: `Set-Location C:\Users\TomasCoro\gym-schedule; node --test tests/session.test.js`
Expected: FAIL — `lastWorkingSet is not a function` (o `not exported`).

- [ ] **Step 4: Implementare `lastWorkingSet`**

In `session.js`, subito dopo la fine di `previousWeekSet` (dopo la sua `}` a ~riga 172), aggiungere:

```js
// {reps,kg,week} della serie working PIÙ PESANTE (kg numerico max) dell'ultima
// settimana precedente (< weekKey) che ne ha una; null se nessuno storico utile.
// Scandisce indietro: salta le settimane senza alcun kg numerico working.
// track: null = normale, "a"/"b" = traccia del superset.
export function lastWorkingSet(data, day, exId, weekKey, track = null) {
  const keys = Object.keys(data?.weeks ?? {})
    .filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k) && k < weekKey).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    const t = entryTrack(getEntry(data, keys[i], day, exId), track);
    let best = null;
    for (const s of t.sets) {
      if (s.warmup || s.failed) continue;
      const k = parseNum(s.kg);
      if (k !== null && (best === null || k > parseNum(best.kg))) best = { reps: s.reps, kg: s.kg };
    }
    if (best) return { ...best, week: keys[i] };
  }
  return null;
}
```

Nota: `parseNum` è dichiarata più in basso nel file (riga ~175) ma è una `function` (hoisted), quindi è già visibile qui. `entryTrack` (~143) e `getEntry` (import in cima) sono in scope.

- [ ] **Step 5: Eseguire i test → devono passare**

Run: `Set-Location C:\Users\TomasCoro\gym-schedule; node --test tests/session.test.js`
Expected: PASS (i 5 nuovi + tutti gli esistenti del file).

- [ ] **Step 6: Commit**

```powershell
Set-Location C:\Users\TomasCoro\gym-schedule
git add session.js tests/session.test.js
git commit -m @'
feat(session): lastWorkingSet — serie più pesante dell'ultima sessione

Helper puro per il display "ultima volta" in lista.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
```

---

### Task 2: Display "ultima volta" in renderList + CSS

**Files:**
- Modify: `app.js` — import di `lastWorkingSet` + `renderList()` (`app.js:1593`, ramo non-completato ~1612-1613)
- Modify: `style.css` — regola `.item .r .sub .ult` (accanto a riga 145)
- Modify: `sw.js:5` — bump `CACHE`

- [ ] **Step 1: Importare `lastWorkingSet` in app.js**

Trovare la riga di import di `session.js` in `app.js` (`grep -n "from \"./session.js\"" app.js`) e aggiungere `lastWorkingSet` alla lista degli import (insieme a `bestKg`, `sessionVolume`, ecc. già importati).

- [ ] **Step 2: Aggiungere l'helper di etichetta e l'append al `.sub` in renderList**

In `renderList()` (`app.js:1593`), sostituire il blocco che costruisce `sub` (righe ~1607-1609):

```js
    const sub = document.createElement("div"); sub.className = "sub";
    sub.textContent = `${ex.setsReps} · rec ${getRest(currentDay, exIdAt(i), ex.restSeconds)}″`;
    mid.append(nm, sub);
```

con:

```js
    const sub = document.createElement("div"); sub.className = "sub";
    sub.textContent = `${ex.setsReps} · rec ${getRest(currentDay, exIdAt(i), ex.restSeconds)}″`;
    if (!isComplete(i)) {
      const exId = exIdAt(i);
      let lastLabel = "";
      if (ex.superset) {
        const a = lastWorkingSet(data, currentDay, exId, currentWeek, "a");
        const b = lastWorkingSet(data, currentDay, exId, currentWeek, "b");
        const parts = [];
        if (a) parts.push(`A${a.kg}`);
        if (b) parts.push(`B${b.kg}`);
        if (parts.length) lastLabel = parts.join(" ");
      } else {
        const last = lastWorkingSet(data, currentDay, exId, currentWeek);
        if (last) lastLabel = `${last.reps}×${last.kg}`;
      }
      if (lastLabel) {
        const u = document.createElement("span"); u.className = "ult";
        u.textContent = ` · ult. ${lastLabel}`;
        sub.appendChild(u);
      }
    }
    mid.append(nm, sub);
```

(`appendChild` su un nodo con `textContent` già impostato aggiunge lo span dopo il nodo di testo: il testo base resta.)

- [ ] **Step 3: Aggiungere la regola CSS**

In `style.css`, subito dopo la riga 145 (`.item .r .sub{...}`), aggiungere:

```css
.item .r .sub .ult{color:var(--acc);}
```

- [ ] **Step 4: Bump cache service worker**

In `sw.js:5`, cambiare:

```js
const CACHE = "gymsched-v28";
```

(da `gymsched-v27`.)

- [ ] **Step 5: Verifica test invariati**

Run: `Set-Location C:\Users\TomasCoro\gym-schedule; npm test`
Expected: PASS, 0 fail (i 152 esistenti + i 5 nuovi di Task 1).

- [ ] **Step 6: Verifica browser (Playwright)**

Avviare un server statico locale sulla cartella `C:\Users\TomasCoro\gym-schedule` e con Playwright:
1. Iniettare storico via `localStorage` chiave `gymsched_pending` (id canonici da `data.json`): per un esercizio normale del giorno corrente, una settimana precedente con serie `{reps:"8",kg:"70",done:true}` e una più leggera; per un superset, tracce `a`/`b`.
2. Caricare la pagina, attendere la lista.
3. Asserire che il `.sub` dell'esercizio normale contenga `ult. 8×70`, e quello del superset contenga `ult. A.. B..`.
4. Asserire che un esercizio **senza** storico NON abbia `.ult`, e che un esercizio completato (tutte le serie done) NON abbia `.ult`.

Expected: tutte le asserzioni verdi. (Se Playwright non è praticabile, verifica manuale sul telefono dopo il deploy: riavviare la PWA per prendere `gymsched-v28`.)

- [ ] **Step 7: Commit + push**

```powershell
Set-Location C:\Users\TomasCoro\gym-schedule
git fetch; git pull --ff-only
git add app.js style.css sw.js
git commit -m @'
feat(list): mostra "ultima volta" nel sottotitolo esercizio

Serie più pesante dell'ultima sessione (normale reps×kg, superset
A/B kg-only). Display-only. Cache v28.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
git push
```

---

## Self-Review

**Spec coverage:**
- Helper `lastWorkingSet` (serie più pesante, forward-only, salta settimane senza kg, esclude warmup/failed, traccia superset, null) → Task 1, Step 2/4 (test + impl). ✓
- Display normale `reps×kg` → Task 2, Step 2. ✓
- Display superset `A{kg} B{kg}`, una sola traccia → Task 2, Step 2. ✓
- Nessuna appendice se completato → Task 2, Step 2 (`if (!isComplete(i))`). ✓
- Nessuna appendice senza storico → Task 2, Step 2 (`if (lastLabel)`). ✓
- "best" invariato → non toccato. ✓
- CSS accent → Task 2, Step 3. ✓
- Bump cache → Task 2, Step 4. ✓

**Placeholder scan:** nessun TBD/TODO; tutti gli step hanno codice o comando esatto. ✓

**Type consistency:** `lastWorkingSet` ritorna `{reps,kg,week}` (stringhe) in Task 1; Task 2 usa `.kg`, `.reps` su quel ritorno e accetta `null`. Firma `(data, day, exId, weekKey, track)` coerente tra spec/Task 1/Task 2. ✓
