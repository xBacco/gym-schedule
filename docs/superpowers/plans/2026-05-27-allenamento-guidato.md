# Allenamento guidato — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere anteprima del prossimo esercizio nell'overlay, notifica di fine recupero best-effort, e fix del popup commento veloce non centrato (spec `2026-05-27-allenamento-guidato-design.md`).

**Architecture:** Una funzione pura nuova in `session.js` (`nextExercisePreview`) coperta da test. Il resto è DOM/CSS in `app.js`/`index.html`/`style.css`/`sw.js`, non testabile in Node → verifica in browser reale. La striscia "prossimo" si inietta in un punto unico (`renderFocusOverlay`) per non duplicare codice tra render normale e superset. La notifica usa la registrazione del service worker già presente.

**Tech Stack:** Vanilla JS ES modules, `node --test`, PWA service worker, Notification API.

**Convenzioni del progetto:**
- Gate logico: `node --test` (atteso prima: **pass 114**; dopo il Task 1: **pass 116** — due nuovi test).
- Commit + push su `main` (no PR). Su PowerShell, prima del push: `git fetch origin` + `git pull --ff-only origin main`. Messaggi commit via `-m` (NON here-string: introduce un BOM).
- DOM/CSS verificati in browser reale (server HTTP locale + Playwright), perché `app.js` non è testato in Node.

**Gate logico (PowerShell):**
```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test 2>&1 | Select-Object -Last 6; Pop-Location
```

**Servire l'app per la verifica (Task 6):**
```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
Start-Process python -ArgumentList '-m','http.server','8780' -WindowStyle Hidden
# aprire http://localhost:8780/index.html ; se compare "Nuova versione", cliccarlo (attiva cache v14)
```

---

## File Structure

- `session.js` — **Modify**: aggiunge `nextExercisePreview(exercises, idx)` (logica pura).
- `tests/session.test.js` — **Modify**: 2 test per `nextExercisePreview`.
- `app.js` — **Modify**: import di `nextExercisePreview`; `buildNextStrip` + chiamata in `renderFocusOverlay`; helper `notifyOn`/`showRestDoneBanner`; variabile `swReg`; logica notifica in `timer.onEnd`; wiring toggle in `wireSettings`.
- `index.html` — **Modify**: checkbox "Avvisi recupero" nel dialog impostazioni; markup banner `#restDoneBanner`.
- `style.css` — **Modify**: `margin:auto` su `dialog`; stile `.nextstrip`; stile `.restdone`.
- `sw.js` — **Modify**: handler `notificationclick`; bump `CACHE` → `gymsched-v14`.

Nessun file nuovo.

---

## Task 1: Helper puro `nextExercisePreview` (TDD)

**Files:**
- Modify: `tests/session.test.js`
- Modify: `session.js`

- [ ] **Step 1: Scrivi i test (RED)**

In `tests/session.test.js`, aggiungere `nextExercisePreview` all'import esistente da `../session.js` (la riga 3 che importa `parseTargetTrack, parseTarget, ...`). Poi, in fondo al file, aggiungere:

```js
test("nextExercisePreview: ritorna nome+target del successivo", () => {
  const ex = [{ name: "A", setsReps: "3 × 10" }, { name: "B", setsReps: "3 × 12" }];
  assert.deepEqual(nextExercisePreview(ex, 0), { last: false, name: "B", target: "3 × 12" });
});

test("nextExercisePreview: ultimo esercizio -> { last: true }", () => {
  const ex = [{ name: "A", setsReps: "3 × 10" }, { name: "B", setsReps: "3 × 12" }];
  assert.deepEqual(nextExercisePreview(ex, 1), { last: true });
});
```

