# Editor scheda + ID stabili — Design

**Data:** 2026-05-27
**Stato:** approvato (brainstorming)

## Problema

Oggi la scheda (`PLAN`) è **codice** in `plan.js` (una `const`) e i log sono
indicizzati per **posizione**: `data.weeks[week].entries[day]["0"]`, `["1"]`, …
Per dare all'utente un editor della scheda (modifica / aggiungi / elimina /
riordina esercizi) servono due cambi accoppiati:

1. La scheda deve diventare **dato modificabile e sincronizzato**, non codice.
2. Ogni esercizio deve avere un'**identità stabile**, così riordinare/eliminare
   non corrompe i log storici (l'indice 3 della settimana scorsa non deve più
   "scivolare" su un altro esercizio dopo un riordino).

Senza identità stabile, tutto il valore storico dell'app
(`previousWeekSet`, `bestKg`, `exerciseTrend`, `prefillSets`, note persistenti)
si rompe alla prima modifica strutturale.

## Scope

**Dentro:**
- Editor degli esercizi **dentro** ai 3 giorni fissi A/B/C: modifica, aggiungi,
  elimina, riordina.
- Modifica campi esercizio: nome, serie×reps, recupero (testo + secondi),
  superset sì/no, bilanciere opzionale.
- Migrazione dati indice→ID, una-tantum e idempotente.
- Scheda spostata in `data.json`, sincronizzata via GitHub.

**Fuori (YAGNI):**
- Aggiungere / togliere / rinominare interi **giorni** (restano fissi A/B/C).
- Modifiche alle **impostazioni app** (token, bilanciere default, dischi,
  commenti rapidi): già esistono nel dialog ⚙ e funzionano — non si toccano.
- "Cestino" / ripristino di esercizi eliminati (estensione futura).

## Decisioni prese

1. **Scheda nel dato + ID stabili** (vs. layer di override sul codice, vs.
   restare a indici rimappando lo storico ad ogni modifica). È l'unica con un
   end-state sano: gli ID stabili sono il prezzo inevitabile di
   "riordina/elimina senza perdere lo storico", e mettere la scheda nel dato la
   rende sincronizzabile tra PC e telefono.
2. **ID = stringa opaca breve** (4–5 char base36, es. `k7m2`), generata una
   volta, mai riusata. La posizione la dà l'ordine nell'array, non l'ID. (vs.
   slug dal nome — cambia se rinomini; vs. numerico — implica posizione.)
3. **Riordino su mobile = drag ⠿** via **pointer events** (non drag&drop HTML5
   nativo), per gestire `touch-action` ed evitare conflitti con lo scroll.
4. **Eliminare un esercizio = log conservati ma nascosti** (vs. cancellati):
   niente perdita accidentale di storico.
5. **Editor lanciato da una ✎ nell'header**, accanto al ⚙ (vs. dentro al ⚙).

## Modello dati

`data.json` guadagna `schema` e `plan`:

```js
{
  schema: 2,                 // marcatore di versione (oggi implicito = 1)
  plan: [
    {
      day: "A",
      title: "Petto + Tricipiti",
      exercises: [
        { id: "k7m2", name, setsReps, recText, restSeconds, superset, bar? },
        …
      ],
    },
    … // B, C
  ],
  weeks: {
    "2026-W22": {
      label,
      entries: { "A": { "k7m2": { sets, note }, … } },  // chiavi-ID, non indici
    },
  },
  updatedAt,
}
```

- **`data.plan`** è la fonte di verità. `plan.js` resta come **seed di default**:
  usato solo per popolare `data.plan` quando è assente (prima installazione /
  dato vuoto).
- **`id`**: opaco, breve, stabile. Generato da `genId(existingIds)`.
- **`entries[day]`**: chiavi-ID al posto delle chiavi-indice.

## Migrazione (pura, una-tantum, idempotente)

`migrate(data)` gira al boot **prima** di qualunque render o save:

