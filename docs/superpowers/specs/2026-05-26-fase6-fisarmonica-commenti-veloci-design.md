# Fase 6 — Fisarmonica esercizi + Commenti veloci + palette Amber

Data: 2026-05-26
Stato: design approvato in brainstorming (mockup interattivi)

## Contesto

App PWA per loggare gli allenamenti (vanilla JS, niente build). Stato in `data.json`
sincronizzato su GitHub via `GitHubStore`. Logica pura testabile in `store.js` / `session.js`
(gate: `node --test`, 97 test verdi). Rendering in `app.js`, stile in `style.css`.

Oggi il giorno mostra **un solo esercizio "in focus"** (card grande in cima) più una lista
"prossimi"; toccare un prossimo lo fa diventare il focus (salta in cima). Questa fase sostituisce
quel modello con una **lista a fisarmonica a ordine fisso**, aggiunge i **commenti veloci per
serie** e ricolora l'app in **Amber**.

Le tre parti sono indipendenti come dominio ma toccano gli stessi file; si implementano in
sequenza (prima la fisarmonica, che sposta l'editor; poi i commenti veloci dentro l'editor; poi
la palette, puramente CSS).

---

## Parte 1 — Lista a fisarmonica

### Comportamento (deciso)

- I 7 esercizi del giorno sono in **ordine fisso**: niente più "salta in cima".
- Ogni riga chiusa mostra: numero, nome (+ badge superset), `setsReps · rec N″`, e a destra
  il `best` kg (o `A·B / 2 tracce` per i superset) oppure `✓` se completato.
- **Tap su una riga = apri/chiudi in posizione.** Dentro la riga aperta c'è l'editor completo
  che già esiste oggi (serie loggate, stepper carico/reps, barra facile/giusta/dura, chip di
  ripetizione, dots, "Serie fatta", nota, e — solo una volta — la riga volume in fondo alla lista).
- **Uno solo aperto alla volta**: aprire un esercizio chiude quello prima.
- **Si può chiudere tutto**: ri-toccare l'esercizio aperto lo chiude senza aprirne altri.
- **All'apertura dell'app e al cambio giorno/settimana: tutto chiuso** (vista pulita).
- **Dopo aver completato un esercizio** (ultima serie che porta `isEntryComplete` a true):
  l'esercizio appena finito si chiude e si **apre automaticamente il prossimo esercizio non
  completato** (`activeExerciseIndex`). Completare una serie non finale lascia l'esercizio aperto.
- La barra di progresso in alto resta (segmenti: completati pieni, quello aperto in accento,
  gli altri vuoti). Quando non c'è nessun aperto, nessun segmento è in accento.

### Modello di stato

Sostituire `focusIndex` (l'indice dell'unico esercizio in focus) con `openIndex`:
- `openIndex = null` → nessun esercizio aperto.
- `openIndex = i` → l'esercizio `i` è aperto.

`changeWeek` / `changeDay` impostano `openIndex = null`.
Il completamento di un esercizio imposta `openIndex = activeExerciseIndex(...)`.

### Rendering

`render()` produce, dopo header + barra progresso, **un'unica lista** `#list` di card; non più
`#focus` + `#upnext` separati. Per ogni esercizio `i`:
- riga "testata" (sempre visibile) con i dati riassuntivi e handler di toggle;
- corpo (visibile solo se `i === openIndex`) che contiene l'editor renderizzato dalle funzioni
  esistenti `renderFocusNormal` / `renderFocusSuperset`, adattate a scrivere nel contenitore-corpo
  dell'esercizio invece che nel vecchio `#focus`.

Le funzioni editor oggi usano la variabile globale `focusIndex` per sapere su quale esercizio
operano. Vanno parametrizzate sull'indice dell'esercizio che stanno renderizzando (passare `idx`)
così che gli handler (`persist`, `setEntry`, `withSet`, ecc.) lavorino sull'esercizio giusto anche
quando in futuro più corpi fossero in DOM. In pratica: `renderFocusNormal(ex, idx)` e
`renderFocusSuperset(ex, idx)`, e `persist()` riceve `idx`.

La **riga volume** (oggi dentro la card focus) si sposta in fondo alla lista, renderizzata una
volta sola, sotto tutti gli esercizi.

`renderUpNext` viene rimosso (assorbito nella lista). `renderProgress` resta ma usa `openIndex`
per il segmento in accento (e l'etichetta `NN/07` mostra il numero dell'aperto, o il totale
completati quando niente è aperto).

### Test (parte 1)

Logica pura già coperta (`activeExerciseIndex`, `isEntryComplete`). Aggiungere test su un piccolo
helper estraibile, es. `nextOpenAfterComplete(data, week, day, plan)` che ritorna l'indice da aprire
dopo un completamento (= `activeExerciseIndex`), per fissare il comportamento "apri il prossimo".
Il rendering DOM si verifica a mano nel browser (Playwright), non in unit test.

---

## Parte 2 — Commenti veloci per serie

### Comportamento (deciso)

- Il commento veloce si lega alla **singola serie**.
- Una serie può avere **più commenti** (toggle on/off).
- In sessione, **sotto la barra facile/giusta/dura** della serie corrente compare una riga di
  **chip** con i commenti predefiniti + un chip **"+ scrivi"** per inserirne uno al volo (via
  `prompt`, aggiunto solo a quella serie, non alla lista dei predefiniti).
