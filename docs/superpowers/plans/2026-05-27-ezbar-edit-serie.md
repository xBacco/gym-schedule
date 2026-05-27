# EZ bar + editing inline serie finita — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere un bilanciere EZ (10 kg) per-esercizio al calcolo dischi, e rendere reps/kg di una serie finita modificabili inline sulla riga, spostando il popup feel/non-riuscita/elimina dietro un'icona.

**Architecture:** Helper puro `exerciseBar()` in `store.js` (testato con `node --test`). Wiring DOM in `app.js`: la linea dischi vive in `buildEditBlock` (condivisa da path normale e superset) e riceve il bilanciere per-esercizio; `setRow` rende reps/kg editabili inline per le serie `done`, con commit che riusa gli helper immutabili esistenti (`withSet`/`withSupersetSet` + `setEntry` + `persist`).

**Tech Stack:** Vanilla JS ES modules, `node --test` (gate logica pura), Playwright per verifica DOM in browser (PWA offline, dati su GitHub). Tema Amber `--acc:#E8A93C`.

---

## Vincoli operativi (validi per ogni task)

- Repo reale: `C:\Users\TomasCoro\gym-schedule` (NON la cwd). Usare **PowerShell** per git/test — la Bash sandbox qui è inaffidabile (svuota la dir).
- Commit + push diretti su `main` (no PR). Prima del push: `git fetch` + `git pull --ff-only` (il telefono pusha i log).
- Bump `CACHE` in `sw.js` solo quando cambia un file dell'app-shell (`app.js`/`plan.js`/`style.css`/...). Da `gymsched-v14` → `gymsched-v15` una volta sola (ultimo task UI).
- Comando test (da dentro `C:\Users\TomasCoro\gym-schedule`): `node --test`. Singolo file: `node --test tests/store.test.js`.
- Suite attuale: 116 test verdi. Deve restare verde.

---

## Task 1: Helper puro `exerciseBar` in store.js

**Files:**
- Modify: `store.js` (aggiunta export, dopo `platesPerSide` ~riga 119-132)
- Test: `tests/store.test.js` (in fondo al file)

- [ ] **Step 1: Scrivere i test che falliscono**

In fondo a `tests/store.test.js` aggiungere:

```js
import { exerciseBar } from "../store.js";

test("exerciseBar: usa exercise.bar quando è un numero finito > 0", () => {
  assert.equal(exerciseBar({ name: "Curl EZ", bar: 10 }, 20), 10);
  assert.equal(exerciseBar({ bar: 7.5 }, 20), 7.5);
});

test("exerciseBar: ricade sul default quando bar è assente/0/negativo/NaN", () => {
  assert.equal(exerciseBar({ name: "Panca" }, 20), 20);
  assert.equal(exerciseBar({ bar: 0 }, 20), 20);
  assert.equal(exerciseBar({ bar: -5 }, 20), 20);
  assert.equal(exerciseBar({ bar: NaN }, 20), 20);
  assert.equal(exerciseBar({ bar: "10" }, 20), 20); // stringa non accettata
});

test("exerciseBar: exercise null/undefined -> default", () => {
  assert.equal(exerciseBar(null, 20), 20);
  assert.equal(exerciseBar(undefined, 25), 25);
});
```

- [ ] **Step 2: Eseguire i test per verificare che falliscano**

In PowerShell:
```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test tests/store.test.js; Pop-Location
```
Atteso: FAIL — `exerciseBar is not a function` / import non risolto.

- [ ] **Step 3: Implementare l'helper minimale**

In `store.js`, subito dopo `platesPerSide` (~riga 132), aggiungere:

```js
// Peso del bilanciere da usare per un esercizio: exercise.bar se numero finito > 0,
// altrimenti defaultBar. Niente coercizione da stringa (i dati del PLAN sono numeri).
export function exerciseBar(exercise, defaultBar) {
  const b = exercise && exercise.bar;
  return typeof b === "number" && Number.isFinite(b) && b > 0 ? b : defaultBar;
}
```

- [ ] **Step 4: Eseguire i test per verificare che passino**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test tests/store.test.js; Pop-Location
```
Atteso: PASS, 0 fail.

- [ ] **Step 5: Commit**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git add store.js tests/store.test.js
git commit -m "feat: exerciseBar() helper per bilanciere per-esercizio`n`nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
Pop-Location
```

---

## Task 2: Dato `bar: 10` sui due esercizi EZ in plan.js

**Files:**
- Modify: `plan.js:27` (giorno B, indice 5) e `plan.js:41` (giorno C, indice 5)