- [ ] **Step 2: Esegui i test (devono FALLIRE)**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test 2>&1 | Select-Object -Last 6; Pop-Location
```
Atteso: FAIL (`nextExercisePreview is not a function` / non esportato).

- [ ] **Step 3: Implementa la funzione (GREEN)**

In `session.js`, aggiungere (in fondo o vicino a `parseTarget`):

```js
// Dati per la striscia "prossimo esercizio" nell'overlay.
// exercises: array degli esercizi del giorno; idx: indice di quello aperto.
// Se non c'è un successivo (ultimo esercizio o idx fuori range) -> { last: true }.
// Altrimenti -> { last: false, name, target } del successivo.
export function nextExercisePreview(exercises, idx) {
  const next = Array.isArray(exercises) ? exercises[idx + 1] : undefined;
  if (!next) return { last: true };
  return { last: false, name: next.name, target: next.setsReps };
}
```

- [ ] **Step 4: Esegui i test (devono PASSARE)**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test 2>&1 | Select-Object -Last 6; Pop-Location
```
Atteso: **pass 116**, fail 0.

- [ ] **Step 5: Commit**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git fetch origin 2>&1 | Out-Null; git pull --ff-only origin main 2>&1 | Select-Object -Last 1
git add session.js tests/session.test.js
git commit -m "feat(session): nextExercisePreview per l'anteprima prossimo esercizio" -m "Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push origin main 2>&1 | Select-Object -Last 1
Pop-Location
```

---

## Task 2: Striscia "Prossimo esercizio" nell'overlay

**Files:**
- Modify: `app.js`
- Modify: `style.css`

- [ ] **Step 1: Importa l'helper**

In cima ad `app.js`, aggiungere `nextExercisePreview` alla riga di import da `./session.js` (quella che già importa `parseTarget`, `prefillSets`, ecc.).

- [ ] **Step 2: Aggiungi `buildNextStrip`**

In `app.js`, subito **prima** di `function renderFocusOverlay()` (riga ~1105), inserire:

```js
// Striscia informativa in fondo all'overlay: prossimo esercizio o "ultimo".
function buildNextStrip(exercises, idx) {
  const info = nextExercisePreview(exercises, idx);
  const strip = document.createElement("div");
  strip.className = "nextstrip";
  if (info.last) {
    strip.classList.add("end");
    const t = document.createElement("span");
    t.className = "nx-end";
    t.textContent = "Ultimo esercizio della sessione";
    strip.appendChild(t);
  } else {
    const tag = document.createElement("span");
    tag.className = "nx-tag"; tag.textContent = "Prossimo";
    const arrow = document.createElement("span");
    arrow.className = "nx-arrow"; arrow.textContent = "→";
    const nm = document.createElement("span");
    nm.className = "nx-name"; nm.textContent = info.name;
    const tg = document.createElement("span");
    tg.className = "nx-target"; tg.textContent = info.target;
    strip.append(tag, arrow, nm, tg);
  }
  return strip;
}
```

- [ ] **Step 3: Inietta la striscia nel footer (punto unico)**

In `renderFocusOverlay`, subito dopo la riga `foot.textContent = "";` (riga ~1119), aggiungere:

```js
  foot.appendChild(buildNextStrip(dayPlan().exercises, openIndex));
```

Così la striscia è il primo figlio del footer e la CTA, aggiunta dopo da `renderFocusNormal`/`renderFocusSuperset`, le finisce sotto (ordine DOM = ordine visivo nel footer flex-column).

- [ ] **Step 4: Stile della striscia**

In `style.css`, dopo la regola `.qc-dialog{...}` (riga ~264), aggiungere:

```css
.nextstrip{display:flex;align-items:center;gap:8px;padding:8px 2px 12px;
  border-top:1px solid var(--line);margin-bottom:10px;}
