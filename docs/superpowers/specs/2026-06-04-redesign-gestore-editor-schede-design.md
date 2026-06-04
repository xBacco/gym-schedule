# Redesign gestore schede (B-terminale) + editor scheda (1-tab-evolute)

Data: 2026-06-04
Stato: approvato dall'utente (brainstorming via mockup interattivi)

## Obiettivo

Riallineare i due overlay "Schede" (`#sheetsOverlay`) e "Modifica scheda" (`#planOverlay`)
al linguaggio CRT/terminale già adottato da calendario e Database esercizi.
Solo UI e micro-interazioni: **nessun cambio al modello dati né alle mutazioni**.

Mockup di riferimento (storia decisionale):
- varianti: `.superpowers/brainstorm/25605-1780567505/content/gestore-varianti.html` (scelta B "Terminale") e `editor-varianti.html` (scelta 1 "Tab evolute")
- design consolidato e approvato: `.superpowers/brainstorm/30021-1780580444/content/design-finale-gestore-editor.html`
- in fase di implementazione copiare il consolidato in `mockups/gestore-editor-rev1.html` (convenzione repo: mai riusare nomi).

## Decisioni chiave (approvate)

1. **Nomi schede a slug** stile directory (`focus-alto/`) — *solo display*; il nome reale
   resta invariato nel modello e nei prompt di rinomina.
2. **Ordinamento gestore**: scheda attiva sempre prima; archivio per ultima sessione
   decrescente (mai usate in fondo).
3. **Rinomina / importa / conferme** restano su `window.prompt` / `window.confirm` (come oggi).
4. **Modello dati intatto**: `sheets.js` (mutazioni e schema 6), `editor.js`, store/sync,
   drag-riordino, dialog esercizio, pattern history/popstate — tutti invariati.
5. Entrambi i temi (Carta default + Graphite) gratis via i token CSS esistenti
   (`--surf`, `--line`, `--acc`, `--field`, `--acc-soft`, `--line-acc`, …): nessun colore hard-coded.

## Gestore schede — variante B "Terminale"

### Struttura (dall'alto in basso)

1. Riga prompt: `$ ls schede/ --sort=ultima` (testo statico, classe stile `db-prompt`).
2. **Blocchi scheda ad accordion** — uno espanso alla volta, default = scheda attiva:
   - **Header** (sempre visibile, tap = espandi/chiudi): freccia `▸` (espansa, accent) /
     `▹` (chiusa, faint) · nome slug in grassetto · a destra il tag `ATTIVA` (bordo accent)
     oppure, per l'archivio chiuso, meta compatta `3g · 20 es · ult 26.05`.
   - Formato date (ovunque nel gestore): `oggi` se è oggi; `DD.MM` se anno corrente;
     `DD.MM.YY` altrimenti; `mai usata` se `lastDate` è null.
   - **Corpo espanso**:
     - lista giorni: lettera del giorno (accent, bold) + titolo giorno in minuscolo +
       `N es` (faint) — dati veri presi dal plan della scheda;
     - riga meta con bordo dashed sopra: `ult <data|oggi|mai usata> · N settimane loggate`;
     - riga azioni (bottoni compatti stile terminale):
       - scheda attiva: `✎ modifica` (primaria, fondo accent) · `rinomina` · `⧉ duplica` · `rm` (rosso);
       - scheda archivio: `↪ attiva` (primaria) · `rinomina` · `⧉ duplica` · `rm`.
     - `rm` visibile solo se esistono ≥ 2 schede; chiede conferma (testo attuale).
3. Riga hint: `› tap su una scheda per aprirla`.
4. Riga nuova in fondo (3 bottoni dashed, flex): `$ nuova` · `$ duplica` · `$ importa`.

### Comportamenti

- Tap sull'header del blocco espande/chiude (i bottoni interni fermano la propagazione).
  Stato di espansione in variabile di modulo, reset all'apertura del gestore (attiva espansa).
- `✎ modifica`: chiude il gestore e apre l'editor (meccanismo `sheetsPending` attuale).
- `↪ attiva`: `setActiveSheet` su quella scheda (resta nel gestore, re-render).
- `⧉ duplica` nel blocco duplica *quella* scheda; `$ duplica` in fondo duplica l'attiva
  (comportamenti attuali di `renderSheets`).
- `$ nuova` / `$ importa`: handler attuali (scheda vuota / `importSheetPrompt`).

### Dati derivati (helper puri, testati)

