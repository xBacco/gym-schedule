# Scan — figura anatomica con heatmap muscolare — design

**Data:** 2026-06-04
**Stato:** approvato, pronto per il piano di implementazione
**Mockup di riferimento:** `mockups/scan-anatomia-rev1.html` (la "versione finale
coerente" approvata nel brainstorming; generatore e iterazioni intermedie in
`.superpowers/brainstorm/30259-1780581068/assets/`, non versionati)

## Scopo

Una figura anatomica fronte/retro con i muscoli "accesi" in base a cosa si è
allenato (ispirazione: body heatmap di Hevy), declinata su tre superfici:

1. una **nuova schermata "Scan"** con la vista settimana e la vista freschezza;
2. la **pagina esercizio nel Database** (muscoli colpiti + illustrazione del
   movimento);
3. l'**editor scheda** (cosa copre un giorno).

In più, un **calcolatore dischi** richiamabile dalla sessione di allenamento.

## Stile visivo (trasversale a tutte le superfici)

### Figura X-ray "alone morbido"

- Silhouette scura piena; i muscoli **spenti restano sempre visibili**
  (fill `#1c2127`, stroke `#2c343c`) — la figura non è mai vuota.
- Muscolo **attivo** = doppio path: sotto una copia sfocata
  (`feGaussianBlur stdDeviation="20"`) che fa da alone, sopra il path nitido.
  Colore ambra `#f0a73c`, opacità proporzionale all'intensità.
- Muscoli **secondari** (nella pagina esercizio) in blu `#7FC8FF`.
- "**Mai allenato**" = contorno tratteggiato rosso (solo nella vista freschezza).

### Pannello "monitor CRT incassato"

- La palette del pannello è **fissa, fuori dai temi**: sfondo scuro `#0c0e11`
  anche sul tema Carta — l'effetto voluto è un monitor incassato nella pagina.
- Sfondo blueprint: griglia doppia (fine 14px + maggiore 70px, ambra a bassa
  opacità) + scanline + parentesi HUD angolari.
- Targhette HUD (`SCAN·W23`, `TGT·SEED12`, `MOV·0↔1`, …) in basso a destra.
  **Regola fissa: la targhetta ha una fascia riservata** — il pannello con
  targhetta usa padding-bottom 24px e nessun contenuto (legende, didascalie,
  immagini) può sovrapporsi. Regola nata da un bug reale del mockup.
- Righello con coordinate solo sui **pannelli grandi** (schermata Scan), non
  sui pannelli piccoli di DB ed editor.
- La resa del pannello vive in una classe condivisa **`.crt-panel`** in
  `style.css`.

### Scartati (per non ridiscuterli)

Foto reali degli esercizi (e con loro free-exercise-db), hex dump di sfondo,
reticolo da scanner, griglia blu, quote CAD finte, tap sul singolo muscolo
(layout "hero" D), nomi schermata alternativi (Corpo, Status, Anatomia,
Muscoli), pannello che segue i temi chiari.

## Modello dati e calcolo heat

### Voce di catalogo estesa

```js
{ id, name, muscle, note, secondary: [], img: "" }
```

- `secondary` — array (anche vuoto) di gruppi tra gli **8 fissi** di
  `MUSCLE_GROUPS`: i gruppi colpiti indirettamente dall'esercizio.
- `img` — URL override dell'illustrazione (vince su `media-map.js`);
  `""` = usa la mappa.
- **Invariante schema 6**: `hydrate`, `dehydrate` e `mergeBlobs` elencano i
  campi esplicitamente — un campo non listato viene perso in silenzio. Vanno
  aggiornati tutti e tre, più la normalizzazione: una voce vecchia senza i
  campi nuovi resta valida e si normalizza a `secondary: [], img: ""` (stesso
  pattern della migrazione "Accorpa").
- Il **seed** va arricchito con i secondari sensati (es. Panca piana →
  `["Spalle", "Tricipiti"]`); resta deterministico (niente Date/random).

### Calcolo heat

- Volume per gruppo = somma dei volumi esercizio (stessa definizione di
  `session.js`: reps×kg, manubri ×2, tracce a tempo escluse).
- **Heat gruppo = volume da primario + 0.5 × volume da secondario.** Il
  fattore 0.5 è fisso (niente pesi per-esercizio, YAGNI).
- I secondari si risolvono col **lookup catalogo per nome** (stesso
  link-per-nome di `catalogUsage`). Un esercizio "al volo" non a catalogo
  contribuisce **solo al suo gruppo primario**.
- Intensità normalizzata **sul max della vista corrente**: il gruppo col
  volume più alto vale 1.0, gli altri in proporzione.

### Mappatura gruppi → zone della figura

| Gruppo | Zone |
|---|---|
| Petto | chest |
| Dorso | upper-back, lower-back, trapezius |
| Spalle | deltoids |
| Bicipiti | biceps |
| Tricipiti | triceps |
| Gambe | quadriceps, hamstring, gluteal, adductors |
| Polpacci | calves |
| Core | abs, obliques |

Le zone della figura non mappate (es. avambracci) restano sempre spente.

## Architettura

- **`body-data.js`** — i path SVG fronte/retro per zona, **vendorati** da
  react-native-body-highlighter (licenza MIT, header di attribuzione nel
  file). Solo dati, nessuna logica.
- **`body.js`** — modulo puro, testabile in Node:
  - `GROUP_ZONES` — la mappatura gruppi→zone di cui sopra;
  - `heatByGroup(...)` — dai volumi per gruppo alla mappa zona→intensità
    normalizzata sul max;
  - `freshnessByGroup(...)` — dalle date "ultima volta allenato" per gruppo
    alle fasce della vista freschezza (intensità + insieme ⚠ + insieme "mai");
  - `renderBody({ heats, secondaries, cold, w }) → stringa SVG` — fronte +
    retro affiancati. Gli **id dei filtri SVG sono univoci per istanza**
    (suffisso contatore): più figure nella stessa pagina non collidono.
