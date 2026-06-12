# Split di `app.js` — design

**Data:** 2026-06-12
**Stato:** approvato (brainstorming)
**Contesto:** blocco #4b del programma "fai tutte e 4" (Fondamenta → Refactor → Feature → Capacitor). #4a (smoke E2E) è la rete di sicurezza appena costruita per questo lavoro.

## Problema

`app.js` è un monolite di **4123 righe**: è l'entry/controller dell'app (caricato come `<script type="module" src="./app.js">`, nessun bundler). Importa tutti i moduli puri esistenti (`store, session, editor, sheets, catalog, body, timer, …`) e contiene **tutta** la logica UI/DOM/orchestrazione: overlay, rendering, eventi, boot, splash, banner.

Conseguenze:
- Difficile da tenere in testa, da modificare con sicurezza, da rivedere.
- La logica DOM dentro `app.js` è **quasi del tutto non testata** dai 446 unit test (che coprono i moduli *puri*). L'unica rete automatica su `app.js` è lo smoke E2E di boot (online/offline) + verifica manuale su device.

## Obiettivo

Spezzare `app.js` in moduli più piccoli e a confini netti, **un'estrazione alla volta**, **senza cambiare comportamento** (refactor puro, zero modifiche di logica), così che ogni passo sia spedibile e verificato. Traguardo: `app.js` da 4123 → ~1500 righe, con ogni feature/overlay nel proprio file.

**Non-obiettivi (YAGNI):**
- Nessun cambio di comportamento, UI o logica.
- Nessun bundler/build step (resta ESM diretto nel browser).
- Nessun refactor del *cuore focus* (rendering esercizio): è l'ondata 4, **fuori scope** in questo spec (rivalutabile dopo l'ondata 3).
- Nessun refactor opportunistico non legato allo split.

## Vincoli del progetto (scoperti in esplorazione)

