# Spec — "Ultima volta" nel sottotitolo della lista esercizi

**Data:** 2026-05-27
**Stato:** approvato (design-only, variante B)
**Origine:** brainstorming feature #5 "copia settimana", ridotta a sola visualizzazione. La feature #1 "suggerimento peso" è stata scartata.

## Obiettivo

Nella lista esercizi del giorno (riga compatta, non aperta), mostrare nel sottotitolo **cosa hai fatto l'ultima volta** su quell'esercizio, così da avere subito un riferimento per scegliere il peso senza dover aprire l'overlay o la progressione. Puramente informativo: nessun input, nessun calcolo di suggerimento, nessuna modifica ai dati.

## Comportamento

Nella riga di ciascun esercizio non ancora completato, il sottotitolo `.sub` — oggi `"{setsReps} · rec {N}″"` — riceve un'appendice:

```
4 × 8 · rec 90″ · ult. 8×70
```

Dove `ult. 8×70` = la **serie working più pesante** (kg numerico massimo) dell'**ultima sessione registrata** per quell'esercizio.

### Cosa mostrare

- **Esercizio normale:** `ult. {reps}×{kg}` della serie più pesante (es. `ult. 8×70`).
- **Superset:** solo i kg per traccia, `ult. A{kgA} B{kgB}` (es. `ult. A20 B15`). Niente reps (riga già densa, due tracce).
  - Se una sola traccia ha storico, mostra solo quella (es. `ult. A20`).
- Il valore **"best" a destra resta invariato** (massimo storico, non l'ultima volta).

### Quando NON mostrare

- Esercizio già completato nella sessione corrente (`isComplete(i)` → riga con `✓`): nessuna appendice.
- Nessuno storico utile: appendice omessa del tutto (sottotitolo come oggi).
- "Storico utile" = esiste una settimana precedente (`< currentWeek`) con almeno una serie working (non warmup, non `failed`) con un **kg numerico**.

### Definizione "serie più pesante dell'ultima sessione"

- Si scandiscono le settimane con dato per quell'esercizio/giorno, dalla **più recente** in giù, **solo settimane `< currentWeek`** (forward-only: la settimana corrente non conta come "ultima volta").
- La prima settimana che contiene almeno una serie working con kg numerico è "l'ultima sessione".
- Dentro quella settimana si prende la serie working con **kg numerico massimo** (a parità di kg, la prima incontrata). Si escludono warmup e serie `failed`.
- Le settimane con sole serie senza kg numerico vengono saltate (si prosegue indietro).

## Helper puro (logica testabile)

Nuovo export in `session.js`, vicino a `previousWeekSet`:

```js
// {reps, kg, week} della serie working PIÙ PESANTE (kg numerico max) dell'ultima
// settimana precedente (< weekKey) che ne ha una; null se nessuno storico utile.
// Esclude warmup e serie failed. track: null = normale, "a"/"b" = traccia superset.
export function lastWorkingSet(data, day, exId, weekKey, track = null) { ... }
```

- Riusa `entryTrack` / `getEntry` / `parseNum` già presenti nel file (stesso stile di `previousWeekSet` e `topSetSeries`).
- `reps`/`kg` restano stringhe (come negli altri helper): la formattazione del display sta in `app.js`.

## Display (app.js / renderList)

- In `renderList()` (`app.js:1593`), nel ramo "non completato":
  - normale → `lastWorkingSet(data, currentDay, exIdAt(i), currentWeek)`; se non null, appende uno `<span class="ult">` al `.sub`.
  - superset → chiama per `"a"` e `"b"`; compone l'etichetta kg-only; appende lo span se almeno una traccia ha dato.
- Lo span è figlio di `.sub` (il testo base resta via `textContent`, poi `appendChild`).

## CSS

Nuova regola in `style.css`, accanto a `.item .r .sub`:

```css
.item .r .sub .ult{color:var(--acc);}
```

Distingue l'ultima volta (accent ambra) dal resto del sottotitolo (`--dim`).

## Cache

Cambiano file dell'app-shell (`app.js`, `session.js`, `style.css`, tutti nello SHELL del service worker) → bump `CACHE` in `sw.js:5` da `gymsched-v27` a `gymsched-v28`.

## Fuori scope

- Nessun suggerimento di peso / progressive overload (feature #1 scartata).
- Nessuna copia/precompilazione di settimane (il `prefillSets` esistente già copre il prefill dello stepper).
- Nessun cambiamento al "best", all'overlay, o ai dati salvati.

## Verifica

- `npm test` — i nuovi test di `lastWorkingSet` passano; i 152 esistenti restano verdi.
- Browser (Playwright o telefono): iniettare storico via `gymsched_pending` con l'id canonico da `data.json`; aprire la lista; verificare l'appendice `ult.` su un esercizio normale e su un superset, l'assenza su esercizio completato e su esercizio senza storico.
