# Gym Schedule — Fase 5: serie di riscaldamento vs working set

**Data:** 2026-05-26
**Stato:** design approvato (brainstorming con mockup interattivo). Da qui → piano di implementazione.
**Origine:** ultima voce del backlog §8 di `2026-05-25-ui-redesign-design.md`.

---

## 1. Obiettivo

Permettere di marcare una serie come **riscaldamento** (warmup) e distinguerla dai **working set**.
Le serie di riscaldamento servono a scaldare a carico ridotto e **non sono lavoro effettivo**: vanno
loggate (per memoria e precompilazione) ma **escluse da tutte le metriche** e dal conteggio del target.

L'app si usa col pollice in palestra: la marcatura dev'essere un'azione esplicita e a basso attrito.

## 2. Decisioni (chiuse il 2026-05-26)

1. **Marcatura — pulsante separato (opzione C).** Accanto a `+ serie` un secondo pulsante **`+ riscald.`**
   che aggiunge una serie già marcata come riscaldamento. Esplicito, nessuna ambiguità. (Scartate: toggle
   sul blocco serie corrente; tap sull'indice della riga.)
2. **Effetto sui calcoli — esclusa da tutto.** Una serie di riscaldamento:
   - **non** entra nel **volume di sessione**;
   - **non** entra nei **record (PR / `bestKg`)**;
   - **non** entra nel **trend top-set** (`weekTopKg` / `exerciseTrend`);
   - **non** conta verso il **numero di serie del target** per il completamento dell'esercizio
     (es. `4×6-8` = 4 *working* set; eventuali warmup non riducono né aumentano questo conteggio).
3. **Resa visiva della serie warmup.** Riga **attenuata**, indice mostrato come **`W`** (in verde) al
   posto del numero, badge mono **`RISCALD.`** al posto della marcatura di progressione (`▲ +x`).
   I "pallini serie" (dots) distinguono il warmup con un anello verde anziché pieno.
4. **Riga volume — mostrare anche il totale assoluto precedente.** Oltre alla variazione percentuale,
   la riga `Volume sessione` mostra **in piccolo il totale in kg della settimana scorsa**, perché la
   sola percentuale non è calcolabile a mente. Formato:
   ```
   Volume sessione        2.296 kg
                          −21% · sett. scorsa 2.900 kg
   ```
   La percentuale resta colorata (verde se ≥ 0, arancio se < 0).

## 3. Modello dati

Estensione **non distruttiva** del set per-serie esistente (`{reps, kg, done, feel}`):

```jsonc
{ reps: 8, kg: 40, done: true, feel: "", warmup: true }   // serie di riscaldamento
{ reps: 8, kg: 72.5, done: true, feel: "ok", warmup: false } // working set (default)
```

- Nuovo campo booleano **`warmup`**, default **`false`**.
- `normalizeSet` aggiunge `warmup: !!s?.warmup`. I dati esistenti (senza il campo) restano validi e
  diventano automaticamente working set (`warmup: false`). Nessuna migrazione di file necessaria.

## 4. Logica pura (testabile in Node) — modifiche

Tutte in `store.js` / `session.js`, coperte da `node --test` (il gate del progetto).

### 4.1 `store.js`
- **`normalizeSet`** — aggiungere `warmup: !!s?.warmup` all'oggetto restituito.
- **`prefillSets`** — la mappatura dei set precedenti porta anche `warmup` (oltre a `reps`/`kg`), così
  un'eventuale serie warmup loggata resta coerente per indice. Effetto secondario, ma evita incoerenze.

### 4.2 `session.js`
- **`bestKg`** — saltare i set con `warmup` (un warmup non è mai un PR).
- **`trackVolume`** — saltare i set con `warmup` (oltre al già presente `!s.done`).
- **`weekTopKg`** — saltare i set con `warmup` (di riflesso `exerciseTrend` li esclude, perché ci si
  basa su `weekTopKg`).
- **`trackComplete`** — il target si misura sui **soli working set**:
  completo quando `(numero di working set) >= targetSets` **e** tutte le serie loggate sono `done`
  (un warmup non `done` continua a bloccare il completamento). Vale anche per le tracce superset
  via `isEntryComplete`.
- **`previousSetInSession`** — saltare i set con `warmup`: la chip "ripeti serie sopra" deve ripetere
  l'ultimo **working** set, non un riscaldamento a carico ridotto.
- **`previousWeekSet`** — allineare l'indice ai **soli working set** della settimana precedente
  (i warmup non spostano l'allineamento di `setIndex`).

## 5. UI (`app.js` + `style.css`) — modifiche

Non testata in Node; verifica in browser reale (come da convenzione di progetto).

### 5.1 Pulsante `+ riscald.` (solo esercizi normali, `renderFocusNormal`)
- Accanto al `+ serie` esistente (riga dei dots), un secondo bottone `+ riscald.` con accento verde
  tenue. Al click: `withSet(v, entry.sets.length, { reps: "", kg: "", done: false, warmup: true })`,
  poi `persist(); render()`. Usato a inizio esercizio, il warmup finisce naturalmente in cima.
- **Conservazione del flag:** `withSet` fonde il patch sull'oggetto esistente, quindi `warmup` viene
  preservato quando la serie viene chiusa con "Serie fatta" (la CTA non tocca `warmup`).

### 5.2 `setRow` — resa della serie warmup
- Classe `warm` sulla riga (opacità ridotta, valori in colore secondario).
- Indice reso come `W` (verde) invece del numero.
- Badge `RISCALD.` al posto della marcatura di progressione; **nessun** `▲ +x` / `▼` per i warmup.
- Il toggle del feel/RPE resta invariato (ininfluente sui calcoli; non lo tocchiamo).

### 5.3 Dots
- Il pallino di una serie warmup ha lo stile ad anello verde (`.dt.warm`) invece di pieno.

### 5.4 `buildVolumeRow` — nuovo formato
- Numero grande `<vol> kg`.
- Riga piccola sotto: `<±pct>% · sett. scorsa <prevVol> kg`, con `pct` colorato (verde ≥ 0, arancio < 0).
- Se non c'è volume precedente (`prevVol <= 0`), mostrare solo il numero grande (nessuna riga piccola).
- Vale sia per il render normale sia per il superset (entrambi chiamano `buildVolumeRow`).

## 6. Fuori scope (Fase 5)

- **`+ riscald.` per i superset.** Il render superset (`renderFocusSuperset` / `trackBlock`) non ha un
  pulsante "+ serie" esplicito (le serie seguono target/indice corrente). La **logica** di esclusione
  (volume, PR, trend, completamento) funziona già anche per i warmup nei superset, ma **l'affordance UI
  per marcarli non viene aggiunta in questa fase** (il riscaldamento riguarda soprattutto i fondamentali
  pesanti, che sono esercizi normali). Decisione consapevole, non una svista.
- Distinzione automatica warmup in base al carico (es. "sotto il 50% del top set"): no, è sempre manuale.

## 7. Testing

- **Logica pura:** estendere `tests/store.test.js` e `tests/session.test.js` per coprire tutte le
  modifiche §4 (warmup escluso da volume/PR/trend, target sui soli working set, `normalizeSet.warmup`,
  repeat-helpers che saltano i warmup). Gate: `node --test` verde.
- **UI:** verifica manuale in browser reale (Playwright) — aggiungere un warmup con `+ riscald.`,
  confermare resa attenuata + badge, e che volume / working-set / trend lo escludano; verificare il
  nuovo formato della riga volume (numero + % colorata + totale precedente).