.nextstrip .nx-tag{font-size:10px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--faint);font-weight:700;}
.nextstrip .nx-arrow{color:var(--faint);}
.nextstrip .nx-name{font-size:14px;font-weight:600;color:var(--dim);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.nextstrip .nx-target{margin-left:auto;font-size:12px;color:var(--dim);
  font-family:"JetBrains Mono",monospace;opacity:.85;white-space:nowrap;}
.nextstrip.end .nx-end{font-size:12px;color:var(--faint);font-style:italic;}
```

- [ ] **Step 5: Sanity check logico (la suite resta verde)**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test 2>&1 | Select-Object -Last 6; Pop-Location
```
Atteso: **pass 116**, fail 0 (nessun test tocca `app.js`; serve solo a confermare che non si sono rotti gli import).

- [ ] **Step 6: Commit**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git fetch origin 2>&1 | Out-Null; git pull --ff-only origin main 2>&1 | Select-Object -Last 1
git add app.js style.css
git commit -m "feat(focus): striscia anteprima prossimo esercizio sopra la CTA" -m "Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push origin main 2>&1 | Select-Object -Last 1
Pop-Location
```

---

## Task 3: Fix popup commento veloce centrato

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Ripristina `margin:auto` sui dialog**

In `style.css`, la regola alla riga ~161 è:

```css
dialog{border:none;border-radius:16px;padding:18px;max-width:340px;background:var(--surf);color:var(--ink);}
```

Sostituirla con (aggiunto solo `margin:auto;`):

```css
dialog{border:none;border-radius:16px;padding:18px;max-width:340px;background:var(--surf);color:var(--ink);margin:auto;}
```

Questo annulla l'effetto del reset globale `*{margin:0}` che impediva al browser di centrare i `<dialog>` modali, riportandoli al centro (commento veloce, modifica serie, impostazioni).

- [ ] **Step 2: Commit**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git fetch origin 2>&1 | Out-Null; git pull --ff-only origin main 2>&1 | Select-Object -Last 1
git add style.css
git commit -m "fix(css): ricentra i dialog modali (margin:auto su dialog)" -m "Il reset globale *{margin:0} annullava il margin:auto UA dei dialog -> apparivano in alto a sinistra." -m "Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push origin main 2>&1 | Select-Object -Last 1
Pop-Location
```

---

## Task 4: Toggle "Avvisi recupero" in Impostazioni

**Files:**
- Modify: `index.html`
- Modify: `app.js`

- [ ] **Step 1: Aggiungi il checkbox nel dialog impostazioni**

In `index.html`, dentro `<form class="settings">`, **subito prima** del blocco `<menu>` (riga ~59), inserire:

```html
        <fieldset class="setblock">
          <legend>Avvisi recupero</legend>
          <label class="notifyrow"><input type="checkbox" id="notifyToggle"> Notifica a fine recupero</label>
          <p class="hint">A schermo bloccato o app chiusa la notifica potrebbe non arrivare (limite del browser).</p>
        </fieldset>
```

- [ ] **Step 2: Helper `notifyOn` e variabile `swReg`**

In `app.js`, vicino agli altri `*_KEY` di localStorage (cerca `BAR_KEY`/`PLATES_KEY`), aggiungere:

```js
const NOTIFY_KEY = "gymsched_notify";
function notifyOn() {
  return localStorage.getItem(NOTIFY_KEY) === "1"
    && "Notification" in window && Notification.permission === "granted";
}
```

E a livello di modulo, vicino a `let swUpdating = false;` (riga ~1320), aggiungere:

```js
let swReg = null;
```

- [ ] **Step 3: Salva la registrazione del SW**

In `app.js`, nella `.then((reg) => {` della registrazione service worker (riga ~1342), aggiungere come **prima** riga del callback:

```js
      swReg = reg;
```

- [ ] **Step 4: Wiring del toggle in `wireSettings`**

In `wireSettings`, dentro l'handler `settingsBtn` click (dove si fa `dlg.showModal()`), **prima** di `dlg.showModal();` aggiungere:

```js
    document.getElementById("notifyToggle").checked = notifyOn();
```

E, sempre in `wireSettings` (una sola volta, es. subito dopo il listener di `qcAdd`), aggiungere il listener del toggle:

```js
  document.getElementById("notifyToggle").addEventListener("change", async (e) => {
    if (!e.target.checked) { localStorage.setItem(NOTIFY_KEY, "0"); return; }
    if (!("Notification" in window)) {
      e.target.checked = false;
      alert("Notifiche non supportate da questo browser.");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      localStorage.setItem(NOTIFY_KEY, "1");
    } else {
      e.target.checked = false;
      localStorage.setItem(NOTIFY_KEY, "0");
      alert("Permesso notifiche negato dal browser/sistema.");
    }
  });
```

- [ ] **Step 5: Sanity check logico**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test 2>&1 | Select-Object -Last 6; Pop-Location
```
Atteso: **pass 116**, fail 0.

- [ ] **Step 6: Commit**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git fetch origin 2>&1 | Out-Null; git pull --ff-only origin main 2>&1 | Select-Object -Last 1
git add index.html app.js
git commit -m "feat(settings): toggle Avvisi recupero con richiesta permesso notifiche" -m "Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push origin main 2>&1 | Select-Object -Last 1
Pop-Location
```

---

## Task 5: Notifica + banner a fine recupero

**Files:**
- Modify: `index.html`
- Modify: `app.js`
- Modify: `style.css`
- Modify: `sw.js`

- [ ] **Step 1: Markup del banner in-app**

In `index.html`, **subito prima** di `<div id="timerBar" ...>` (riga ~116), inserire:

```html
  <div id="restDoneBanner" class="restdone hidden">RECUPERO FINITO</div>
```

- [ ] **Step 2: Helper banner**

In `app.js`, vicino a `startRest` (riga ~137), aggiungere:

```js
function showRestDoneBanner() {
  const b = document.getElementById("restDoneBanner");
  if (!b) return;
  b.classList.remove("hidden");
  clearTimeout(showRestDoneBanner._t);
  showRestDoneBanner._t = setTimeout(() => b.classList.add("hidden"), 2500);
}
```

- [ ] **Step 3: Aggiorna `timer.onEnd`**

In `app.js`, l'attuale callback (riga ~126):

```js
  onEnd: () => {
    hideFeelAsk();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    beep();
    setTimeout(() => {
      document.getElementById("timerBar").classList.add("hidden");
      document.body.classList.remove("timer-on");
    }, 1500);
  },
```

va sostituito con (riceve `label`, che è `ex.name` passato a `startRest`):

```js
  onEnd: (label) => {
    hideFeelAsk();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    beep();
    if (document.hidden && notifyOn() && swReg) {
      swReg.showNotification("Recupero finito", {
        body: (label ? label + " · " : "") + "prossima serie",
        tag: "rest-done", renotify: true, vibrate: [200, 100, 200], icon: "./icon.svg",
      }).catch(() => {});
    } else if (!document.hidden) {
      showRestDoneBanner();
    }
    setTimeout(() => {
      document.getElementById("timerBar").classList.add("hidden");
      document.body.classList.remove("timer-on");
    }, 1500);
  },
```

- [ ] **Step 4: Stile del banner**

In `style.css`, dopo la regola `.feelask{...}` (riga ~298), aggiungere:

```css
.restdone{position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:70;
  background:var(--acc);color:var(--acc-ink);font-weight:800;font-size:18px;
  letter-spacing:.04em;padding:16px 26px;border-radius:14px;
  box-shadow:0 10px 30px rgba(0,0,0,.5);pointer-events:none;}
.restdone.hidden{display:none;}
```

- [ ] **Step 5: Handler `notificationclick` + bump cache nel service worker**

In `sw.js`, cambiare la riga 5 da `const CACHE = "gymsched-v13";` a:

```js
const CACHE = "gymsched-v14";
```

E in fondo al file (dopo il listener `fetch`), aggiungere:

```js
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
      for (const c of cs) { if ("focus" in c) return c.focus(); }
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});
```

- [ ] **Step 6: Sanity check logico**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test 2>&1 | Select-Object -Last 6; Pop-Location
```
Atteso: **pass 116**, fail 0.

- [ ] **Step 7: Commit**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git fetch origin 2>&1 | Out-Null; git pull --ff-only origin main 2>&1 | Select-Object -Last 1
git add index.html app.js style.css sw.js
git commit -m "feat(timer): notifica sistema se in background + banner in-app a fine recupero" -m "notificationclick riporta a fuoco l'app. Cache v13 -> v14." -m "Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
git push origin main 2>&1 | Select-Object -Last 1
Pop-Location
```

---

## Task 6: Verifica nel browser reale + memory

**Files:** nessuna modifica al codice (sola verifica + memory).

- [ ] **Step 1: Servi l'app e attiva la cache v14**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
Start-Process python -ArgumentList '-m','http.server','8780' -WindowStyle Hidden
```
Aprire `http://localhost:8780/index.html` (Playwright). Se compare il banner "Nuova versione", cliccarlo per attivare la **v14** e ricaricare.

- [ ] **Step 2: Anteprima prossimo esercizio**

- Giorno A, aprire l'esercizio 01: nel footer, **sopra** "Serie fatta", deve comparire `Prossimo → Lento avanti manubri · 3 × 8-10`.
- Aprire un **superset** (es. Giorno A esercizio 06): la striscia "Prossimo" deve esserci comunque, sopra la CTA "(A+B)".
- Aprire l'**ultimo** esercizio (08): deve comparire `Ultimo esercizio della sessione` al posto della riga "Prossimo".
- Nessun errore in console (a parte l'eventuale 404 `favicon.ico` preesistente).

- [ ] **Step 3: Popup commento veloce centrato**

Ridimensionare il viewport a ~390×800 (Playwright `browser_resize`). Aprire un esercizio, toccare il bottone "commento veloce": il popup `#qcDialog` deve apparire **centrato** orizzontalmente e verticalmente, non in alto a sinistra. Verificare di passaggio che anche il popup "modifica serie" e "Impostazioni" siano centrati.

- [ ] **Step 4: Toggle notifiche**

Aprire ⚙ Impostazioni: deve esserci la sezione "Avvisi recupero" con il checkbox e l'hint. (La richiesta di permesso e la notifica di sistema vanno provate **sul telefono reale**: in Playwright il prompt di permesso e il comportamento in background non sono riproducibili in modo affidabile — annotare come verifica manuale.)

- [ ] **Step 5: Aggiorna la memory**

Aggiornare `gym-schedule-phases.md` (nuova voce "Lotto allenamento guidato completo": anteprima next, notifica best-effort, fix dialog centrato; cache v14; 116 test) e la riga indice in `MEMORY.md`. Segnare che il lotto "app editabile" resta da fare (descrizione persa col /clear, ri-chiedere).

---

## Self-Review (compilato dall'autore del piano)

**Spec coverage:**
- Anteprima prossimo esercizio (variante A, "ultimo" incluso) → Task 1 (logica) + Task 2 (DOM/CSS).
- Notifica best-effort: toggle in Impostazioni + permesso → Task 4; notifica se background + banner se foreground + `notificationclick` → Task 5.
- Fix dialog centrato (`margin:auto`) → Task 3.
- Test `nextExercisePreview` (suite 114→116) → Task 1. (Spec diceva "→115" con un test; il piano ne usa due, più robusti: caso normale e caso "ultimo" — atteso **116**.)
- Bump cache v14 → Task 5 step 5.
- Verifica browser → Task 6.

**Placeholder scan:** nessun TODO/TBD; ogni step ha codice o comando completo.

**Type/identifier consistency:** `nextExercisePreview(exercises, idx)` con forma di ritorno `{last:true}` / `{last:false,name,target}` coerente tra session.js, test, e `buildNextStrip`. `notifyOn()`, `swReg`, `NOTIFY_KEY`, `showRestDoneBanner`, `#notifyToggle`, `#restDoneBanner`, `.nextstrip`, `.restdone`, cache `gymsched-v14` coerenti tra tutti i task.

**Nota di scope:** la spec stimava 115 test (un solo test). Il piano aggiunge due test (più completi); l'atteso diventa **116**. Differenza voluta, non un'incoerenza.
