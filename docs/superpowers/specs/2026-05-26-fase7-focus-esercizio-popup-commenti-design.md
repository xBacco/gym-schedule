# Fase 7 — Focus esercizio a schermo intero + popup commento veloce

Data: 2026-05-26
Stato: approvato dall'utente (design), pronto per il piano di implementazione.

## Obiettivo

Due interventi UX sulla schermata sessione di gym-schedule:

1. **Focus mode a schermo intero**: toccando un esercizio si apre un overlay che
   occupa tutto lo schermo, blocca lo scroll e tiene l'utente concentrato su
   quell'esercizio finché non lo completa o lo chiude esplicitamente.
2. **Commento veloce in popup**: i chip dei commenti, oggi sempre visibili inline
   (ingombranti), diventano un singolo bottone che apre un popup con i tag.

Nessuna modifica al modello dati: il campo `comments: string[]` per serie esiste già
(Fase 6). I preset restano gestiti in Impostazioni.

## Decisioni prese (confermate con mockup interattivo)

- **Scroll**: *blocco totale*. Dentro il focus non si scrolla; il contenuto deve
  stare in una schermata.
- **Uscita**: freccia ← sempre presente in alto a sinistra **+** ritorno automatico
  alla lista quando l'esercizio è completato (tutte le serie working fatte).
- **Popup commenti**: *applica subito*. Ogni tap su un tag lo attiva/disattiva
  all'istante sulla serie corrente; si chiude toccando fuori o la ←. Nessun
  bottone "Fatto".

## A. Focus mode a schermo intero

### Comportamento
- La lista (`#list`) resta sempre a righe collassate. Toccare una riga apre un
  **overlay dedicato** (non più l'espansione inline nella fisarmonica).
- L'overlay copre header, tab giorni, progress e lista.
- **Scroll bloccato**: il `body`/contenitore sotto non scrolla mentre l'overlay è
  aperto; il pannello dell'esercizio non ha scroll interno (blocco totale).
- **Struttura overlay**:
  - *Header fisso*: pulsante ← (chiudi), nome esercizio, indicatore "serie X / Y".
  - *Corpo* comprimibile: stepper kg/reps, feel (facile/giusta/dura), bottone
    commento veloce, chip "ripeti serie", riga trend (se presente).
  - *Footer ancorato in basso*: pulsante "Salva serie" sempre raggiungibile.
- **Uscita**:
  - ← chiude l'overlay e torna alla lista (stato esercizio invariato).
  - Al salvataggio dell'ultima serie working (esercizio completo) l'overlay si
    chiude automaticamente e si torna alla lista.

### Superset (traccia A + B)
È il caso più alto. Per rispettare il blocco totale, il focus di un superset usa
**sotto-tab A / B** interni: si mostra una traccia per volta, mantenendo header e
footer condivisi. Il salvataggio segue la traccia attiva; l'esercizio è completo
quando entrambe le tracce hanno le serie working fatte.

### Fitting senza scroll
- Footer "Salva serie" in `position` ancorata in basso all'overlay.
- Corpo centrale con spaziatura condensata; gli elementi opzionali (trend,
  ripeti-serie) restano ma compatti.
- Target: contenuto visibile su schermi telefono comuni (~640px+ di altezza utile)
  senza scroll, sia per esercizi normali sia per superset (grazie ai sotto-tab).

## B. Commento veloce → popup

### Comportamento
- Sotto i feel chip, un solo bottone **"💬 commento veloce (n)"** dove `n` è il
  numero di tag attivi sulla serie corrente; quando `n > 0` si mostrano i tag
  scelti in piccolo sotto il bottone.
- Tap sul bottone → apre un **popup** (riusa lo stile `<dialog>` già in
  `style.css`) con la lista dei tag preset come toggle + voce "＋ scrivi…".
- **Applica subito**: ogni tap su un tag chiama `toggleComment` sulla bozza della
  serie corrente e aggiorna lo stato immediatamente. Il popup si chiude toccando il
  backdrop o la ←/× ; nessun bottone di conferma.
- "＋ scrivi…" apre l'input testo (può restare `prompt()` per ora) e aggiunge il
  commento libero, anch'esso applicato subito.
- La **modifica dei commenti su una serie già salvata** (oggi via `prompt()` con
  separatore `;`) viene instradata sullo stesso popup, salvando immediatamente sulla
  serie.
- La **gestione preset** in Impostazioni resta invariata.

## Componenti toccati

- `app.js`: rendering/wiring di overlay focus, lock scroll, sotto-tab superset,
  bottone+popup commenti, ritorno automatico a fine esercizio. È il grosso del
  lavoro.
- `style.css`: stili overlay a schermo intero, header/footer ancorati, popup
  commenti.
- `index.html`: eventuale contenitore radice dell'overlay e del popup, se serve.
- `sw.js`: bump cache `gymsched-v4` → `gymsched-v5`.

## Testing

Coerente con le convenzioni del progetto: la logica pura sta già in
`store.js`/`session.js` (testata con `node --test`) e non cambia. Questi interventi
sono quasi interamente rendering/wiring DOM in `app.js`, quindi la verifica è in
**browser reale via Playwright** (server HTTP locale, ES modules):
- apertura overlay a tutto schermo, scroll bloccato (lista dietro ferma);
- ← chiude; completare l'ultima serie chiude da solo;
- superset: sotto-tab A/B, completamento su entrambe le tracce;
- popup commenti: tap applica subito, conteggio sul bottone, chip riepilogo;
- nessuna regressione su salvataggio/sync e su `node --test` (resta verde).

## Fuori scope

- Editor in-app dei target serie/reps (resta in `plan.js`).
- Gesture di swipe per cambiare esercizio (esplicitamente non voluta: focus pieno).
- Modifiche al modello dati o alla sincronizzazione.
