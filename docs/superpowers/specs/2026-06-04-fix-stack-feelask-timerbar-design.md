# Fix sovrapposizione striscia giudizio / barra timer — stack in basso — Design

**Data:** 2026-06-04
**Origine:** screenshot dell'utente: con il timer a due righe attivo, la striscia «com'è andata?» finisce sotto la barra.
**Mockup:** `.superpowers/brainstorm/28112-1780576234/content/fix-timer-feelask-varianti.html` — scelta la **variante B (stack)** dopo aver scartato A/C/D/E/F e le tre alternative "zero disturbo" G/H/I (`fix-timer-giudizio-zero-disturbo.html`). Decisione dell'utente: si tiene l'impostazione attuale (pannello-domanda + auto-chiusura dopo il tap), si corregge solo il posizionamento.

## Problema oggi

- `.feelask` (`style.css:572`): `position:fixed; bottom:74px; z-index:55` — il `74px` era tarato sulla vecchia barra a una riga.
- `.timerbar` (`style.css:200`): `position:fixed; bottom:0`, oggi due righe (~96-100px reali, di più nello stato GO) e `z-index:60` dentro il focus (`style.css:492`), quindi **sopra** la striscia (55).
- Risultato: timer attivo + striscia visibile → la striscia si infila sotto la barra e resta mezza coperta.

## Nuovo: contenitore unico `#bottomStack`

I due elementi smettono di essere fissati indipendentemente con numeri magici: un solo wrapper fisso in basso, figli in colonna. La striscia sta sempre appoggiata sopra la barra, qualunque altezza abbiano entrambe — la sovrapposizione diventa impossibile per costruzione.

### Markup (`index.html`)

`#feelAsk` (oggi a riga 404, prima del drawer) si sposta accanto a `#timerBar` (426), dentro il wrapper:

```html
<div id="bottomStack">
  <div id="feelAsk" class="feelask hidden">…</div>
  <div id="timerBar" class="timerbar hidden">…</div>
</div>
```

Il contenuto interno dei due blocchi non cambia di una virgola.

### CSS (`style.css`)

- **Nuova regola** `#bottomStack{position:fixed;left:50%;transform:translateX(-50%);bottom:0;width:100%;max-width:440px;z-index:60;display:flex;flex-direction:column;}` — assorbe il posizionamento oggi duplicato nei due figli. `z-index:60` è quello attuale della barra (sta sopra il focus overlay, z-40). Con entrambi i figli `.hidden` lo stack è alto 0: invisibile e non intercetta tap.
- `.feelask` (`:572`): perde `position/left/transform/bottom/width/max-width/z-index`; resta un blocco statico largo 100% con la sua grafica (bordo accento, ombra, padding).
- `.timerbar` (`:200`): perde `position/left/transform/bottom/width/max-width`; restano sfondo, bordo, padding, `backdrop-filter`. La regola `.timerbar{z-index:60}` (`:492`) si elimina (la z la dà lo stack). Stato `go-on` (`:217`) invariato.
- **Spazio riservato nel focus:** oggi `body.timer-on .focus-body{padding-bottom:196px}` (`:597`). Con lo stack le altezze si sommano (barra ~100px + striscia ~85px, ~120px su superset). Nuove regole:
  - `body.timer-on .focus-body{padding-bottom:196px}` — invariata (solo timer);
  - `body.feel-on .focus-body{padding-bottom:160px}` — sola striscia (la striscia superset a due tracce è ~150px reali);
  - `body.timer-on.feel-on .focus-body{padding-bottom:300px}` — entrambi visibili.

### JS (`app.js`)

- `showFeelAsk` (`:1906`): aggiunge `document.body.classList.add("feel-on")`.
- `hideFeelAsk` (`:1957`): `remove("feel-on")`.
- Nient'altro. Comportamento della striscia **invariato**: stessa domanda, stessi chip, auto-chiusura ~1.2s dopo il tap (`scheduleFeelAskClose`), avanzamento all'esercizio dopo, doppia traccia A/B sui superset. La barra già usa `.hidden` + `body.timer-on` (`:1235`, `:1247`).

## Casi coperti per costruzione

- Timer due righe + striscia singola → striscia sopra la barra.
- Superset (striscia a due tracce, più alta) → idem, lo stack si allarga da solo.
- Stato GO «vai →» (barra più alta) + striscia ancora aperta → idem.
- Striscia senza timer (timer chiuso/scaduto) → striscia a filo schermo.
- Solo timer → come oggi, a filo schermo.

## Non-obiettivi

- Nessun cambio a grafica o contenuto di striscia e barra.
- Nessun cambio alla logica del giudizio (tempi, avanzamento, superset).
- Drawer, `#updateBanner`, safe-area: invariati.

## Test

La suite (`npm test`, 332 verdi) copre moduli puri senza DOM: per un fix di solo layout non ci sono test automatici sensati da aggiungere. Criterio: suite invariata verde + verifica manuale sotto.

## Verifica manuale

1. Serie fatta → timer parte, striscia appare **sopra** la barra, niente sovrapposizione (era il bug).
2. Tap su un giudizio → evidenziato ~1.2s → striscia si chiude da sola.
3. Superset: due tracce A/B visibili per intero sopra la barra.
4. Timer arriva a 0 con striscia aperta → boot-log GO sotto, striscia sopra, entrambi leggibili.
5. ✕ sul timer con striscia aperta → striscia scende a filo schermo.
6. Solo striscia / solo timer / nessuno dei due (stack alto 0, la pagina sotto resta cliccabile).
7. Con entrambi visibili, le note in fondo al focus restano raggiungibili scrollando (padding).
8. Entrambi i temi (Carta / Graphite).
