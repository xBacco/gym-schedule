# Superset a 3 tracce (circuiti) — design

**Data:** 2026-06-08
**Stato:** implementato (2026-06-08) — branch `feat/superset-circuiti-3-tracce`, Task 1–9; 409 test verdi, SW v71

## Problema

Il modello dati supporta solo esercizi **singoli** o **superset da 2** (tracce `a`/`b`).
I circuiti core da 3 mosse non hanno rappresentazione: oggi sono incastrati in una
voce singola con nome "Circ.N · m1 · m2 · m3" e `setsReps` "2-3 giri", che in sessione
diventa inutilizzabile (1 sola serie da spuntare, reps invisibili, niente tracking
per mossa). Vogliamo **circuiti veri da 3 tracce**, tracciabili come gli altri superset.

## Decisioni (brainstorming 2026-06-08)

1. **3ª traccia additiva `c`, opzionale** — si estende `{a,b}` → `{a,b,c}` e si aggiungono
   i metadati `muscleC / unitC / vol2C / platesC` a specchio di `b`. Scartato l'array
   `tracks[]` perché costringerebbe a migrare ogni entry loggata e a riscrivere tutto il
   plumbing del tracking, con più rischio e zero beneficio visibile.
2. **Arità dal nome** — un superset è duo o trio a seconda del numero di pezzi separati da
   ` + ` nel nome (2 = duo, 3 = trio). Unica fonte di verità. `setsReps` segue (`x / y` o
   `x / y / z`).
3. **Vista focus impilata per TUTTI i superset (2 e 3)** — si rimuovono i sotto-tab A/B.
   Le tracce si mostrano come **blocchi interi uno sotto l'altro** (densità "blocchi
   interi", scelta nei mockup): ogni traccia tiene tutto com'è oggi (stepper reps+kg,
   dischi/lato, storico serie, chip "ripeti"). Un unico tasto chiude la serie/giro
   loggando la serie attiva di ogni traccia. Zero perdite di funzionalità, meno rischio.
4. **Editor: supporto minimo ai trio in-app** — il nome ("A + B + C") e `setsReps`
   ("x / y / z") restano campi liberi; si aggiungono i metadati di C (muscolo, unità,
   chip VOL×2 / DISCHI) rivelati quando il superset è attivo, così aprire+salvare un trio
   non ne perde i metadati.

## Invariante critica (non rompere)

- **Nessuna migrazione dei log esistenti.** Le entry duo già loggate (`{a,b}`) e quelle
  singole continuano a normalizzarsi correttamente; `c` assente → traccia vuota.
- I **duo restano identici a oggi** in tutti i comportamenti (default arità 2): parsing,
  completamento, volume, record. La 3ª traccia è in più, non al posto di.
- `dehydrate(data)` a ogni save resta invariato (vedi [[schede-multiple-decision]]).

## Data model (`store.js`)

- `normalizeSupersetEntry(v)` → `{ a, b, c, note }`, con `c` da `v.c` o entry vuota.
  Legacy singola → A; b e c vuote. Vuoto → tre tracce vuote.
- Persistenza entry trasparente (`setEntry`/`getEntry`/`dehydrate`/`hydrate` invariati:
  salvano l'oggetto così com'è).

## Schema esercizio (`plan.js`)

