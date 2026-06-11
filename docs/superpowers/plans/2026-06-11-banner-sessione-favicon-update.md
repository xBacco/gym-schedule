# Banner sessione full-width · favicon adattiva · toast aggiornamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tre rifiniture UI: la chip sessione "in corso"/"in pausa" occupa l'intera riga con i controlli al bordo destro; il favicon del tab segue chiaro/scuro di sistema; il banner di aggiornamento PWA diventa un toast terminale ignorabile per sessione.

**Architecture:** Solo presentazione (DOM/CSS/asset). La logica pura del cronometro (`timer.js`: `sessionState`/`elapsedMs`/`normalizeSessionEntry`) **non si tocca**, quindi la suite Node resta intatta come rete di regressione. Le modifiche sono: ristrutturazione DOM in `renderSessionControl` (wrap del gruppo sinistro in `.sc-left`), nuova regola CSS full-width, nuovo `favicon.svg` con media query interna, sostituzione del banner-bottone con un toast multi-elemento + flag di dismiss di sessione, e un singolo bump della cache del Service Worker a fine lavoro.

**Tech Stack:** vanilla JS ESM, CSS a token (`var(--acc)`, `var(--surf2)`, …), Service Worker versionato (`node --test` per la regressione).

> **Verifica & strategia di test.** La suite (`npm test` → `node --test`, **416** test) copre solo logica pura: nessun test rende `renderSessionControl` o `showUpdateBanner` nel DOM (la fase 1, che toccava la stessa funzione, non aggiunse test DOM — pattern consolidato del repo). Quindi qui **non** si scrivono unit test DOM nuovi: i 416 test servono a dimostrare che nessuna logica è stata rotta, e la verifica visiva è manuale in browser con cache SW svuotata. Ogni task esegue `npm test` come gate di regressione prima del commit.

> **Branch.** Si lavora sul branch già attivo `feat/banner-sessione-favicon-update` (la spec è già committata lì). Nessun nuovo branch/worktree.

---

## File Structure

| File | Responsabilità nel piano |
|---|---|
| `app.js` | `renderSessionControl`: wrap del gruppo sinistro in `.sc-left` (Task 1). `showUpdateBanner` + nuovo flag `updateDismissed`: toast multi-elemento con `✕` (Task 3). |
| `style.css` | Regola full-width `.sessclock.running/.paused` + `.sc-left` (Task 1). Sostituzione `#updateBanner` → `.update-toast` + `ut-*` + keyframe `ut-in` (Task 3). |
| `favicon.svg` | **Nuovo**: SVG auto-adattivo via `@media (prefers-color-scheme)` interno, geometria identica a `icon.svg` (Task 2). |
| `index.html` | Due `<link rel="icon">` nel `<head>` (SVG + PNG fallback) (Task 2). |
| `sw.js` | `./favicon.svg` aggiunto agli `ASSETS` (Task 2) + bump `CACHE` v73→v74 una sola volta a fine lavoro (Task 4). |

---

## Task 1: Banner sessione a tutta riga

Negli stati **IN_CORSO** e **IN_PAUSA** la chip diventa `display:flex; width:100%`: il gruppo sinistro (indicatore + label + tempo) viene avvolto in uno `span.sc-left` con `flex:1`, così cresce e spinge i controlli (`⏸/▶` + `✕`) al bordo destro. Applicato a entrambi gli stati per non far cambiare larghezza alla chip quando si mette in pausa. **FINITO** resta compatto (`inline-flex`, `.ended`); **PRONTO** è già il bottone full-width (invariato).

> **Nota di design (perché `flex:1` e non `space-between`):** i figli flex della chip sono tre (`.sc-left`, `.sc-toggle`, `.sc-x`). Con `justify-content:space-between` il `⏸/▶` finirebbe spaziato al centro. Con `.sc-left{flex:1}` invece il gruppo sinistro riempie lo spazio e i due controlli restano appaiati a destra (mantengono i loro `margin-left:8px`). Questo conserva esattamente il DOM `el.append(toggle, x)` esistente.