1. Se `data.schema >= 2` → già migrato, ritorna `data` invariato.
2. Se `data.plan` assente → la costruisce dal `PLAN` di `plan.js`, generando un
   `id` per ogni esercizio **nell'ordine attuale** (che è l'ordine con cui sono
   stati storicamente loggati gli indici → mappatura corretta, perché `plan.js`
   non ha mai cambiato posizioni in passato).
3. Per ogni settimana e giorno, riscrive le chiavi: l'entry all'indice `i`
   diventa l'entry sotto l'`id` dell'esercizio in posizione `i` nel piano
   seedato. Indici **senza** esercizio corrispondente (log orfani) vengono
   conservati sotto una chiave dedicata (es. `_orphan_<i>`), non persi.
4. Imposta `data.schema = 2` e salva.

Idempotente: il guard sullo `schema` impedisce ri-esecuzioni. Rischio basso (1
sola settimana di dati reali oggi), ma la logica è generale e testata.

## Logica editor — modulo nuovo `editor.js` (puro, testabile)

Funzioni immutabili su `plan`:

- `genId(existingIds)` → id univoco breve.
- `addExercise(plan, day, ex)` → aggiunge in fondo, assegna id nuovo.
- `removeExercise(plan, day, id)` → toglie dall'array (i log restano nel dato).
- `reorderExercise(plan, day, fromIdx, toIdx)` → sposta in posizione.
- `updateExercise(plan, day, id, patch)` → modifica campi dell'esercizio.

Tutte pure → coperte da unit test come `store.js` / `session.js`.

## Refactor del keying

Le funzioni che oggi prendono `idx` passano a lavorare per **`id`**:
`getEntry`, `setEntry` (`store.js`); `bestKg`, `exerciseTrend`,
`previousWeekSet`, `previousNote`, `prefillSets`, `sessionVolume`,
`activeExerciseIndex`, `previousSetInSession` (`session.js`). In `app.js` si
itera `dayPlan().exercises` usando `ex.id` invece dell'indice di array. I test
esistenti (~119) vengono aggiornati alle nuove firme.

> Nota: `activeExerciseIndex` può restare "index" come ritorno (serve a sapere
> quale card aprire nell'ordine corrente), ma la **chiave di lettura/scrittura**
> dei log diventa l'id dell'esercizio a quell'indice.

## UI editor

- Apertura: **✎ nell'header**, accanto al ⚙.
- Overlay a tab giorno A/B/C. Righe esercizio con **drag ⠿ (pointer events)**,
  **✎ modifica**, **🗑 elimina**, e **＋ aggiungi** in fondo.
- Dialog "modifica/aggiungi": nome, serie×reps (stringa, es. `3 × 8-10`),
  recupero (testo + secondi), superset sì/no, bilanciere opzionale. Per i
  superset il campo serie×reps usa il formato `A / B` già esistente in `PLAN`.
- Salvataggio: muta `data.plan` → `scheduleSave()` (stesso flusso debounce →
  GitHub dei log).

## Casi limite & sync

- **Eliminare con storico:** log conservati sotto il loro id, non più mostrati;
  nessuna cancellazione → niente perdita accidentale.
- **Conflitti multi-device sulla scheda:** stesso meccanismo
  `ConflictError` → reload → merge già esistente in `saveToCloud`. La scheda è
  piccola, i conflitti sono rari.
- **Cambio superset di un esercizio:** i log esistenti restano validi perché
  `normalizeSupersetEntry` / `normalizeEntry` tollerano entrambe le forme.

## Test & verifica

- **Unit (Node `--test`):** `migrate` (incl. idempotenza e log orfani),
  `editor.js` (add/remove/reorder/update/genId), firme id-based aggiornate in
  `store.js` / `session.js`.
- **Manuale (Playwright + telefono):** modificare un esercizio, riordinare,
  eliminare; verificare che lo storico "settimana precedente" segua
  correttamente l'esercizio **dopo un riordino**.
- **Cache:** bump `sw.js` v17 → v18.

## Rischi

- Refactor del keying tocca molte funzioni: mitigato dai test esistenti e dal
  fatto che sono pure.
- La migrazione deve essere corretta al primo colpo (gira sul dato reale):
  mitigato da idempotenza, guard di versione, test, e dal poco dato esistente.
