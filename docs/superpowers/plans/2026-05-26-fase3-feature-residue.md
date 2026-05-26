# Fase 3 — Feature residue (§5/§9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completare le feature in scope della §5 ancora mancanti dopo la Fase 2: flush di sync all'uscita (§9.2), Wake Lock, PWA installabile/offline, nota rapida per esercizio, calcolatore dischi con set configurabile (§9.1).

**Architecture:** L'app è vanilla ES modules senza build step. La logica pura vive in moduli Node-testabili (`store.js`, `session.js`, `timer.js`); il rendering/wiring DOM vive in `app.js` (non testato in Node, verificato in browser). La Fase 3 segue la stessa divisione: nuova logica pura → modulo + test `node --test`; UI/API browser → `app.js`/`index.html` + verifica browser. Le impostazioni utente stanno in `localStorage` (come `gymsched_token`, `gymsched_rest`).

**Tech Stack:** HTML + CSS + JS vanilla (ES modules), `node:test`/`node:assert/strict`, Web APIs (Screen Wake Lock, Service Worker, Web App Manifest), GitHub Contents API (già presente in `GitHubStore`).

---

## File Structure

**Nuovi file:**
- `wakelock.js` — wrapper `ScreenWakeLock` (API iniettabile, testabile). Responsabilità: acquisire/rilasciare/riacquisire il wake lock dello schermo.
- `tests/wakelock.test.js` — test del wrapper.
- `manifest.json` — Web App Manifest (installabilità PWA).
- `icon.svg` — icona dell'app (vettoriale, scrivibile come testo).
- `sw.js` — service worker: cache dell'app-shell per l'uso offline.

**File modificati:**
- `session.js` — aggiunge `withNote` e `previousNote` (logica nota per esercizio).
- `tests/session.test.js` — test di `withNote`/`previousNote`.
- `store.js` — aggiunge `parsePlateSet` (parsing del set dischi configurato).
- `tests/store.test.js` — test di `parsePlateSet`.
- `app.js` — wiring: flush all'uscita, Wake Lock, registrazione SW, campo nota nel focus, calcolatore dischi nello stepper, input bilanciere/dischi nelle Impostazioni.
- `index.html` — link manifest + meta PWA; input bilanciere/dischi nel dialog Impostazioni.
- `style.css` — stili per `.noteblock` e `.plates`.

**Comando test (sempre lo stesso):** `cd C:\Users\TomasCoro\gym-schedule; node --test`
Baseline attuale: **63 pass / 0 fail**. A fine piano attesi **74 pass** (+5 wakelock, +4 note, +2 plates).

---

### Task 1: Sync flush all'uscita (§9.2)

Oggi `persist()` schedula `saveToCloud` con un debounce (1.5s); manca il "flush di sicurezza all'uscita/chiusura sessione" richiesto dalla decisione §9.2. Si aggiunge un flush best-effort su `visibilitychange`→hidden e su `pagehide`. È wiring DOM: nessun test Node, verifica in browser.

**Files:**
- Modify: `app.js` (aggiunge `flushPending` vicino a `saveToCloud`; wiring in `boot`)

- [ ] **Step 1: Aggiungere `flushPending()` dopo `saveToCloud`**

In `app.js`, subito **dopo** la funzione `async function saveToCloud() { ... }` (chiude a riga ~583), inserire:

```js
// Flush best-effort quando la sessione viene messa via (tab nascosta o pagina
// chiusa): salva subito i pending invece di aspettare il debounce. §9.2.
function flushPending() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (getPending().length && getToken() && store) saveToCloud();
}
```

- [ ] **Step 2: Cablare il flush in `boot()`**

In `app.js`, dentro `async function boot()`, subito **dopo** la riga
`document.getElementById("newWeekBtn").addEventListener("click", newWeek);`
aggiungere:

```js
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushPending(); });
  window.addEventListener("pagehide", flushPending);
```

- [ ] **Step 3: Verificare che la test-suite resti verde (nessuna regressione)**

Run: `cd C:\Users\TomasCoro\gym-schedule; node --test`
Expected: `tests 63 ... pass 63 ... fail 0` (questo task non aggiunge test Node).

- [ ] **Step 4: Verifica browser (smoke)**