- **ESM diretto, niente bundler.** Ogni nuovo modulo è un file `.js` con `import`/`export` **relativi** (mai CDN — c'è un guard test anti-CDN).
- **Service Worker precacha ogni file esplicitamente** (`ASSETS` + `CACHE = gymsched-vNN` in `sw.js`). Ogni nuovo modulo va aggiunto ad `ASSETS` e va bumpato `CACHE`, altrimenti l'offline si rompe.
- **Gap rilevato:** *non* esiste un guard che obblighi ogni `.js` dell'app a stare in `ASSETS`. Va creato come primo passo (vedi sotto).
- `app.js` **non esporta nulla** e non è importato da nessuno: è puro entry. Spostare codice fuori da `app.js` non rompe import esterni.

## Architettura: stato condiviso via `ctx`

Il nodo tecnico è lo **stato mutabile a livello di modulo** (`data`, `store`, `currentWeek`, `openIndex`, …) e `render()`, referenziati ovunque. In ESM non si possono "spezzare" delle `let` di modulo tra più file.

**Soluzione (decisa): un oggetto context condiviso.**

Nuovo modulo `app-context.js`:

```js
import { emptyData, isoWeekKey } from "./store.js";
import { PLAN } from "./plan.js";

// Stato condiviso fra app.js e i moduli estratti.
export const ctx = {
  data: emptyData(),
  store: null,
  session: null,
  profileStorage: null,
  dataVersion: 0,
  pusher: null,
  currentWeek: isoWeekKey(new Date()),
  currentDay: "A",
  openIndex: null,       // esercizio aperto nel focus (letto dagli overlay per il blocco-scroll)
  nutritionOpen: false,  // letto da plan-editor/scan/calendar
  planOpen: false,       // letto da scan/calendar
  render: () => {},      // registrato al boot da app.js
};

// Helper trasversali (dipendono solo da ctx + moduli puri).
export const planDays = () => (Array.isArray(ctx.data.plan) && ctx.data.plan.length ? ctx.data.plan : PLAN);
export const fmtKg = (n) => Math.round(n).toLocaleString("it-IT");
```

Regole:
- `app-context.js` importa **solo moduli puri** → nessun ciclo di import.
- I moduli estratti `import { ctx, planDays, … } from "./app-context.js"`. Dentro il codice spostato, i riferimenti allo stato condiviso diventano `ctx.data`, `ctx.openIndex`, ecc. (sostituzione meccanica). **Le firme delle funzioni non cambiano.**
- Lo stato **privato** di un overlay (es. `calYear, calByDate, dbFilter, sheetsExpandedId, scanTab, drawerPending, planEditDay, audioCtx`) si sposta col modulo come `let` normale — **non** va in `ctx`.
- Lo stato **solo-focus** (`focusDrawerOpen, chartExId, chartTrack, chartAll, sha`) resta `let` locale in `app.js` (ondata 4 fuori scope).

### Cosa va in `ctx` e cosa no

- **In `ctx`** (letto/scritto oltre confine): `data, store, session, profileStorage, dataVersion, pusher, currentWeek, currentDay, openIndex, nutritionOpen, planOpen, render`.
- **Privato del modulo** (letto solo dentro): `calendarOpen, sheetsOpen, catalogOpen, scanOpen, drawerOpen` e tutto lo stato di vista dei singoli overlay.

> Nota sul blocco-scroll: solo `openIndex, nutritionOpen, planOpen` sono letti da *altri* overlay (per decidere se ripristinare `document.body.style.overflow`). Per questo sono in `ctx`; gli altri flag "aperto" restano privati.

### Chiamate inter-modulo

Default: **import diretto** del simbolo (es. `sheets-ui.js` importa `openPlanEditor` da `plan-editor.js`), finché il grafo resta **aciclico**. Se un'estrazione creasse un ciclo, la chiamata passa per **`ctx`** (funzione registrata al boot, stesso meccanismo di `ctx.render`). `render()` resta in `app.js` (è il dispatcher che chiama i renderer dei moduli) e viene registrato come `ctx.render` al boot.

## Ricetta ripetibile per ogni estrazione

Behavior-preserving, **zero cambi di logica**. Per il modulo `<M>.js`:

1. Crea `<M>.js`; sposta le funzioni + il loro stato privato.
2. Ripunta i riferimenti oltre confine: stato condiviso → `ctx.x`; helper trasversali → import da `app-context`; chiamate ad altri moduli → import diretto (o `ctx` se ciclo).
3. `export` dei punti d'ingresso che il resto dell'app chiama.
4. In `app.js`: rimuovi il codice spostato, aggiungi `import { … } from "./<M>.js"`, ricabla i renderer dentro `render()`.
5. Aggiungi `"./<M>.js"` ad `ASSETS` in `sw.js` e bumpa `CACHE` (`gymsched-vNN` → `vNN+1`).
6. **Verifica:** `node --test` (≥ 446 verdi) **e** `npm run e2e` verdi. Diff di solo spostamento + `ctx.`.
7. Commit: `refactor(app): estrai <M>.js da app.js`.

## Mappa dei moduli e ordine

Branch `refactor/app-split` (sync con `origin/main` prima di iniziare — su questo repo il main locale può essere indietro). ff-merge + push **per ondata** (4 checkpoint spedibili e verificabili su iPhone, rollback granulare).

### Ondata 0 — fondamenta
| # | Passo | Note |
|---|---|---|
| 0.1 | `tests/sw-assets.test.js` | Guard: ogni `*.js` app di root (escl. `tests/`, `scripts/`, `node_modules/`, `vendor/`, `sw.js`) deve comparire in `ASSETS` di `sw.js`. Da qui in poi protegge l'offline a ogni estrazione. |
| 0.2 | `app-context.js` | Introduce `ctx` + helper; **migra lo stato condiviso** da `let` di `app.js` a `ctx.*`, ripuntando tutti i riferimenti. Commit di fondazione (nessuna funzione spostata ancora). |
| 0.3 | `cues.js` | Audio: `ensureAudio, tone, beep, cueWarning, cueCountdown` + `audioCtx`. Zero stato condiviso. |
| 0.4 | `local-prefs.js` | Wrapper localStorage: pending/rest/bar/plates/notify/timervol/quick-comments. Quasi puro. |
| 0.5 | `a11y.js` | Helper a11y/UI condivisi: `a11yToggle, a11yRestoreFocus, mkBtn, mkPrompt, mkNew` + `a11yRefocus`. Usati da sheets-ui **e** catalog-ui → estratto prima di loro. |

### Ondata 1 — overlay
| # | Modulo | Contenuto |
|---|---|---|
| 1.1 | `calendar.js` | Tutto il blocco calendario + grafico progressione (`openCalendar…renderCalProg, openCalDay`, costanti `CAL_*`). |
| 1.2 | `scan-ui.js` | Overlay figura anatomica (`openScan…renderScan`). |
| 1.3 | `catalog-ui.js` | Overlay Database esercizi (`openCatalog…openCatalogDelete`, helper `db*`). |
| 1.4 | `sheets-ui.js` | Gestore schede (`openSheets…deleteSheetConfirm`). Importa `a11y.js` e `openPlanEditor`. |
| 1.5 | `plan-editor.js` | Editor scheda + dialog esercizio + drag (`openPlanEditor…attachDragHandle`). |
| 1.6 | `nutrition-ui.js` | Overlay guida alimentazione (`openNutrition, closeNutrition, renderNutritionOverlay`). Piccolo, estratto per coerenza. |

### Ondata 2 — sessione / timer
| # | Modulo | Contenuto |
|---|---|---|
| 2.1 | `drawer.js` | Menu drawer in fondo (`renderDrawer…wireDrawer`). |
| 2.2 | `session-clock.js` | Cronometro sessione (`startSession…tickSessionDisplays`). |
| 2.3 | `rest-ui.js` | Timer riposo (`startRest, showTimerGo, collapse/expand/discardRest, wireTimerControls, goDrain*`) + `restCtx`. |

### Ondata 3 — boot / chrome
| # | Modulo | Contenuto |
|---|---|---|
| 3.1 | `update-banner.js` | Banner update SW + store (`showUpdateBanner, showStoreUpdateBanner, renderAppLine`). |
| 3.2 | `splash-control.js` | `splashBootReady, dismissSplash, startSplashDecrypt`. |
| 3.3 | `boot.js` | `boot` + recovery/rescue/reconcile (`dumpGymschedKeys, rescueLegacyLocalStorage, forceAppUpdate, recoverLogsFromOldCloud, reconcileFromRemote`). **Alto rischio** (percorso critico) — coperto dallo smoke E2E di boot. |

### Ondata 4 — cuore focus — **FUORI SCOPE**
`renderFocusNormal, trackBlock, renderFocusSuperset, renderFocusOverlay, buildEditBlock, setRow, set/feel/chart dialog, persist, render()` (~1000+ righe). Resta in `app.js`. Da rivalutare dopo l'ondata 3.

## Stato finale atteso
`app.js` ~1500 righe: import + wiring di `ctx` + `render()` dispatcher + cuore focus + week management. Ogni overlay/feature nel proprio file. Offline garantito dal guard test. 446+ test verdi, smoke E2E verdi.

## Rischi e mitigazioni
- **Regressione DOM non intercettata dai unit test** → rete = smoke E2E (boot) + diff di solo spostamento + verifica manuale iPhone per ondata. Dove economico, aggiungere uno smoke E2E che apre l'overlay appena estratto.
- **Cicli di import** → regola "diretto se aciclico, altrimenti via `ctx`".
- **Offline rotto da modulo non in `ASSETS`** → guard test (passo 0.1) + bump `CACHE` nella ricetta.
- **Doppia fonte di verità durante 0.2** → migrare tutto lo stato condiviso in un unico commit di fondazione, non a metà.

## Verifica
- `node --test` → atteso ≥ 446 pass, 0 fail (a ogni commit).
- `npm run e2e` → boot online + offline verdi (a ogni commit).
- `git status -sb` pulito; un commit per passo.
- Verifica manuale iPhone a fine di ogni ondata (utente).
