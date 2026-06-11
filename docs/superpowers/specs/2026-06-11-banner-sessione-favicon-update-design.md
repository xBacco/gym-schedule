# Restyle: banner sessione a tutta riga · favicon adattiva · banner aggiornamento — Design

> Data: 2026-06-11 · Tema: graphite (e Carta) · Stack: vanilla JS ESM, CSS a token, Service Worker versionato.

## Problema

Tre rifiniture UI emerse dall'uso su iPhone:

1. **Banner sessione "in corso"** — la chip è compatta a sinistra (`inline-flex; align-self:flex-start`) e lascia vuota tutta la riga a destra: sbilanciato.
2. **Icona/logo** — lo splash segue il tema (SVG colorato via token), ma l'icona sulla home del telefono è un PNG statico. L'utente vorrebbe un'icona che segua chiaro/scuro.
3. **Banner aggiornamento** — è una pill ambra piena, grezza e non ignorabile.

## Obiettivi (scelte approvate sui mockup)

- **1 → opzione A**: chip sessione a **tutta larghezza**, controlli al bordo destro, nessuno spazio vuoto.
- **2 → favicon adattiva** al **tema di sistema** (chiaro/scuro). L'icona della home resta invariata (vedi Non-goals).
- **3 → opzione B**: toast terminale (bordo ambra, pallino pulsante, CTA `› aggiorna`, `✕` per rimandare). **Senza** numero di versione.

## Non-goals (limiti dichiarati)

- **Icona home dinamica su iOS**: impossibile. L'`apple-touch-icon` di una web-app è congelato al momento dell'"Aggiungi alla Home" e non segue né il tema in-app né quello di sistema. Non si tocca: resta il tile scuro attuale (`icon-180/192/512.png`, `manifest.json`).
- Lo **splash** resta com'è (già segue il tema via token CSS).
- Nessun numero di versione nel banner (eviterebbe plumbing SW→pagina e rischio di imprecisione).
- Logica pura (`timer.js`: `sessionState`/`elapsedMs`/`normalizeSessionEntry`) **invariata** → la suite Node (416) resta la rete di regressione.

---

## 1 · Banner sessione a tutta riga

**Comportamento.** Negli stati con controlli (**IN_CORSO** e **IN_PAUSA**) la chip diventa `display:flex; width:100%` con il contenuto distribuito `space-between`:

- gruppo sinistro `.sc-left`: indicatore (`.sc-dot` pulsante in corso / `.sc-ico` ⏸ in pausa) + label ("in corso · " / "in pausa · ") + tempo (`#sessClockText`);
- gruppo controlli a destra: `⏸/▶` (`.sc-toggle`) + `✕` (`.sc-x`).

Applico il full-width a **entrambi** gli stati così la chip non cambia larghezza quando si mette in pausa. Lo stato **FINITO** resta **compatto** (`inline-flex`): è terminale e senza controlli (`⏱ allenamento MM:SS`). Lo stato **PRONTO** è già il bottone "Avvia" a tutta larghezza (invariato).

**DOM (`renderSessionControl`).** Oggi i figli del nodo per gli stati con tempo sono: `[indicatore-textnode, label-textnode, #sessClockText]` poi `el.append(toggle, x)`. Ristrutturo così:

- creo uno span contenitore `.sc-left` che racchiude indicatore + label + `#sessClockText`;
- `el.replaceChildren(scLeft)` e poi `el.append(toggle, x)` come ora;
- il tick fluido resta valido: `tickSessionDisplays` continua ad aggiornare **solo** `#sessClockText` a stato invariato (il nodo esiste ancora, ora annidato in `.sc-left`), e ricostruisce solo al cambio di stato (`dataset.state`). Il pulse non si resetta.

**CSS.** Nuova regola per gli stati con controlli:

```css
.sessclock.running, .sessclock.paused { display:flex; width:100%; justify-content:space-between; }
.sessclock .sc-left { display:inline-flex; align-items:center; min-width:0; }
```

`.sessclock.ended` e la chip base restano `inline-flex` (compatte). Le classi `running`/`paused` sono già impostate da `renderSessionControl` (lavoro precedente).

**Invariante:** lo stato PRONTO non è interessato; `FINITO` resta compatto; nessun cambiamento alla logica del cronometro.

---

## 2 · Favicon adattiva al tema di sistema

**Nuovo file `favicon.svg`** — un solo SVG che si auto-adatta con `@media (prefers-color-scheme)` interno: il segno resta sempre ambra (`#f0a73c`), cambia solo lo sfondo del tile e il riempimento del chip-body.

