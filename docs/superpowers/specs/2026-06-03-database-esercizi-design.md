# Database esercizi — design

**Data:** 2026-06-03
**Stato:** approvato, pronto per il piano di implementazione

## Scopo

Un catalogo di esercizi consultabile a sé, diviso per gruppo muscolare, con
aggiunta "al volo" (add-if-missing). Raggiungibile da una nuova voce del drawer
in fondo: **"Database esercizi"**. Serve come riferimento personale: l'utente
sfoglia/cerca i propri esercizi, vede dove sono usati e come stanno andando, e
ci appunta note tecniche.

**Fuori scope (YAGNI):** l'integrazione col form scheda (un picker che alimenti
"Nuovo esercizio" pescando dal catalogo). È la cura definitiva al problema del
link-per-nome (vedi sotto), ma non viene fatta ora. Resta annotata come naturale
passo successivo.

## Modello dati

Una voce di catalogo:

```js
{ id, name, muscle, note }
```

- `id` — identificatore stabile interno (generato con `genId`, come le schede).
  Serve a rinominare senza perdere la nota e a fare merge deterministico in sync.
- `name` — stringa, nome dell'esercizio. Unicità **case-insensitive dentro lo
  stesso gruppo** (due gruppi possono avere lo stesso nome — raro ma ammesso).
- `muscle` — uno degli **8 gruppi fissi** già usati nella `<select id="exMuscle">`
  di `index.html`: `Petto, Dorso, Spalle, Bicipiti, Tricipiti, Gambe, Polpacci,
  Core`. Nessun gruppo custom.
- `note` — stringa libera opzionale (cue tecnico, presa, link…). `""` = nessuna.

Il catalogo è una lista piatta di queste voci; il raggruppamento per `muscle` e
l'ordinamento alfabetico avvengono in fase di render, non nello storage.

### Seed iniziale

Al primo avvio (catalogo assente nel blob) si popola con esercizi comuni dei
fondamentali per gruppo. Fonte: gli esercizi presenti nel seed di `plan.js` più
una lista classica per copertura (la stessa già usata nei mockup `rev5`). Il seed
gira **una sola volta**: una volta che il campo `catalog` esiste nel blob (anche
vuoto, `[]`), non si re-seeda.

## Persistenza (il punto critico)

Il catalogo è un **nuovo campo top-level del blob schema 6**, sincronizzato su
Supabase come schede e storico. La forma persistente diventa:

```js
{ schema: 6, updatedAt, activeSheetId, sheets:[…], catalog:[…] }
```

`sheets.js` traduce tra blob persistente e forma in-memory `data` usata da
`app.js`. **`hydrate`, `dehydrate` e `mergeBlobs` costruiscono l'oggetto di
ritorno elencando esplicitamente i campi**: un nuovo campo non listato viene
**silenziosamente perso**. Quindi vanno toccati tutti e tre:

1. **`hydrate(input)`** (sheets.js:56) — aggiungere `catalog` all'oggetto
   in-memory restituito: `catalog: structuredClone(blob.catalog ?? [])`. Se
   assente nel blob → seed (vedi sopra) oppure `[]` e seed gestito a livello app.
2. **`dehydrate(data)`** (sheets.js:72) — riscrivere `catalog` nel blob:
   `out.catalog = structuredClone(data.catalog ?? [])`.
3. **`toSheetsBlob(input)`** (sheets.js:19) — il ramo `schema >= 6` fa già
   `structuredClone(data)`, quindi preserva `catalog` automaticamente; il ramo
   legacy (`schema < 6`) costruisce un oggetto nuovo: aggiungere `catalog: []`
   (un blob legacy non ha catalogo).
4. **`mergeBlobs(local, remote)`** (store.js:252) — l'oggetto di ritorno
   (`{ schema:6, updatedAt, activeSheetId, sheets }`) va esteso con `catalog`
   mergiato. Merge per `id`: unione delle voci; a parità di `id` vince il lato
   con `updatedAt` più recente (stesso criterio già usato per le altre parti);
   le voci presenti solo da un lato si conservano. **Niente cancellazioni
   implicite**: una voce assente da un lato ma presente nell'altro resta (le
   delete vere si propagano come la voce semplicemente non più presente in
   entrambi → per ora una delete su un device che poi mergia con un remoto che
   la contiene ancora la "resuscita"; accettabile per la v1, coerente col modello
   attuale che non ha tombstone).

### Invariante critica (NON negoziabile)

**`dehydrate(data)` deve essere chiamato a OGNI punto di salvataggio**, altrimenti
le modifiche in-memory (incluso il catalogo) si perdono al reload. I punti di save
esistenti (`scheduleSave`, `persist`, `mutateSheets` via
`hydrate(fn(dehydrate(data)))`) già rispettano questo. Le mutazioni del catalogo
devono passare per lo stesso meccanismo (vedi sotto), non scrivere a parte.

### Mutazioni catalogo

Le operazioni (add / rename+regroup / delete / edit nota) seguono il pattern
`mutateSheets` già esistente (app.js:264): funzioni **pure** in `sheets.js` (o un
nuovo modulo `catalog.js` se cresce) che prendono il blob e restituiscono un blob
nuovo, applicate con `data = hydrate(fn(dehydrate(data))); scheduleSave();`. Così
l'invariante dehydrate-a-ogni-save è automatica.

