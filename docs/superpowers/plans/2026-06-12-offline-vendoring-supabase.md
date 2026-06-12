# Offline reale — vendoring Supabase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminare l'unica dipendenza JS cross-origin (esm.sh) vendorizzando un bundle ESM autonomo di `@supabase/supabase-js`, così l'app fa boot offline in modo deterministico.

**Architecture:** Sito statico senza build step permanente. Uno script Node una-tantum (`scripts/vendor-supabase.cjs`) usa esbuild per produrre `vendor/supabase.js` (committato), che il service worker cacha. `supabase-client.js` importa da quel file locale invece che dal CDN. Un guard test blocca per sempre la reintroduzione di import remoti.

**Tech Stack:** Node `--test` (ESM), esbuild (devDep), `@supabase/supabase-js` (devDep, runtime via bundle committato), service worker.

Spec: `docs/superpowers/specs/2026-06-12-offline-vendoring-supabase-design.md`

---

### Task 1: Guard test (red first)

**Files:**
- Test: `tests/vendor-supabase.test.js` (create)

- [ ] **Step 1: Write the failing test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url));

test("vendor/supabase.js esiste (eseguire `node scripts/vendor-supabase.cjs`)", () => {
  assert.ok(existsSync(at("../vendor/supabase.js")), "vendor/supabase.js mancante");
});