Run (PowerShell, in `C:\Users\TomasCoro\gym-schedule`):
`python -m http.server 8031`
Aprire `http://localhost:8031/`, aprire DevTools → Network. Fare un'azione che logga una serie ("Serie fatta"), poi cambiare tab (rendere la pagina nascosta).
Expected: senza token configurato lo status resta `nessun token ⧗`/`offline ⧗` e **non** ci sono errori in console; con token presente parte una PUT a `api.github.com` al passaggio in background. Chiudere il server (Ctrl+C).

- [ ] **Step 5: Commit**

```bash
cd C:\Users\TomasCoro\gym-schedule
git add app.js
git commit -m "feat(sync): flush dei pending all'uscita/cambio tab (§9.2)"
```

---

### Task 2: Wake Lock — modulo testabile + wiring (§5 #3, MUST)

Lo schermo deve restare acceso durante la sessione. Si crea un wrapper con `navigator` iniettabile (stesso pattern di `GitHubStore.fetchImpl` e dei callback di `RestTimer`), testabile in Node con un finto navigator. Il browser rilascia il sentinel quando la tab è nascosta, quindi si riacquisisce su `visibilitychange`→visibile.

**Files:**
- Create: `wakelock.js`
- Test: `tests/wakelock.test.js`
- Modify: `app.js` (istanza + `enable()` + riacquisizione su visibilitychange)

- [ ] **Step 1: Scrivere i test (falliranno: modulo assente)**

Create `tests/wakelock.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { ScreenWakeLock } from "../wakelock.js";

function fakeNav() {
  const calls = { request: 0, release: 0 };
  const nav = {
    wakeLock: {
      request: async () => {
        calls.request++;
        return { release: async () => { calls.release++; }, addEventListener: () => {} };
      },
    },
  };
  return { nav, calls };
}

test("enable acquisisce un sentinel via wakeLock.request", async () => {
  const { nav, calls } = fakeNav();
  const wl = new ScreenWakeLock(nav);
  await wl.enable();
  assert.equal(calls.request, 1);
  assert.ok(wl.sentinel);
});

test("disable rilascia il sentinel e azzera lo stato", async () => {
  const { nav, calls } = fakeNav();
  const wl = new ScreenWakeLock(nav);
  await wl.enable();
  await wl.disable();
  assert.equal(calls.release, 1);
  assert.equal(wl.sentinel, null);
});

test("onVisible riacquisisce solo se voluto e senza sentinel", async () => {
  const { nav, calls } = fakeNav();
  const wl = new ScreenWakeLock(nav);
  await wl.enable();      // request -> 1
  wl.sentinel = null;     // simula il rilascio del browser quando la tab è nascosta
  await wl.onVisible();   // request -> 2
  assert.equal(calls.request, 2);
});

test("onVisible non fa nulla se il wake lock non è voluto", async () => {
  const { nav, calls } = fakeNav();
  const wl = new ScreenWakeLock(nav);
  await wl.onVisible();
  assert.equal(calls.request, 0);
});

test("API assente: supported() è false e enable() non lancia", async () => {
  const wl = new ScreenWakeLock({});
  assert.equal(wl.supported(), false);
  await wl.enable();
  assert.equal(wl.sentinel, null);
});
```

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `cd C:\Users\TomasCoro\gym-schedule; node --test`
Expected: FAIL con errore di import (`Cannot find module '../wakelock.js'`).

- [ ] **Step 3: Implementare `wakelock.js`**

Create `wakelock.js`:

```js
// ---- Wrapper Screen Wake Lock (navigator iniettabile -> testabile in Node) ----
// Tiene lo schermo acceso durante la sessione. Il browser rilascia il sentinel
// quando la tab è nascosta, quindi si riacquisisce con onVisible().

export class ScreenWakeLock {
  constructor(nav = (typeof navigator !== "undefined" ? navigator : undefined)) {
    this.nav = nav;
    this.sentinel = null;
    this.wanted = false;
  }

  supported() {
    return !!(this.nav && this.nav.wakeLock && typeof this.nav.wakeLock.request === "function");
  }

  async enable() {
    this.wanted = true;
    await this._acquire();
  }

  async disable() {
    this.wanted = false;
    if (this.sentinel) {
      try { await this.sentinel.release(); } catch (_) { /* già rilasciato */ }
      this.sentinel = null;
    }
  }

  // Da chiamare su visibilitychange: riacquisisce quando la pagina torna visibile.
  async onVisible() {
    if (this.wanted && !this.sentinel) await this._acquire();
  }

  async _acquire() {
    if (!this.supported() || this.sentinel) return;
    try {
      this.sentinel = await this.nav.wakeLock.request("screen");
      this.sentinel.addEventListener?.("release", () => { this.sentinel = null; });
    } catch (_) {
      this.sentinel = null; // request può rifiutare se non visibile / non permesso
    }
  }
}
```

