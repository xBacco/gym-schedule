# EZ bar + editing inline serie finita — Design

> Data: 2026-05-27 · Progetto: gym-schedule (PWA offline, vanilla JS ES modules, dati su GitHub)

## Obiettivo

Quick win con due interventi indipendenti emersi dall'uso reale, prima dell'editor completo della scheda (rimandato a spec separata):

1. **Bilanciere EZ per esercizio** — alcuni esercizi usano la barra EZ (~10 kg) invece del bilanciere standard (default 20 kg). La linea dischi deve calcolare i dischi per lato con la barra giusta.
2. **Editing inline della serie finita** — poter correggere reps/kg di una serie già completata direttamente sulla riga, senza aprire il popup; il popup resta per feel / non riuscita / elimina, raggiunto da un'icona.

**Fuori scope (deciso con l'utente):** editor completo della scheda (modifica/aggiungi/togli/riordina esercizi + impostazioni app). Spec separata; nodo tecnico = ID stabili per esercizio.

## Vincoli del progetto

- PWA **senza backend**: dati su GitHub (cross-origin). Commit + push diretti su `main` (no PR); prima del push `git fetch` + `git pull --ff-only`.
- Logica pura in `store.js`/`session.js` testata con `node --test` (gate). Rendering/wiring DOM in `app.js`, non testato in Node → verifica in browser reale (Playwright, server HTTP locale 8780).
- Bump di `CACHE` in `sw.js` quando cambia un file dell'app-shell (attuale `gymsched-v14` → `v15`).
- Tema **Amber** (`--acc:#E8A93C`).
- Telefono pusha i log: non rompere la forma dei dati salvati (entry keyed per indice di esercizio).

---

## 1. Bilanciere EZ per esercizio

**Cosa:** nuovo campo opzionale `bar` (numero, kg) sugli esercizi del PLAN. Quando presente, la linea dischi usa quel valore come peso della barra invece del default globale.

**Dati (`plan.js`):** aggiungere `bar: 10` ai due esercizi che usano la EZ:
- giorno **B**, indice **5**: `Curl EZ + Skullcrusher`
- giorno **C**, indice **5**: `Curl EZ + Skullcrusher`

Forma esercizio attuale: `{ name, setsReps, recText, restSeconds, superset }` → diventa `{ ..., bar?: number }`. Campo opzionale: chi non ce l'ha usa il default.

**Logica pura (testabile) — `store.js`:**

```js
// Ritorna il peso del bilanciere da usare per questo esercizio.
// exercise.bar se è un numero finito > 0, altrimenti defaultBar.
export function exerciseBar(exercise, defaultBar) { ... }
```

Casi da testare: `bar` valido → ritorna `bar`; `bar` assente/0/negativo/NaN → ritorna `defaultBar`; `exercise` null/undefined → ritorna `defaultBar`.

**Wiring (`app.js`):** la linea dischi vive in `buildEditBlock` (riga ~432), **condivisa** dal path normale (`renderFocusNormal`, call site ~823) e dal path superset (`trackBlock` via `renderFocusSuperset`, call site ~991). `renderPlates` chiama oggi `getBar()` (riga ~457).

- Aggiungere un parametro `bar` a `buildEditBlock(label, state, prev, bar)`; `renderPlates` usa `bar` al posto di `getBar()` (riga 457 e fallback messaggio riga 458).
- Call site normale (823): `ex` è in scope → passare `exerciseBar(ex, getBar())`.
- Call site superset (991): `trackBlock` non ha `ex` direttamente. Calcolare `exerciseBar(ex, getBar())` una sola volta nel chiamante `renderFocusSuperset` (che ha `ex`) e passarlo a `trackBlock` → a `buildEditBlock`. Entrambe le tracce A/B della stessa entry superset condividono lo stesso `bar` (è un campo unico dell'esercizio; entrambe le metà del "Curl EZ + Skullcrusher" usano la EZ).

**Effetto verificato:** i due esercizi EZ sono superset, ma il superset mostra comunque la linea dischi (via `buildEditBlock`), quindi `bar: 10` ha effetto visibile sul calcolo "per lato".

**Impostazione globale invariata:** `getBar()` (localStorage `BAR_KEY`, default 20) resta il default per tutti gli esercizi senza `bar`. Nessuna nuova UI di impostazione in questo lotto.

---

## 2. Editing inline della serie finita

**Stato attuale:** in `setRow` (riga ~685) la riga di una serie completata mostra reps/kg nello span `.v`; un click su `.v` chiama `onOpen()` → `openSetDialog` (popup completo: reps, kg, feel, ✗ non riuscita + nota, annulla completamento, elimina). Il feel/✗ a destra è anch'esso cliccabile e apre lo stesso popup.

**Nuovo comportamento:** per una serie **finita** (`set.done`, non warmup):

- **reps e kg diventano editabili inline** sulla riga, come due `<input type="number">` compatti al posto del testo `reps × kg kg`. Commit **su blur** (e su `Enter`): aggiorna solo reps/kg, **preservando** `feel`, `failed`, `failNote`, `comments` esistenti.
- **Popup dietro un'icona** ✎ (o ⋯) a fine riga: apre l'`openSetDialog` esistente per feel / ✗ non riuscita + nota / annulla completamento / elimina. Sostituisce il click-per-aprire su `.v` e sul badge feel.
- Vale per **serie normale** (`renderFocusNormal`/`setRow`) e **superset** (`trackBlock`/`setRow`).

**Serie attiva (in corso): invariata.** Lo stepper `+/− 0.5 kg` e lo stepper reps di `buildEditBlock` restano il modo di inserire la serie corrente. L'editing inline riguarda solo righe già `done`.

**Commit (riusa i percorsi esistenti):**
- Normale: `setEntry(data, …, withSet(v, i, { reps, kg }))` + `persist(idx)` + `render()` — stessi helper già usati da `onApply` (righe ~806). Passando solo `{ reps, kg }`, `withSet` fa merge e gli altri campi restano.
- Superset: `withSupersetSet(getEntry(...), trackKey, i, { reps, kg })` + `persist` + `render` (come riga ~956).

**API di `setRow`:** oggi `setRow(i, set, prev, isCurrent, onRemove, onOpen)`. Aggiungere un callback per il commit inline, es. `onEdit(reps, kg)`, mantenendo `onOpen` per l'icona popup. (Dettaglio firma da fissare in fase di plan.)

**Validazione input:** reps intero ≥ 0; kg numero ≥ 0 con step 0.5 (coerente con lo stepper). Input vuoto/non valido al blur → ripristina il valore precedente (nessun commit). Nessun decimale sui reps.

**Note UX:**
- `inputmode="numeric"` / `decimal` per tastiera mobile adatta.
- La progressione (`▲ +x` / `▼ -x` calcolata da `progressionDelta` su `prev.kg`) e il badge feel/✗ vanno ricalcolati al `render()` dopo il commit — già automatico, basta che il commit passi da `render()`.
- Non rompere il badge feel/✗: ora apre il popup; con la nuova icona ✎, il badge resta **informativo** (mostra feel/✗) e l'azione di modifica passa dall'icona. (Comportamento del tap sul badge da confermare in plan: informativo vs apre popup.)

---

## Test & verifica

- **Unit (`node --test`, gate):** `exerciseBar` (casi sopra). Suite attuale 116 test → deve restare verde.
- **Browser (Playwright, localhost:8780):**
  1. EZ bar: aprire giorno B/C esercizio "Curl EZ + Skullcrusher", inserire un kg, verificare che la linea dischi calcoli "per lato" con barra 10 (non 20). Un esercizio con bilanciere normale resta a 20.
  2. Inline edit: completare una serie, modificare reps/kg inline, blur → valore aggiornato, feel/✗ preservati, ▲/▼ ricalcolato. Vale su normale e superset.
  3. Icona ✎: apre il popup feel/non riuscita/elimina come prima.
  4. Serie attiva: stepper invariato.
  5. 0 errori console.
- **Cache:** bump `sw.js` a `gymsched-v15`.

## Ordine di implementazione suggerito

1. `exerciseBar` in `store.js` + test (TDD).
2. `bar: 10` in `plan.js` + parametro `bar` in `buildEditBlock` e wiring dei due call site.
3. Editing inline in `setRow` + callback di commit nei due path.
4. Bump cache, verifica browser, commit/push.
