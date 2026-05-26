# Lotto 1 — Fix che fanno male durante l'allenamento

Data: 2026-05-26
Stato: approvato (mockup validati con l'utente)

## Obiettivo

Cinque correzioni alla schermata focus dell'esercizio (overlay a schermo intero,
`renderFocusNormal` / `renderFocusSuperset` in `app.js`). Nessun cambio al formato
dei dati: le serie restano `{reps, kg, done, feel, warmup, comments}`. I log
esistenti restano validi e intatti.

## Decisioni di design (validate con mockup)

1. **Sensazione (facile/giusta/dura)** non si chiede più *prima* della serie.
   - Si toglie la `buildRpeBar` dall'editor della serie corrente.
   - Dopo aver premuto "Serie fatta", durante il recupero appare una striscia
     sopra la barra del timer: «Serie X · com'è andata?» con i tre pulsanti.
     Tap = salva il feel sulla serie appena conclusa. Resta opzionale.
   - Il feel resta modificabile anche dopo, dal popup sulla serie fatta.
2. **Tocco su una serie già fatta → popup centrato** (come i `<dialog>` esistenti
   dell'app, sfondo oscurato, chiusura con ✕ o tap fuori). Contenuto:
   - titolo «Serie N · R × K kg»
   - barra sensazione facile/giusta/dura (preselezionata se già impostata)
   - editor reps e kg con stepper +/− (niente più `prompt()`)
   - «↩ Annulla conferma» → la serie torna non-fatta (ridiventa la corrente)
   - «🗑 Elimina serie» → rimuove la serie dall'elenco
3. **Note non più coperte dal timer**: il corpo del focus riserva spazio in basso
   sufficiente alla barra del timer, così l'ultimo elemento (nota) resta leggibile
   quando il recupero è in corso.

## Le 5 correzioni

### #2 — I kg si azzerano scegliendo facile/giusta/dura
Causa: ogni `render()` in `renderFocusNormal` riassegna `draft` dai valori della
*volta scorsa* (`prefillSets`), buttando i kg appena digitati; toccare la RPE bar
chiamava `render()`.
Fix:
- Togliere la RPE bar dall'editor corrente (vedi #3) elimina l'innesco principale.
- Inoltre rendere `draft` stabile tra i redraw: ricaricare i valori solo quando
  cambia la serie corrente (chiave `idx:curIdx`), non a ogni `render()`. Idem per
  `draftA`/`draftB` nel superset.

### #3 + #15 — Sensazione dopo la serie
- Rimuovere `buildRpeBar` dal corpo della serie corrente (in `renderFocusNormal` e
  in `trackBlock`).
- Alla conferma "Serie fatta", la serie viene salvata con `feel` corrente (di norma
  `""`). Poi compare la striscia "com'è andata?" sopra il timer per la serie appena
  conclusa; il tap aggiorna il `feel` di quella serie.
- Il `feel` è comunque modificabile dal popup (#15).

### #12 — Modifica reps/kg di una serie fatta
- Sostituire i due `prompt()` (in `setRow` e nei rami superset) con il popup
  centrato: stepper reps (interi, ≥0) e kg (step 0.5, ≥0), come l'editor esistente.

### #13 — Annullare/togliere una serie confermata
- Nel popup: «Annulla conferma» imposta `done:false` sulla serie (riusa `withSet`),
  e «Elimina serie» la rimuove (riusa `withoutSet` / `withoutSupersetSet`).

### #11 — Il timer copre le note
- `.focus-body` riceve `padding-bottom` pari all'altezza della barra timer quando
  il recupero è attivo (classe sul body/overlay attivata da `startRest`, rimossa a
  fine/stop del timer). In alternativa padding costante sufficiente.

## Componenti toccati

- `app.js`:
  - `renderFocusNormal`, `trackBlock`/`renderFocusSuperset`: togliere RPE bar,
    stabilizzare le bozze, cablare il popup al posto dei `prompt()`.
  - `setRow`: l'onClick di una serie fatta apre il popup (normale e superset).
  - nuovo: `openSetDialog(...)` che costruisce/mostra il popup e applica le azioni
    (feel, reps/kg, annulla conferma, elimina) tramite gli helper puri esistenti.
  - nuovo: striscia "com'è andata?" mostrata in `startRest` / a fine conferma,
    legata alla serie appena conclusa.
  - `startRest` / `timer.onEnd` / `tStop`: toggle della classe per lo spazio note.
- `index.html`: markup del nuovo `<dialog>` per la serie (o creato via DOM in JS,
  coerente con gli altri dialog).
- `style.css`: stili popup serie, striscia feel sopra il timer, padding del corpo.
- `sw.js`: bump versione cache (lo richiede ogni modifica allo shell).

## Logica pura / dati
Nessun nuovo formato. Si riusano `withSet`, `withoutSet`, `withSupersetSet`,
`withoutSupersetSet`, `normalizeSet`. Niente da cambiare in `store.js`/`session.js`,
quindi i test esistenti restano verdi; si aggiungono test solo se introduciamo
nuovi helper puri (es. un eventuale `undoSet`, ma `withSet({done:false})` basta).

## Fuori scope (altri lotti)
Pulizia 4ª serie / +serie-−serie (#4/#5/#14), serie non riuscita (#6), contenuto
scheda (#9/#16/#17/#21/#10), allenamento guidato (#1/#7/#8/#20), app editabile
(#22/#18/#19).