- La figura è un **riepilogo**: nessun tap sul singolo muscolo.
- **Service worker**: i file nuovi (`body.js`, `body-data.js`,
  `media-map.js`, `plates.js`) entrano nella lista cache + bump versione.

## Superfici UI

### Schermata Scan (nuova)

- Voce di menù **"Scan"** con emoji 🩻, status bar `◈ SCAN`. Menù a **5
  voci**: Schede, Database esercizi, Scan (3ª), Calendario (4ª), Impostazioni
  (5ª, a tutta larghezza in fondo).
- Pannello grande (con righello) + due tab:
  - **SETTIMANA** — heat dai volumi della settimana corrente.
  - **FRESCHEZZA** — fasce su "ultima volta allenato": ieri **0.95** /
    2–3 giorni **0.6** / 4–5 giorni **0.25** / ≥6 giorni **spento + ⚠** /
    mai allenato **tratteggio rosso**. Stessa fonte date del calendario.
- Legenda sotto la figura (scala poco→tanto, non allenato, mai).

### Database esercizi

- Nel **form** voce: chips multi-select per i gruppi secondari + campo `img`
  (URL override, opzionale).
- Nella **pagina esercizio**: pannello figura (primario ambra pieno,
  secondari blu, targhetta `TGT·…`) + pannello illustrazioni (vedi Media).

### Editor scheda

- Pannello heat **del giorno**: cosa copre quel giorno della scheda
  (targhetta `DAY·…`). Zone non coperte = spente normali, **non rosse** — il
  rosso "mai" ha senso solo sullo storico, non su un piano.

## Media esercizi

- Illustrazioni **wger / Everkinetic** (licenza libera) **hotlinkate**:
  `https://wger.de/media/exercise-images/<id>/<Nome>-1.png` e `-2.png`
  (inizio/fine movimento, affiancate). Verificate esistenti: 192/Bench-press,
  91/Crunches.
- **`media-map.js`** — mappa nome seed (IT) → id wger + nome file. Il campo
  `img` della voce di catalogo vince sulla mappa.
- **Fallback**: non tutti i ~64 esercizi seed avranno un'illustrazione; in
  assenza (o su `onerror`, es. offline) il pannello media **non compare** e
  resta solo il pannello figura+muscoli. Nessuna cache SW delle immagini
  esterne.
- Resa "fosforo" sul pannello blueprint:
  `filter: invert(1) grayscale(1) sepia(1) saturate(3) hue-rotate(-14deg)
  brightness(.95) contrast(1.2) drop-shadow(0 0 5px rgba(240,167,60,.55));
  mix-blend-mode: screen`.

## Calcolatore dischi

- **Dove**: icona ⚖ accanto al campo kg di ogni serie nella sessione. Tap →
  overlay CRT (stesso pattern dell'overlay catalogo), pre-caricato col valore
  del campo (o l'ultimo carico noto).
- **`plates.js`** — modulo puro. Input: kg target (**totale**, bilanciere
  incluso — coerente con come si logga il kg), peso bilanciere (default 20),
  inventario dischi per lato (default: 25 / 20 / 15 / 10 / 5 / 2.5 / 1.25).
  Calcolo: `(target − bilanciere) / 2`, riempimento greedy.
  - Target esatto non raggiungibile → combinazione più vicina per difetto e
    per eccesso col delta (`94 → 93.5 (−0.5) | 95 (+1)`).
  - Target < bilanciere → "solo bilanciere (20 kg)".
- **UI overlay**: barra orizzontale con dischi impilati in resa blueprint,
  etichetta `LATO·SX ≡ LATO·DX`, lista testuale `2×25 + 1×10 + 1×2.5`.
  Bilanciere e inventario modificabili nell'overlay (chips on/off sui
  dischi), persistiti come le altre preferenze locali (localStorage, fuori
  dal blob sync).
- **Fuori scope**: nessun aggancio automatico al tipo di esercizio — lo si
  apre quando serve (manubri/corpo libero: semplicemente non si apre).

## Piano test

Tutti con `node --test`, solo moduli puri (zero DOM, come gli esistenti):

1. **`body.js`** — `GROUP_ZONES` copre tutti gli 8 gruppi con zone valide;
   `heatByGroup`: primario 1.0 + 0.5×secondari, normalizzazione sul max;
   `freshnessByGroup`: le fasce; `renderBody`: la stringa SVG contiene i
   path attesi e due render nella stessa pagina hanno id filtri diversi.
2. **`media-map.js`** — lookup nome→id, override `img`, fallback assente.
3. **`plates.js`** — decomposizione esatta, per difetto/eccesso, target
   sotto-bilanciere, decimali (2.5/1.25), inventario ridotto.
4. **`catalog.js`** — migrazione: voci senza `secondary`/`img` restano valide
   e si normalizzano; `hydrate`/`dehydrate`/`mergeBlobs` conservano i campi.
5. **Freschezza** — dato un log con date note, le fasce escono giuste
   (ieri / 2–3g / 4–5g / ≥6g / mai), stessa fonte date del calendario.

## Fuori scope (YAGNI)

- Pesi dei secondari per-esercizio (il fattore è fisso a 0.5).
- Cache offline delle illustrazioni wger.
- Tap sul singolo muscolo / drill-down dalla figura.
- Aggancio del calcolatore dischi al tipo di esercizio.