**Files:**
- Modify: `app.js:1476-1494` (corpo di `renderSessionControl` per gli stati con tempo)
- Modify: `style.css:599-624` (blocco `.sessclock` / `.sc-*`)

- [ ] **Step 1: Wrap del gruppo sinistro in `.sc-left` (`app.js`)**

Sostituisci il blocco esistente che costruisce `kids` e chiama `el.replaceChildren(...kids)` (attualmente `app.js:1476-1494`):

```js
  const secs = elapsedMs(entry, Date.now()) / 1000;
  const txt = document.createElement("span");
  txt.className = "sc-t";
  txt.id = "sessClockText";
  txt.textContent = fmtDuration(secs); // SOLO il tempo: il tick aggiorna questo nodo
  const kids = [];
  if (state === "IN_CORSO") {
    const dot = document.createElement("span");
    dot.className = "sc-dot";
    kids.push(dot, document.createTextNode("in corso · "), txt);
  } else if (state === "IN_PAUSA") {
    const ico = document.createElement("span");
    ico.className = "sc-ico";
    ico.textContent = "⏸";
    kids.push(ico, document.createTextNode("in pausa · "), txt);
  } else { // FINITO
    kids.push(document.createTextNode("⏱ allenamento "), txt);
  }
  el.replaceChildren(...kids);
```

con questa versione, che avvolge gli stessi figli in uno `span.sc-left`:

```js
  const secs = elapsedMs(entry, Date.now()) / 1000;
  const txt = document.createElement("span");
  txt.className = "sc-t";
  txt.id = "sessClockText";
  txt.textContent = fmtDuration(secs); // SOLO il tempo: il tick aggiorna questo nodo
  // Gruppo sinistro: indicatore + label + tempo. Con `.sc-left{flex:1}` (CSS)
  // riempie la riga full-width e spinge i controlli al bordo destro.
  const scLeft = document.createElement("span");
  scLeft.className = "sc-left";
  if (state === "IN_CORSO") {
    const dot = document.createElement("span");
    dot.className = "sc-dot";
    scLeft.append(dot, document.createTextNode("in corso · "), txt);
  } else if (state === "IN_PAUSA") {
    const ico = document.createElement("span");
    ico.className = "sc-ico";
    ico.textContent = "⏸";
    scLeft.append(ico, document.createTextNode("in pausa · "), txt);
  } else { // FINITO
    scLeft.append(document.createTextNode("⏱ allenamento "), txt);
  }
  el.replaceChildren(scLeft);
```

Il resto della funzione (guard `if (state === "FINITO") return;`, creazione di `toggle`/`x`, `el.append(toggle, x)`) **non cambia**. `#sessClockText` resta un id unico, ora annidato in `.sc-left`: il tick (`tickSessionDisplays`) continua ad aggiornarlo per id, quindi il pulse non si resetta.

- [ ] **Step 2: Regola CSS full-width (`style.css`)**

Nel blocco `.sessclock`, subito dopo la riga `.sessclock.paused{color:var(--dim);border-color:var(--line);}` (attualmente `style.css:622`), aggiungi:

```css
/* In corso / in pausa: chip a tutta riga, controlli al bordo destro */
.sessclock.running,.sessclock.paused{display:flex;width:100%;}
.sessclock .sc-left{display:inline-flex;align-items:center;min-width:0;flex:1;}
```

`.sessclock.ended` (FINITO) e la chip base restano `inline-flex` (compatte): non vengono toccate. Le classi `running`/`paused` sono già impostate da `renderSessionControl` (`el.classList.toggle("running"/"paused", …)`).

- [ ] **Step 3: Regressione — `npm test`**

Run: `npm test`
Expected: `# pass 416` / `# fail 0` (nessuna logica pura toccata).

- [ ] **Step 4: Verifica manuale rapida (facoltativa ma raccomandata)**

Apri `index.html` servito in locale, avvia una sessione: la chip "in corso" occupa l'intera riga con `⏸ ✕` a destra; metti in pausa → la chip **non** cambia larghezza, mostra `⏸` (icona) a sinistra e `▶ ✕` a destra. Restringi a 320px: nessun overflow.

- [ ] **Step 5: Commit**

