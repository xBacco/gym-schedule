# Fix back-button sui dialog (finding C2)

Data: 2026-05-27

## Problema

L'app usa due meccanismi per i layer sovrapposti:

- **3 overlay a schermo intero** (focus esercizio, guida alimentazione, editor scheda)
  sono registrati nella history con `pushState`. Il tasto "indietro" di Android fa
  scattare `popstate`, dove avviene la chiusura. Funziona.
- **4 `<dialog>` nativi** (`chartDialog`, `setDialog`, `exDialog`, `qcDialog`) usano
  `showModal()`/`close()`. Rispondono a Esc (evento `cancel`) e al tap sul backdrop,
  ma **non** sono registrati nella history.

Quando un dialog è aperto sopra un overlay (es. il grafico sopra il focus), il tasto
"indietro" non chiude il dialog: fa scattare `popstate`, che chiude l'**overlay sotto**,
lasciando il dialog sospeso nel vuoto. È il finding C2 della review della vista
progressione.

## Contesto di apertura (verificato)

Ogni dialog si apre **sempre sopra un overlay** già registrato nella history:

- `chartDialog`, `setDialog`, `qcDialog` → sopra il focus esercizio (`gymFocus`)
- `exDialog` → sopra l'editor scheda (`gymPlan`)

Nessun dialog si apre sopra la vista principale nuda. Sotto ogni dialog c'è quindi
sempre una voce di history dell'overlay.

## Comportamento atteso

Standard Android: un "indietro" chiude **solo il layer in cima** (il dialog); un
secondo "indietro" chiude l'overlay sotto.

## Soluzione (approccio A — guardia centralizzata)

Un solo punto di modifica: il gestore `popstate` in `app.js` (attuale ~riga 1760).

I dialog **non** vengono registrati nella history (nessuna modifica ai loro percorsi
di apertura/chiusura: bottoni, backdrop ed Esc restano identici). Nel `popstate`,
prima di gestire gli overlay:

```js
window.addEventListener("popstate", () => {
  // Un dialog modale è sempre il layer in cima: il tasto indietro chiude quello,
  // non l'overlay sotto. Lo richiudiamo e ripristiniamo la voce di history
  // dell'overlay sottostante (che il back ha appena consumato), così resta aperto
  // e un secondo "indietro" lo chiuderà.
  const openDlg = [...document.querySelectorAll("dialog[open]")].pop();
  if (openDlg) {
    openDlg.close();
    if (planOpen) history.pushState({ gymPlan: true }, "");
    else if (nutritionOpen) history.pushState({ gymNutrition: true }, "");
    else if (openIndex !== null) history.pushState({ gymFocus: true }, "");
    return;
  }
  if (openIndex !== null) { hideFeelAsk(); openIndex = null; render(); }
  if (nutritionOpen) { nutritionOpen = false; renderNutritionOverlay(); }
  if (planOpen) { planOpen = false; renderPlanEditor(); }
});
```

`querySelectorAll(...).pop()` prende l'ultimo dialog aperto in ordine DOM (robustezza
difensiva nel caso improbabile di dialog annidati; in pratica ne è aperto uno solo).

### Flussi verificati

1. **Android back, dialog sopra overlay:** back consuma la voce dell'overlay →
   `popstate` → dialog aperto → lo chiude e ri-pusha la voce dell'overlay. Overlay
   resta visibile, dialog chiuso. Secondo back → nessun dialog → chiude l'overlay. ✓
2. **Chiusura normale (bottone/backdrop/Esc):** chiama `dlg.close()` direttamente,
   nessuna modifica alla history. Dialog chiuso, overlay invariato, voce di history
   ancora presente. Nessun doppio scatto perché questi percorsi non toccano la
   history. ✓
3. **`setDialog` con azioni:** i bottoni impostano `setDlgAction` poi `dlg.close()` —
   percorso invariato, l'azione viene letta come prima. Solo il percorso Android-back
   passa da `popstate` → `dlg.close()`: in quel caso `setDlgAction` deve risolvere
   come "cancel" (da verificare in fase di piano: assicurarsi che il default in
   chiusura sia "cancel", come già fa l'handler `cancel`/backdrop).
4. **`exDialog` sopra editor:** back → chiude il dialog (scarta l'input non salvato,
   come il backdrop), ri-pusha `gymPlan`. ✓

## Out of scope

- Dialog sopra la vista principale nuda (non esiste questo caso oggi).
- Refactor a layer-stack (sproporzionato).

## Verifica

Comportamento history/DOM, non unit-testabile con `node --test`. Verifica browser
Playwright: aprire grafico sopra focus → `history.back()` → il grafico si chiude e il
focus resta; secondo `history.back()` → il focus si chiude. Ripetere per `setDialog`
(con azione = cancel) ed `exDialog` sopra l'editor. Bump cache `gymsched-v22`.
