# Lotto 3 — Contenuto scheda

Data: 2026-05-26
Stato: approvato (design validato con l'utente)

## Obiettivo

Correggere il **contenuto della scheda** (`plan.js`): nomi di esercizi ambigui e
target di ripetizioni, emersi dall'uso reale. È una modifica **solo-dati**: nessun
cambio di logica, nessun nuovo formato dati, nessuna modifica a `store.js`/`session.js`.

## Decisioni di design (validate con l'utente)

1. **Superset "uguali a 10"** vale **solo per i superset con peso** (braccia). I superset
   core/tenuta restano invariati.
2. **Formato rep**: numero **fisso** (es. `3 × 10`, `3 × 12`), non range.
3. **Nomi**: versione **esplicita**, togliendo alternative ambigue.
4. **Face pull**: default a **12** rep.

## Le modifiche (esatte, su `plan.js`)

### Rinomini — Giorno B
- `Panca inclinata manubri` → `Spinte su panca inclinata (manubri)`
- `Affondi camminata o Goblet squat` → `Affondi con manubri`
  (tolta la parola "camminata" e l'alternativa "o Goblet squat")

### Superset con peso → entrambe le tracce `3 × 10`
- **A** — `Pushdown tricipiti + Curl manubri`: `3 × 12-15 / 3 × 12-15` → `3 × 10 / 3 × 10`
- **B** — `Curl EZ + Skullcrusher`: `3 × 8-10 / 3 × 10-12` → `3 × 10 / 3 × 10`
- **C** — `Curl EZ + Skullcrusher`: `3 × 8-10 / 3 × 10-12` → `3 × 10 / 3 × 10`
- **C** — `Curl concentrato + Pushdown`: `3 × 15 / 3 × 15` → `3 × 10 / 3 × 10`

### Face pull — Giorno B
- `Face pull`: `3 × 15-20` → `3 × 12`

### Invariati (superset core/tenuta)
- **A** — `Crunch a terra + Plank` (`3 × 15-20 / 3 × max`)
- **B** — `Leg raise + Russian twist` (`3 × 12-15 / 3 × 20`)
- **C** — `Crunch inverso + Plank laterale` (`3 × 15 / 3 × max/lato`)

Nessun altro esercizio cambia. La scheda resta **8 / 8 / 8**.

## Integrità dei dati / logica pura

- **Storico/trend indicizzati per giorno+posizione (idx), non per nome.** Rinominare
  un esercizio NON rompe i log già registrati né i trend/record. Da **verificare in
  fase di piano** che non esista alcun match per-nome (`previousWeekSet`,
  `exerciseTrend`, ecc. usano `idx`).
- `parseTarget("3 × 10", ...)` deve produrre `reps: "10"`, `sets: 3`, gestendo il
  numero singolo (senza trattino) come già fa coi range. `repsLow("10")` = 10.
  Da **verificare/aggiungere test** se non già coperto.
- Cambiare il target rep NON tocca le serie già loggate (i `sets` salvati restano);
  cambia solo target visualizzato, prefill e conteggio completamento (3 working set).

## Test

- `node --test` è il gate (atteso: tutti verdi). Se esiste un test che asserisce
  nomi/rep della scheda (es. conteggio 8/8/8, o un esercizio specifico), va
  aggiornato ai nuovi valori. Se `parseTarget` sul numero singolo non è coperto,
  aggiungere un caso.

## PWA

- `plan.js` fa parte dell'app-shell cachata: bump `sw.js` `gymsched-v12` → `gymsched-v13`.

## Fuori scope (altri lotti)

- Feedback fine timer (vibrazione/suono/notifica) → lotto dedicato.
- App editabile + profili (rep standard modificabili dall'app, Impostazioni, schede
  multiple) → lotto dedicato; assorbirà la necessità di editare la scheda a mano.
- Residuo: timer che taglia la nota, gestione opzioni feel → lotto dedicato.
