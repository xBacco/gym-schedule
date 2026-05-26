# Lotto 3 — Contenuto scheda — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correggere nomi di esercizi ambigui e target di ripetizioni nella scheda (`plan.js`), secondo la spec `2026-05-26-lotto3-contenuto-scheda-design.md`.

**Architecture:** Modifica **solo-dati** all'array statico `PLAN` in `plan.js`. Nessun cambio di logica: `store.js`/`session.js`/`app.js` non si toccano. Lo storico è indicizzato per giorno+posizione (idx), quindi rinominare non rompe i log. Si aggiunge un test-guardia su `parseTarget` per blindare il parsing del numero singolo (`"3 × 10"`) e si bumpa la cache PWA perché `plan.js` è nell'app-shell.

**Tech Stack:** Vanilla JS ES modules. Test puri con `node --test`. PWA service worker (`sw.js`).

**Convenzioni del progetto:**
- Gate logico: `node --test` (atteso prima dell'intervento: **pass 113, fail 0**; dopo il Task 1: **pass 114**).
- Commit + push su `main` (no PR). Su PowerShell: prima del push `git fetch origin` + `git pull --ff-only origin main` (l'app pusha commit `log:` dal telefono). Messaggi commit via `-m` (NON here-string pipe: introduce un BOM).
- Verifica DOM nel browser reale (server HTTP locale), perché `app.js` non è testato in Node.

**Come servire/verificare nel browser (vale per il Task 3):**
```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
Start-Process python -ArgumentList '-m','http.server','8780' -WindowStyle Hidden
# poi aprire http://localhost:8780/index.html (ES modules: file:// non funziona)
# se compare il banner "Nuova versione", cliccarlo per attivare la cache nuova
```

`node --test` (gate):
```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test 2>&1 | Select-Object -Last 6; Pop-Location
```

---

## File Structure

- `tests/session.test.js` — aggiunge **un** test che blinda `parseTarget` sul numero singolo (`"3 × 10"`), senza range. Modifica.
- `plan.js` — 7 modifiche all'array `PLAN` (2 rinomini, 4 superset con peso → `3 × 10 / 3 × 10`, face pull → `3 × 12`). Modifica.
- `sw.js` — bump `CACHE` `gymsched-v12` → `gymsched-v13` (riga 5). Modifica.

Nessun file nuovo. Nessuna modifica a `store.js`/`session.js`/`app.js`.

---

## Task 1: Test-guardia per `parseTarget` sul numero singolo

**Files:**
- Modify: `tests/session.test.js`

Nota: `parseTarget`/`parseTargetTrack` già gestiscono il numero singolo (la regex
`^(\d+)\s*[×x]\s*(.+)$` cattura `"10"` come `reps`). Questo è un **test di
caratterizzazione/guardia**: serve a impedire regressioni future ora che la scheda
usa target a numero fisso. Quindi al passo 2 il test **passa subito** (non è red-green).

- [ ] **Step 1: Aggiungi il test**

In `tests/session.test.js`, subito dopo il test esistente che usa
`parseTarget("3 × 8-10 / 3 × 10-12", true)` (intorno alla riga 47-50, alla fine di
quel blocco `test(...)`), aggiungere un nuovo test. `parseTarget` è già importato in
cima al file (è usato dal test esistente).

```js
test("parseTarget gestisce reps a numero singolo (senza range)", () => {
  assert.deepEqual(parseTarget("3 × 10"), { sets: 3, reps: "10" });
  assert.deepEqual(parseTarget("3 × 10 / 3 × 10", true), {
    a: { sets: 3, reps: "10" },
    b: { sets: 3, reps: "10" },
  });
});
```

- [ ] **Step 2: Esegui il test (deve PASSARE)**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test 2>&1 | Select-Object -Last 6; Pop-Location
```
Atteso: **pass 114**, fail 0. (Il nuovo test passa perché il codice già supporta il numero singolo.)

- [ ] **Step 3: Commit**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git fetch origin 2>&1 | Out-Null; git pull --ff-only origin main 2>&1 | Select-Object -Last 1
git add tests/session.test.js
git commit -m "test(plan): blinda parseTarget su reps a numero singolo (lotto3)" -m "Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push origin main 2>&1 | Select-Object -Last 1
Pop-Location
```

---

## Task 2: Modifiche al contenuto scheda (`plan.js`) + bump cache

**Files:**
- Modify: `plan.js`
- Modify: `sw.js`

I valori "prima" qui sotto sono le stringhe esatte presenti nel file: usarle come
match. **Ordine e unicità contano** (vedi note sui due `Curl EZ + Skullcrusher`).

- [ ] **Step 1: Rinomina "Panca inclinata manubri" (Giorno B)**

Match unico. Cambiare solo il `name`:

Da:
```js
      { name: "Panca inclinata manubri", setsReps: "3 × 8-10", recText: "90 sec", restSeconds: 90, superset: false },
```
A:
```js
      { name: "Spinte su panca inclinata (manubri)", setsReps: "3 × 8-10", recText: "90 sec", restSeconds: 90, superset: false },
```

- [ ] **Step 2: Rinomina "Affondi camminata o Goblet squat" (Giorno B)**

Match unico. Cambiare solo il `name` (rep e resto invariati):

Da:
```js
      { name: "Affondi camminata o Goblet squat", setsReps: "3 × 10-12", recText: "90-120 s", restSeconds: 120, superset: false },
```
A:
```js
      { name: "Affondi con manubri", setsReps: "3 × 10-12", recText: "90-120 s", restSeconds: 120, superset: false },
```

- [ ] **Step 3: Superset Curl EZ + Skullcrusher (Giorni B e C) → `3 × 10 / 3 × 10`**

La riga `setsReps: "3 × 8-10 / 3 × 10-12"` compare **identica due volte** (giorno B
e giorno C, entrambi `Curl EZ + Skullcrusher`). Sostituire **tutte** le occorrenze
della stringa `setsReps: "3 × 8-10 / 3 × 10-12"` con `setsReps: "3 × 10 / 3 × 10"`
(usare l'opzione `replace_all` dell'Edit, o eseguire l'edit due volte). Nessun'altra
riga contiene quella stringa.

Risultato (entrambe le righe diventano):
```js
      { name: "Curl EZ + Skullcrusher", setsReps: "3 × 10 / 3 × 10", recText: "75 sec", restSeconds: 75, superset: true },
```

- [ ] **Step 4: Superset Pushdown tricipiti + Curl manubri (Giorno A) → `3 × 10 / 3 × 10`**

Match unico (`"3 × 12-15 / 3 × 12-15"` appare solo qui):

Da:
```js
      { name: "Pushdown tricipiti + Curl manubri", setsReps: "3 × 12-15 / 3 × 12-15", recText: "75 sec", restSeconds: 75, superset: true },
```
A:
```js
      { name: "Pushdown tricipiti + Curl manubri", setsReps: "3 × 10 / 3 × 10", recText: "75 sec", restSeconds: 75, superset: true },
```

- [ ] **Step 5: Superset Curl concentrato + Pushdown (Giorno C) → `3 × 10 / 3 × 10`**

Match unico (`"3 × 15 / 3 × 15"` appare solo qui):

Da:
```js
      { name: "Curl concentrato + Pushdown", setsReps: "3 × 15 / 3 × 15", recText: "60 sec", restSeconds: 60, superset: true },
```
A:
```js
      { name: "Curl concentrato + Pushdown", setsReps: "3 × 10 / 3 × 10", recText: "60 sec", restSeconds: 60, superset: true },
```

- [ ] **Step 6: Face pull (Giorno B) → `3 × 12`**

`"3 × 15-20"` da solo NON è unico (appare anche in "Alzate posteriori (reverse fly)"
e dentro "Crunch a terra + Plank"). Matchare l'**intera riga** del Face pull:

Da:
```js
      { name: "Face pull", setsReps: "3 × 15-20", recText: "60 sec", restSeconds: 60, superset: false },
```
A:
```js
      { name: "Face pull", setsReps: "3 × 12", recText: "60 sec", restSeconds: 60, superset: false },
```

- [ ] **Step 7: Bump cache service worker**

In `sw.js`, riga 5:

Da:
```js
const CACHE = "gymsched-v12";
```
A:
```js
const CACHE = "gymsched-v13";
```

- [ ] **Step 8: Esegui il gate logico**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test 2>&1 | Select-Object -Last 6; Pop-Location
```
Atteso: **pass 114**, fail 0. (`plan.test.js` resta verde: asserisce solo struttura
8/8/8, campi, rest in [60,120], ≤3 serie per traccia — niente di ciò che cambiamo.)

- [ ] **Step 9: Commit**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git fetch origin 2>&1 | Out-Null; git pull --ff-only origin main 2>&1 | Select-Object -Last 1
git add plan.js sw.js
git commit -m "feat(scheda): nomi espliciti + superset peso 3x10 + face pull 3x12 (lotto3)" -m "Spinte su panca inclinata; Affondi con manubri; Curl EZ+Skullcrusher / Pushdown+Curl / Curl concentrato+Pushdown a 3x10/3x10; Face pull 3x12. Core/tenuta invariati. Cache v12 -> v13." -m "Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push origin main 2>&1 | Select-Object -Last 1
Pop-Location
```

---

## Task 3: Verifica nel browser reale

**Files:** nessuno (sola verifica).

- [ ] **Step 1: Servi l'app e aprila**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
Start-Process python -ArgumentList '-m','http.server','8780' -WindowStyle Hidden
```
Aprire `http://localhost:8780/index.html`. Se compare il banner "Nuova versione",
cliccarlo (attiva la cache v13) e attendere il reload.

- [ ] **Step 2: Verifica Giorno B**

Selezionare il tab **B**. Atteso nella lista esercizi:
- "Spinte su panca inclinata (manubri)" (non più "Panca inclinata manubri");
- "Affondi con manubri" (non più "Affondi camminata o Goblet squat");
- "Curl EZ + Skullcrusher" con target `3 × 10 / 3 × 10`;
- "Face pull" con target `3 × 12`.

Aprire "Curl EZ + Skullcrusher": i sotto-tab A/B devono mostrare entrambi
`serie X / 3` e l'editor proporre 10 reps di default su entrambe le tracce.

- [ ] **Step 3: Verifica Giorni A e C**

- Giorno **A** → "Pushdown tricipiti + Curl manubri": target `3 × 10 / 3 × 10`.
- Giorno **C** → "Curl EZ + Skullcrusher" e "Curl concentrato + Pushdown": entrambi
  `3 × 10 / 3 × 10`.
- I superset core/tenuta (Crunch a terra + Plank, Leg raise + Russian twist, Crunch
  inverso + Plank laterale) devono essere **invariati**.
- Nessun errore in console (a parte l'eventuale 404 `favicon.ico`, preesistente).

- [ ] **Step 4: Aggiorna la memory**

Aggiornare `gym-schedule-phases.md` (nuova voce "Lotto 3 — contenuto scheda
completo", cache v13, 114 test) e la riga indice in `MEMORY.md`.

---

## Self-Review (compilato dall'autore del piano)

**Spec coverage:**
- Rinomini Panca inclinata / Affondi → Task 2 step 1-2.
- Superset con peso a `3 × 10 / 3 × 10` (i 4: A Pushdown+Curl, B/C Curl EZ+Skullcrusher, C Curl concentrato+Pushdown) → Task 2 step 3-5.
- Face pull `3 × 12` → Task 2 step 6.
- Core/tenuta invariati → garantito non toccandoli (nessuno step li modifica).
- `parseTarget` numero singolo → Task 1 (guard test).
- Bump cache v13 → Task 2 step 7.
- Test gate verde / nessun test scheda da aggiornare → verificato (plan.test.js asserisce solo struttura).

**Placeholder scan:** nessun TODO/TBD; ogni step ha la stringa esatta o il comando.

**Type/identifier consistency:** stringhe `setsReps` coerenti tra spec, piano e file reale; nomi nuovi identici tra step e spec. `CACHE` `gymsched-v13` coerente. Test usa `parseTarget` (già importato in `session.test.js`).