- `sheetSummaries` (sheets.js) esteso con un campo **additivo** `dayLines:
  [{ day, title, count }]` per scheda — sola lettura, nessun impatto su schema/mutazioni;
  i campi esistenti restano identici (i test attuali non cambiano).
- Ordinamento: helper puro in sheets.js accanto a `sheetSummaries`
  (attiva prima, poi `lastDate` desc, `null` in fondo).
- `sheetSlug(name)`: slug display-only analogo a `goSlug` ma con separatore `-`
  e fallback `scheda` (es. `Focus alto` → `focus-alto`). Suffisso `/` aggiunto dal render.

## Editor scheda — variante 1 "Tab evolute"

### Struttura

1. Header overlay invariato; il sottotitolo `#planSub` diventa
   `<slug> · N giorni · M es` (es. `focus-alto · 3 giorni · 22 es`).
2. **Tab giorni**: lettera grande + sotto il titolo del giorno abbreviato
   (mini-label, una riga, ellipsis CSS). Tab attiva a fondo accent. Tab `＋` invariata.
   - `tabMiniLabel(title)`: helper puro — minuscolo, split su `[/·,+]`, trim,
     ogni parte troncata a 5 caratteri, join con `·` (es. `Petto · Tricipiti · Laterali`
     → `petto·trici·later`); l'ellipsis CSS copre i casi ancora lunghi.
3. **Barra giorno** sotto le tab: titolo intero `A — Petto · Tricipiti · Laterali`
   (ellipsis se lungo) + due bottoni compatti `✎` / `🗑` (handler attuali
   `renamePlanDay` / `deletePlanDay`).
4. **Righe esercizio** (`.pe-row` ridisegnata):
   - numero progressivo `01`…`NN` (faint) · grip `⠿` (drag invariato) · blocco nome+sub ·
     icone `✎` / `🗑` (handler attuali);
   - nome: se superset, badge `SS` compatto al posto dell'attuale `SUPERSET`;
     se il nome contiene `+`, il separatore è renderizzato in accent (`Pushdown ＋ Curl`);
   - sub-riga: `setsReps · rec m:ss · bilanciere Xkg · vol ×2 · a tempo` dove
     `rec` è `formatTime(restSeconds)` (timer.js); se `restSeconds` non è numerico
     (es. schede importate) fallback su `recText`, e se manca anche quello il
     segmento `rec` viene omesso. `recText` non è più mostrato nell'editor
     (resta nel modello e nelle altre viste).
5. Bottone `＋ aggiungi esercizio` dashed (handler attuale).
6. Stato vuoto (nessun giorno): testo attuale, ristilizzato come riga prompt.

### Cosa non cambia nell'editor

Dialog esercizio (`#exDialog`), drag-to-reorder (pointer events), gestione giorni
(`addDay`/`renameDay`/`removeDay` via prompt/confirm), pattern history.

## CSS

- Nuove classi per il gestore (es. `.sh-blk`, `.sh-acts`, `.sh-new`) in sostituzione di
  `.sheet-card`/`.sheet-btn`/`.sheet-newrow`; editor: restyle di `.pe-row` + nuova `.pe-ix`
  (numero riga) e mini-label nelle tab. Le classi CSS morte vanno rimosse.
- Solo token semantici esistenti: i due temi funzionano senza regole dedicate.
- Niente interferenze con `fx-glow`/`scanline` (nessun nuovo `::after` posizionato).

## Test

- I 332 test esistenti restano verdi (le estensioni sono additive).
- Nuovi test unit (node --test, pattern repo):
  - `sheetSummaries`: campo `dayLines` (giorni/titoli/conteggi, scheda vuota → `[]`);
  - ordinamento: attiva prima, archivio per `lastDate` desc, `null` in fondo;
  - `sheetSlug`: minuscole/accenti/separatore `-`/fallback/lunghezza;
  - `tabMiniLabel`: split, troncamento a 5, join `·`, titolo vuoto/assente → stringa
    vuota (la tab mostra solo la lettera);
  - formato date del gestore: oggi / anno corrente / anno diverso / null.
- Verifica visiva reale (Playwright, 390×844) su entrambi i temi: gestore con 2+ schede
  (accordion, azioni), editor con superset e giorni multipli. NB: scoprire `#app`
  (display:none prima del login) per misurare.

## Rollout

- Bump cache service worker (`sw.js`, `gymsched-v62` → `v63`) come ultimo task.