- [ ] **Step 4: Eseguire i test per vederli passare**

Run: `cd C:\Users\TomasCoro\gym-schedule; node --test`
Expected: `pass 68 ... fail 0` (63 + 5 nuovi).

- [ ] **Step 5: Cablare il Wake Lock in `app.js`**

In `app.js`, aggiungere l'import in cima al blocco di import (dopo la riga `import { RestTimer, formatTime } from "./timer.js";`):

```js
import { ScreenWakeLock } from "./wakelock.js";
```

Subito **dopo** `const timer = new RestTimer({ ... });` (chiude a riga ~96), aggiungere:

```js
const wakeLock = new ScreenWakeLock();
```

Dentro `function startRest(seconds, label)`, **dopo** `ensureAudio();`, aggiungere (l'acquisizione avviene così dentro un gesto utente, requisito di alcuni browser):

```js
  wakeLock.enable();
```

In `function wireTimerControls()`, **sostituire** la riga esistente:

```js
  document.addEventListener("visibilitychange", () => { if (!document.hidden) timer.sync(); });
```

con:

```js
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { timer.sync(); wakeLock.onVisible(); }
  });
```

In `async function boot()`, **dopo** `render();` (la chiamata finale a render, riga ~671), aggiungere:

```js
  wakeLock.enable();
```

- [ ] **Step 6: Verificare che i test restino verdi**

Run: `cd C:\Users\TomasCoro\gym-schedule; node --test`
Expected: `pass 68 ... fail 0`.

- [ ] **Step 7: Verifica browser (smoke)**

Run: `python -m http.server 8032` (in `C:\Users\TomasCoro\gym-schedule`).
Aprire `http://localhost:8032/`, DevTools → Console:
`navigator.wakeLock` deve esistere (Chromium); nessun errore non gestito in console al boot o al "Serie fatta". (Il wake lock vero si osserva solo su device fisico.) Chiudere il server.

- [ ] **Step 8: Commit**

```bash
cd C:\Users\TomasCoro\gym-schedule
git add wakelock.js tests/wakelock.test.js app.js
git commit -m "feat(session): Screen Wake Lock durante la sessione attiva (§5 #3)"
```

---

### Task 3: PWA — manifest + icona + service worker (§5 #7)

App installabile su home e funzionante offline. Il service worker cacha solo l'app-shell same-origin; `data.json` vive su `api.github.com` (cross-origin) e resta gestito da `app.js`, quindi il SW lo ignora. Verifica in browser (i SW non si testano in Node).

**Files:**
- Create: `manifest.json`, `icon.svg`, `sw.js`
- Modify: `index.html` (link manifest + meta), `app.js` (registrazione SW)

- [ ] **Step 1: Creare `manifest.json`**

Create `manifest.json`:

```json
{
  "name": "Gym Schedule",
  "short_name": "Gym",
  "description": "Diario di allenamento — log per-serie con progressione.",
  "lang": "it",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0E0F0E",
  "theme_color": "#0E0F0E",
  "icons": [
    { "src": "./icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any maskable" }
  ]
}
```

- [ ] **Step 2: Creare `icon.svg`**

Create `icon.svg` (bilanciere stilizzato verde su fondo quasi-nero, coerente col tema):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="96" fill="#0E0F0E"/>
  <g fill="#3FE0A8">
    <rect x="96" y="232" width="320" height="48" rx="10"/>
    <rect x="120" y="176" width="40" height="160" rx="12"/>
    <rect x="352" y="176" width="40" height="160" rx="12"/>
    <rect x="72" y="208" width="32" height="96" rx="10"/>
    <rect x="408" y="208" width="32" height="96" rx="10"/>
  </g>
</svg>
```

- [ ] **Step 3: Creare `sw.js`**

Create `sw.js`:

```js
// Service worker: cache dell'app-shell per l'uso offline. data.json NON è qui
// dentro (vive su api.github.com, cross-origin): la sync resta gestita da app.js.
// NB: bumpare CACHE (es. -v2) quando cambia un file dell'app-shell, per
// invalidare la cache vecchia ed evitare codice stantio.
const CACHE = "gymsched-v1";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./store.js",
  "./session.js",
  "./timer.js",
  "./plan.js",
  "./wakelock.js",
  "./manifest.json",
  "./icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Solo GET same-origin: API GitHub e font passano diretti alla rete.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match("./index.html")))
  );
});
```

- [ ] **Step 4: Collegare manifest e meta PWA in `index.html`**

In `index.html`, nel `<head>`, **dopo** la riga `<link rel="stylesheet" href="./style.css">`, aggiungere:

```html
  <link rel="manifest" href="./manifest.json">
  <link rel="apple-touch-icon" href="./icon.svg">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

