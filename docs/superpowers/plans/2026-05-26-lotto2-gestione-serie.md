# Lotto 2 — Gestione serie · Implementation Plan

> Flusso "snello" scelto dall'utente: niente spec formale; piano a task eseguito subagent-driven con review spec + review finale (salto la review qualità per-task sui task meccanici). Logica pura testata con `node --test` (gate). Render/wiring DOM verificato in browser dall'utente.

**Goal:** Gestione serie durante l'allenamento, dai feedback #4/#5/#14/#6:
1. **Mai 4ª serie fantasma** (#4/#14): un esercizio da 3 mostra 3 righe, non una 4ª pronta da riempire. La 4ª si aggiunge solo col tasto **+ serie**.
2. **+ serie / togli serie sempre** (#5/#14): aggiungere/togliere una serie in qualsiasi momento, anche nei **superset** (oggi mancano lì).
3. **Serie non riuscita + nota** (#6): segnare una serie come non riuscita con nota del perché, dal **popup della serie**. Conta come "gestita" (l'esercizio si chiude) ma è **esclusa dalle stats** (come i riscaldamenti).

**Decisioni di design (utente):** "non riuscita" si segna nel popup (toggle + nota); una serie fallita conta verso il completamento ma NON entra in volume/trend/record.

**Stack:** Vanilla JS ES modules. Logica pura in `store.js`/`session.js` (test `node --test`), DOM in `app.js`. HEAD di partenza = `17cdc8f`.

**Modello dati:** si aggiungono due campi alla serie in `normalizeSet`: `failed: boolean`, `failNote: string`. Nessun'altra modifica di formato. Gli helper `withSet`/`withSupersetSet` propagano i campi via merge (già fanno spread).

---

## Task 1 — Logica pura: campi `failed`/`failNote` + esclusione dalle stats (TDD)

**Files:** `store.js`, `session.js`, `tests/store.test.js`, `tests/session.test.js`

- **store.js `normalizeSet`** (riga ~70): aggiungere i due campi al ritorno:
  ```js
  return { reps: String(s?.reps ?? ""), kg: String(s?.kg ?? ""), done: !!s?.done, feel, warmup: !!s?.warmup, failed: !!s?.failed, failNote: String(s?.failNote ?? ""), comments };
  ```
- **session.js** — escludere le serie `failed` (come si fa con `warmup`) da TUTTE le statistiche; il completamento NON cambia (una serie failed ha `done:true` e non è warmup, quindi conta già verso il target — è voluto):
  - `bestKg` (riga ~126): `if (s.warmup || s.failed) continue;`
  - `trackVolume` (riga ~183): `if (!s.done || s.warmup || s.failed) continue;`
  - `weekTopKg` (riga ~215): `if (s.warmup || s.failed) continue;`
  - `previousSetInSession` (riga ~153): `if (t.sets[i].done && !t.sets[i].warmup && !t.sets[i].failed) return ...`
  - `previousWeekSet` (riga ~165): `const working = t.sets.filter((s) => !s.warmup && !s.failed);`
  - `trackComplete` / `isEntryComplete`: **nessuna modifica** (failed conta verso il completamento).

**Test da aggiungere (TDD: scrivere prima, poi far passare):**
- `tests/store.test.js`: `normalizeSet` di default dà `failed:false`/`failNote:""`; preserva `failed:true` e `failNote:"..."`; `failNote` non-stringa → `""`.
- `tests/session.test.js`:
  - una serie `{done:true, failed:true, reps, kg}` NON entra in `sessionVolume`/`trackVolume`, non in `bestKg`, non in `weekTopKg`/`exerciseTrend`, non è sorgente di `previousSetInSession`/`previousWeekSet`.
  - una serie failed **conta** verso `isEntryComplete` (es. 2 done normali + 1 done failed su target 3 → completo).

**Verifica:** `node --test` verde, con i nuovi test che falliscono PRIMA della modifica al codice di produzione e passano DOPO.

**Commit:** `feat(serie): campo failed/failNote escluso dalle stats (logica pura)`

---

## Task 2 — Niente 4ª serie fantasma + stato "completo" nel focus normale

**Files:** `app.js` — `renderFocusNormal`

- **Togliere il termine `curIdx + 1`** dal calcolo del numero di righe (riga ~655):
  ```js
  const total = Math.max(entry.sets.length, tgt.sets);
  ```
  Così un esercizio da 3 (e `entry.sets.length <= 3`) mostra esattamente 3 righe.
- **Gestire l'esercizio già completo** (es. riaperto dalla lista): quando `curIdx >= total` non c'è una serie corrente da editare, e l'editor + il CTA "Serie fatta" creerebbero una 4ª serie fantasma. In quel caso:
  - NON renderizzare l'editor della serie corrente (stepper/`buildEditBlock`, repeat-chips) né il CTA "Serie fatta".
  - Continuare a mostrare: le righe delle serie fatte (`setsBox`), la riga pallini con i tasti **+ serie** / **+ riscald.**, e il campo nota.
  - Suggerimento: calcolare `const allDone = curIdx >= total;` subito dopo `total`, e avvolgere in `if (!allDone) { ...editor + cta... }` i blocchi pertinenti. Leggere `renderFocusNormal` per individuare con precisione i blocchi editor/CTA da condizionare.

**Verifica browser (utente):** un esercizio da 3 mostra 3 righe; completate le 3 e riaperto l'esercizio, niente 4ª riga vuota e niente creazione accidentale; il tasto **+ serie** aggiunge volutamente una 4ª.

**Commit:** `fix(serie): niente 4ª serie fantasma + vista esercizio completo (normale)`

---

## Task 3 — Superset: + serie e togli-serie

**Files:** `app.js` — `trackBlock` e (se il CTA/editor del superset è altrove) `renderFocusSuperset`

- **`total` del superset** (riga ~779): togliere `curIdx + 1` → `const total = Math.max(trackEntry.sets.length, tgtTrack.sets);` e applicare lo stesso guard "completo" all'editor/CTA del superset (individuare dove vive il CTA: probabilmente in `renderFocusSuperset`). Se condizionare il CTA condiviso A/B è troppo intricato, come minimo togliere `curIdx+1` per non gonfiare le righe.
- **Tasto "+ serie" per traccia** in `trackBlock` (allineato al normale, ma SENZA "+ riscald." per i superset, com'è la convenzione): un `.addset` "+ serie" che appende una serie vuota:
  ```js
  data = setEntry(data, currentWeek, currentDay, idx, withSupersetSet(getEntry(data, currentWeek, currentDay, idx), trackKey, trackEntry.sets.length, { reps: "", kg: "", done: false }), new Date().toISOString());
  persist(idx); render();
  ```
- **Togli serie non-fatta**: passare a `setRow` un `onRemove` reale per le serie NON fatte del superset (oggi è `null`): chiama `withoutSupersetSet(getEntry(...), trackKey, i)` + persist + render. (Le serie fatte si eliminano già dal popup, Lotto 1 Task 4.)

**Verifica browser (utente):** in un superset si può aggiungere una serie (per traccia A/B) e togliere una serie non fatta; niente 4ª fantasma.

**Commit:** `feat(serie): + serie e togli-serie nei superset + niente 4ª fantasma`

---

## Task 4 — Popup "Non riuscita" (toggle + nota) + rendering del fallimento

**Files:** `app.js` — `openSetDialog`, `setRow`, e i siti `onOpen`/`onApply` in `renderFocusNormal` e `trackBlock`; `style.css` (stile badge/nota fallimento)

- **`openSetDialog`**: estendere `opts` con `failed` e `failNote`; in `setDlgState` aggiungere `failed`/`failNote`. Aggiungere nel dialog (dopo la sezione feel) un toggle **"✗ Non riuscita"** e, quando attivo, un `<input>`/`<textarea>` per la **nota del perché** (legato a `setDlgState.failNote`). Lo scaffolding markup va aggiunto in `#setDialog` (vedi sotto) o creato via DOM coerentemente.
  - La callback di applicazione passa anche failed/failNote. Cambiare la firma `onApply` per portarli: `onApply(reps, kg, feel, failed, failNote)`.
  - Il bottone **"↩ Annulla conferma"** ha senso solo se la serie è `done`: nasconderlo quando si apre il popup su una serie non ancora fatta.
- **Markup nel dialog** (`index.html`, dentro `#setDialog`, dopo `#setDlgRpe`/prima di "Modifica" o in fondo): aggiungere
  ```html
  <button id="setDlgFail" type="button" class="failtoggle">✗ Non riuscita</button>
  <textarea id="setDlgFailNote" class="failnote hidden" rows="2" placeholder="Perché? (es. niente più forza)"></textarea>
  ```
  e cablarli in `openSetDialog` (toggle `failed`, mostra/nascondi la textarea, aggiorna `setDlgState.failNote` su input).
- **Aprire il popup anche sulla serie CORRENTE (non fatta)**: oggi `onOpen` è passato solo quando `set.done`. Aggiungere un modo per aprire il popup sulla serie corrente — es. rendere tappabile il numero/riga della serie corrente, o un piccolo link "segna/​modifica" — così si può marcarla "non riuscita". (Il "mark" avviene nel popup, NON con un CTA separato: l'utente ha scelto il popup.) All'apertura sulla serie corrente, passare `failed: set.failed`, `failNote: set.failNote`, e nell'`onApply` includere `done: true` quando `failed` è true (una serie non riuscita è "gestita" → done).
- **`onApply` callers** (normale `renderFocusNormal` e superset `trackBlock`): includere `failed`/`failNote` nel patch a `withSet`/`withSupersetSet`. Se `failed` è true forzare `done:true`.
- **`setRow` rendering**: per una serie `failed`, mostrare un badge **"✗ non riuscita"** (classe rossa, es. `.rpe.fail` o `.failbadge`) al posto/oltre il tag feel, e la `failNote` come riga sotto (stile simile a `.cmt`). Una serie failed resta visibilmente done ma marcata.
- **`style.css`**: stile per `.failtoggle` (attivo/inattivo), `.failnote`, e il badge `.failbadge`/`.rpe.fail` (colore `var(--down)`).

**Verifica browser (utente):** tap su una serie (corrente o fatta) → popup col toggle "Non riuscita"; attivandolo appare la nota; applicando, la serie si marca rossa "non riuscita" con la nota, l'esercizio avanza/si completa, e il volume/record NON la conteggiano.

**Commit:** `feat(serie): segna serie non riuscita con nota dal popup (#6)`

---

## Task 5 — Bump cache + verifica finale

**Files:** `sw.js`

- `sw.js`: `const CACHE = "gymsched-v10";` → `"gymsched-v11"`.
- `node --test` completo verde.
- **Commit:** `chore: bump cache v11 (lotto 2)`

---

## Note di rischio
- `total = Math.max(len, tgt)` senza `curIdx+1`: assicurarsi che la serie corrente abbia sempre una riga quando l'esercizio NON è completo (curIdx < total per costruzione, perché se non completo curIdx punta a una serie entro tgt o entro len). Lo stato `allDone` gestisce il caso completo.
- Firma `onApply` estesa a 5 argomenti: aggiornare ENTRAMBI i chiamanti (normale + superset) e la `showFeelAsk` NON usa onApply (resta invariata).
- `failed` esclusa dalle stats ma inclusa nel completamento: verificare con i test che `isEntryComplete` resti vero con una serie failed.