- Nuovi campi opzionali: `muscleC`, `unitC`, `vol2C`, `platesC` (specchio di `*B`).
- Commento schema aggiornato: `muscleC?`, `unitC?`.
- Additivi e opzionali → nessuna migration di schema necessaria (esercizi esistenti
  invariati). Niente trio aggiunto al PLAN seed di default (i circuiti core vivono nel
  piano dell'utente, applicati in fase 2).

## Logica di sessione (`session.js`)

- **Nuovo helper** `supersetTrackKeys(ex)` → `["a","b"]` o `["a","b","c"]` contando i pezzi
  ` + ` del nome (solo se `ex.superset`); `[]` altrimenti. Fonte unica dell'arità.
- `parseTarget(setsReps, superset, n = 2)` — il separatore di traccia è uno slash
  **circondato da spazi** (` / `, regex `/\s+\/\s+/`), così i qualificatori *senza spazi*
  come `8/lato` o `max/lato` restano dentro la loro traccia. Si splittano i primi `(n-1)`
  separatori; l'ultima traccia tiene tutto il resto (incl. eventuali slash). `n = 3`
  → `{a,b,c}`; `n = 2` → `{a,b}`. I chiamanti passano `supersetTrackKeys(ex).length`.
  **Cambio rispetto a oggi:** si passa da `indexOf("/")` (primo slash qualunque) a split
  su ` / ` spaziato. Retrocompatibile: tutti i separatori esistenti hanno gli spazi, quindi
  i duo non cambiano; come bonus si corregge il caso (oggi rotto) di un qualificatore con
  slash nella **prima** traccia di un duo. Va bloccato con un test dedicato.
- `entryTrack(entry, track)` accetta anche `"c"`.
- Funzioni per-traccia estese a `"c"`: `trackName` (split su ` + ` a 3 pezzi),
  `volumeMeta` (`vol2C`/`unitC`), `platesOn` (`platesC`), `bestKg`, `bestKgBefore`,
  `bestReps`, `bestRepsBefore`, `historyIsBodyweight`, `isWeekRecord`,
  `previousSetInSession`, `previousWeekSet`, `lastWorkingSet`, `topSetSeries`.
- Funzioni che iterano le tracce → usano `supersetTrackKeys(ex)` invece di `[a,b]` fissi:
  `isEntryComplete` (regola "traccia vuota non blocca" valida anche per C),
  `exerciseVolume`, `sessionHasDoneSet`, `weekTopKg`, `volumeByMuscle`,
  `muscleContributions`.

## Vista focus / sessione (`app.js`)

- `renderFocusSuperset` riscritto: **niente `ss-tabs`**. Per ogni key in
  `supersetTrackKeys(ex)` si costruisce e appende il `trackBlock` completo (in ordine
  A, B, [C]). Stato draft per-traccia generalizzato (oggi `draftA`/`draftB` → mappa per
  key, incl. `c`). Si rimuove la variabile `supersetTab`.
- CTA unica "Serie fatta (A+B[+C]) · avvia recupero ▸": logga la serie attiva di **ogni
  traccia non ancora completa** (cicla su `supersetTrackKeys`), poi avvia il recupero.
  Etichetta costruita dalle key attive.
- `showFeelAsk` generalizzato a N tracce (oggi `aIdx`/`bIdx` → array di `{track, idx}`):
  una barra RPE per traccia, come oggi.
- Grafico: `chartTrack` ammette `"c"`; `calIsPr`/PR check con OR anche su `"c"`;
  `lastWorkingSet(..., "c")` per la riga "ult.".

## Riga scheda + editor (`app.js`, `index.html`)

- `buildPlanRow`: il nome con due ` ＋ ` si renderizza già (cicla su `split("+")`); si
  aggiorna solo il badge "vol ×2 / a tempo" perché consideri anche C
  (`volumeMeta(ex,"c")`, `ex.unitC`).
- `index.html` dialog esercizio: etichetta superset `A / B` → `A / B / C`; nuovi controlli
  C (`#exMuscleC` + label, `#exUnitC` + label, chip `#exVol2C` / `#exPlatesC` in
  `#exChipsB`/nuovo `#exChipsC`).
- `app.js`: `toggleMuscleB` mostra/nasconde anche i campi C; `openExDialog`/`readExDialog`
  leggono/scrivono `muscleC`/`unitC`/`vol2C`/`platesC` (solo se superset);
  `applyChipDefaults`/`updateChipsFromEx`/`clearExChipsUI` includono le chip C.

## Test (`tests/`)

Estendere i test superset esistenti con casi a 3 tracce + il nuovo helper. Tutti verdi
prima di mergiare.
- `session.test.js`: `supersetTrackKeys`; `parseTarget` a 3 (split su ` / ` spaziato,
  qualificatore `8/lato` in traccia **non-ultima** che NON deve spezzare, `max/lato` in C,
  asimmetrici) + regressione duo (separatore spaziato invariato, slash in traccia A non
  spezza); `isEntryComplete` a 3 (completo, combinazioni con tracce vuote);
  `bestKg`/`lastWorkingSet`/`topSetSeries`/
  `previousSetInSession` su `"c"`; `volumeMeta`/`platesOn` con `vol2C`/`platesC`;
  `exerciseVolume`/`sessionHasDoneSet`/`volumeByMuscle`/`muscleContributions` a 3 tracce.
- `store.test.js`: `normalizeSupersetEntry` forma `{a,b,c,note}`; vuoto → 3 tracce vuote;
  legacy → A con b/c vuote.
- `sheets.test.js`: campi `vol2C`/`platesC` sopravvivono a hydrate/dehydrate.
- `body.test.js`: `dayCoverage` con `muscleC`.

## Rollout (2 fasi)

**Fase 1 — codice.** Implementazione + test verdi → bump service worker `sw.js`
`gymsched-v70` → `v71` → commit + push su `main` (deploy GitHub Pages).

**Fase 2 — dati (dopo che il deploy supporta i trio).** Applicare i 3 circuiti core al
piano vivo (scheda `2b80r`) via Playwright, stessa tecnica della v430 (modifica del solo
`plan` nel blob localStorage + `dirty`, reload → `mergeBlobs` + push). Trasforma le voci
"Circ.N" rotte in superset da 3 veri. I log W23/W24 restano intatti (le `weeks` si
fondono; il `plan` locale vince). Vedi [[scheda-revisione-petto-3x]].

Mapping circuiti (un "set" = un giro; target 2 giri, il 3° si aggiunge a mano):

| Giorno | Nome | setsReps | unità (a/b/c) |
|---|---|---|---|
| C | Dead bug + Crunch a terra + Plank | `2 × 8/lato / 2 × 10 / 2 × 25-30` | reps/reps/**sec** |
| B | Bird-dog + Russian twist + Plank laterale | `2 × 8/lato / 2 × 8/lato / 2 × 20/lato` | reps/reps/**sec** |
| A | Crunch inverso + Hollow hold + Plank tocco spalla | `2 × 10 / 2 × 20-25 / 2 × 8/lato` | reps/**sec**/reps |

Tutte e tre con `muscle`/`muscleB`/`muscleC` = Core, `restSeconds` 60.

## Fuori scope

- Array generico di tracce (>3). Si resta a max 3.
- Trio nel PLAN seed di default.
- Ridisegno RPE/commenti (restano come oggi).
- Non editare `data.json` del repo (stale, vedi [[scheda-revisione-petto-3x]]).
