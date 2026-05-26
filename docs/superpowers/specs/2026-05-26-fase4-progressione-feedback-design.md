# Gym Schedule — Fase 4: progressione e feedback

**Data:** 2026-05-26
**Stato:** design approvato, da qui → piano di implementazione.
**Riferimenti:** backlog spec redesign `2026-05-25-ui-redesign-design.md` §8; codice live `C:\Users\TomasCoro\gym-schedule`.

---

## 1. Contesto e obiettivo

Le Fasi 1–3 del redesign sono complete e pushate su `main` (modello dati per-serie,
schermata sessione scura con focus card a stepper, sync batch, Wake Lock, PWA, nota per
esercizio, calcolatore dischi). Questo lavoro pesca dal backlog "fuori scope" della spec
redesign (§8) le tre voci scelte dall'utente, tutte al servizio del tema centrale dell'app:
**capire se sto migliorando** (progressione di carico).

In scope per la Fase 4:
- **A — Tag "com'è andata"** (RPE light) per serie.
- **B — "Ripeti serie precedente"**: scorciatoie per richiamare valori già noti.
- **C — Volume di sessione + mini-trend** ultime 3 settimane per esercizio.

Voce **non** inclusa dal backlog §8: distinzione warmup vs working set (rimandata).
La voce §8 "long-press su +/−" risulta **già implementata** (`app.js`, hold su pointerdown).

Vincoli invariati: mobile-first, uso col pollice in palestra, tema scuro `#0E0F0E` + accento
verde `#3FE0A8`, numeri/label in JetBrains Mono. Niente nuove dipendenze. Logica pura testata
con `node --test`; rendering/wiring DOM in `app.js`.

## 2. Modello dati (estensione)

La serie passa da `{reps, kg, done}` a `{reps, kg, done, feel}`:

```jsonc
"A:01": {
  sets: [
    { reps: 8, kg: 72.5, done: true, feel: "ok" },
    { reps: 8, kg: 72.5, done: true, feel: "hard" }
  ],
  note: ""
}
```

- `feel ∈ {"", "easy", "ok", "hard"}`, default `""` (= non valutata).
- **Migrazione non distruttiva:** ogni serie esistente senza `feel` viene normalizzata a `""`.
  Nessuna scrittura forzata sui dati storici; `feel` compare solo quando l'utente lo imposta.
- Nessun altro campo nuovo. Volume e trend sono **derivati** dai dati esistenti, non persistiti.

## 3. Feature A — Tag "com'è andata" (RPE light)

### 3.1 Comportamento
- Ogni serie ha un'autovalutazione a 3 livelli: **facile / giusta / dura** (`easy`/`ok`/`hard`).
- Si imposta con un tap, senza tastiera. È opzionale: una serie può restare senza tag (`""`).
- Granularità: **per serie** (non per esercizio).

### 3.2 Dato e logica
- `normalizeSet(s)` (in `store.js`) estesa per includere `feel`: valore tra i quattro ammessi,
  qualsiasi altro input → `""`. Retrocompatibile con serie prive del campo.
- `withSet(entry, index, patch)` (in `session.js`) è già generica: `withSet(e, i, {feel})`
  imposta il tag preservando il resto. Nessuna nuova funzione di logica necessaria.

### 3.3 UI (`app.js` + `style.css`)
- **Serie corrente:** tre pulsanti `facile / giusta / dura` nel blocco input (sotto lo stepper,
  prima del CTA). Tap → `withSet(..., {feel})`, lo stato attivo è evidenziato. Tap sul tag già
  attivo lo deseleziona (torna a `""`).
- **Serie già fatte:** chip colorato a destra della riga serie, **tappabile** per correggere al
  volo (coerente con §9.4 della spec redesign "serie chiuse modificabili al tocco").
- **Colori (3 nuove classi CSS):** `easy` azzurro freddo, `ok` verde-accento, `hard` ambra.
  Contrasto adeguato su fondo scuro, niente riempimenti pieni (solo testo + bordo sottile).
- Per i **superset**, il tag vale per la serie della traccia attiva (A o B), stesso modello.

### 3.4 Test (`node --test`)
- `normalizeSet`: preserva `feel` valido; mappa valori non ammessi a `""`; serie legacy → `""`.
- `withSet`: imposta `feel` senza alterare `reps`/`kg`/`done`; lo stesso per `withSupersetSet`.

## 4. Feature B — "Ripeti serie precedente"

### 4.1 Comportamento
Nel blocco input della serie corrente compaiono fino a due chip, **mostrate solo se il rispettivo
valore esiste**:
1. **`↑ serie sopra`** — `reps,kg` dell'ultima serie *done* della stessa traccia in questa sessione.
2. **`↶ scorsa Wxx`** — `reps,kg` della stessa serie (stesso indice) della settimana precedente
   con dato; `Wxx` mostra la settimana di provenienza.