```bash
git add app.js style.css
git commit -m "feat(sessione): chip in corso/pausa a tutta riga, controlli a destra"
```

---

## Task 2: Favicon adattiva al tema di sistema

Un solo `favicon.svg` con `@media (prefers-color-scheme)` interno (via `<style>`): il segno resta sempre ambra `#f0a73c`; cambiano lo sfondo del tile e il riempimento del chip-body (scuro `#12151a` / chiaro `#ece3d0`). Geometria identica a `icon.svg`. Due `<link rel="icon">` nel `<head>` (SVG + PNG fallback per browser senza SVG-favicon). L'`apple-touch-icon` **non si tocca**.

**Files:**
- Create: `favicon.svg`
- Modify: `index.html:10` (aggiunta dopo l'`apple-touch-icon`)
- Modify: `sw.js:25` (aggiunta `./favicon.svg` agli `ASSETS`)

- [ ] **Step 1: Crea `favicon.svg`**

Crea il file `favicon.svg` (root del progetto) con questo contenuto. Sfondo e chip-body usano classi CSS che cambiano fill con la media query; il resto del segno è ambra fisso (stesse `rect`/`line` di `icon.svg`):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <style>
    .bg{fill:#12151a;}
    .chip{fill:#12151a;}
    @media (prefers-color-scheme: light){
      .bg{fill:#ece3d0;}
      .chip{fill:#ece3d0;}
    }
  </style>
  <rect class="bg" width="512" height="512" rx="112"/>
  <g fill="#f0a73c">
    <rect x="150" y="191" width="40" height="130" rx="16"/>
    <rect x="322" y="191" width="40" height="130" rx="16"/>
    <rect x="104" y="215" width="30" height="82" rx="12"/>
    <rect x="378" y="215" width="30" height="82" rx="12"/>
  </g>
  <g stroke="#f0a73c" stroke-width="7" stroke-linecap="round">
    <line x1="190" y1="244" x2="228" y2="244"/>
    <line x1="190" y1="268" x2="228" y2="268"/>
    <line x1="284" y1="244" x2="322" y2="244"/>
    <line x1="284" y1="268" x2="322" y2="268"/>
  </g>
  <g fill="#f0a73c">
    <rect x="236" y="214" width="8" height="14" rx="2"/>
    <rect x="252" y="214" width="8" height="14" rx="2"/>
    <rect x="268" y="214" width="8" height="14" rx="2"/>
    <rect x="236" y="284" width="8" height="14" rx="2"/>
    <rect x="252" y="284" width="8" height="14" rx="2"/>
    <rect x="268" y="284" width="8" height="14" rx="2"/>
  </g>
  <rect class="chip" x="228" y="228" width="56" height="56" rx="6" stroke="#f0a73c" stroke-width="7"/>
  <rect x="246" y="246" width="20" height="20" rx="4" fill="#f0a73c"/>
</svg>
```

- [ ] **Step 2: Aggiungi i `<link rel="icon">` nel `<head>` (`index.html`)**

Dopo la riga `  <link rel="apple-touch-icon" href="./icon-180.png">` (attualmente `index.html:10`) inserisci:

```html
  <link rel="icon" type="image/svg+xml" href="./favicon.svg">
  <link rel="icon" type="image/png" href="./icon-192.png">
```

L'`apple-touch-icon` resta esattamente com'è (icona home iOS invariata).

- [ ] **Step 3: Aggiungi `favicon.svg` agli `ASSETS` del Service Worker (`sw.js`)**

Nel array `ASSETS`, subito dopo la riga `  "./icon.svg",` (attualmente `sw.js:25`) aggiungi:

```js
  "./favicon.svg",
```

> Il bump della `CACHE` avviene una sola volta nel Task 4 (anche `style.css`/`app.js`/`index.html` cambiano): non bumparla qui.

- [ ] **Step 4: Regressione — `npm test`**

Run: `npm test`
Expected: `# pass 416` / `# fail 0`.

- [ ] **Step 5: Verifica manuale rapida (facoltativa)**

In DevTools → Rendering → "Emulate CSS prefers-color-scheme": passando da `dark` a `light` il favicon nella tab cambia sfondo (scuro ↔ carta) col segno ambra invariato.

- [ ] **Step 6: Commit**

```bash
git add favicon.svg index.html sw.js
git commit -m "feat(pwa): favicon SVG adattivo al tema di sistema + fallback PNG"
```

---

## Task 3: Banner aggiornamento → toast terminale

`showUpdateBanner` costruisce un `<div class="update-toast">` (non più un singolo `<button>`) con: pallino ambra pulsante, testo "Nuova versione disponibile", CTA `› aggiorna` (stessa azione `SKIP_WAITING` di oggi) e `✕` che rimuove il banner e setta `updateDismissed = true`. Il flag impedisce al poll a 60s / `visibilitychange` di ri-mostrarlo nella stessa sessione; al prossimo load riparte da `false`. La logica `controllerchange`→reload **non cambia**.

**Files:**
- Modify: `app.js:3914` (aggiunta del flag `updateDismissed`)
- Modify: `app.js:3917-3928` (corpo di `showUpdateBanner`)
- Modify: `style.css:558-562` (sostituzione blocco `#updateBanner`)

- [ ] **Step 1: Aggiungi il flag di dismiss (`app.js`)**

Dopo la riga `let swUpdating = false;` (attualmente `app.js:3914`) aggiungi:

```js
// Toast aggiornamento rimandato col `✕`: di sola sessione (riparte a false al
// prossimo load, così se l'update è ancora pending il toast riappare).
let updateDismissed = false;
```

- [ ] **Step 2: Riscrivi `showUpdateBanner` come toast (`app.js`)**

Sostituisci l'intera funzione esistente (attualmente `app.js:3917-3928`):

```js
function showUpdateBanner(reg) {
  if (document.getElementById("updateBanner")) return;
  const b = document.createElement("button");
  b.id = "updateBanner";
  b.type = "button";
  b.textContent = "Nuova versione · tocca per aggiornare";
  b.addEventListener("click", () => {
    swUpdating = true;
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
  });
  document.body.appendChild(b);
}
```

con:

```js
function showUpdateBanner(reg) {
  if (updateDismissed) return;                                 // rimandato in questa sessione
  if (document.getElementById("updateBanner")) return;         // già presente
  const b = document.createElement("div");
  b.id = "updateBanner";
  b.className = "update-toast";
  b.setAttribute("role", "status");

  const dot = document.createElement("span");
  dot.className = "ut-dot";

  const tx = document.createElement("span");
  tx.className = "ut-tx";
  tx.textContent = "Nuova versione disponibile";

  const go = document.createElement("button");
  go.type = "button";
  go.className = "ut-go";
  go.textContent = "› aggiorna";
  go.addEventListener("click", () => {
    swUpdating = true;
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
  });

  const x = document.createElement("button");
  x.type = "button";
  x.className = "ut-x";
  x.textContent = "✕";
  x.setAttribute("aria-label", "Rimanda");
  x.addEventListener("click", () => {
    updateDismissed = true;
    b.remove();
  });

  b.append(dot, tx, go, x);
  document.body.appendChild(b);
}
```

- [ ] **Step 3: Sostituisci il CSS del banner (`style.css`)**

Sostituisci il blocco esistente (attualmente `style.css:558-562`):

```css
/* banner aggiornamento PWA */
#updateBanner{position:fixed;left:50%;transform:translateX(-50%);bottom:84px;z-index:50;
  background:var(--acc);color:var(--acc-ink);border:none;border-radius:12px;padding:11px 16px;
  font-family:"JetBrains Mono",monospace;font-size:12px;font-weight:700;cursor:pointer;
  box-shadow:0 6px 20px rgba(0,0,0,.4);}
```

con il toast terminale (riusa il keyframe `scpulse` già definito per la chip):

```css
/* banner aggiornamento PWA — toast terminale */
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

> Token usati, tutti già definiti in entrambi i temi: `var(--surf2)`/`var(--line-acc)` (come `.sessclock`), `var(--acc)`/`var(--acc-ink)`/`var(--dim)`, e `var(--tx)` (= "testo in evidenza", chiaro `#2f2614` / scuro `#eef1f4`, alto contrasto su `--surf2`). Nessuna incognita.

- [ ] **Step 4: Regressione — `npm test`**

Run: `npm test`
Expected: `# pass 416` / `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add app.js style.css
git commit -m "feat(pwa): banner aggiornamento come toast terminale con dismiss di sessione"
```

---

## Task 4: Bump cache Service Worker + verifica finale

Tutti i file dell'app-shell (`index.html`, `style.css`, `app.js`, nuovo `favicon.svg`) sono cambiati: un solo bump della `CACHE` invalida la cache vecchia ed evita codice stantio.

**Files:**
- Modify: `sw.js:5` (`CACHE` v73 → v74)

- [ ] **Step 1: Bump della cache (`sw.js`)**

Sostituisci la riga (attualmente `sw.js:5`):

```js
const CACHE = "gymsched-v73";
```

con:

```js
const CACHE = "gymsched-v74";
```

- [ ] **Step 2: Regressione finale — `npm test`**

Run: `npm test`
Expected: `# pass 416` / `# fail 0`.

- [ ] **Step 3: Verifica manuale completa (browser, cache SW svuotata)**

In DevTools → Application → Service Workers: "Unregister", poi hard reload. Controlla:
1. Chip "in corso"/"in pausa" a tutta riga, controlli a destra, nessun salto di larghezza al pause; nessun overflow a 320/390px.
2. Favicon del tab che cambia con `prefers-color-scheme` di sistema (DevTools → Rendering → Emulate).
3. Toast aggiornamento con bordo ambra/pallino/`✕`: il `✕` lo rimuove e non riappare fino al reload.

(Verifica su device iPhone: a cura dell'utente dopo merge+push.)

- [ ] **Step 4: Commit**

```bash
git add sw.js
git commit -m "chore(sw): bump cache v73 -> v74"
```

---

## Self-Review (eseguita in fase di stesura)

**Spec coverage:**
- Obiettivo 1 (chip full-width, opzione A) → Task 1 ✓ (IN_CORSO + IN_PAUSA full-width, FINITO compatto, PRONTO invariato).
- Obiettivo 2 (favicon adattiva al tema di sistema, home iOS invariata) → Task 2 ✓ (`favicon.svg` + 2 link, `apple-touch-icon` non toccato).
- Obiettivo 3 (toast terminale opzione B, dismiss di sessione, senza versione) → Task 3 ✓.
- `favicon.svg` negli `ASSETS` + bump cache → Task 2 (ASSETS) + Task 4 (bump) ✓.
- Non-goal "logica pura invariata, 416 test rete di regressione" → rispettato: nessun file di `timer.js`/logica toccato; gate `npm test` in ogni task ✓.

**Scostamento dalla spec (motivato):** la spec sezione 1 dava `justify-content:space-between`. Con 3 figli flex (`.sc-left`, `.sc-toggle`, `.sc-x`) `space-between` spazia il toggle al centro. Il piano usa invece `.sc-left{flex:1}` (gruppo sinistro che riempie, controlli appaiati a destra), che ottiene il layout voluto mantenendo il DOM `el.append(toggle, x)` esistente. Risultato visivo identico all'intento "controlli al bordo destro".

**Placeholder scan:** nessun TBD/TODO/"gestisci edge case"; ogni step di codice mostra il codice completo. ✓

**Type/naming consistency:** classi (`.sc-left`, `.update-toast`, `.ut-dot/.ut-tx/.ut-go/.ut-x`), id (`updateBanner`, `sessClockText`), flag (`updateDismissed`, `swUpdating`) e keyframe (`scpulse`, `ut-in`) coerenti tra app.js e style.css. ✓

**Rischi verificati:** tutti i token CSS del toast (`--surf2`, `--line-acc`, `--acc`, `--acc-ink`, `--dim`, `--tx`) esistono in entrambi i temi (controllato in `style.css:7-43`) — nessun fallback necessario. Rischio residuo solo lato browser: SVG-favicon con media query interna è supportato da Chrome/Firefox/Edge/Safari ≥16.4, i più vecchi cadono sul PNG fallback (per design).
