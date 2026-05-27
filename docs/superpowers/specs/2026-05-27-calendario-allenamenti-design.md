# Sezione calendario allenamenti

Data: 2026-05-27

## Obiettivo

Una vista calendario mensile che mostra i giorni in cui l'utente si è allenato.

## Vincolo dei dati (verificato)

Il modello dati indicizza le sessioni per **settimana ISO** + **giorno scheda A/B/C**:

```
data.weeks["2026-W21"].entries["A"]["<exId>"] = { sets:[…], note }
```

Il timestamp passato a `setEntry` finisce solo in `data.updatedAt` (campo globale
unico, sovrascritto a ogni salvataggio). **Oggi non viene salvata la data reale di
nessun allenamento.** Dallo storico esistente si ricava solo la settimana, non il
giorno esatto.

## Decisioni (brainstorming)

1. **Date reali da ora in poi.** Si inizia a salvare la data vera a ogni log;
   calendario mensile con i giorni segnati. Lo storico passato (senza date) **non**
   appare nel calendario — resta visibile nel grafico progressione (forward-only).
2. **Tap su un giorno segnato → dettaglio:** giorno scheda (A/B/C) + volume totale
   della sessione. Sola lettura, resta nel calendario.

## Architettura

### Cattura della data

Estendere `setEntry(data, weekKey, day, exIndex, value, nowIso)` in `store.js` per
registrare la data della sessione, *set-if-absent*:

```js
if (!next.weeks[weekKey].dates) next.weeks[weekKey].dates = {};
if (next.weeks[weekKey].dates[day] == null && nowIso) {
  next.weeks[weekKey].dates[day] = nowIso.slice(0, 10); // "YYYY-MM-DD"
}
```

- Tutti i percorsi di log passano già da `setEntry(..., new Date().toISOString())`,
  quindi un solo punto cattura tutto.
- *Set-if-absent*: la data resta quella della prima serie loggata; le modifiche
  successive non la spostano.
- Campo `dates` additivo → nessuna migrazione. Lo storico passato non ha `dates`
  (calendario vuoto nel passato = forward-only, come deciso).
- **Limite noto e accettato:** i log offline applicati da `applyPending` (riga ~262)
  prenderebbero la data di *applicazione*, non di log. Scarto accettato per ora.

### Funzioni pure (in `session.js`, testabili con `node --test`)

- `sessionDates(data)` → `[{ date, weekKey, day }]` estratto da `weeks[].dates`,
  ordinato per data. Ignora le settimane senza `dates`.
- `monthGrid(year, month)` → matrice di settimane (righe), ognuna 7 celle allineate
  Lun→Dom; celle dei bordi mese = `null`. `month` 0-based (come `Date`).
- Volume del dettaglio: riuso `sessionVolume(data, weekKey, day, dayPlan)` esistente.

### Rendering (in `app.js`)

Overlay a schermo intero, stesso pattern history degli altri (focus/alimentazione/
editor):

- flag `calendarOpen`, `calendarMonth` (anno+mese visualizzati, default mese corrente).
- `openCalendar()`: `pushState({ gymCalendar: true })` + render.
- `closeCalendar()`: se `history.state.gymCalendar` → `history.back()` (chiude in
  `popstate`), altrimenti chiude diretto.
- aggiungere `calendarOpen` al gestore `popstate` (già toccato dal fix back-button) e
  alla logica `document.body.style.overflow`.

Griglia mensile:

- intestazioni `L M M G V S D`, frecce `‹ ›` per cambiare mese, default mese corrente.
- celle dei giorni; un giorno con una sessione (presente in `sessionDates`) è colorato
  con l'accento del tema (`--acc`).
- tap su un giorno segnato → pannello dettaglio sotto la griglia: data leggibile,
  giorno scheda (A/B/C) e volume totale (`sessionVolume`). Se più sessioni nello stesso
  giorno (settimana + sotto-settimana sullo stesso giorno scheda è raro), elencarle.

### Markup / CSS

- `📅 #calendarBtn` nell'header (`index.html` riga ~32, accanto a `🥗 ✎ ⚙`).
- `#calendarOverlay` con header (titolo + frecce mese + chiusura) e corpo griglia.
- CSS in `style.css` con le variabili tema reali (`--acc/--dim/--surf2/--bg`), nessuna
  dipendenza esterna.

## Flusso dati

1. Utente logga una serie → `setEntry(..., nowIso)` → stampa `weeks[wk].dates[day]`
   set-if-absent.
2. Apertura calendario → `sessionDates(data)` raccoglie tutte le date → `monthGrid`
   costruisce la griglia del mese → render colora i giorni allenati.
3. Tap su giorno → trova la voce in `sessionDates` per quella data → mostra
   `sessionVolume(data, weekKey, day, dayPlan)` nel pannello dettaglio.

## Error handling

- Mese senza sessioni: griglia normale, nessun giorno colorato, nessun crash.
- `dates` assente (storico vecchio): `sessionDates` lo salta.
- Giorno scheda non più nella scheda corrente: il dettaglio mostra A/B/C + volume
  comunque calcolabili dalle entries salvate.

## Out of scope

- Date reali per lo storico passato (non registrate).
- Modifica/cancellazione di una sessione dal calendario (sola lettura).
- Aprire/rivedere la sessione completa dal calendario (scelta: solo dettaglio).

## Verifica

- Unit test (`node --test`) per `sessionDates` e `monthGrid`.
- Test che `setEntry` stampi `dates[day]` set-if-absent.
- Verifica browser Playwright: log di una serie → il giorno appare colorato nel mese
  corrente → tap → dettaglio con A/B/C e volume.
- Bump cache `gymsched-v22` (condiviso col fix back-button).