Funzioni pure previste (testabili in Node, come `sheets.js`):
- `addCatalogEntry(blob, { name, muscle, note })` — rifiuta duplicati
  case-insensitive nello stesso gruppo.
- `renameCatalogEntry(blob, id, { name, muscle })` — sposta di gruppo e/o
  rinomina; preserva `id` e `note`.
- `deleteCatalogEntry(blob, id)`.
- `setCatalogNote(blob, id, note)`.

## UI — direzione "terminale"

Riferimento visivo definitivo: `mockups/db-esercizi-rev5.html` (già allineato a
tutte le decisioni, animazione inclusa).

- **Accesso:** nuova voce nel drawer in fondo (`renderDrawer`, app.js:355), che
  apre un overlay a tutta altezza con la sua entry nella history (stesso pattern
  di `openSheets`, app.js:249, e degli altri overlay).
- **Lista a nodi-cartella:** un nodo espandibile per gruppo, box-drawing
  `├─ └─`, dot-leader, conteggio per gruppo (es. `petto … 08`). Gruppi
  collassabili.
- **Ordinamento:** alfabetico dentro ogni gruppo, `localeCompare(…, "it",
  { sensitivity: "base" })` (case/accent-insensitive).
- **Ricerca:** barra `grep>` che filtra l'intero albero in tempo reale; con un
  filtro attivo i gruppi con match si auto-espandono e il termine è evidenziato.
- **Add-if-missing:** se la ricerca non produce match, compare un bottone
  **"aggiungi «…»"** che apre il form add pre-compilato col testo cercato.
- **Dettaglio inline:** tap sulla riga → il chevron ruota e il dettaglio si apre
  **in linea** (niente popup), con animazione di apertura **scanline CRT** (barra
  di scansione ambra che scende dall'alto + micro-flicker; la sparkline si traccia
  durante la rivelazione). Una sola riga aperta per volta.
- **Contenuto del dettaglio:**
  - **usato in** — elenco scheda + giorno in cui l'esercizio compare (vedi
    "Collegamento storico"); se nessuno → "— non presente in nessuna scheda —".
  - **andamento** — mini-sparkline del top-set nel tempo, con kg dell'ultima
    sessione in punta; se nessuno storico → "— ancora nessuno storico —".
  - **nota** — `textarea` editabile inline; salva on-blur via `setCatalogNote`.
  - azioni: **✎ modifica** e **× elimina**.
  - **Niente** riga separata "ultima volta + PR": l'andamento la copre.
- **Modale:** riservato **solo** ai form add / edit / delete (stesso vocabolario
  di `exDialog`/cal-modal). Tutto il resto è inline.

## Collegamento storico (caveat tecnico)

Catalogo e schede sono **liste separate, collegate per nome**. Lo storico interno
è agganciato a `ex.id` **dentro la scheda** (`getEntry`/`weekTopKg`/`exerciseTrend`
in `session.js`), non al catalogo. Conseguenze:

- "usato in" e sparkline si calcolano cercando, in `data.sheets[*].plan`, gli
  esercizi il cui `name` combacia (case-insensitive) col `name` della voce di
  catalogo, e poi leggendo storico/trend con il loro `ex.id` interno.
- Se il nome nel catalogo **non** combacia con nessun nome nei plan (drift di
  naming), il collegamento non avviene → fallback esplicito "— non presente… —"
  / "— ancora nessuno storico —". Nessun errore, solo assenza di link.
- Eliminare una voce dal catalogo **non tocca** lo storico delle schede (sono
  indipendenti). Va detto nel dialog di conferma elimina.

`exerciseTrend(data, day, exId, weekKey, n, superset)` (session.js:368) e
`weekTopKg` (session.js:329) sono le fonti per la sparkline; vanno aggregate su
tutte le schede/giorni dove il nome compare per produrre la serie mostrata.

## Test

Seguendo il pattern di `tests/sheets.test.js`:

- **Funzioni pure catalogo** (`add/rename/delete/setNote`): happy path, rifiuto
  duplicato case-insensitive nello stesso gruppo, rename che cambia gruppo
  preservando `id`+`note`.
- **Round-trip persistenza:** `dehydrate(hydrate(blob))` stabile **con** `catalog`
  popolato (estende il test esistente "hydrate∘dehydrate è round-trip stabile").
- **Retro-compatibilità:** un blob legacy (schema < 6) o schema 6 **senza**
  `catalog` hydrata a un `data.catalog` valido (`[]` o seed) senza rompere.
- **`mergeBlobs` + catalog:** voci solo-locale e solo-remote conservate; a parità
  di `id` vince `updatedAt` più recente; nessuna perdita del campo.
- **Link per nome:** dato un plan con un esercizio "Panca piana bilanciere" e una
  voce catalogo omonima, "usato in" la trova; con naming divergente, fallback.

## Sequenza di build (alto livello)

1. `sheets.js`: campo `catalog` in hydrate/dehydrate/toSheetsBlob + funzioni pure
   + test.
2. `store.js`: merge del `catalog` in `mergeBlobs` + test.
3. Seed iniziale (one-shot) + dato di partenza.
4. UI overlay "Database esercizi": voce drawer, albero, ricerca, dettaglio inline
   con animazione CRT, form modale add/edit/delete.
5. Collegamento storico (usato-in + sparkline) via session.js, con fallback.
6. Verifica: `node --test` verde, prova end-to-end nel browser (dietro auth
   Supabase, la fa l'utente).
