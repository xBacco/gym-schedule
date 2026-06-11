# Store Update Scaffolding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Predisporre il rilevamento di una versione più nuova in store e il relativo banner + voce Impostazioni, tutto dietro un flag spento, senza cambiare il comportamento attuale.

**Architecture:** Nuovo modulo ESM puro `release.js` con tutta la logica testabile (semver, piattaforma, scelta store, controllo update best-effort). `app.js` importa il modulo e, **solo se `STORE_UPDATE_ENABLED` è true**, esegue il controllo e mostra un toast minimale riusando il componente `.update-toast` di fase 2. `version.json` è il manifest remoto bumpato a ogni release. A flag OFF: nessun fetch, nessun banner store, comportamento identico a oggi.

**Tech Stack:** Vanilla JS ESM (`type: module`), test con `node --test` (`node:test` + `node:assert/strict`), Service Worker per l'app-shell.

Spec di riferimento: `docs/superpowers/specs/2026-06-11-store-update-design.md`. Branch: `feat/store-update-scaffolding` (già creato).

---

## File Structure

| File | Responsabilità |
|------|----------------|
| `release.js` (**nuovo**) | Costanti versione/flag/store + helper puri: `getPlatform`, `isNewer`, `pickStore`, `checkStoreUpdate`. Unica fonte di verità della logica di update store. |
| `version.json` (**nuovo**) | Manifest remoto: `{ "latest": "<versione>" }`. |
| `tests/release.test.js` (**nuovo**) | Unit dei soli helper puri di `release.js`. |
| `app.js` (modifica) | Import del modulo; `showStoreUpdateBanner` (DOM); `renderAppLine` (DOM); init del controllo sotto flag. Nessuna logica decidibile qui dentro. |
| `index.html` (modifica) | Riga `app` in Impostazioni: span versione + contenitore tag dinamico, accanto al bottone force-update esistente. |
| `sw.js` (modifica) | Bump cache `v74`→`v75`; aggiunta di `release.js` e `version.json` agli ASSETS. |

---

## Task 1: `release.js` — costanti + `isNewer`

**Files:**
- Create: `release.js`
- Test: `tests/release.test.js`

- [ ] **Step 1: Write the failing test**

In `tests/release.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { APP_VERSION, STORE_UPDATE_ENABLED, VERSION_MANIFEST_URL, isNewer } from "../release.js";

test("costanti: APP_VERSION è semver, flag OFF, manifest url relativo", () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(STORE_UPDATE_ENABLED, false);
  assert.equal(VERSION_MANIFEST_URL, "./version.json");
});

test("isNewer: remote maggiore → true", () => {
  assert.equal(isNewer("1.1.0", "1.0.0"), true);
  assert.equal(isNewer("1.0.1", "1.0.0"), true);
  assert.equal(isNewer("2.0.0", "1.9.9"), true);
});

test("isNewer: uguale o minore → false", () => {
  assert.equal(isNewer("1.0.0", "1.0.0"), false);
  assert.equal(isNewer("1.0.0", "1.1.0"), false);
});

test("isNewer: campi mancanti trattati come 0", () => {
  assert.equal(isNewer("1.1", "1.1.0"), false);
  assert.equal(isNewer("1.1.1", "1.1"), true);
});

test("isNewer: suffisso pre-release troncato", () => {
  assert.equal(isNewer("1.1.0-beta", "1.0.0"), true);
  assert.equal(isNewer("1.0.0-beta", "1.0.0"), false);
});

test("isNewer: input malformato → false", () => {
  assert.equal(isNewer("abc", "1.0.0"), false);
  assert.equal(isNewer("1.0.0", null), false);
  assert.equal(isNewer(undefined, "1.0.0"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../release.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `release.js`:

```js
// release.js — versione dell'app + rilevamento aggiornamento store (scaffolding a flag spento).
// Tutta la logica decidibile senza DOM/rete vive qui, in funzioni pure e testabili.
// A flag OFF (STORE_UPDATE_ENABLED=false) niente di tutto questo viene eseguito: l'update
// resta gestito dal Service Worker, esattamente come oggi.

export const APP_VERSION = "1.0.0";