- [ ] **Step 5: Registrare il service worker in `app.js`**

In `app.js`, in fondo al file, **sostituire** l'ultima riga:

```js
boot();
```

con:

```js
boot();

// PWA: registra il service worker (best-effort, solo se supportato).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => { /* SW non disponibile */ });
  });
}
```

- [ ] **Step 6: Verificare che i test restino verdi**

Run: `cd C:\Users\TomasCoro\gym-schedule; node --test`
Expected: `pass 68 ... fail 0` (PWA non aggiunge test Node).

- [ ] **Step 7: Verifica browser (installabilità + offline)**

Run: `python -m http.server 8033` (in `C:\Users\TomasCoro\gym-schedule`).
Aprire `http://localhost:8033/` in Chromium, DevTools → Application:
- **Manifest**: nessun errore, nome "Gym Schedule", theme `#0E0F0E`, icona visibile.
- **Service Workers**: `sw.js` registrato e `activated`.
- Console: `await caches.keys()` include `gymsched-v1`.
- Offline test: in Network spuntare "Offline", ricaricare → l'app si carica comunque (dall'app-shell). Togliere "Offline". Chiudere il server.

- [ ] **Step 8: Commit**

```bash
cd C:\Users\TomasCoro\gym-schedule
git add manifest.json icon.svg sw.js index.html app.js
git commit -m "feat(pwa): manifest, icona e service worker per install + offline (§5 #7)"
```

---

### Task 4: Nota rapida per esercizio (§5 #8)

Il modello ha già `note` (preservata da `normalizeEntry`/`normalizeSupersetEntry`/`withSet`). Mancano: una funzione pura per impostarla, la precompilazione dalla settimana precedente (la nota è "persistente tra le settimane"), e il campo UI nel focus.

**Files:**
- Modify: `session.js` (aggiunge `withNote`, `previousNote`)
- Test: `tests/session.test.js`
- Modify: `app.js` (campo nota nel focus normale e superset)
- Modify: `style.css` (stili `.noteblock`)

- [ ] **Step 1: Scrivere i test (falliranno: funzioni assenti)**

In `tests/session.test.js`, aggiornare l'import di `session.js` per includere le nuove funzioni. **Sostituire** la riga:

```js
import { bestKg, progressionDelta } from "../session.js";
```

con:

```js
import { bestKg, progressionDelta, withNote, previousNote } from "../session.js";
```

Poi aggiungere in fondo al file:

```js
test("withNote imposta la nota preservando le serie (normale)", () => {
  const entry = { sets: [{ reps: "8", kg: "70", done: true }], note: "" };
  const out = withNote(entry, "presa stretta", false);
  assert.equal(out.note, "presa stretta");
  assert.equal(out.sets.length, 1);
  assert.equal(out.sets[0].kg, "70");
});

test("withNote su superset preserva entrambe le tracce", () => {
  const entry = { a: { sets: [{ reps: "12", kg: "20", done: true }] }, b: { sets: [] }, note: "" };
  const out = withNote(entry, "spalla tirava", true);
  assert.equal(out.note, "spalla tirava");
  assert.equal(out.a.sets.length, 1);
  assert.equal(out.b.sets.length, 0);
});

test("previousNote prende la nota della settimana precedente più recente", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "70", done: true }], note: "presa media" }, "t");
  d = setEntry(d, "2026-W22", "A", 0, { sets: [], note: "" }, "t");
  assert.equal(previousNote(d, "A", 0, "2026-W22", false), "presa media");
});

test("previousNote ritorna '' se non c'è nota precedente", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "70", done: true }], note: "" }, "t");
  assert.equal(previousNote(d, "A", 0, "2026-W22", false), "");
});
```

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `cd C:\Users\TomasCoro\gym-schedule; node --test`
Expected: FAIL (`withNote`/`previousNote` non esportate → import error o "not a function").