- sistema **scuro** → sfondo `#12151a` (come l'icona attuale);
- sistema **chiaro** → sfondo `#ece3d0` (carta).

Geometria identica a `icon.svg` (stesse `rect`/`line`), così il segno è coerente.

**`index.html` `<head>`** — aggiungo (l'`apple-touch-icon` esistente NON si tocca):

```html
<link rel="icon" type="image/svg+xml" href="./favicon.svg">
<link rel="icon" type="image/png" href="./icon-192.png">   <!-- fallback browser senza SVG favicon -->
```

`favicon.svg` va aggiunto agli `ASSETS` del Service Worker e la cache va bumpata.

**Supporto:** Chrome/Firefox/Edge/Safari 16.4+ leggono l'SVG favicon con media query interna; i più vecchi cadono sul PNG. In modalità PWA standalone non c'è tab, quindi questo riguarda il browser; coerente con la richiesta ("favicon del tab in base al chiaro/scuro del sistema").

---

## 3 · Banner aggiornamento — toast terminale (opzione B)

**`showUpdateBanner(reg)`** costruisce un contenitore (non più un singolo `<button>`):

- `<div id="updateBanner" class="update-toast" role="status">`
  - `<span class="ut-dot">` (pallino ambra pulsante)
  - `<span class="ut-tx">Nuova versione disponibile</span>`
  - `<button class="ut-go">› aggiorna</button>` → stessa azione attuale: `swUpdating = true; reg.waiting?.postMessage({type:"SKIP_WAITING"})`
  - `<button class="ut-x" aria-label="Rimanda">✕</button>` → rimuove il banner e setta un flag di sessione `updateDismissed = true`

**Dismiss.** Aggiungo un flag a modulo `let updateDismissed = false`. `showUpdateBanner` esce subito se `updateDismissed` è true (oltre al guard "già presente"). Così dopo il `✕` il poll a 60s / `visibilitychange` non lo ri-mostra nella stessa sessione; al prossimo avvio (load) il flag riparte da false e, se l'update è ancora in attesa, il banner riappare. La logica `controllerchange`→reload resta invariata.

**CSS `.update-toast`** (sostituisce `#updateBanner`):

```css
.update-toast{position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:50;
  display:flex;align-items:center;gap:10px;max-width:min(420px,calc(100vw - 28px));
  background:var(--surf2);color:var(--tx);border:1px solid var(--line-acc);border-left:3px solid var(--acc);
  border-radius:12px;padding:10px 12px;box-shadow:0 8px 24px rgba(0,0,0,.5);
  animation:ut-in .28s ease-out;}
.update-toast .ut-dot{width:8px;height:8px;border-radius:50%;background:var(--acc);flex:0 0 auto;
  animation:scpulse 1.3s ease-in-out infinite;}
.update-toast .ut-tx{font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:700;flex:1;}
.update-toast .ut-go{background:var(--acc);color:var(--acc-ink);border:none;border-radius:8px;padding:7px 12px;
  font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:700;cursor:pointer;}
.update-toast .ut-x{background:none;border:none;color:var(--dim);font-size:15px;line-height:1;cursor:pointer;padding:0 2px;}
@keyframes ut-in{from{opacity:0;transform:translate(-50%,12px);}to{opacity:1;transform:translate(-50%,0);}}
@media (prefers-reduced-motion:reduce){.update-toast{animation:none;}.update-toast .ut-dot{animation:none;}}
```

Riuso `scpulse` (già definita per la chip).

---

## File toccati

| File | Modifica |
|---|---|
| `index.html` | 2 `<link rel="icon">` nel `<head>` (favicon SVG + PNG fallback). |
| `favicon.svg` | **Nuovo**: SVG auto-adattivo `prefers-color-scheme`. |
| `style.css` | `.sessclock.running/.paused` full-width + `.sc-left`; `#updateBanner` → `.update-toast` + `ut-*` + keyframe `ut-in`. |
| `app.js` | `renderSessionControl`: wrap contenuto in `.sc-left`. `showUpdateBanner`: nuovo DOM toast + `✕`; flag `updateDismissed`. |
| `sw.js` | aggiungi `./favicon.svg` agli `ASSETS`; bump `CACHE` v73 → v74. |

## Verifica

- **Regressione:** `npm test` verde (416) dopo ogni step (nessuna logica pura toccata).
- **Manuale (browser, cache SW svuotata):** chip in corso/pausa a tutta riga con controlli a destra e nessun salto di larghezza al pause; toast aggiornamento con bordo ambra/pallino/`✕` che rimanda; favicon che cambia con `prefers-color-scheme` di sistema (DevTools → Rendering → Emulate CSS prefers-color-scheme). Device iPhone a cura dell'utente dopo merge+push.

## Rischi

- **SVG favicon in Safari**: supporto solo ≥16.4; mitigato dal fallback PNG.
- **Dismiss del toast**: per scelta è di sola sessione (riappare al reload se l'update è ancora pending) — non un vero "non mostrare più".
- **Ristrutturazione DOM chip**: il tick aggiorna `#sessClockText` per id (non per posizione), quindi l'annidamento in `.sc-left` è sicuro; va comunque verificato che l'id resti unico.