- [ ] **Step 1: Aggiungere `bar: 10` al giorno B**

In `plan.js`, riga 27, cambiare:

```js
      { name: "Curl EZ + Skullcrusher", setsReps: "3 × 10 / 3 × 10", recText: "75 sec", restSeconds: 75, superset: true },
```
in:
```js
      { name: "Curl EZ + Skullcrusher", setsReps: "3 × 10 / 3 × 10", recText: "75 sec", restSeconds: 75, superset: true, bar: 10 },
```

- [ ] **Step 2: Aggiungere `bar: 10` al giorno C**

In `plan.js`, riga 41, cambiare:

```js
      { name: "Curl EZ + Skullcrusher", setsReps: "3 × 10 / 3 × 10", recText: "75 sec", restSeconds: 75, superset: true },
```
in:
```js
      { name: "Curl EZ + Skullcrusher", setsReps: "3 × 10 / 3 × 10", recText: "75 sec", restSeconds: 75, superset: true, bar: 10 },
```

> Nota: ci sono due righe identiche con questo nome (B idx5 e C idx5). Modificarle entrambe; verificare con `git diff plan.js` che le righe cambiate siano 2.

- [ ] **Step 3: Verifica suite (nessuna regressione)**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test; Pop-Location
```
Atteso: PASS 116+, fail 0. (`plan.js` non è testato direttamente, è dato statico; il run conferma che non si è rotto nulla a livello di import.)

- [ ] **Step 4: Commit**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git add plan.js
git commit -m "feat: bar 10 (EZ) sui due Curl EZ + Skullcrusher`n`nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
Pop-Location
```

---

## Task 3: Wiring del bilanciere per-esercizio in buildEditBlock

`buildEditBlock(label, state, prev)` (`app.js:432`) contiene la linea dischi (`renderPlates`, riga ~454-459) che oggi chiama `getBar()`. È condivisa dal path normale (call site `app.js:823`) e dal path superset (call site `app.js:991`, dentro `trackBlock`). Va parametrizzata.

**Files:**
- Modify: `app.js:432` (firma `buildEditBlock`), `app.js:457-458` (uso del bar), `app.js:823` (call site normale), `app.js:991` (call site superset), `trackBlock` (`app.js:924`) e il suo chiamante `renderFocusSuperset`.

- [ ] **Step 1: Aggiungere il parametro `bar` a buildEditBlock e usarlo in renderPlates**

In `app.js:432` cambiare la firma:
```js
function buildEditBlock(label, state, prev) {
```
in:
```js
function buildEditBlock(label, state, prev, bar = getBar()) {
```

In `renderPlates` (righe 457-458) sostituire `getBar()` con `bar`:
```js
    const { perSide, leftover } = platesPerSide(n, { bar, plates: getPlateSet() });
    if (!perSide.length) { platesLine.textContent = `per lato: — (≤ bilanciere ${bar} kg)`; return; }
```

- [ ] **Step 2: Import di `exerciseBar` in app.js**

In `app.js:4` (riga di import da `store.js`) aggiungere `exerciseBar` alla lista degli import esistenti. Esempio (mantenere gli altri nomi già presenti):
```js
  normalizeEntry, normalizeSupersetEntry, prefillSets, platesPerSide, parsePlateSet, exerciseBar,
```

- [ ] **Step 3: Passare il bilanciere nel call site normale**

In `app.js:823` (dentro `renderFocusNormal(ex, idx, …)`, dove `ex` è in scope):
```js
    const edit = buildEditBlock(`Serie ${curIdx + 1} — carico · step 0.5 kg`, draft, prev[curIdx] || null);
```
diventa:
```js
    const edit = buildEditBlock(`Serie ${curIdx + 1} — carico · step 0.5 kg`, draft, prev[curIdx] || null, exerciseBar(ex, getBar()));
```

- [ ] **Step 4: Propagare il bilanciere a trackBlock (path superset)**

`trackBlock` (`app.js:924`) non ha `ex` in scope. Aggiungere un parametro `bar` in fondo alla firma:
```js
function trackBlock(trackKey, trackName, trackEntry, tgtTrack, prevSets, state, idx) {
```
diventa:
```js
function trackBlock(trackKey, trackName, trackEntry, tgtTrack, prevSets, state, idx, bar) {
```