// Flag build-time: OFF nella PWA/web su GitHub Pages, ON nella futura build nativa (Capacitor).
export const STORE_UPDATE_ENABLED = false;

export const VERSION_MANIFEST_URL = "./version.json";

export const STORE = {
  ios:     { appId: "PLACEHOLDER_IOS_ID",   url: "https://apps.apple.com/app/idPLACEHOLDER_IOS_ID" },
  android: { pkg:   "it.placeholder.setlog", url: "https://play.google.com/store/apps/details?id=it.placeholder.setlog" },
};

// Confronto semver "x.y.z": true se remote è strettamente più nuovo di current.
// Input malformati → false (meglio non mostrare un banner spurio).
export function isNewer(remote, current) {
  const parse = (v) => {
    if (typeof v !== "string") return null;
    const core = v.trim().split("-")[0];                 // scarta eventuale pre-release (-beta…)
    const parts = core.split(".");
    const nums = [0, 1, 2].map((i) => parseInt(parts[i] ?? "0", 10));
    return nums.some((n) => Number.isNaN(n)) ? null : nums;
  };
  const a = parse(remote);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;                                          // uguali
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — i test di Task 1 verdi, suite complessiva verde.

- [ ] **Step 5: Commit**

```bash
git add release.js tests/release.test.js
git commit -m "feat(release): costanti versione/flag/store + isNewer semver"
```

---

## Task 2: `release.js` — `getPlatform`

**Files:**
- Modify: `release.js`
- Test: `tests/release.test.js`

- [ ] **Step 1: Write the failing test**

Aggiungi in `tests/release.test.js` (aggiorna l'import di `release.js` aggiungendo `getPlatform`):

```js
import { getPlatform } from "../release.js"; // se preferisci, accorpa all'import in cima

test("getPlatform: Capacitor ha priorità sull'UA", () => {
  assert.equal(getPlatform({ userAgent: "Mozilla iPhone" }, { getPlatform: () => "android" }), "android");
});

test("getPlatform: UA iPhone → ios", () => {
  assert.equal(getPlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" }, undefined), "ios");
});

test("getPlatform: UA Android → android", () => {
  assert.equal(getPlatform({ userAgent: "Mozilla/5.0 (Linux; Android 14)" }, undefined), "android");
});

test("getPlatform: desktop/sconosciuto → web", () => {
  assert.equal(getPlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0)" }, undefined), "web");
  assert.equal(getPlatform({}, undefined), "web");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `getPlatform is not a function` / `undefined`.

- [ ] **Step 3: Write minimal implementation**

Aggiungi in `release.js`:

```js
// 'ios' | 'android' | 'web'. Capacitor (se presente) ha priorità; poi UA; fallback 'web'.
export function getPlatform(
  nav = (typeof navigator !== "undefined" ? navigator : {}),
  cap = (typeof globalThis !== "undefined" ? globalThis.Capacitor : undefined),
) {
  if (cap && typeof cap.getPlatform === "function") {
    const p = cap.getPlatform();
    if (p === "ios" || p === "android" || p === "web") return p;
  }
  const ua = (nav && nav.userAgent) || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "web";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add release.js tests/release.test.js
git commit -m "feat(release): getPlatform (Capacitor > UA > web)"
```

---

## Task 3: `release.js` — `pickStore`

**Files:**
- Modify: `release.js`
- Test: `tests/release.test.js`

- [ ] **Step 1: Write the failing test**

Aggiungi in `tests/release.test.js` (estendi l'import con `pickStore, STORE`):

```js
test("pickStore: ios/android → url dello store", () => {
  assert.equal(pickStore("ios"), STORE.ios.url);
  assert.equal(pickStore("android"), STORE.android.url);
});

test("pickStore: web → null (resta sul Service Worker)", () => {
  assert.equal(pickStore("web"), null);
});

test("pickStore: store iniettato", () => {
  const s = { ios: { url: "X" }, android: { url: "Y" } };
  assert.equal(pickStore("ios", s), "X");
  assert.equal(pickStore("android", s), "Y");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `pickStore is not a function`.

- [ ] **Step 3: Write minimal implementation**

Aggiungi in `release.js`:

```js
// URL dello store per la piattaforma; 'web' → null.
export function pickStore(platform, store = STORE) {
  if (platform === "ios") return store.ios?.url ?? null;
  if (platform === "android") return store.android?.url ?? null;
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add release.js tests/release.test.js
git commit -m "feat(release): pickStore per piattaforma"
```

---

## Task 4: `release.js` — `checkStoreUpdate`

**Files:**
- Modify: `release.js`
- Test: `tests/release.test.js`

- [ ] **Step 1: Write the failing test**

Aggiungi in `tests/release.test.js` (estendi l'import con `checkStoreUpdate`):

```js
const okFetch = (body) => async () => ({ json: async () => body });

test("checkStoreUpdate: latest più nuovo → updateAvailable con storeUrl", async () => {
  const r = await checkStoreUpdate({
    fetchFn: okFetch({ latest: "1.1.0" }), currentVersion: "1.0.0", platform: "ios",
  });
  assert.deepEqual(r, { updateAvailable: true, latest: "1.1.0", storeUrl: STORE.ios.url });
});

test("checkStoreUpdate: latest uguale/minore → null", async () => {
  const r = await checkStoreUpdate({
    fetchFn: okFetch({ latest: "1.0.0" }), currentVersion: "1.0.0", platform: "ios",
  });
  assert.equal(r, null);
});

test("checkStoreUpdate: platform web → null senza chiamare fetch", async () => {
  let called = false;
  const r = await checkStoreUpdate({
    fetchFn: async () => { called = true; return { json: async () => ({ latest: "9.9.9" }) }; },
    currentVersion: "1.0.0", platform: "web",
  });
  assert.equal(r, null);
  assert.equal(called, false);
});

test("checkStoreUpdate: fetch che rigetta → null", async () => {
  const r = await checkStoreUpdate({
    fetchFn: async () => { throw new Error("net down"); }, currentVersion: "1.0.0", platform: "ios",
  });
  assert.equal(r, null);
});

test("checkStoreUpdate: JSON malformato → null", async () => {
  const r = await checkStoreUpdate({
    fetchFn: async () => ({ json: async () => { throw new Error("bad json"); } }),
    currentVersion: "1.0.0", platform: "ios",
  });
  assert.equal(r, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `checkStoreUpdate is not a function`.

- [ ] **Step 3: Write minimal implementation**

Aggiungi in `release.js`:

```js
// Best-effort: ritorna {updateAvailable, latest, storeUrl} oppure null. Ogni errore → null,
// per non mostrare mai un banner sbagliato. Su 'web' non chiama nemmeno la rete.
export async function checkStoreUpdate({
  fetchFn = (typeof fetch !== "undefined" ? fetch : undefined),
  manifestUrl = VERSION_MANIFEST_URL,
  currentVersion = APP_VERSION,
  platform = getPlatform(),
} = {}) {
  try {
    if (platform === "web") return null;
    if (typeof fetchFn !== "function") return null;
    const res = await fetchFn(manifestUrl, { cache: "no-store" });
    const data = await res.json();
    const latest = data && data.latest;
    if (!isNewer(latest, currentVersion)) return null;
    const storeUrl = pickStore(platform);
    if (!storeUrl) return null;
    return { updateAvailable: true, latest, storeUrl };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — tutti i test di `release.test.js` verdi.

- [ ] **Step 5: Commit**

```bash
git add release.js tests/release.test.js
git commit -m "feat(release): checkStoreUpdate best-effort con fetch iniettabile"
```

---

## Task 5: `version.json` — manifest

**Files:**
- Create: `version.json`

- [ ] **Step 1: Create the manifest**

Crea `version.json`:

```json
{ "latest": "1.0.0" }
```

- [ ] **Step 2: Verify JSON is valid**

Run: `node -e "console.log(require('./version.json').latest)"`
Expected: stampa `1.0.0`.

- [ ] **Step 3: Commit**

```bash
git add version.json
git commit -m "feat(release): manifest version.json (latest 1.0.0)"
```

---

## Task 6: `index.html` — riga `app` in Impostazioni

**Files:**
- Modify: `index.html:132-135`

- [ ] **Step 1: Apply the markup change**

Sostituisci la riga `app` esistente (attualmente solo il bottone force-update):

```html
          <div class="sv-line">
            <span class="k">app</span>
            <span class="v"><button type="button" id="btnForceUpdate" class="sv-tag">🔄 aggiorna</button></span>
          </div>
```

con:

```html
          <div class="sv-line">
            <span class="k">app</span>
            <span class="v"><span id="appVersion" class="ver">v1.0.0</span> <span id="appUpdateTag"></span> <button type="button" id="btnForceUpdate" class="sv-tag">🔄 aggiorna</button></span>
          </div>
```

(`#appVersion` viene riscritto da `renderAppLine()`; `#appUpdateTag` resta vuoto a flag OFF e ospita il tag `↑ vX.Y.Z` a flag ON con update disponibile.)

- [ ] **Step 2: Add a minimal style for the version text**

In `style.css`, dopo la regola `.sv-term .sv-tag{…}` (≈riga 1251), aggiungi:

```css
.sv-term .ver{ color:var(--dim); font-size:11px; }
```

- [ ] **Step 3: Commit**

```bash
git add index.html style.css
git commit -m "feat(settings): riga app con versione + contenitore tag update"
```

---

## Task 7: `app.js` — integrazione (import, banner, renderAppLine, init sotto flag)

**Files:**
- Modify: `app.js` (import dopo riga 39; funzioni nuove dopo `showUpdateBanner`, che termina a riga 3959)

- [ ] **Step 1: Add the import**

Dopo l'ultimo import (riga 39 `import { actionBarSpec } from "./focus-ui.js";`), aggiungi:

```js
import { APP_VERSION, STORE_UPDATE_ENABLED, checkStoreUpdate } from "./release.js";
```

- [ ] **Step 2: Add banner + settings render + init**

Subito **dopo** la fine della funzione `showUpdateBanner` (la `}` di chiusura a riga 3959), inserisci:

```js
// --- Store update (scaffolding fase 3) ---------------------------------------
// Attivo SOLO se STORE_UPDATE_ENABLED è true (build nativa). A OFF non viene mai
// eseguito: nessun fetch di version.json, nessun banner store. L'update resta sul SW.

// Toast minimale "Aggiorna · vX.Y.Z" che apre lo store. Dismiss di sessione, idempotente.
let storeUpdateDismissed = false;
function showStoreUpdateBanner(latest, storeUrl) {
  if (storeUpdateDismissed) return;
  if (document.getElementById("storeUpdateBanner")) return;
  const b = document.createElement("div");
  b.id = "storeUpdateBanner";
  b.className = "update-toast";
  b.setAttribute("role", "status");

  const dot = document.createElement("span");
  dot.className = "ut-dot";

  const tx = document.createElement("span");
  tx.className = "ut-tx";
  tx.append("Aggiorna · ");
  const v = document.createElement("span");
  v.style.color = "var(--acc)";
  v.textContent = "v" + latest;
  tx.append(v);

  const go = document.createElement("button");
  go.type = "button";
  go.className = "ut-go";
  go.textContent = "›";
  go.setAttribute("aria-label", "Apri lo store");
  go.addEventListener("click", () => window.open(storeUrl, "_blank", "noopener"));

  const x = document.createElement("button");
  x.type = "button";
  x.className = "ut-x";
  x.textContent = "✕";
  x.setAttribute("aria-label", "Rimanda");
  x.addEventListener("click", () => { storeUpdateDismissed = true; b.remove(); });

  b.append(dot, tx, go, x);
  document.body.appendChild(b);
}

// Popola la riga `app` di Impostazioni. Mostra sempre la versione; a flag ON con update
// disponibile aggiunge il tag "↑ vX.Y.Z" e nasconde il force-update manuale del SW.
function renderAppLine(update) {
  const vEl = document.getElementById("appVersion");
  if (vEl) vEl.textContent = "v" + APP_VERSION;

  const fu = document.getElementById("btnForceUpdate");
  if (fu) fu.style.display = STORE_UPDATE_ENABLED ? "none" : "";

  const tagEl = document.getElementById("appUpdateTag");
  if (!tagEl) return;
  tagEl.innerHTML = "";
  if (STORE_UPDATE_ENABLED && update && update.updateAvailable) {
    const t = document.createElement("button");
    t.type = "button";
    t.className = "sv-tag";
    t.textContent = "↑ v" + update.latest;
    t.addEventListener("click", () => window.open(update.storeUrl, "_blank", "noopener"));
    tagEl.appendChild(t);
  }
}

// La versione va mostrata sempre (anche a flag OFF) appena la UI è pronta.
window.addEventListener("load", () => renderAppLine());

// Il controllo store gira solo a flag acceso.
if (STORE_UPDATE_ENABLED) {
  const runStoreCheck = () => {
    checkStoreUpdate().then((u) => {
      if (u && u.updateAvailable) {
        showStoreUpdateBanner(u.latest, u.storeUrl);
        renderAppLine(u);
      }
    });
  };
  window.addEventListener("load", runStoreCheck);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") runStoreCheck();
  });
}
// --- fine Store update -------------------------------------------------------
```

- [ ] **Step 3: Verify the suite still passes**

Run: `npm test`
Expected: PASS — l'aggiunta non tocca i moduli testati; suite verde (416 + i nuovi test di `release.test.js`).

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat(app): banner store + riga versione Impostazioni dietro flag spento"
```

---

## Task 8: `sw.js` — bump cache + nuovi asset

**Files:**
- Modify: `sw.js:5` e `sw.js:6-34`

- [ ] **Step 1: Bump the cache version**

In `sw.js` riga 5, cambia:

```js
const CACHE = "gymsched-v74";
```

in:

```js
const CACHE = "gymsched-v75";
```

- [ ] **Step 2: Add the new assets**

In `sw.js`, dentro l'array `ASSETS`, aggiungi due voci dopo `"./theme.js",` (riga 23):

```js
  "./theme.js",
  "./release.js",
  "./version.json",
```

- [ ] **Step 3: Verify the SW file is valid JS**

Run: `node --check sw.js`
Expected: nessun output (sintassi valida).

- [ ] **Step 4: Commit**

```bash
git add sw.js
git commit -m "chore(sw): cache v74 -> v75 + release.js/version.json negli asset"
```

---

## Task 9: Verifica finale (invariante flag-OFF + suite)

**Files:** nessuno (solo verifica).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS, 0 fail. Conteggio atteso ≈ 416 + ~16 nuovi = ~432 test.

- [ ] **Step 2: Verify the flag-OFF invariant in code**

Run: `git grep -n "if (STORE_UPDATE_ENABLED)" app.js`
Expected: la chiamata a `checkStoreUpdate`/`runStoreCheck` è racchiusa nella guardia. Conferma a vista che **nessun `fetch` di `version.json` può partire** quando il flag è false.

- [ ] **Step 3: Manual smoke (browser)**

Apri l'app (server statico locale), apri Impostazioni:
- la riga `app` mostra `v1.0.0` e il bottone `🔄 aggiorna` (flag OFF, comportamento di oggi);
- in console / Network: **nessuna richiesta a `version.json`**;
- nessun toast store compare.

Atteso: identico a prima della modifica, con in più la versione visibile.

- [ ] **Step 4: Final state**

A questo punto il branch `feat/store-update-scaffolding` contiene: spec + `release.js` + `version.json` + test + integrazione UI + SW bump. Pronto per merge/PR (gestito dall'utente; `finishing-a-development-branch`).

---

## Note di esecuzione

- **TDD reale nei Task 1-4**: scrivi prima il test, vedilo fallire, poi implementa. Non saltare lo step "verify it fails".
- **DRY sugli import del test**: man mano che aggiungi funzioni (Task 2-4), accorpa i nomi nell'unico `import … from "../release.js"` in cima a `tests/release.test.js` invece di ripetere righe di import.
- **Non toccare** `favicon.svg` né le icone (scelta utente fase 2/3): l'icona store sarà la graphite scura attuale, generata solo alla pubblicazione.
- **Segnaposto store voluti**: `PLACEHOLDER_IOS_ID` / `it.placeholder.setlog` restano finché non si pubblica; non sono TODO da risolvere ora.