- Toccare un chip lo aggancia alla serie corrente (stato bozza); ri-toccarlo lo toglie.
- Alla pressione di **"Serie fatta"** i commenti selezionati vengono salvati nella serie.
- Le serie già fatte mostrano i loro commenti **sotto i numeri** della riga ("6 × 55 kg ✓ dura ·
  *alzare 1kg*"). Toccare l'area commenti di una serie fatta riapre il picker di chip per quella
  serie (per aggiungere/togliere), coerente con il feel che è già ri-toccabile.
- I commenti valgono per la settimana corrente (come i numeri della serie); non si propagano
  automaticamente alla settimana dopo.

### Modello dati

Estendere `normalizeSet` con un campo `comments: string[]` (array di stringhe non vuote,
deduplicato, di default `[]`). Vale uniformemente per esercizi normali e per le tracce A/B dei
superset (entrambe passano da `normalizeSet`).

- `normalizeSet(s)` → include `comments: Array.isArray(s?.comments) ? s.comments.filter(...) : []`.
- `withSet(entry, i, patch)` accetta `patch.comments` (sovrascrive l'array) — già passa da
  `normalizeSet`, quindi basta non perdere il campo nel merge.
- Aggiungere helper puri testabili:
  - `toggleComment(comments, text)` → ritorna un nuovo array con `text` aggiunto se assente,
    rimosso se presente (trim, no duplicati).

### Predefiniti (Impostazioni)

- Lista salvata in `localStorage` chiave `gymsched_quickcomments` come JSON array di stringhe.
- Default seed se assente: `["alzare 1kg", "diminuire leggermente", "ultima reps forzata/sporca"]`.
- Helper come per dischi/recupero: `getQuickComments()` / `setQuickComments(arr)`.
- Nel dialog Impostazioni, nuova sezione **"Commenti veloci"**: lista con, per voce, il testo e
  un pulsante elimina (✕); un campo di testo + "+" per aggiungerne; modifica = elimina+riaggiungi
  oppure edit inline (scelta implementativa, non vincolante). Le modifiche si salvano in
  `localStorage` (non viaggiano su GitHub: sono preferenze del dispositivo, come i dischi).

### Rendering

Nuova funzione `buildQuickCommentChips(selected, onToggle, onWrite)` che produce la riga di chip
(predefiniti da `getQuickComments()`, evidenziando quelli in `selected`, più "+ scrivi").
Inserita nell'editor normale (in `renderFocusNormal`, dopo `buildRpeBar`) e in ogni traccia
(`trackBlock`, dopo la sua `buildRpeBar`). La bozza dei commenti della serie corrente vive accanto
a `draft` / `draftA` / `draftB` (es. `draft.comments = []`).

`setRow` mostra i commenti della serie fatta sotto i numeri (nuovo nodo `.cmt`, uno per commento o
uno unico con separatore `·`), con handler per riaprire il picker.

### Test (parte 2)

- `normalizeSet`: `comments` di default `[]`; preserva array valido; scarta non-stringhe/vuoti.
- `toggleComment`: aggiunge se assente, rimuove se presente, trim, no duplicati.
- `withSet` con `patch.comments` preserva l'array dopo normalizzazione.
- I commenti **non** influenzano volume/PR/trend (verifica che le funzioni esistenti ignorino il
  campo — sono già selettive su reps/kg/done/warmup).

---

## Parte 3 — Palette Amber

Puro CSS. Aggiornare le variabili `:root` in `style.css` allo schema Amber scelto:

```
--bg:#100E0A; --surf:#181511; --surf2:#1E1A14; --line:#2A2620;
--ink:#EFEBE3; --dim:#938B7B; --faint:#6F685B;
--acc:#E8A93C; --acc-ink:#241803; --ok:#E8A93C; --down:#E0843F;
--field:#221D14;
```

Verificare i punti dove i colori sono hardcoded (es. bordi `#1e4a3b` del verde, `accsoft`
`#13352a`) e ricondurli all'accento ambra. Nessun cambiamento di layout: solo colore.
La barretta laterale sull'esercizio aperto (dettaglio scelto del mockup A) si aggiunge come
pseudo-elemento sulla card aperta.

---

## File toccati

- `store.js` — `normalizeSet` (+`comments`), `toggleComment`.
- `session.js` — eventuale `nextOpenAfterComplete` (alias di `activeExerciseIndex`); nessuna
  modifica a volume/PR/trend.
- `app.js` — `focusIndex`→`openIndex`; nuova `render()` a lista; editor parametrizzati su `idx`;
  `buildQuickCommentChips`; `setRow` mostra commenti; sezione Impostazioni commenti veloci;
  rimozione `renderUpNext`.
- `style.css` — palette Amber; stili lista/card fisarmonica, chip commenti, riga commento, barretta.
- `index.html` — il markup statico `#focus` / `#upnext` diventa un singolo `#list` (più la sezione
  commenti veloci nel dialog impostazioni).
- `tests/store.test.js` — test `normalizeSet.comments`, `toggleComment`.
- `tests/session.test.js` — test comportamento "apri il prossimo" se si estrae l'helper.

## Fuori scope

- Propagazione dei commenti alla settimana successiva.
- Riordino manuale degli esercizi.
- `+ riscald.` sui superset (già fuori scope da Fase 5).

## Verifica

- `node --test` verde (97 esistenti + nuovi).
- Playwright nel browser reale: lista fisarmonica (ordine fisso, uno aperto, chiusura a zero,
  auto-apertura del prossimo dopo completamento), chip commenti che si agganciano/staccano e
  appaiono sulla serie, sezione impostazioni, palette ambra ovunque, console pulita.