In `app.js:991`, dentro `trackBlock`, passarlo a `buildEditBlock`:
```js
    const edit = buildEditBlock(`Serie ${curIdx + 1} ${trackKey.toUpperCase()} — step 0.5 kg`, state, prevSets[curIdx] || null);
```
diventa:
```js
    const edit = buildEditBlock(`Serie ${curIdx + 1} ${trackKey.toUpperCase()} — step 0.5 kg`, state, prevSets[curIdx] || null, bar);
```

- [ ] **Step 5: Calcolare e passare `bar` nelle chiamate a trackBlock dentro renderFocusSuperset**

Individuare le chiamate a `trackBlock(...)` dentro `renderFocusSuperset` (cercare `trackBlock(` in `app.js`; sono le tracce A e B). In `renderFocusSuperset`, dove `ex` (l'esercizio superset) è in scope, calcolare una volta:
```js
  const ssBar = exerciseBar(ex, getBar());
```
e aggiungere `ssBar` come ultimo argomento a **entrambe** le chiamate `trackBlock(...)` (traccia A e traccia B).

> Verifica: `grep -n "trackBlock(" app.js` deve mostrare la definizione + 2 chiamate; entrambe le chiamate devono terminare con `, ssBar)`.

- [ ] **Step 6: Verifica suite logica**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test; Pop-Location
```
Atteso: PASS, 0 fail (app.js non è testato in Node; il run conferma che gli altri moduli non si sono rotti).

- [ ] **Step 7: Verifica browser (Playwright, localhost:8780)**

Avviare/usare il server su `http://localhost:8780/index.html`. Con Playwright:
1. Aprire giorno **B**, esercizio "Curl EZ + Skullcrusher". Nel blocco di inserimento serie, portare il kg sopra 10 (es. 15) → la linea dischi deve dire "per lato: ..." calcolato con **bilanciere 10** (a 15 kg con barra 10 → per lato 2.5). A kg ≤ 10 deve dire "— (≤ bilanciere 10 kg)".
2. Aprire un esercizio con bilanciere normale (es. giorno A "Panca piana bilanciere"): a 60 kg → "per lato: 20" (bilanciere 20, invariato).
3. Console: 0 errori.

- [ ] **Step 8: Commit**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git add app.js
git commit -m "feat: linea dischi usa il bilanciere per-esercizio (EZ)`n`nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
Pop-Location
```

---

## Task 4: Editing inline reps/kg sulle serie finite in setRow

`setRow(i, set, prev, isCurrent, onRemove, onOpen)` (`app.js:685`). Oggi per una serie `done` mostra `reps × kg kg` nello span `.v` e un click su `.v` chiama `onOpen()` (popup completo). Nuovo: per `set.done && !set.warmup`, reps/kg diventano due `<input>` con commit su blur/Enter; il popup si apre da un'icona ✎ a fine riga. Il badge feel/✗ resta informativo ma continua ad aprire il popup al tap (coerente con prima).

**Files:**
- Modify: `app.js:685-756` (`setRow`), `app.js:801-808` e `app.js:951-970` (call site che costruiscono `onOpen`; aggiungere `onEdit`).

- [ ] **Step 1: Aggiungere il parametro `onEdit` a setRow e rendere editabile lo span `.v` per le serie done**

Cambiare la firma `app.js:685`:
```js
function setRow(i, set, prev, isCurrent, onRemove, onOpen) {
```
in:
```js
function setRow(i, set, prev, isCurrent, onRemove, onOpen, onEdit) {
```

Sostituire il blocco di rendering di `.v` (righe 689-703) con una versione che usa input inline quando la serie è `done`, `onEdit` è fornito e non è warmup:

```js
  const v = document.createElement("span"); v.className = "v";
  const editable = set.done && !set.warmup && typeof onEdit === "function";
  if (editable) {
    v.classList.add("vedit");
    const ri = document.createElement("input");
    ri.type = "number"; ri.className = "ein reps"; ri.inputMode = "numeric";
    ri.min = "0"; ri.step = "1"; ri.value = set.reps === "" || set.reps == null ? "" : String(set.reps);
    const x = document.createElement("span"); x.className = "x"; x.textContent = " × ";
    const ki = document.createElement("input");
    ki.type = "number"; ki.className = "ein kg"; ki.inputMode = "decimal";
    ki.min = "0"; ki.step = "0.5"; ki.value = set.kg === "" || set.kg == null ? "" : String(set.kg);
    const u = document.createElement("span"); u.className = "u"; u.textContent = " kg";
    v.append(ri, x, ki, u);

    const commit = () => {
      const repsRaw = ri.value.trim();
      const kgRaw = ki.value.trim();
      const repsN = parseInt(repsRaw, 10);
      const kgN = parseFloat(kgRaw.replace(",", "."));
      const repsOk = repsRaw === "" || (Number.isInteger(repsN) && repsN >= 0);
      const kgOk = kgRaw === "" || (Number.isFinite(kgN) && kgN >= 0);
      if (!repsOk || !kgOk) { // ripristina, niente commit
        ri.value = set.reps === "" || set.reps == null ? "" : String(set.reps);
        ki.value = set.kg === "" || set.kg == null ? "" : String(set.kg);
        return;
      }
      const newReps = repsRaw === "" ? "" : String(repsN);
      const newKg = kgRaw === "" ? "" : String(kgN);
      if (newReps === String(set.reps ?? "") && newKg === String(set.kg ?? "")) return; // nessun cambiamento
      onEdit(newReps, newKg);
    };
    ri.addEventListener("blur", commit);
    ki.addEventListener("blur", commit);
    const onEnter = (e) => { if (e.key === "Enter") { e.preventDefault(); e.target.blur(); } };
    ri.addEventListener("keydown", onEnter);
    ki.addEventListener("keydown", onEnter);
  } else if (set.reps || set.kg) {
    v.append(document.createTextNode(set.reps || "—"));
    const x = document.createElement("span"); x.className = "x"; x.textContent = " × ";
    const u = document.createElement("span"); u.className = "u"; u.textContent = " kg";
    v.append(x, document.createTextNode(set.kg || "—"), u);
  } else {
    const x = document.createElement("span"); x.className = "x"; x.textContent = " × ";
    v.append(document.createTextNode("—"), x, document.createTextNode("—"));
  }
  row.append(idx, v);
```

Rimuovere il vecchio listener che apriva il popup cliccando su `.v` (righe 701-703):
```js
  if (set.done && onOpen) {
    v.addEventListener("click", () => onOpen());
  }
```
→ eliminato (il popup ora si apre dall'icona, Step 2).

- [ ] **Step 2: Aggiungere l'icona ✎ che apre il popup, per le serie done**

Subito prima di `return row;` (riga 755), aggiungere:
```js
  if (set.done && !set.warmup && onOpen) {
    const ed = document.createElement("span");
    ed.className = "editset";
    ed.textContent = "✎";
    ed.title = "Modifica serie (feel, non riuscita, elimina)";
    ed.addEventListener("click", (e) => { e.stopPropagation(); onOpen(); });
    row.appendChild(ed);
  }
```

(Il badge feel/✗ alle righe 725-739 mantiene il suo `onOpen` al tap: invariato.)

- [ ] **Step 3: Passare `onEdit` dal call site del path normale**

In `renderFocusNormal`, dopo il blocco `onOpen` (che termina ~riga 817) e prima della chiamata `setsBox.appendChild(setRow(...))` (riga 818), definire `onEdit` per la serie `i`:
```js
    const onEdit = set.done ? (reps, kg) => {
      data = setEntry(data, currentWeek, currentDay, idx, withSet(v, i, { reps, kg }), new Date().toISOString());
      persist(idx); render();
    } : null;
```
e aggiornare la chiamata (riga 818):
```js
    setsBox.appendChild(setRow(i, set, prev[i] || null, isCurrent, onRemove, onOpen));
```
in:
```js
    setsBox.appendChild(setRow(i, set, prev[i] || null, isCurrent, onRemove, onOpen, onEdit));
```

> `withSet(v, i, { reps, kg })` fa merge immutabile: feel/failed/failNote/comments/done restano invariati (stesso helper usato da `onApply` alla riga 806).

- [ ] **Step 4: Passare `onEdit` dal call site del path superset**

In `trackBlock`, dopo il blocco `onOpen`/`onRemove` (~riga 970-974) e prima di `setsBox.appendChild(setRow(...))` (riga 975), definire:
```js
    const onEdit = set.done ? (reps, kg) => {
      const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, idx), trackKey, i, { reps, kg });
      data = setEntry(data, currentWeek, currentDay, idx, nv, new Date().toISOString());
      persist(idx); render();
    } : null;
```
e aggiornare la chiamata (riga 975):
```js
    setsBox.appendChild(setRow(i, set, prevSets[i] || null, i === curIdx, onRemove, onOpen));
```
in:
```js
    setsBox.appendChild(setRow(i, set, prevSets[i] || null, i === curIdx, onRemove, onOpen, onEdit));
```

- [ ] **Step 5: Stile degli input inline e dell'icona in style.css**

In `style.css`, aggiungere regole coerenti col tema (input compatti, larghezza adeguata, niente spinner nativi ingombranti su mobile):
```css
.srow .v .ein {
  width: 2.6em;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--acc);
  color: inherit;
  font: inherit;
  text-align: center;
  padding: 0 .1em;
}
.srow .v .ein.kg { width: 3.4em; }
.srow .v .ein:focus { outline: none; border-bottom-color: #fff; }
.srow .v .ein::-webkit-outer-spin-button,
.srow .v .ein::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.srow .editset {
  margin-left: .5em;
  cursor: pointer;
  opacity: .7;
}
.srow .editset:active { opacity: 1; }
```

> Verificare il valore reale della variabile accent: il tema è Amber `--acc:#E8A93C`. Se la variabile ha altro nome, usare quello già definito in `:root`.

- [ ] **Step 6: Verifica suite logica (no regressioni)**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test; Pop-Location
```
Atteso: PASS, 0 fail.

- [ ] **Step 7: Verifica browser (Playwright, localhost:8780)**

1. **Normale:** completare una serie (es. Panca). La riga finita mostra due input reps/kg. Cambiare kg, premere Tab/Enter (blur) → valore aggiornato; riaprendo/ri-renderizzando il valore persiste; il badge feel/✗ e il delta ▲/▼ (vs settimana prima) sono ricalcolati.
2. **Preservazione:** impostare un feel (via icona ✎ → popup), poi modificare kg inline → il feel resta.
3. **Superset:** stessa cosa su una traccia del "Curl EZ + Skullcrusher" (giorno B/C).
4. **Icona ✎:** apre il popup con feel / ✗ non riuscita + nota / annulla completamento / elimina, come prima.
5. **Serie attiva:** lo stepper `+/−` di reps e kg è invariato (l'inline edit non tocca la serie in corso).
6. **Input non valido:** scrivere lettere o lasciare un valore assurdo → al blur ripristina il valore precedente, nessun salvataggio anomalo.
7. Console: 0 errori.

- [ ] **Step 8: Commit**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git add app.js style.css
git commit -m "feat: editing inline reps/kg su serie finita, popup dietro icona`n`nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
Pop-Location
```

---

## Task 5: Bump cache service worker

**Files:**
- Modify: `sw.js` (costante `CACHE`)

- [ ] **Step 1: Bump della versione cache**

In `sw.js` cambiare `gymsched-v14` in `gymsched-v15` (cercare la stringa esatta con `grep -n "gymsched-v" sw.js`; aggiornare l'unica occorrenza della costante `CACHE`).

- [ ] **Step 2: Verifica browser del refresh cache**

Ricaricare `http://localhost:8780/index.html` (hard reload). In DevTools → Application → Cache Storage deve comparire `gymsched-v15` e le vecchie versioni vengono eliminate all'`activate`. App funzionante offline.

- [ ] **Step 3: Commit**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git add sw.js
git commit -m "chore: bump cache gymsched-v15`n`nCo-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
Pop-Location
```

---

## Task 6: Push finale

- [ ] **Step 1: Fetch + pull + push**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git fetch origin
git pull --ff-only
node --test
git push origin main
git status --porcelain=v1 --branch
Pop-Location
```
Atteso: suite verde (116+ test, 0 fail), push ok, `## main...origin/main` con working tree pulito.

---

## Self-Review (eseguita)

- **Copertura spec:** EZ bar (helper puro Task 1 + dato Task 2 + wiring Task 3) ✓; editing inline + popup dietro icona (Task 4) ✓ su normale e superset ✓; serie attiva invariata (Task 4 Step 7.5) ✓; cache bump (Task 5) ✓; test unit + browser (in ogni task) ✓.
- **Placeholder:** nessuno; ogni step di codice mostra il codice e il comando.
- **Coerenza tipi/nomi:** `exerciseBar(exercise, defaultBar)` definito in Task 1, usato con questa firma in Task 3 (`exerciseBar(ex, getBar())`). `buildEditBlock(label, state, prev, bar)` param aggiunto in Task 3 Step 1 e usato nei 3 call site. `onEdit(reps, kg)` aggiunto a `setRow` in Task 4 Step 1 e fornito dai due call site in Step 3-4. `withSet`/`withSupersetSet`/`setEntry`/`persist`/`getEntry` sono helper già esistenti nel codice (verificati ai call site `onApply` esistenti).
- **Nota da risolvere in esecuzione:** confermare il nome esatto della variabile CSS accent in `:root` (atteso `--acc`) e la stringa esatta della costante cache in `sw.js` prima di editare.