- [ ] **Step 3: Implementare `withNote` e `previousNote` in `session.js`**

In `session.js`, **dopo** `withoutSupersetSet` (chiude a riga ~93), aggiungere:

```js
// Imposta la nota (a livello esercizio) preservando le serie. `superset` sceglie
// la forma dell'entry. La nota è sempre top-level, sia normale sia superset.
export function withNote(entry, note, superset = false) {
  const text = String(note ?? "");
  if (superset) {
    const e = normalizeSupersetEntry(entry);
    return { ...e, note: text };
  }
  const e = normalizeEntry(entry);
  return { sets: e.sets, note: text };
}

// Nota più recente loggata in una settimana precedente per quell'esercizio
// (le note sono persistenti tra le settimane). "" se nessuna.
export function previousNote(data, day, idx, weekKey, superset = false) {
  const keys = Object.keys(data?.weeks ?? {})
    .filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k) && k < weekKey).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    const v = getEntry(data, keys[i], day, idx);
    const e = superset ? normalizeSupersetEntry(v) : normalizeEntry(v);
    if (e.note && e.note.trim()) return e.note;
  }
  return "";
}
```

- [ ] **Step 4: Eseguire i test per vederli passare**

Run: `cd C:\Users\TomasCoro\gym-schedule; node --test`
Expected: `pass 72 ... fail 0` (68 + 4 nuovi).

- [ ] **Step 5: Aggiungere il campo nota in `app.js`**

In `app.js`, aggiornare l'import da `session.js`. **Sostituire**:

```js
import {
  parseTarget, activeExerciseIndex, activeSetIndex, isEntryComplete, bestKg, progressionDelta,
  withSet, withoutSet, withSupersetSet,
} from "./session.js";
```

con:

```js
import {
  parseTarget, activeExerciseIndex, activeSetIndex, isEntryComplete, bestKg, progressionDelta,
  withSet, withoutSet, withSupersetSet, withNote, previousNote,
} from "./session.js";
```

Poi, **prima** di `function setRow(` (riga ~303), aggiungere il costruttore del campo nota:

```js
// Campo nota per esercizio (persistente tra le settimane). Mostra la nota della
// settimana corrente; se vuota, suggerisce in placeholder quella precedente.
function buildNoteField(superset) {
  const v = getEntry(data, currentWeek, currentDay, focusIndex);
  const e = superset ? normalizeSupersetEntry(v) : normalizeEntry(v);
  const prev = previousNote(data, currentDay, focusIndex, currentWeek, superset);

  const wrap = document.createElement("div");
  wrap.className = "noteblock";
  const lab = document.createElement("label");
  lab.className = "notelabel"; lab.textContent = "Nota";
  const ta = document.createElement("textarea");
  ta.className = "note"; ta.rows = 1;
  ta.placeholder = prev ? `↳ ${prev}` : "presa, set-up, sensazioni…";
  ta.value = e.note || "";
  ta.addEventListener("change", () => {
    const cur = getEntry(data, currentWeek, currentDay, focusIndex);
    data = setEntry(data, currentWeek, currentDay, focusIndex, withNote(cur, ta.value.trim(), superset), new Date().toISOString());
    persist();
  });
  wrap.append(lab, ta);
  return wrap;
}
```

In `renderFocusNormal`, **dopo** `card.appendChild(cta);` (riga ~433) e **prima** di `root.appendChild(card);`, aggiungere:

```js
  card.appendChild(buildNoteField(false));
```

In `renderFocusSuperset`, **dopo** `card.appendChild(cta);` (riga ~513) e **prima** di `root.appendChild(card);`, aggiungere:

```js
  card.appendChild(buildNoteField(true));
```

- [ ] **Step 6: Aggiungere gli stili in `style.css`**

In `style.css`, **dopo** il blocco `/* dots + cta */` (la regola `.cta{...}` chiude a riga ~104), aggiungere:

```css
/* nota per esercizio */
.noteblock{margin-top:14px;}
.noteblock .notelabel{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);display:block;margin-bottom:6px;}
.noteblock .note{width:100%;min-height:44px;resize:vertical;background:var(--surf2);border:1px solid var(--line);border-radius:12px;padding:10px 12px;
  color:var(--ink);font-family:inherit;font-size:14px;line-height:1.4;}
.noteblock .note::placeholder{color:var(--faint);}
.noteblock .note:focus{outline:none;border-color:var(--acc);}
```

- [ ] **Step 7: Verificare che i test restino verdi**

Run: `cd C:\Users\TomasCoro\gym-schedule; node --test`
Expected: `pass 72 ... fail 0`.

- [ ] **Step 8: Verifica browser (smoke)**

Run: `python -m http.server 8034` (in `C:\Users\TomasCoro\gym-schedule`).
Aprire `http://localhost:8034/`. Sotto la CTA del focus c'è il campo "Nota". Scrivere un testo, cliccare fuori (evento `change`), cambiare esercizio e tornare: la nota persiste. Verificare che compaia anche su un esercizio superset. Chiudere il server.

- [ ] **Step 9: Commit**

```bash
cd C:\Users\TomasCoro\gym-schedule
git add session.js tests/session.test.js app.js style.css
git commit -m "feat(session): nota rapida per esercizio persistente tra settimane (§5 #8)"
```

---

### Task 5: Calcolatore dischi + set configurabile (§5 #9, §9.1)

`platesPerSide` esiste già e è testata. Mancano: il parsing del set dischi configurato (logica pura → testabile), gli input nelle Impostazioni (bilanciere 20 kg di default; dischi default `20/15/10/5/2.5/1.25` per lato, configurabili — §9.1), e la riga "per lato" sotto lo stepper che si aggiorna col carico.

**Files:**
- Modify: `store.js` (aggiunge `parsePlateSet`)
- Test: `tests/store.test.js`
- Modify: `index.html` (input bilanciere/dischi nel dialog Impostazioni)
- Modify: `app.js` (lettura/scrittura impostazioni + riga dischi nello stepper)
- Modify: `style.css` (stile `.plates`)

- [ ] **Step 1: Scrivere i test (falliranno: funzione assente)**

In `tests/store.test.js`, aggiungere `parsePlateSet` all'import esistente da `../store.js` (aggiungere il nome nella lista già importata in cima al file). Poi aggiungere in fondo:

```js
test("parsePlateSet: parsa, ordina decrescente e scarta invalidi", () => {
  assert.deepEqual(parsePlateSet("20, 15, 10, 5, 2.5, 1.25"), [20, 15, 10, 5, 2.5, 1.25]);
  assert.deepEqual(parsePlateSet("10 5 2.5"), [10, 5, 2.5]);
  assert.deepEqual(parsePlateSet("20, abc, -5, 0, 15"), [20, 15]);
});

test("parsePlateSet: stringa vuota -> []", () => {
  assert.deepEqual(parsePlateSet(""), []);
});
```

- [ ] **Step 2: Eseguire i test per vederli fallire**

Run: `cd C:\Users\TomasCoro\gym-schedule; node --test`
Expected: FAIL (`parsePlateSet` non esportata).

- [ ] **Step 3: Implementare `parsePlateSet` in `store.js`**

In `store.js`, **subito dopo** `platesPerSide` (chiude a riga ~105), aggiungere:

```js
// "20, 15, 10, 5, 2.5" -> [20,15,10,5,2.5] (decimali col punto; separatori
// virgola o spazi). Scarta non numerici e valori <= 0; ordina decrescente.
export function parsePlateSet(str) {
  return String(str ?? "")
    .split(/[,\s]+/)
    .map((t) => parseFloat(t))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);
}
```

- [ ] **Step 4: Eseguire i test per vederli passare**