Tap su una chip → precompila **sia il carico sia le ripetizioni** della serie corrente (riempie lo
stepper, l'utente può poi aggiustare col +/−). Non chiude la serie: è solo precompilazione.

Razionale (dall'utente): con 3 serie di panca il carico varia poco; poter richiamare con un tap il
valore della serie precedente o della settimana scorsa rende immediato capire se si sta migliorando.

### 4.2 Logica pura nuova (`session.js`)
- `previousSetInSession(entry, index, track = null)` → `{reps, kg}` dell'ultima serie con indice
  `< index` che sia `done`, altrimenti `null`. Con `track` (`"a"`/`"b"`) opera sulla traccia
  indicata del superset; senza, sull'entry normale.
- `previousWeekSet(data, day, idx, weekKey, setIndex)` → `{reps, kg}` della settimana precedente
  con dato per quell'esercizio (riusa il pattern di scansione di `previousNote`: chiavi `YYYY-Www`
  ordinate, `< weekKey`, dalla più recente). Ritorna il set a `setIndex` se esiste, altrimenti
  l'ultimo set disponibile di quella settimana; `null` se nessuna settimana ha dati.

Entrambe ritornano stringhe coerenti col modello (`reps`/`kg` come stringhe, come `normalizeSet`).

### 4.3 UI (`app.js`)
- Render delle chip nel blocco input solo quando la funzione corrispondente ritorna un valore.
- Tap → applica il valore allo stato locale dello stepper della serie corrente (stesso percorso
  della precompilazione esistente da §4.2 della spec redesign), senza scrivere subito su `done`.

### 4.4 Test (`node --test`)
- `previousSetInSession`: ritorna l'ultima done precedente; salta le non-done; `null` se nessuna;
  rispetta l'indice; variante superset per traccia.
- `previousWeekSet`: trova la settimana precedente con dato; salta settimane vuote; fallback
  all'ultimo set se l'indice non esiste; `null` senza storico.

## 5. Feature C — Volume di sessione + mini-trend

### 5.1 Volume di sessione
- **Definizione:** Σ `reps × kg` su tutte le serie *done* di tutti gli esercizi del giorno corrente
  (per i superset somma entrambe le tracce). Non esistendo la distinzione warmup/working, tutte le
  serie done contano.
- **Confronto:** stessa metrica calcolata sullo stesso `day` della settimana precedente → delta %
  (`null`/nascosto se manca lo storico o il volume precedente è 0).
- **Posizione (UI):** riga **in fondo alla focus card**, sotto il CTA. Totale "running" che cresce a
  ogni serie chiusa, con il delta % a destra (verde se ≥ 0).
- **Logica pura nuova (`session.js`):** `sessionVolume(data, weekKey, day, dayPlan)` → numero (kg).
  Itera gli esercizi del `dayPlan`, normalizza ogni entry (normale o superset), somma
  `reps×kg` delle serie `done` con `reps` e `kg` numerici (usa il parsing tollerante alla virgola
  già presente, come in `bestKg`).

### 5.2 Mini-trend per esercizio
- **Definizione:** per l'esercizio in focus, mostra il **top-set (kg max)** delle ultime 3 settimane
  con dato: `W20 67.5 · W21 70 · W22 72.5` (numeri mono, settimana corrente evidenziata in accento).
- **Posizione (UI):** riga compatta nella focus card, sotto nome/target dell'esercizio.
- **Logica pura nuova (`session.js`):** `exerciseTrend(data, day, idx, weekKey, n = 3)` →
  array (max `n`) di `{week, kg}` per le ultime `n` settimane `≤ weekKey` che hanno almeno una serie
  con kg numerico; `kg` = massimo kg loggato in quella settimana per quell'esercizio (stessa logica
  per-set di `bestKg`, ma ristretta a una settimana). Salta le settimane senza dato. Ordine
  cronologico crescente. Gestisce normale e superset.

### 5.3 Test (`node --test`)
- `sessionVolume`: somma corretta normale; somma entrambe le tracce nei superset; esclude serie non
  done e valori non numerici; `0` se niente done.
- `exerciseTrend`: ritorna ≤ `n` voci; salta settimane vuote; usa il top-set corretto; ordine
  crescente; vuoto senza storico.

## 6. Note di qualità (baseline)
- Tap target ≥ 44px per i pulsanti tag e le chip "ripeti".
- Contrasto dei tag colorati su fondo scuro ≥ ~4.5:1 dove conta la leggibilità.
- Nessuna nuova dipendenza, nessun asset: tutto generato/calcolato a runtime.
- Numeri grandi (volume) con separatore migliaia per leggibilità (es. `3 480 kg`).

## 7. Esecuzione
Subagent-driven come la Fase 3: per ogni task implementer → spec review → code-quality review;
review olistica finale con Opus; commit + push su `main` (convenzione progetto, no PR).
`node --test` è il gate (suite attuale: 76 test; la Fase 4 la estende).

## 8. Fuori scope (resta in backlog)
- Distinzione serie di riscaldamento vs working set (esclusa esplicitamente in questa fase).
- "Ripeti serie precedente" su long-press dedicato (qui è una chip a tap singolo).
- Trend grafico (sparkline/barre): scelta confermata sui **soli numeri mono**.
