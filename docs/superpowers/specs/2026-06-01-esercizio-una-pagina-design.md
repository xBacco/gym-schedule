# Esercizio "in una sola pagina" — design

**Data:** 2026-06-01
**Stato:** approvato (layout B)

## Problema

Quando si apre un esercizio nel focus a schermo intero (`#focusOverlay`), il
`focus-body` impila troppi blocchi e su telefono sfora: bisogna scrollare su/giù
per vedere tutto e poi tornare in cima. Obiettivo: tutto l'essenziale visibile
subito, senza scroll, su un telefono medio.

## Decisione

Layout **B — Essenziali + barra icone**. Gli essenziali restano grandi e
leggibili; le azioni secondarie vivono in una barra di icone in fondo al body,
con un cassetto "⋯ Altro" che le espande inline.

### Sempre visibili (nel `focus-body`, in ordine)

1. "ultima volta" (`.trend`)
2. lista serie fatte (`.sets`)
3. input serie corrente (`.editblock`: stepper kg + stepper reps)
4. chip "ripeti sessione / sett. scorsa" (`buildRepeatChips`) — solo quando esistono
5. pallini avanzamento (`.dots`)
6. **barra azioni** (nuova, sempre in fondo al body): `⏱ Recupero · 💬 Commenti · ✗ Fail · ⋯ Altro`

Footer invariato: striscia "prossimo esercizio" + CTA "Serie fatta · avvia recupero ▸".

### Barra azioni (4 tasti)

- **⏱ Recupero** — mostra il valore corrente (es. `90s`); al tocco apre il
  cassetto posizionato sul recupero.
- **💬 Commenti** — apre il dialog commenti rapidi della serie (`openQcDialog`),
  comportamento attuale.
- **✗ Fail** — apre il flusso "Serie non riuscita" (`openSetDialog` con
  `failed`), comportamento attuale del link `.fail-link`.
- **⋯ Altro** — apre/chiude il cassetto.

### Cassetto "⋯ Altro" (collassato di default)

Contiene, inline:
- editor recupero (`buildRestEditor`, lo stepper – 90s +)
- nota esercizio (`buildNoteField`)
- volume esercizio (`buildVolLine`, quando > 0)
- `+ riscaldamento` e `+ serie` (i due `.addset`)

Stato di default: **chiuso** a ogni apertura dell'esercizio. Lo stato del
cassetto è effimero (UI), non persiste tra esercizi né tra sessioni.

## Componenti coinvolti (app.js)

- `renderFocusNormal(ex, idx, container, footer)` — ricomposto: invece di
  appendere tutti i blocchi in colonna, costruisce: trend → sets → editblock →
  repeat chips → dots → cassetto (chiuso) → barra azioni. `buildRestEditor` non
  va più appeso in cima da `renderFocusOverlay`, ma dentro al cassetto.
- `renderFocusOverlay()` — rimuovere `body.appendChild(buildRestEditor(...))`
  dalla cima (il recupero ora vive nel cassetto).
- `renderFocusSuperset(ex, idx, container, footer)` — stessa logica: per ogni
  traccia attiva, barra azioni + cassetto. Spazio più stretto → la barra è
  condivisa a livello di esercizio, il cassetto contiene recupero (comune) +
  nota + volume + add per la traccia corrente.
- Nuovi helper:
  - `buildActionBar({ rest, onRest, onComment, onFail, onMore, drawerOpenRef })`
    — ritorna la riga a 4 tasti.
  - `buildSecondaryDrawer(...)` — ritorna il contenitore `.drawer` (chiuso) con
    recupero/nota/volume/add.
- Stato modulo: una variabile `focusDrawerOpen` (bool, default `false`),
  resettata a `false` quando cambia `openIndex` / `currentDay` / `currentWeek`.

## CSS (style.css)

Nuove classi nello stile Amber CRT (riusano i token esistenti):
- `.actbar` / `.actbtn` (+ `.actbtn.more.open`) — barra azioni in fondo.
- `.drawer` / `.drawer.open` — cassetto collassabile.
- Compattare i margini esistenti dentro `.focus-body` quel tanto che basta.
- `.focus-body` resta `overflow-y:auto` come safety net (schermi molto piccoli /
  cassetto aperto con tanti elementi), ma il default a cassetto chiuso deve
  stare in una schermata su un telefono medio.

## Data flow / persistenza

Nessun cambiamento ai dati o allo store: si tocca solo la composizione del DOM
nel focus overlay e lo stato UI `focusDrawerOpen`. Tutte le azioni
(salvataggio serie, recupero, note, commenti, fail, add) restano quelle attuali
con gli stessi handler.

## Test

- `tests/` è la suite esistente. Aggiungere/adeguare test su:
  - default `focusDrawerOpen === false`;
  - reset del cassetto al cambio esercizio/giorno/settimana;
  - la barra azioni espone i 4 handler corretti.
- I test del logging serie esistenti devono restare verdi (handler invariati).

## Fuori scope

- Nessuna nuova feature di logging.
- Nessun ridisegno di home/calendario/altri overlay.
- Nessuna modifica al modello dati o alla sync.