Run: `cd C:\Users\TomasCoro\gym-schedule; node --test`
Expected: `pass 74 ... fail 0` (72 + 2 nuovi).

- [ ] **Step 5: Aggiungere gli input nel dialog Impostazioni (`index.html`)**

In `index.html`, dentro `<form method="dialog" class="settings">`, **dopo** la riga `<p class="hint">Il token resta solo in questo browser. Vedi il README per crearlo.</p>` e **prima** di `<menu>`, aggiungere:

```html
        <label for="barInput">Bilanciere (kg)</label>
        <input id="barInput" type="number" inputmode="decimal" step="0.5" min="0" placeholder="20">
        <label for="platesInput">Dischi per lato (kg, separati da virgola)</label>
        <input id="platesInput" type="text" inputmode="decimal" placeholder="20, 15, 10, 5, 2.5, 1.25">
        <p class="hint">Usati dal calcolatore dischi. Decimali col punto (es. 2.5).</p>
```

- [ ] **Step 6: Lettura/scrittura impostazioni dischi in `app.js`**

In `app.js`, aggiungere `parsePlateSet` e `platesPerSide` all'import da `./store.js`. **Sostituire**:

```js
import {
  isoWeekKey, emptyData, ensureWeek, setEntry, getEntry,
  normalizeEntry, normalizeSupersetEntry, prefillSets,
  GitHubStore, ConflictError, AuthError,
} from "./store.js";
```

con:

```js
import {
  isoWeekKey, emptyData, ensureWeek, setEntry, getEntry,
  normalizeEntry, normalizeSupersetEntry, prefillSets, platesPerSide, parsePlateSet,
  GitHubStore, ConflictError, AuthError,
} from "./store.js";
```

Dopo il blocco delle costanti chiave (`const REST_KEY = "gymsched_rest";` a riga ~44 con le sue funzioni; inserire **dopo** `function setRest(...)` che chiude a riga ~54), aggiungere:

```js
// ---- Impostazioni calcolatore dischi (browser only) ----
const BAR_KEY = "gymsched_bar";
const PLATES_KEY = "gymsched_plates";
const getBar = () => { const n = parseFloat(localStorage.getItem(BAR_KEY)); return Number.isFinite(n) && n > 0 ? n : 20; };
const getPlateSet = () => { const v = parsePlateSet(localStorage.getItem(PLATES_KEY) || ""); return v.length ? v : [20, 15, 10, 5, 2.5, 1.25]; };
```

- [ ] **Step 7: Mostrare i dischi per lato nello stepper (`buildEditBlock`)**

In `app.js`, dentro `function buildEditBlock(label, state, prev)`: **dopo** il blocco dello stepper carico (cioè dopo `block.appendChild(stepper);`, riga ~245) e **prima** della definizione `const renderKg = () => {`, inserire la riga dischi e il suo renderer:

```js
  const platesLine = document.createElement("div");
  platesLine.className = "plates";
  block.appendChild(platesLine);
  const renderPlates = () => {
    const n = parseFloat(String(state.kg).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) { platesLine.textContent = ""; return; }
    const { perSide, leftover } = platesPerSide(n, { bar: getBar(), plates: getPlateSet() });
    if (!perSide.length) { platesLine.textContent = `per lato: — (≤ bilanciere ${getBar()} kg)`; return; }
    platesLine.textContent = `per lato: ${perSide.join(" + ")}` + (leftover > 0 ? `  (+${leftover} scoperto)` : "");
  };
```

Sempre in `buildEditBlock`, **sostituire** la funzione `renderKg` esistente:

```js
  const renderKg = () => {
    const n = parseFloat(String(state.kg).replace(",", "."));
    num.textContent = Number.isFinite(n) ? n.toFixed(1) : "—";
  };
```

con (aggiunge la riga `renderPlates()` in coda così i dischi si aggiornano a ogni step):

```js
  const renderKg = () => {
    const n = parseFloat(String(state.kg).replace(",", "."));
    num.textContent = Number.isFinite(n) ? n.toFixed(1) : "—";
    renderPlates();
  };
```

- [ ] **Step 8: Popolare e salvare le impostazioni dischi in `wireSettings()`**

In `app.js`, **sostituire** l'intero handler `wireSettings`:

```js
function wireSettings() {
  const dlg = document.getElementById("settingsDialog");
  document.getElementById("settingsBtn").addEventListener("click", () => {
    document.getElementById("tokenInput").value = getToken() || "";
    dlg.showModal();
  });
  dlg.addEventListener("close", () => {
    if (dlg.returnValue === "save") {
      setToken(document.getElementById("tokenInput").value.trim() || null);
      initStore();
      saveToCloud();
    } else if (dlg.returnValue === "clear") {
      setToken(null);
      initStore();
      setStatus("sola lettura", "pending");
    }
  });
}
```

con:

```js
function wireSettings() {
  const dlg = document.getElementById("settingsDialog");
  document.getElementById("settingsBtn").addEventListener("click", () => {
    document.getElementById("tokenInput").value = getToken() || "";
    document.getElementById("barInput").value = getBar();
    document.getElementById("platesInput").value = getPlateSet().join(", ");
    dlg.showModal();
  });
  dlg.addEventListener("close", () => {
    if (dlg.returnValue === "save") {
      setToken(document.getElementById("tokenInput").value.trim() || null);
      localStorage.setItem(BAR_KEY, String(parseFloat(document.getElementById("barInput").value) || 20));
      localStorage.setItem(PLATES_KEY, document.getElementById("platesInput").value);
      initStore();
      saveToCloud();
      render(); // ridipinge il calcolatore col nuovo set
    } else if (dlg.returnValue === "clear") {
      setToken(null);
      initStore();
      setStatus("sola lettura", "pending");
    }
  });
}
```

- [ ] **Step 9: Aggiungere lo stile `.plates` in `style.css`**

In `style.css`, **dopo** la regola `.prefill{...}` (riga ~81), aggiungere:

```css
.plates{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--dim);text-align:center;margin-top:9px;}
```

- [ ] **Step 10: Verificare che i test restino verdi**

Run: `cd C:\Users\TomasCoro\gym-schedule; node --test`
Expected: `pass 74 ... fail 0`.

- [ ] **Step 11: Verifica browser (smoke)**

Run: `python -m http.server 8035` (in `C:\Users\TomasCoro\gym-schedule`).
Aprire `http://localhost:8035/`. Nel focus di un esercizio normale, lo stepper carico mostra "per lato: …" sotto il valore. Premendo `+0.5`/`−0.5` la riga si aggiorna. Aprire ⚙ Impostazioni: ci sono i campi Bilanciere e Dischi precompilati; cambiarli, Salva → il calcolatore riflette il nuovo set. Chiudere il server.

- [ ] **Step 12: Commit**

```bash
cd C:\Users\TomasCoro\gym-schedule
git add store.js tests/store.test.js index.html app.js style.css
git commit -m "feat(ui): calcolatore dischi per lato + set configurabile (§5 #9, §9.1)"
```

---

### Task 6: Verifica olistica finale

**Files:** nessuna modifica (solo verifica).

- [ ] **Step 1: Suite completa verde**

Run: `cd C:\Users\TomasCoro\gym-schedule; node --test`
Expected: `tests 74 ... pass 74 ... fail 0`.

- [ ] **Step 2: Smoke browser end-to-end**

Run: `python -m http.server 8036` (in `C:\Users\TomasCoro\gym-schedule`).
Su `http://localhost:8036/` verificare in un unico giro: SW registrato (Application), manifest valido, campo nota persistente, calcolatore dischi reattivo, nessun errore in console al boot/Serie fatta/cambio tab. Chiudere il server.

- [ ] **Step 3: Stato git pulito**

Run: `cd C:\Users\TomasCoro\gym-schedule; git status -sb`
Expected: working tree pulito; i commit dei Task 1–5 presenti in `git log --oneline`.

---

## Note operative
- **Convenzione progetto:** commit + push automatici su `main` a ogni task (regola globale auto-commit-push). Il push avviene dopo ogni commit di task.
- **Cache SW durante lo sviluppo:** modificando un file dell'app-shell, ricordarsi di bumpare `CACHE` in `sw.js` (`gymsched-v1` → `-v2`) per non servire codice stantio.
- **Fuori scope (resta §8):** long-press già fatto in Fase 2; "ripeti serie precedente", volume/trend, warmup vs working set, RPE — non in questo piano.