test("vendor/supabase.js è autonomo: nessun import remoto", () => {
  const src = readFileSync(at("../vendor/supabase.js"), "utf8");
  assert.ok(!/from\s*["']https?:\/\//.test(src), "import statico remoto nel bundle");
  assert.ok(!/import\s*\(\s*["']https?:\/\//.test(src), "dynamic import remoto nel bundle");
});

test("supabase-client.js importa il bundle locale, non un CDN", () => {
  const src = readFileSync(at("../supabase-client.js"), "utf8");
  assert.match(src, /from\s*["']\.\/vendor\/supabase\.js["']/, "deve importare ./vendor/supabase.js");
  assert.ok(!/from\s*["']https?:\/\//.test(src), "supabase-client.js importa ancora da un URL");
});

test("sw.js cacha il bundle vendorizzato e ha bumpato CACHE a v79", () => {
  const sw = readFileSync(at("../sw.js"), "utf8");
  assert.match(sw, /["']\.\/vendor\/supabase\.js["']/, "ASSETS deve includere ./vendor/supabase.js");
  assert.match(sw, /const CACHE\s*=\s*["']gymsched-v79["']/, "CACHE deve essere gymsched-v79");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/vendor-supabase.test.js`
Expected: FAIL — tutti e 4 i test rossi (file e modifiche non ancora presenti).

> NB: non committare ancora il test (resterebbe rosso). Entra in git al Task 4, quando tutti e 4 passano: così ogni commit ha la suite verde.

---

### Task 2: devDeps + vendor script + genera il bundle

**Files:**
- Modify: `package.json` (devDependencies)
- Create: `scripts/vendor-supabase.cjs`
- Create: `vendor/supabase.js` (generato, committato)

- [ ] **Step 1: Installa esbuild + supabase-js come devDeps pinnati**

Run:
```bash
npm install --save-dev --save-exact esbuild @supabase/supabase-js
```
Expected: `package.json` ora ha `devDependencies` con esbuild e @supabase/supabase-js a versioni esatte; crea `package-lock.json` e `node_modules/` (già gitignored).

- [ ] **Step 2: Scrivi lo script di vendoring**

`scripts/vendor-supabase.cjs`:
```js
// scripts/vendor-supabase.cjs — genera vendor/supabase.js: bundle ESM autonomo di
// @supabase/supabase-js per l'offline reale (niente import da CDN cross-origin).
// Uso: node scripts/vendor-supabase.cjs   (richiede le devDeps esbuild + @supabase/supabase-js)
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const OUT = path.join(__dirname, "..", "vendor", "supabase.js");
const pkgVersion = require("@supabase/supabase-js/package.json").version;

(async () => {
  const tmp = path.join(__dirname, "_supabase-entry.js");
  fs.writeFileSync(tmp, `export { createClient } from "@supabase/supabase-js";\n`);
  try {
    const result = await esbuild.build({
      entryPoints: [tmp],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      minify: true,
      write: false,
      legalComments: "none",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const code = result.outputFiles[0].text;

    // Assert anti-rete: nessun import/require remoto deve restare nel bundle.
    if (/from\s*["']https?:\/\//.test(code) || /import\s*\(\s*["']https?:\/\//.test(code)) {
      console.error("ERRORE: il bundle contiene ancora import remoti. Abort, niente scrittura.");
      process.exit(1);
    }

    const header =
`// vendor/supabase.js — bundle ESM autonomo di @supabase/supabase-js v${pkgVersion}.
// Generato da scripts/vendor-supabase.cjs (esbuild) per l'offline reale: NESSUN import da CDN.
// NON modificare a mano — rigenerare con: node scripts/vendor-supabase.cjs
`;
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, header + code);
    console.log("scritto vendor/supabase.js", (header + code).length, "bytes, supabase-js v" + pkgVersion);
  } finally {
    fs.unlinkSync(tmp);
  }
})();
```

- [ ] **Step 3: Genera il bundle**

Run: `node scripts/vendor-supabase.cjs`
Expected: stampa `scritto vendor/supabase.js <N> bytes, supabase-js vX.Y.Z`; il file `vendor/supabase.js` esiste (~100–150 KB). Nessun errore "import remoti".

- [ ] **Step 4: Run guard test — 2 su 4 verdi**

Run: `node --test tests/vendor-supabase.test.js`
Expected: "vendor/supabase.js esiste" e "è autonomo" → PASS; "supabase-client.js importa il bundle locale" e "sw.js … v79" → FAIL (ancora da fare in Task 3/4).

---

### Task 3: Punta supabase-client.js al bundle locale

**Files:**
- Modify: `supabase-client.js:3`

- [ ] **Step 1: Cambia l'import**

In `supabase-client.js`, sostituisci la riga:
```js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
```
con:
```js
import { createClient } from "./vendor/supabase.js";
```
(Il resto del file — `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `createClient(... persistSession/autoRefreshToken/detectSessionInUrl ...)` — resta identico.)

- [ ] **Step 2: Run guard test — 3 su 4 verdi**

Run: `node --test tests/vendor-supabase.test.js`
Expected: solo "sw.js … v79" ancora FAIL; gli altri 3 PASS.

- [ ] **Step 3: Commit bundle + script + import**

```bash
git add package.json package-lock.json scripts/vendor-supabase.cjs vendor/supabase.js supabase-client.js
git commit -m "feat(offline): vendorizza @supabase/supabase-js (esbuild) e importa locale"
```

---

### Task 4: Cache il bundle nel service worker

**Files:**
- Modify: `sw.js:5` (CACHE) e `sw.js:6-36` (ASSETS)

- [ ] **Step 1: Aggiungi il bundle agli ASSETS e bumpa CACHE**

In `sw.js`, cambia:
```js
const CACHE = "gymsched-v78";
```
in:
```js
const CACHE = "gymsched-v79";
```
e dentro l'array `ASSETS`, dopo `"./supabase-client.js",` aggiungi una riga:
```js
  "./vendor/supabase.js",
```

- [ ] **Step 2: Run guard test — 4 su 4 verdi**

Run: `node --test tests/vendor-supabase.test.js`
Expected: tutti e 4 PASS.

- [ ] **Step 3: Run l'intera suite**

Run: `node --test`
Expected: tutti i test PASS (442 esistenti + 4 nuovi = 446), 0 fail.

- [ ] **Step 4: Commit SW + guard test (tutto verde)**

```bash
git add sw.js tests/vendor-supabase.test.js
git commit -m "feat(offline): cacha vendor/supabase.js nel SW (v79) + guard test"
```

---

### Task 5: Verifica offline reale (Playwright MCP)

**Files:** nessuna modifica committata (verifica). La suite E2E permanente è il sotto-progetto #4a.

- [ ] **Step 1: Avvia il server statico**

Run (background): `python -m http.server 8765`
Expected: serve la root su http://localhost:8765

- [ ] **Step 2: Carica l'app e attendi il SW**

Con gli strumenti Playwright MCP: `browser_navigate` su `http://localhost:8765`, poi `browser_wait_for` finché compare la schermata di login (testo "ACCESSO" / "autenticazione richiesta"). Concedi qualche secondo per l'install del SW.

- [ ] **Step 3: Gate deterministico — zero richieste a esm.sh**

Con `browser_network_requests`, verifica che **nessuna** richiesta abbia host `esm.sh`. Questo prova che l'app non dipende più dal CDN per il boot.
Expected: 0 richieste verso `https://esm.sh/...`.

- [ ] **Step 4: Boot offline reale (best-effort)**

Se il tooling lo consente (`browser_run_code_unsafe` con `context.setOffline(true)`), metti il context offline, `browser_navigate` di nuovo sulla pagina e verifica che l'app faccia comunque boot fino alla schermata login senza errori di modulo in console (`browser_console_messages` non deve contenere "Failed to fetch dynamically imported module" né errori su `supabase`). Se `setOffline` non è esponibile via MCP, lo Step 3 (zero esm.sh) è il gate sufficiente per questo sotto-progetto; l'offline-reload completo è coperto dagli E2E in #4a.

- [ ] **Step 5: Chiudi il server**

Ferma il processo `http.server` in background.

---

## Note di chiusura

- `node_modules/` e le devDeps NON vengono spedite: il runtime usa solo `vendor/supabase.js` committato.
- A integrazione completata, il branch `offline-supabase-vendoring` segue il flusso di `finishing-a-development-branch` (ff-merge su main + push), coerente con la prassi del repo.
- Aggiornare la memoria di progetto al merge.
