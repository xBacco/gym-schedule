# Drawer menu in fondo (peek drawer) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire le 4 icone (🥗 📅 ✎ ⚙) nella barra in alto con un drawer "a sbircio" ancorato in fondo: chiuso mostra una maniglia con "MENU" + icone in anteprima; si apre con tap o trascinamento e mostra 4 tile (Alimentazione · Calendario · Modifica scheda · Impostazioni).

**Architecture:** Nuovo elemento `#menuDrawer` (handle + panel collassabile) + `#drawerScrim`, fisso `bottom:0`. Stato `drawerOpen` con `openDrawer/closeDrawer/renderDrawer` che seguono lo **stesso pattern history** degli overlay esistenti (pushState `{gymMenu:true}`, back chiude). Le voci richiamano le funzioni già presenti `openNutrition/openCalendar/openPlanEditor` e una nuova `openSettings()` (estratta dall'handler attuale di `#settingsBtn`). Il pannello si apre via `max-height` (niente calcoli di pixel sul translate). Quando il timer di recupero è attivo (`body.timer-on`) il drawer è nascosto via CSS.

**Tech Stack:** Vanilla JS (ES modules), CSS custom properties (tema amber), Pointer Events per tap+drag, Service Worker cache.

---

## File Structure

- `index.html` — rimuove le 4 icone da `.week-row`; aggiunge `#menuDrawer` + `#drawerScrim` prima del timer bar.
- `style.css` — stili drawer (handle, panel a griglia 2×2, scrim, hide su `timer-on`).
- `app.js` — stato `drawerOpen`, funzioni open/close/render/launch, `openSettings()` estratta, wiring handle (tap+drag) e voci, ramo `popstate`, rimozione listener delle icone eliminate.
- `sw.js` — bump `CACHE` `gymsched-v23` → `gymsched-v24`.

Nessun nuovo file. Nessuna modifica a session.js/store.js (i 152 test restano invariati e verdi).

---

### Task 1: CSS del drawer

**Files:**
- Modify: `style.css` (append in fondo al file)

- [ ] **Step 1: Aggiungere gli stili del drawer**

Aggiungi in fondo a `style.css`:

```css
/* ---- Drawer menu in fondo (peek drawer) ---- */
.drawer{position:fixed;left:50%;transform:translateX(-50%);bottom:0;
  width:100%;max-width:440px;background:var(--surf);border-top:1px solid var(--line);
  border-radius:18px 18px 0 0;z-index:30;box-shadow:0 -10px 30px rgba(0,0,0,.4);}
body.timer-on .drawer,body.timer-on .drawer-scrim{display:none;}

.drawer-handle{display:block;width:100%;background:transparent;border:none;
  padding:9px 0 12px;cursor:pointer;touch-action:none;color:var(--dim);font:inherit;}
.dh-grab{display:block;width:40px;height:4px;border-radius:3px;background:var(--line);margin:0 auto;}
.dh-lbl{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:8px;
  font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--dim);}
.dh-chev{color:var(--acc);font-size:13px;line-height:1;transition:transform .2s ease;}
.drawer.open .dh-chev{transform:rotate(180deg);}
.dh-hint{display:flex;justify-content:center;gap:18px;margin-top:9px;font-size:18px;}
.drawer.open .dh-hint{display:none;}

.drawer-panel{display:grid;grid-template-columns:1fr 1fr;gap:10px;
  max-height:0;overflow:hidden;padding:0 16px;
  transition:max-height .26s ease,padding .26s ease;}
.drawer.open .drawer-panel{max-height:420px;padding:6px 16px 22px;}
.dr-item{display:flex;flex-direction:column;align-items:center;gap:7px;padding:15px 8px;
  background:var(--surf2);border:1px solid var(--line);border-radius:14px;
  color:var(--ink);font:inherit;cursor:pointer;}
.dr-item .e{font-size:23px;}
.dr-item .t{font-size:13px;font-weight:600;}
.dr-item:active{border-color:var(--acc);}

.drawer-scrim{position:fixed;inset:0;background:rgba(8,7,5,.5);z-index:25;}
.drawer-scrim.hidden{display:none;}
```

- [ ] **Step 2: Commit**

```powershell
git add style.css
git commit -m "feat(drawer): stili peek drawer menu in fondo"
```

---

### Task 2: HTML — rimuovere icone e aggiungere il drawer

**Files:**
- Modify: `index.html:32-35` (rimozione 4 icone) e `index.html:205` (inserimento drawer prima del timer bar)

- [ ] **Step 1: Rimuovere le 4 icone dalla `.week-row`**

In `index.html` la `.week-row` attuale (righe 28-36) contiene 4 `button.btn-icon`. Eliminare SOLO le 4 righe delle icone, lasciando select, `+ Sett.` e `#status`:

Da:
```html
    <div class="week-row">
      <select id="weekSelect" aria-label="Settimana"></select>
      <button id="newWeekBtn" class="btn-soft">+ Sett.</button>
      <span id="status" class="status">—</span>
      <button id="nutritionBtn" class="btn-icon" aria-label="Alimentazione">🥗</button>
      <button id="calendarBtn" class="btn-icon" aria-label="Calendario">📅</button>
      <button id="planEditBtn" class="btn-icon" aria-label="Modifica scheda">✎</button>
      <button id="settingsBtn" class="btn-icon" aria-label="Impostazioni">⚙</button>
    </div>
```

A:
```html
    <div class="week-row">
      <select id="weekSelect" aria-label="Settimana"></select>
      <button id="newWeekBtn" class="btn-soft">+ Sett.</button>
      <span id="status" class="status">—</span>
    </div>
```

- [ ] **Step 2: Aggiungere il drawer prima del timer bar**

In `index.html`, subito prima di `<!-- Rest timer -->` (riga 205), inserire:

```html
  <!-- Menu drawer in fondo -->
  <div id="drawerScrim" class="drawer-scrim hidden"></div>
  <div id="menuDrawer" class="drawer" aria-hidden="true">
    <button id="drawerHandle" class="drawer-handle" aria-label="Menu" aria-expanded="false">
      <span class="dh-grab"></span>
      <span class="dh-lbl"><span class="dh-chev">⌃</span> MENU <span class="dh-chev">⌃</span></span>
      <span class="dh-hint"><span>🥗</span><span>📅</span><span>✎</span><span>⚙</span></span>
    </button>
    <div id="drawerPanel" class="drawer-panel" role="menu">
      <button class="dr-item" data-act="nutrition" role="menuitem"><span class="e">🥗</span><span class="t">Alimentazione</span></button>
      <button class="dr-item" data-act="calendar" role="menuitem"><span class="e">📅</span><span class="t">Calendario</span></button>
      <button class="dr-item" data-act="plan" role="menuitem"><span class="e">✎</span><span class="t">Modifica scheda</span></button>
      <button class="dr-item" data-act="settings" role="menuitem"><span class="e">⚙</span><span class="t">Impostazioni</span></button>
    </div>
  </div>

```

- [ ] **Step 3: Verifica visiva rapida (server già attivo su :8099)**

Apri `http://localhost:8099/index.html` nel browser: la barra in alto non deve più mostrare le 4 icone; in fondo deve comparire la maniglia "MENU" con le 4 icone in anteprima. (Il JS non è ancora collegato: tap/voci non funzionano — è atteso.)

- [ ] **Step 4: Commit**

```powershell
git add index.html
git commit -m "feat(drawer): markup drawer in fondo, rimuove icone dalla barra"
```

---

### Task 3: JS — stato, open/close, openSettings, wiring, popstate

**Files:**
- Modify: `app.js` — aggiungere blocco drawer dopo `closeCalendar`/`calShiftMonth` (dopo riga ~148); estrarre `openSettings()`; modificare `wireSettings` (riga ~1770); modificare il blocco wiring in `boot()` (righe ~1841-1846); aggiungere ramo `popstate` (riga ~1874).

- [ ] **Step 1: Aggiungere stato e funzioni del drawer**

In `app.js`, subito dopo la funzione `calShiftMonth` (cioè dopo la riga 148, prima del blocco successivo), inserire:

```javascript
// ---- Menu drawer in fondo: stessa logica history degli overlay. ----
let drawerOpen = false;
let drawerPending = null; // azione da eseguire dopo che il drawer si è chiuso

function renderDrawer() {
  const d = document.getElementById("menuDrawer");
  const scrim = document.getElementById("drawerScrim");
  d.classList.toggle("open", drawerOpen);
  d.setAttribute("aria-hidden", drawerOpen ? "false" : "true");
  document.getElementById("drawerHandle").setAttribute("aria-expanded", String(drawerOpen));
  scrim.classList.toggle("hidden", !drawerOpen);
}
function openDrawer() {
  if (drawerOpen) return;
  drawerOpen = true;
  history.pushState({ gymMenu: true }, "");
  renderDrawer();
}
function closeDrawer() {
  if (!drawerOpen) return;
  if (history.state && history.state.gymMenu) history.back(); // → popstate chiude
  else { drawerOpen = false; renderDrawer(); }
}
function toggleDrawer() { drawerOpen ? closeDrawer() : openDrawer(); }
// Chiude il drawer e, una volta chiuso (history consumata), lancia l'azione scelta.
function drawerLaunch(fn) { drawerPending = fn; closeDrawer(); }
```

- [ ] **Step 2: Estrarre `openSettings()` a livello modulo**

L'handler attuale di `#settingsBtn` (in `wireSettings`, righe ~1770-1777) va spostato in una funzione modulo riusabile. Aggiungerla subito dopo le funzioni drawer del passo 1:

```javascript
function openSettings() {
  const dlg = document.getElementById("settingsDialog");
  document.getElementById("tokenInput").value = getToken() || "";
  document.getElementById("barInput").value = getBar();
  document.getElementById("platesInput").value = getPlateSet().join(", ");
  renderQcList();
  document.getElementById("notifyToggle").checked = notifyOn();
  dlg.showModal();
}
```

- [ ] **Step 3: Rimuovere l'handler `#settingsBtn` da `wireSettings`**

In `wireSettings` (righe ~1770-1777) eliminare SOLO il listener su `#settingsBtn` (l'elemento non esiste più). Lasciare intatto il `dlg.addEventListener("close", …)` subito sotto.

Da rimuovere:
```javascript
  document.getElementById("settingsBtn").addEventListener("click", () => {
    document.getElementById("tokenInput").value = getToken() || "";
    document.getElementById("barInput").value = getBar();
    document.getElementById("platesInput").value = getPlateSet().join(", ");
    renderQcList();
    document.getElementById("notifyToggle").checked = notifyOn();
    dlg.showModal();
  });
```

> Nota: se in cima a `wireSettings` la variabile `dlg` ora risulta usata solo dal listener `close`, lasciarla com'è — il listener `close` la usa ancora.

- [ ] **Step 4: Sostituire i listener delle icone rimosse + wiring drawer in `boot()`**

In `boot()` (righe ~1841-1846) ci sono i listener su `#nutritionBtn`, `#planEditBtn`, `#calendarBtn` (elementi rimossi). Sostituire QUELLE TRE righe (mantenendo i `*Back` e `calPrev/calNext` che riguardano gli overlay, ancora presenti):

Da:
```javascript
  document.getElementById("nutritionBtn").addEventListener("click", openNutrition);
  document.getElementById("nutritionBack").addEventListener("click", () => closeNutrition());
  document.getElementById("planEditBtn").addEventListener("click", openPlanEditor);
  document.getElementById("planBack").addEventListener("click", () => closePlanEditor());
  document.getElementById("calendarBtn").addEventListener("click", openCalendar);
  document.getElementById("calendarBack").addEventListener("click", closeCalendar);
```

A:
```javascript
  document.getElementById("nutritionBack").addEventListener("click", () => closeNutrition());
  document.getElementById("planBack").addEventListener("click", () => closePlanEditor());
  document.getElementById("calendarBack").addEventListener("click", closeCalendar);
  wireDrawer();
```

- [ ] **Step 5: Aggiungere `wireDrawer()`**

Aggiungere `wireDrawer` come funzione modulo (es. subito dopo `wireTimerControls`, prima di `initStore`):

```javascript
function wireDrawer() {
  const handle = document.getElementById("drawerHandle");
  let startY = null, moved = false;
  handle.addEventListener("pointerdown", (e) => {
    startY = e.clientY; moved = false;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (startY === null) return;
    if (Math.abs(e.clientY - startY) > 8) moved = true;
  });
  handle.addEventListener("pointerup", (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    startY = null;
    if (!moved) { toggleDrawer(); return; }      // tap
    if (dy < -24 && !drawerOpen) openDrawer();    // trascina su → apre
    else if (dy > 24 && drawerOpen) closeDrawer(); // trascina giù → chiude
  });
  document.getElementById("drawerScrim").addEventListener("click", closeDrawer);
  document.getElementById("drawerPanel").addEventListener("click", (e) => {
    const b = e.target.closest(".dr-item");
    if (!b) return;
    const map = { nutrition: openNutrition, calendar: openCalendar, plan: openPlanEditor, settings: openSettings };
    const fn = map[b.dataset.act];
    if (fn) drawerLaunch(fn);
  });
}
```

- [ ] **Step 6: Aggiungere il ramo drawer al `popstate`**

Nel listener `popstate` (righe ~1859-1878), subito dopo il blocco `if (openDlg) { … return; }` (cioè prima di `if (openIndex !== null) { hideFeelAsk(); … }`), inserire:

```javascript
    if (drawerOpen) {
      drawerOpen = false;
      renderDrawer();
      const t = drawerPending; drawerPending = null;
      if (t) t();
      return;
    }
```

- [ ] **Step 7: Verifica e2e nel browser (server :8099)**

Apri `http://localhost:8099/index.html` e verifica con Playwright/manuale:
1. Barra in alto senza icone; in fondo la maniglia "MENU" + anteprima 🥗📅✎⚙.
2. Tap sulla maniglia → il pannello sale con le 4 tile; chevron ruotano; anteprima nascosta.
3. Trascinamento su (>24px) apre; trascinamento giù sul handle chiude.
4. Tap sullo scrim chiude.
5. Tap su ogni tile apre l'overlay corretto (Alimentazione / Calendario / Modifica scheda / Impostazioni).
6. Back del browser col drawer aperto → chiude solo il drawer, resta sulla scheda.
7. Avvia un recupero (timer) → la maniglia sparisce; a timer finito (`✕`) riappare.

- [ ] **Step 8: `npm test` — i 152 test restano verdi**

```powershell
Set-Location C:\Users\TomasCoro\gym-schedule; npm test
```
Atteso: tutti i test pass (nessuna regressione; session.js/store.js non toccati).

- [ ] **Step 9: Commit**

```powershell
git add app.js
git commit -m "feat(drawer): stato, tap+drag, voci e back-button del drawer menu"
```

---

### Task 4: Bump cache Service Worker

**Files:**
- Modify: `sw.js:5`

- [ ] **Step 1: Bump CACHE**

In `sw.js` riga 5, da:
```javascript
const CACHE = "gymsched-v23";
```
a:
```javascript
const CACHE = "gymsched-v24";
```

- [ ] **Step 2: Commit**

```powershell
git add sw.js
git commit -m "chore(sw): bump cache a v24 per drawer menu"
```

---

## Verifica finale

- [ ] `Set-Location C:\Users\TomasCoro\gym-schedule; npm test` → 152 test, 0 fail.
- [ ] Browser su porta pulita: barra in alto senza icone, drawer in fondo funzionante (tap+drag, voci, back, hide su timer).
- [ ] `git status -sb` → `## main...origin/main` pulito dopo i commit.

## Note di integrazione (per chi esegue)

- z-index: drawer 30 / scrim 25, **sotto** gli overlay a schermo intero (z40) e la timerbar (z60): quando un overlay è aperto copre la maniglia, corretto.
- Il `padding-bottom:132px` di `.wrap` è già > altezza maniglia (~64px): la lista non resta nascosta dietro la maniglia, nessuna modifica necessaria.
- Il drawer NON è un `<dialog>`: usa il ramo `popstate` dedicato (non quello `dialog[open]`). Quando il drawer è aperto nessun dialog/overlay è aperto, quindi il ramo `dialog[open]` viene saltato e si raggiunge il ramo drawer.
- `drawerLaunch`: `closeDrawer()` fa `history.back()` (consuma `gymMenu`) → `popstate` chiude il drawer ed esegue `drawerPending` (es. `openNutrition`, che a sua volta fa `pushState gymNutrition`). History pulita: back dall'overlay torna alla scheda.
