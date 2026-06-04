# Scan — figura anatomica heatmap · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Figura anatomica fronte/retro con muscoli "accesi" (X-ray + blueprint CRT) su tre superfici: nuova schermata Scan (tab SETTIMANA/FRESCHEZZA), pagina esercizio del Database (muscoli + illustrazione wger), editor scheda (copertura del giorno).

**Architecture:** Moduli puri testabili in Node (`body-data.js` dati vendorati, `body.js` logica heat/render, `media-map.js` illustrazioni) + estensione `catalog.js` (`secondary`/`img`) e `session.js` (contributi volume, ultima-volta per gruppo). UI in `app.js`/`index.html`/`style.css` seguendo i pattern esistenti (overlay `focus-ov` + history state, drawer `data-act`, dialog `dbScrim`).

**Tech Stack:** vanilla JS ES modules, `node --test`, SVG inline, service worker (bump cache v63→v64).

**Spec:** `docs/superpowers/specs/2026-06-04-anatomia-heatmap-design.md`
**Mockup:** `mockups/scan-anatomia-rev1.html`

**⚠ Prerequisito branch:** il checkout principale potrebbe essere occupato da `feat/a11y-accordion` (lavoro parallelo). Prima di partire: `git -C <repo> branch --show-current`. Se NON è `main`, lavorare in un worktree dedicato (`git worktree add ../set.log-anatomia main` poi `git checkout -b feat/anatomia-heatmap`), MAI cambiare branch nel checkout principale. Se è `main`: `git checkout -b feat/anatomia-heatmap` e procedere lì.

**⚠ Prerequisito sorgenti vendoring (Task 1):** servono i file `bh-front.ts`, `bh-back.ts`, `bh-wrapper.tsx`, `bh-LICENSE` in `.superpowers/brainstorm/30259-1780581068/assets/`. Se la cartella non esiste più, riscaricarli dal repo GitHub `HichamELBSI/react-native-body-highlighter` (MIT): `assets/bodyFront.ts` → `bh-front.ts`, `assets/bodyBack.ts` → `bh-back.ts`, `index.tsx` → `bh-wrapper.tsx`, `LICENSE` → `bh-LICENSE`.

---

## File Structure

| File | Azione | Responsabilità |
|---|---|---|
| `scripts/vendor-body-data.cjs` | Create | conversione one-off sorgenti TS → `body-data.js` (provenance documentata) |
| `body-data.js` | Create (generato) | SOLO dati: path SVG fronte/retro per zona + silhouette + viewBox, header MIT |
| `body.js` | Create | logica pura: `GROUP_ZONES`, `heatByGroup`, `freshnessByGroup`, `dayCoverage`, `renderBody` |
| `media-map.js` | Create | mappa nome seed → illustrazioni wger, `mediaFor(entry)` con override `img` |
| `session.js` | Modify | `muscleContributions` (volumi per-traccia con nome), `lastTrainedByGroup` |
| `catalog.js` | Modify | campi `secondary`/`img` in add/rename, seed con secondari, `backfillCatalogSecondaries` |
| `app.js` | Modify | overlay Scan, pannelli DB/editor, chips form, wiring drawer/popstate/backfill |
| `index.html` | Modify | markup `scanOverlay`, 5ª voce drawer |
| `style.css` | Modify | `.crt-panel` e satelliti (palette FISSA fuori dai temi), tabs Scan, chips |
| `sw.js` | Modify | ASSETS + bump `gymsched-v64` |
| `tests/body.test.js` | Create | test body.js + body-data.js |
| `tests/media-map.test.js` | Create | test media-map.js |
| `tests/session.test.js` | Modify | test nuove funzioni session |
| `tests/catalog.test.js` | Modify | test secondary/img/seed/backfill |
| `tests/store.merge.test.js` | Modify | mergeBlobs conserva i campi nuovi del catalogo |

Convenzioni di stile: commenti in italiano, stile conciso come i moduli esistenti; test con `import { test } from "node:test"; import assert from "node:assert/strict";`.

---

### Task 1: Vendoring dati figura → `body-data.js`

**Files:**
- Create: `scripts/vendor-body-data.cjs`
- Create: `body-data.js` (generato dallo script)
- Test: `tests/body.test.js` (prima parte)

- [ ] **Step 1: Scrivere lo script di conversione**

Creare `scripts/vendor-body-data.cjs`:

```js
// Genera body-data.js dai sorgenti di react-native-body-highlighter (MIT).
// Sorgenti NON versionati (scaricati a mano dal repo HichamELBSI/react-native-body-highlighter):
//   bh-front.ts (assets/bodyFront.ts) · bh-back.ts (assets/bodyBack.ts)
//   bh-wrapper.tsx (index.tsx) · bh-LICENSE (LICENSE)
// Uso: node scripts/vendor-body-data.cjs <dir-sorgenti>
const fs = require("fs");
const path = require("path");

const src = process.argv[2];
if (!src) { console.error("uso: node scripts/vendor-body-data.cjs <dir con bh-front.ts bh-back.ts bh-wrapper.tsx bh-LICENSE>"); process.exit(1); }

// Estrae [{slug, paths[]}] dal sorgente TS: blocchi `slug: "..."` seguiti da stringhe-path SVG.
function parseParts(ts) {
  const parts = [];
  const chunks = ts.split(/slug:\s*"/).slice(1);
  for (const ch of chunks) {
    const slug = ch.slice(0, ch.indexOf('"'));
    const stop = ch.indexOf("slug:");
    const body = stop === -1 ? ch : ch.slice(0, stop);
    const paths = [...body.matchAll(/"((?:M|m)[^"]+)"/g)].map((m) => m[1]);
    parts.push({ slug, paths });
  }
  return parts;
}

const front = parseParts(fs.readFileSync(path.join(src, "bh-front.ts"), "utf8"));
const back = parseParts(fs.readFileSync(path.join(src, "bh-back.ts"), "utf8"));
const wrapper = fs.readFileSync(path.join(src, "bh-wrapper.tsx"), "utf8");
// Le prime due path d="..." del wrapper sono le silhouette fronte e retro.
const [baseFront, baseBack] = [...wrapper.matchAll(/d="([^"]+)"/g)].map((m) => m[1]);
const license = fs.readFileSync(path.join(src, "bh-LICENSE"), "utf8").trim()
  .split(/\r?\n/).map((l) => "// " + l).join("\n");

if (!front.length || !back.length || !baseFront || !baseBack) {
  console.error("parsing fallito: front", front.length, "back", back.length);
  process.exit(1);
}

const out = `// body-data.js — path SVG della figura anatomica fronte/retro (SOLO dati).
// Vendorato da react-native-body-highlighter (https://github.com/HichamELBSI/react-native-body-highlighter)
// con scripts/vendor-body-data.cjs — NON modificare a mano, rigenerare.
// Licenza originale (MIT):
${license}

export const FRONT_PARTS = ${JSON.stringify(front)};

export const BACK_PARTS = ${JSON.stringify(back)};

export const BASE_FRONT = ${JSON.stringify(baseFront)};

export const BASE_BACK = ${JSON.stringify(baseBack)};

export const VIEWBOX_FRONT = "0 0 724 1448";

export const VIEWBOX_BACK = "724 0 724 1448";
`;
fs.writeFileSync(path.join(__dirname, "..", "body-data.js"), out);
console.log("scritto body-data.js", out.length, "bytes,", front.length, "+", back.length, "zone");
```

- [ ] **Step 2: Generare body-data.js**

Run: `node scripts/vendor-body-data.cjs .superpowers/brainstorm/30259-1780581068/assets`
Expected: `scritto body-data.js <N> bytes, <f> + <b> zone` (N ~40–50000; f, b ≥ 10)

- [ ] **Step 3: Scrivere i test del modulo dati**

Creare `tests/body.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { FRONT_PARTS, BACK_PARTS, BASE_FRONT, BASE_BACK } from "../body-data.js";

test("body-data: parti fronte/retro presenti e con path", () => {
  assert.ok(FRONT_PARTS.length >= 10);
  assert.ok(BACK_PARTS.length >= 10);
  for (const p of [...FRONT_PARTS, ...BACK_PARTS]) {
    assert.ok(p.slug && Array.isArray(p.paths) && p.paths.length >= 1);
  }
  assert.ok(BASE_FRONT.startsWith("M") || BASE_FRONT.startsWith("m"));
  assert.ok(BASE_BACK.startsWith("M") || BASE_BACK.startsWith("m"));
});

test("body-data: le zone chiave della figura esistono", () => {
  const slugs = new Set([...FRONT_PARTS, ...BACK_PARTS].map((p) => p.slug));
  for (const z of ["chest", "abs", "obliques", "biceps", "triceps", "deltoids",
    "trapezius", "upper-back", "lower-back", "quadriceps", "hamstring",
    "gluteal", "adductors", "calves"]) {
    assert.ok(slugs.has(z), `zona mancante: ${z}`);
  }
});
```

- [ ] **Step 4: Run test**

Run: `node --test tests/body.test.js`
Expected: 2 PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/vendor-body-data.cjs body-data.js tests/body.test.js
git commit -m "feat(body): vendoring path SVG figura da react-native-body-highlighter (MIT)"
```

---

### Task 2: `body.js` — `GROUP_ZONES` + `heatByGroup`

**Files:**
- Create: `body.js`
- Test: `tests/body.test.js`

- [ ] **Step 1: Test falliti**

Aggiungere a `tests/body.test.js` (e scommentare l'import di `GROUP_ZONES`):

```js
import { GROUP_ZONES, heatByGroup } from "../body.js";
import { MUSCLE_GROUPS } from "../catalog.js";

test("GROUP_ZONES: copre tutti gli 8 gruppi con zone valide della figura", () => {
  const slugs = new Set([...FRONT_PARTS, ...BACK_PARTS].map((p) => p.slug));
  assert.deepEqual(Object.keys(GROUP_ZONES).sort(), [...MUSCLE_GROUPS].sort());
  for (const zones of Object.values(GROUP_ZONES)) {
    assert.ok(zones.length >= 1);
    for (const z of zones) assert.ok(slugs.has(z), `zona inesistente: ${z}`);
  }
});

test("heatByGroup: primario pieno, secondario 0.5 via catalogo, normalizzato sul max", () => {
  const catalog = [{ id: "c1", name: "Panca piana bilanciere", muscle: "Petto",
    note: "", secondary: ["Spalle", "Tricipiti"], img: "" }];
  const contribs = [
    { muscle: "Petto", name: "Panca piana bilanciere", volume: 1000 },
    { muscle: "Bicipiti", name: "Curl manubri", volume: 250 },
  ];
  const { groups, zones } = heatByGroup(contribs, catalog);
  assert.equal(groups.Petto, 1);                 // 1000 → max
  assert.equal(groups.Spalle, 0.5);              // 500 da secondario
  assert.equal(groups.Tricipiti, 0.5);
  assert.equal(groups.Bicipiti, 0.25);           // 250/1000
  assert.equal(zones.chest, 1);
  assert.equal(zones.deltoids, 0.5);
  assert.equal(zones.biceps, 0.25);
  assert.equal(zones["upper-back"], undefined);  // mai allenato → assente
});

test("heatByGroup: esercizio fuori catalogo conta solo il primario", () => {
  const { groups } = heatByGroup([{ muscle: "Dorso", name: "Inventato", volume: 100 }], []);
  assert.deepEqual(groups, { Dorso: 1 });
});

test("heatByGroup: contributi vuoti → mappe vuote, nessun NaN", () => {
  const { groups, zones } = heatByGroup([], []);
  assert.deepEqual(groups, {});
  assert.deepEqual(zones, {});
});

test("heatByGroup: gruppo ignoto o volume 0 ignorati", () => {
  const { groups } = heatByGroup([
    { muscle: "Altro", name: "X", volume: 100 },
    { muscle: "", name: "Y", volume: 100 },
    { muscle: "Petto", name: "Z", volume: 0 },
    { muscle: "Petto", name: "W", volume: 50 },
  ], []);
  assert.deepEqual(groups, { Petto: 1 });
});
```

- [ ] **Step 2: Run, verificare FAIL**

Run: `node --test tests/body.test.js`
Expected: FAIL (`Cannot find module '../body.js'`)

- [ ] **Step 3: Implementare**

Creare `body.js`:

```js
// body.js
// ---- Figura anatomica heatmap (puro, testabile in Node). I dati path vivono
//      in body-data.js (vendorati MIT); qui solo logica: mappatura gruppi→zone,
//      heat normalizzato, fasce freschezza, render SVG. ----
import {
  FRONT_PARTS, BACK_PARTS, BASE_FRONT, BASE_BACK, VIEWBOX_FRONT, VIEWBOX_BACK,
} from "./body-data.js";

// Mappatura degli 8 gruppi del catalogo sulle zone della figura. Le zone non
// elencate qui (testa, mani, avambracci…) restano sempre neutre.
export const GROUP_ZONES = {
  Petto: ["chest"],
  Dorso: ["upper-back", "lower-back", "trapezius"],
  Spalle: ["deltoids"],
  Bicipiti: ["biceps"],
  Tricipiti: ["triceps"],
  Gambe: ["quadriceps", "hamstring", "gluteal", "adductors"],
  Polpacci: ["calves"],
  Core: ["abs", "obliques"],
};

const norm = (s) => String(s ?? "").trim().toLowerCase();

// Heat per gruppo dai contributi per-traccia [{muscle, name, volume}]:
// primario pieno + 0.5× nei gruppi `secondary` della voce di catalogo con lo
// stesso nome (link-per-nome, come catalogUsage). Esercizi fuori catalogo →
// solo primario. Intensità normalizzate sul max della vista (il gruppo col
// volume più alto vale 1). Ritorna { groups: {Gruppo: 0..1}, zones: {zona: 0..1} }.
export function heatByGroup(contribs, catalog = []) {
  const byName = new Map();
  for (const e of catalog) byName.set(norm(e.name), e);
  const vol = new Map();
  const add = (g, v) => { if (g && GROUP_ZONES[g] && v > 0) vol.set(g, (vol.get(g) ?? 0) + v); };
  for (const c of contribs ?? []) {
    add(c.muscle, c.volume);
    for (const g of byName.get(norm(c.name))?.secondary ?? []) add(g, c.volume * 0.5);
  }
  const max = Math.max(0, ...vol.values());
  const groups = {}, zones = {};
  for (const [g, v] of vol) {
    const h = max > 0 ? v / max : 0;
    groups[g] = h;
    for (const z of GROUP_ZONES[g]) zones[z] = Math.max(zones[z] ?? 0, h);
  }
  return { groups, zones };
}
```

- [ ] **Step 4: Run test**

Run: `node --test tests/body.test.js`
Expected: tutti PASS

- [ ] **Step 5: Commit**

```bash
git add body.js tests/body.test.js
git commit -m "feat(body): GROUP_ZONES e heatByGroup (primario + 0.5 secondari, norm sul max)"
```

---

### Task 3: `body.js` — `freshnessByGroup`

**Files:**
- Modify: `body.js`
- Test: `tests/body.test.js`

- [ ] **Step 1: Test falliti**

Aggiungere a `tests/body.test.js` (estendere l'import da `../body.js` con `freshnessByGroup`):

```js
test("freshnessByGroup: fasce ieri/2-3g/4-5g/≥6g/mai", () => {
  const today = "2026-06-04";
  const last = {
    Petto: "2026-06-04",     // oggi → 0.95
    Dorso: "2026-06-03",     // ieri → 0.95
    Spalle: "2026-06-01",    // 3g → 0.6
    Bicipiti: "2026-05-31",  // 4g → 0.25
    Tricipiti: "2026-05-29", // 6g → spento + ⚠
    // Gambe/Polpacci/Core assenti → mai → tratteggio
  };
  const { zones, warnGroups, neverGroups } = freshnessByGroup(last, today);
  assert.equal(zones.chest, 0.95);
  assert.equal(zones["upper-back"], 0.95);
  assert.equal(zones.deltoids, 0.6);
  assert.equal(zones.biceps, 0.25);
  assert.equal(zones.triceps, undefined);            // spento
  assert.deepEqual(warnGroups, ["Tricipiti"]);
  assert.deepEqual([...neverGroups].sort(), ["Core", "Gambe", "Polpacci"]);
  assert.equal(zones.calves, undefined);
});

test("freshnessByGroup: never → set di zone cold per il render", () => {
  const { never } = freshnessByGroup({}, "2026-06-04");
  assert.ok(never.has("chest") && never.has("calves") && never.has("abs"));
});
```

- [ ] **Step 2: Run, verificare FAIL**

Run: `node --test tests/body.test.js`
Expected: FAIL (`freshnessByGroup is not a function` / import error)

- [ ] **Step 3: Implementare**

Aggiungere a `body.js` dopo `heatByGroup`:

```js
// Fasce freschezza dalla mappa gruppo→data ISO dell'ultima sessione:
// 0–1 giorni 0.95 · 2–3 0.6 · 4–5 0.25 · ≥6 spento (gruppo in warnGroups) ·
// assente = mai allenato (zone in `never` → tratteggio rosso nel render).
export function freshnessByGroup(lastByGroup, todayIso) {
  const days = (iso) => Math.round((Date.parse(todayIso) - Date.parse(iso)) / 86400000);
  const zones = {}, never = new Set(), warnGroups = [], neverGroups = [];
  for (const [g, zs] of Object.entries(GROUP_ZONES)) {
    const last = lastByGroup?.[g];
    if (!last) { neverGroups.push(g); zs.forEach((z) => never.add(z)); continue; }
    const d = days(last);
    const h = d <= 1 ? 0.95 : d <= 3 ? 0.6 : d <= 5 ? 0.25 : 0;
    if (h === 0) { warnGroups.push(g); continue; } // spento + ⚠ in legenda
    for (const z of zs) zones[z] = Math.max(zones[z] ?? 0, h);
  }
  return { zones, never, warnGroups, neverGroups };
}
```

- [ ] **Step 4: Run test**

Run: `node --test tests/body.test.js`
Expected: tutti PASS

- [ ] **Step 5: Commit**

```bash
git add body.js tests/body.test.js
git commit -m "feat(body): freshnessByGroup a fasce con warn e mai-allenato"
```

---

### Task 4: `body.js` — `renderBody` + `dayCoverage`

**Files:**
- Modify: `body.js`
- Test: `tests/body.test.js`

- [ ] **Step 1: Test falliti**

Aggiungere a `tests/body.test.js`:

```js
test("renderBody: SVG fronte+retro con silhouette e zone attive", () => {
  const html = renderBody({ zones: { chest: 1, biceps: 0.5 } });
  assert.ok(html.includes("<svg"));
  assert.equal((html.match(/<svg/g) || []).length, 2); // fronte + retro
  assert.ok(html.includes('viewBox="0 0 724 1448"'));
  assert.ok(html.includes('viewBox="724 0 724 1448"'));
  assert.ok(html.includes("#f0a73c"));     // ambra attiva
  assert.ok(html.includes("feGaussianBlur")); // alone
});

test("renderBody: secondari blu e cold tratteggiato", () => {
  const html = renderBody({ zones: {}, secondaries: new Set(["deltoids"]), cold: new Set(["calves"]) });
  assert.ok(html.includes("#7FC8FF"));
  assert.ok(html.includes("stroke-dasharray"));
});

test("renderBody: id filtri univoci tra due render nella stessa pagina", () => {
  const ids = (h) => [...h.matchAll(/filter id="([^"]+)"/g)].map((m) => m[1]);
  const a = ids(renderBody({ zones: { chest: 1 } }));
  const b = ids(renderBody({ zones: { chest: 1 } }));
  assert.ok(a.length >= 2 && b.length >= 2);
  for (const id of a) assert.ok(!b.includes(id), `id duplicato: ${id}`);
});

test("dayCoverage: presenze → primario 1, secondario 0.5, fuori catalogo solo primario", () => {
  const catalog = [{ id: "c1", name: "Panca piana bilanciere", muscle: "Petto",
    note: "", secondary: ["Tricipiti"], img: "" }];
  const dp = { day: "A", exercises: [
    { id: "e1", name: "Panca piana bilanciere", muscle: "Petto" },
    { id: "e2", name: "Squat al volo", muscle: "Gambe" },
  ] };
  const { groups } = dayCoverage(dp, catalog);
  assert.equal(groups.Petto, 1);
  assert.equal(groups.Gambe, 1);
  assert.equal(groups.Tricipiti, 0.5);
});

test("dayCoverage: superset spalmato su muscle e muscleB", () => {
  const dp = { day: "A", exercises: [
    { id: "e1", name: "Plank + Crunch a terra", muscle: "Core", muscleB: "Core", superset: true },
  ] };
  const { groups } = dayCoverage(dp, []);
  assert.deepEqual(groups, { Core: 1 });
});
```

(Estendere l'import da `../body.js` con `renderBody, dayCoverage`.)

- [ ] **Step 2: Run, verificare FAIL**

Run: `node --test tests/body.test.js`
Expected: FAIL sui 5 test nuovi

- [ ] **Step 3: Implementare**

Aggiungere a `body.js`:

```js
// ---- Render SVG (stringhe; niente DOM, testabile in Node). Palette X-ray
//      FISSA fuori dai temi: il pannello è un "monitor incassato". ----
const X = {
  sil: "#0c0f12", neutral: "#161a1e", off: "#1c2127", offLine: "#2c343c",
  amber: "#f0a73c", blue: "#7FC8FF", down: "#e0705a", ink: "#3a4148",
};
// Zone senza gruppo muscolare: sempre neutre (più scure dei muscoli spenti).
const NEUTRAL_ZONES = new Set(["head", "hair", "neck", "hands", "feet",
  "ankles", "knees", "forearm", "tibialis"]);

let uid = 0; // contatore per id filtri univoci (più figure nella stessa pagina)

function fig(parts, baseD, viewBox, { zones = {}, secondaries = new Set(), cold = new Set(), w = 86 }) {
  const g = "bx" + (uid++);
  const defs = `<filter id="${g}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="20"/></filter>`;
  const base = `<path d="${baseD}" fill="${X.sil}" fill-opacity=".82" stroke="${X.ink}" stroke-width="2.5"/>`;
  let z = "";
  for (const p of parts) {
    const h = zones[p.slug] ?? 0;
    let attrs, halo = "";
    if (NEUTRAL_ZONES.has(p.slug)) attrs = `fill="${X.neutral}"`;
    else if (cold.has(p.slug)) attrs = `fill="${X.off}" stroke="${X.down}" stroke-width="4" stroke-dasharray="10 8"`;
    else if (secondaries.has(p.slug)) {
      for (const d of p.paths) halo += `<path d="${d}" fill="${X.blue}" fill-opacity=".6" filter="url(#${g})"/>`;
      attrs = `fill="${X.blue}" fill-opacity=".32" stroke="${X.blue}" stroke-width="1.5" stroke-opacity=".7"`;
    } else if (h > 0) {
      for (const d of p.paths) halo += `<path d="${d}" fill="${X.amber}" fill-opacity="${(0.35 + h * 0.6).toFixed(2)}" filter="url(#${g})"/>`;
      attrs = `fill="${X.amber}" fill-opacity="${(0.22 + h * 0.58).toFixed(2)}" stroke="${X.amber}" stroke-width="1.5" stroke-opacity="${(h * 0.9).toFixed(2)}"`;
    } else attrs = `fill="${X.off}" stroke="${X.offLine}" stroke-width="1.5"`;
    z += halo;
    for (const d of p.paths) z += `<path d="${d}" ${attrs}/>`;
  }
  return `<svg viewBox="${viewBox}" style="width:${w}px;height:auto;flex:none"><defs>${defs}</defs>${base}${z}</svg>`;
}

// Coppia fronte+retro. opts: { zones: {zona:0..1}, secondaries: Set<zona>,
// cold: Set<zona> (tratteggio rosso "mai"), w: px per figura }.
export function renderBody(opts = {}) {
  return `<div class="bd-pair">${fig(FRONT_PARTS, BASE_FRONT, VIEWBOX_FRONT, opts)}${fig(BACK_PARTS, BASE_BACK, VIEWBOX_BACK, opts)}</div>`;
}

// Copertura muscolare di un giorno di scheda (senza volumi, per l'editor):
// ogni esercizio vale 1 sul primario (+0.5 sui secondari via catalogo).
// Zone non coperte restano spente normali, MAI rosse.
export function dayCoverage(dayPlan, catalog = []) {
  const contribs = [];
  for (const ex of dayPlan?.exercises ?? []) {
    const name = String(ex?.name ?? "");
    if (ex?.superset) {
      const [nameA, nameB] = name.includes(" + ") ? name.split(" + ") : [name, name];
      contribs.push({ muscle: ex.muscle, name: nameA, volume: 1 },
        { muscle: ex.muscleB, name: nameB, volume: 1 });
    } else contribs.push({ muscle: ex?.muscle, name, volume: 1 });
  }
  return heatByGroup(contribs, catalog);
}
```

- [ ] **Step 4: Run test**

Run: `node --test tests/body.test.js`
Expected: tutti PASS

- [ ] **Step 5: Commit**

```bash
git add body.js tests/body.test.js
git commit -m "feat(body): renderBody X-ray alone morbido e dayCoverage editor"
```

---

### Task 5: `session.js` — `muscleContributions` + `lastTrainedByGroup`

**Files:**
- Modify: `session.js` (dopo `volumeByMuscle`, ~riga 376, e dopo `sessionDates`, ~riga 469)
- Test: `tests/session.test.js` (append in fondo)

- [ ] **Step 1: Test falliti**

Aggiungere in fondo a `tests/session.test.js` (estendere l'import esistente da `../session.js` con `muscleContributions, lastTrainedByGroup`):

```js
// ---- muscleContributions / lastTrainedByGroup (heatmap anatomica) ----

const heatData = () => ({
  plan: [{ day: "A", title: "Push", exercises: [
    { id: "x1", name: "Panca piana bilanciere", muscle: "Petto" },
    { id: "x2", name: "Spinte inclinata manubri", muscle: "Petto" },
    { id: "x3", name: "Plank + Crunch a terra", muscle: "Core", muscleB: "Core", superset: true, unit: "sec", unitB: "reps" },
  ] }],
  weeks: { "2026-W23": {
    dates: { A: "2026-06-02" },
    entries: { A: {
      x1: { sets: [{ reps: "8", kg: "80", done: true }, { reps: "5", kg: "60", done: true, warmup: true }] },
      x2: { sets: [{ reps: "10", kg: "20", done: true }] },
      x3: { a: { sets: [{ reps: "60", done: true }] }, b: { sets: [{ reps: "15", done: true }] } },
    } },
  } },
});

test("muscleContributions: per-traccia con nome, manubri x2, warmup/sec esclusi", () => {
  const d = heatData();
  const out = muscleContributions(d, "2026-W23", "A", d.plan[0]);
  // x1: 8*80=640 (warmup escluso) · x2: 10*20*2=400 (manubri) ·
  // x3 traccia A a tempo → volume 0 (esclusa) · traccia B reps senza kg → 0 (esclusa)
  assert.deepEqual(out, [
    { muscle: "Petto", name: "Panca piana bilanciere", volume: 640 },
    { muscle: "Petto", name: "Spinte inclinata manubri", volume: 400 },
  ]);
});

test("lastTrainedByGroup: data più recente per gruppo, anche con volume 0", () => {
  const d = heatData();
  // Core: serie done a tempo/senza kg → volume 0 ma ALLENATO (conta per freschezza)
  const out = lastTrainedByGroup(d);
  assert.equal(out.Petto, "2026-06-02");
  assert.equal(out.Core, "2026-06-02");
  assert.equal(out.Dorso, undefined);
});

test("lastTrainedByGroup: vince la data più recente tra più settimane", () => {
  const d = heatData();
  d.weeks["2026-W22"] = {
    dates: { A: "2026-05-26" },
    entries: { A: { x1: { sets: [{ reps: "8", kg: "70", done: true }] } } },
  };
  assert.equal(lastTrainedByGroup(d).Petto, "2026-06-02");
});

test("lastTrainedByGroup: serie solo warmup o non-done non contano", () => {
  const d = heatData();
  d.weeks["2026-W23"].entries.A = {
    x1: { sets: [{ reps: "5", kg: "60", done: true, warmup: true }, { reps: "8", kg: "80", done: false }] },
  };
  assert.equal(lastTrainedByGroup(d).Petto, undefined);
});
```

(Struttura verificata su `store.js/getEntry`: `weeks[wk].entries[day][exId]`; superset = `{a:{sets},b:{sets}}` come nei test esistenti.)

- [ ] **Step 2: Run, verificare FAIL**

Run: `node --test tests/session.test.js`
Expected: FAIL (funzioni non esportate)

- [ ] **Step 3: Implementare**

In `session.js`, dopo `volumeByMuscle` (~riga 376):

```js
// Contributi volume per-traccia CON NOME (per la heatmap anatomica: i gruppi
// secondari si risolvono per nome a valle, in body.js/heatByGroup). Come
// volumeByMuscle ma non aggregato; tracce a volume 0 escluse.
export function muscleContributions(data, weekKey, day, dayPlan) {
  const out = [];
  for (const ex of dayPlan?.exercises ?? []) {
    const v = getEntry(data, weekKey, day, ex.id);
    const name = String(ex?.name ?? "");
    if (ex?.superset) {
      const e = normalizeSupersetEntry(v);
      const [nameA, nameB] = name.includes(" + ") ? name.split(" + ") : [name, name];
      out.push({ muscle: ex.muscle, name: nameA, volume: trackVolume(e.a, volumeMeta(ex, "a")) });
      out.push({ muscle: ex.muscleB, name: nameB, volume: trackVolume(e.b, volumeMeta(ex, "b")) });
    } else {
      out.push({ muscle: ex?.muscle, name, volume: trackVolume(normalizeEntry(v), volumeMeta(ex, null)) });
    }
  }
  return out.filter((c) => c.volume > 0);
}
```

Dopo `sessionDates` (~riga 469):

```js
// Gruppo → data ISO dell'ultima sessione con almeno una serie done non-warmup
// per quel gruppo. Conta anche corpo libero/a tempo (volume 0): per la
// freschezza vale l'aver allenato, non i kg. Solo gruppi PRIMARI (i secondari
// pesano solo sulla vista settimana). Scansiona le settimane della scheda attiva.
export function lastTrainedByGroup(data) {
  const out = {};
  const plan = Array.isArray(data?.plan) ? data.plan : [];
  for (const s of sessionDates(data)) {
    const dp = plan.find((d) => d.day === s.day);
    if (!dp) continue;
    for (const ex of dp.exercises ?? []) {
      const v = getEntry(data, s.weekKey, s.day, ex.id);
      const tracks = ex?.superset
        ? [{ t: normalizeSupersetEntry(v).a, m: ex.muscle }, { t: normalizeSupersetEntry(v).b, m: ex.muscleB }]
        : [{ t: normalizeEntry(v), m: ex?.muscle }];
      for (const { t, m } of tracks) {
        if (!m) continue;
        if (!t.sets.some((st) => st.done && !st.warmup)) continue;
        if (!out[m] || s.date > out[m]) out[m] = s.date;
      }
    }
  }
  return out;
}
```

(`getEntry`, `trackVolume`, `volumeMeta`, `normalizeEntry`, `normalizeSupersetEntry`, `sessionDates` sono già definiti nel modulo.)

- [ ] **Step 4: Run test**

Run: `node --test tests/session.test.js`
Expected: tutti PASS (anche i preesistenti)

- [ ] **Step 5: Commit**

```bash
git add session.js tests/session.test.js
git commit -m "feat(session): muscleContributions e lastTrainedByGroup per la heatmap"
```

---

### Task 6: `catalog.js` — campi `secondary`/`img`, seed con secondari, backfill

**Files:**
- Modify: `catalog.js`
- Test: `tests/catalog.test.js`, `tests/store.merge.test.js`

- [ ] **Step 1: Test falliti**

Aggiungere in fondo a `tests/catalog.test.js` (estendere l'import con `backfillCatalogSecondaries`):

```js
// ---- secondary / img (heatmap anatomica) ----

test("addCatalogEntry: salva secondary validi e img; scarta gruppo primario e ignoti", () => {
  const out = addCatalogEntry(base(), { name: "Chest press", muscle: "Petto",
    secondary: ["Spalle", "Petto", "Tricipiti", "Spalle", "Marziani"], img: " https://x/y.png " });
  const e = out.catalog.find((x) => x.name === "Chest press");
  assert.deepEqual(e.secondary, ["Spalle", "Tricipiti"]); // dedup, no primario, no ignoti
  assert.equal(e.img, "https://x/y.png");
});

test("addCatalogEntry: default secondary [] e img \"\"", () => {
  const out = addCatalogEntry(base(), { name: "Croci", muscle: "Petto" });
  const e = out.catalog.find((x) => x.name === "Croci");
  assert.deepEqual(e.secondary, []);
  assert.equal(e.img, "");
});

test("renameCatalogEntry: aggiorna secondary/img e ripulisce il nuovo primario", () => {
  const blob = { ...base(), catalog: [{ id: "c1", name: "Panca", muscle: "Petto",
    note: "cue", secondary: ["Spalle", "Tricipiti"], img: "u" }] };
  const out = renameCatalogEntry(blob, "c1", { name: "Panca", muscle: "Tricipiti",
    secondary: ["Spalle", "Tricipiti"], img: "u2" });
  const e = out.catalog[0];
  assert.deepEqual(e.secondary, ["Spalle"]); // Tricipiti ora è il primario
  assert.equal(e.img, "u2");
  assert.equal(e.note, "cue");
});

test("renameCatalogEntry: senza secondary/img espliciti conserva gli esistenti", () => {
  const blob = { ...base(), catalog: [{ id: "c1", name: "Panca", muscle: "Petto",
    note: "", secondary: ["Spalle"], img: "u" }] };
  const out = renameCatalogEntry(blob, "c1", { name: "Panca larga", muscle: "Petto" });
  assert.deepEqual(out.catalog[0].secondary, ["Spalle"]);
  assert.equal(out.catalog[0].img, "u");
});

test("voci legacy senza secondary/img restano valide nelle letture", () => {
  // groupedCatalog e catalogUsage non devono rompersi su voci vecchie
  const blob = base(); // la voce di base() non ha secondary/img
  assert.ok(groupedCatalog(blob).length >= 1);
});

test("seedCatalog: voci con secondary sensati e img vuota", () => {
  const seed = seedCatalog();
  const panca = seed.find((e) => e.name === "Panca piana bilanciere");
  assert.deepEqual(panca.secondary, ["Spalle", "Tricipiti"]);
  assert.equal(panca.img, "");
  const curl = seed.find((e) => e.name === "Curl bilanciere");
  assert.deepEqual(curl.secondary, []);
  for (const e of seed) assert.ok(Array.isArray(e.secondary) && typeof e.img === "string");
});

test("backfillCatalogSecondaries: riempie SOLO le voci con secondary undefined", () => {
  const blob = { ...base(), catalog: [
    { id: "c1", name: "panca piana bilanciere", muscle: "Petto", note: "" },     // match seed (case-ins)
    { id: "c2", name: "Curl bilanciere", muscle: "Bicipiti", note: "", secondary: ["Spalle"] }, // scelta utente: intatta
    { id: "c3", name: "Esercizio mio", muscle: "Dorso", note: "" },              // non-seed → []
  ] };
  const out = backfillCatalogSecondaries(blob);
  assert.deepEqual(out.catalog[0].secondary, ["Spalle", "Tricipiti"]);
  assert.deepEqual(out.catalog[1].secondary, ["Spalle"]);
  assert.deepEqual(out.catalog[2].secondary, []);
});

test("backfillCatalogSecondaries: idempotente, stesso riferimento se nulla da fare", () => {
  const done = backfillCatalogSecondaries({ ...base(), catalog: [
    { id: "c1", name: "X", muscle: "Petto", note: "", secondary: [], img: "" }] });
  assert.equal(backfillCatalogSecondaries(done), done); // niente save inutile
});
```

Aggiungere in fondo a `tests/store.merge.test.js` (riusare gli helper/fixture del file):

```js
test("mergeBlobs: conserva secondary e img delle voci catalogo", () => {
  const L = { schema: 6, updatedAt: "2026-06-04T10:00:00Z", activeSheetId: "s1",
    sheets: [{ id: "s1", name: "A", plan: [], weeks: {} }],
    catalog: [{ id: "c1", name: "Panca", muscle: "Petto", note: "",
      secondary: ["Spalle"], img: "https://x/y.png" }] };
  const R = { schema: 6, updatedAt: "2026-06-03T10:00:00Z", activeSheetId: "s1",
    sheets: [{ id: "s1", name: "A", plan: [], weeks: {} }],
    catalog: [{ id: "c2", name: "Squat", muscle: "Gambe", note: "" }] };
  const out = mergeBlobs(L, R);
  const c1 = out.catalog.find((e) => e.id === "c1");
  assert.deepEqual(c1.secondary, ["Spalle"]);
  assert.equal(c1.img, "https://x/y.png");
  assert.ok(out.catalog.find((e) => e.id === "c2"));
});
```

- [ ] **Step 2: Run, verificare FAIL**

Run: `node --test tests/catalog.test.js tests/store.merge.test.js`
Expected: FAIL sui test nuovi (i mergeBlobs probabilmente già PASS: passthrough per structuredClone — bene, resta come lock)

- [ ] **Step 3: Implementare in `catalog.js`**

Sostituire `addCatalogEntry` e `renameCatalogEntry` e aggiungere gli helper:

```js
// Secondari validi: dedup, solo gruppi noti, mai il primario.
const cleanSecondary = (secondary, muscle) =>
  [...new Set((Array.isArray(secondary) ? secondary : [])
    .filter((g) => MUSCLE_GROUPS.includes(g) && g !== muscle))];

export function addCatalogEntry(blob, { name, muscle, note = "", secondary = [], img = "" }) {
  const n = String(name ?? "").trim();
  if (!n) return blob;
  if (catalogHasDup(blob, n, muscle)) return blob;
  const out = clone(blob);
  const id = genId(cat(out).map((e) => e.id));
  out.catalog = [...cat(out), { id, name: n, muscle, note: String(note ?? "").trim(),
    secondary: cleanSecondary(secondary, muscle), img: String(img ?? "").trim() }];
  return out;
}

export function renameCatalogEntry(blob, id, { name, muscle, secondary, img }) {
  const n = String(name ?? "").trim();
  if (!n) return blob;
  if (catalogHasDup(blob, n, muscle, id)) return blob;
  const out = clone(blob);
  out.catalog = cat(out).map((e) => {
    if (e.id !== id) return e;
    const next = { ...e, name: n, muscle };
    // secondary/img espliciti → aggiornati; impliciti → conservati ma ripuliti
    // (il nuovo primario non può restare tra i secondari).
    next.secondary = cleanSecondary(secondary !== undefined ? secondary : e.secondary, muscle);
    if (img !== undefined) next.img = String(img ?? "").trim();
    return next;
  });
  return out;
}
```

Modificare `seedCatalog` (riga 29-39) e aggiungere la tabella + backfill:

```js
// Secondari del seed (solo le voci dove ha senso; assente = []). Gli avambracci
// non hanno gruppo → i curl restano senza secondari.
const SEED_SECONDARY = {
  "Panca piana bilanciere": ["Spalle", "Tricipiti"],
  "Spinte inclinata manubri": ["Spalle", "Tricipiti"],
  "Croci ai cavi in piedi": ["Spalle"],
  "Dips": ["Tricipiti", "Spalle"],
  "Chest press": ["Spalle", "Tricipiti"],
  "Panca declinata": ["Tricipiti"],
  "Push-up": ["Spalle", "Tricipiti", "Core"],
  "Stacco da terra": ["Gambe", "Core"],
  "Stacco rumeno": ["Gambe"],
  "Rematore bilanciere": ["Bicipiti"],
  "Rematore manubrio": ["Bicipiti"],
  "Pulldown presa larga": ["Bicipiti"],
  "Lat machine presa stretta": ["Bicipiti"],
  "Pullover": ["Petto", "Tricipiti"],
  "Pulley basso": ["Bicipiti"],
  "Trazioni": ["Bicipiti"],
  "Rematore al cavo": ["Bicipiti"],
  "Hyperextension": ["Gambe"],
  "Lento avanti bilanciere": ["Tricipiti"],
  "Lento avanti manubri": ["Tricipiti"],
  "Alzate posteriori": ["Dorso"],
  "Face pull": ["Dorso"],
  "Arnold press": ["Tricipiti"],
  "Tirate al mento": ["Dorso"],
  "Scrollate": ["Dorso"],
  "Dips alle parallele": ["Petto", "Spalle"],
  "Squat bilanciere": ["Core"],
  "Affondi manubri": ["Core"],
  "Bulgarian split squat": ["Core"],
  "Goblet squat": ["Core"],
  "Stacco sumo": ["Dorso"],
  "Plank": ["Spalle"],
  "Ab wheel": ["Dorso", "Spalle"],
  "Mountain climber": ["Spalle"],
};

export function seedCatalog() {
  const out = [];
  let i = 0;
  for (const [muscle, names] of Object.entries(SEED_BY_GROUP)) {
    for (const name of names) {
      out.push({ id: `seed-${i}`, name, muscle, note: "",
        secondary: SEED_SECONDARY[name] ?? [], img: "" });
      i += 1;
    }
  }
  return out;
}

// Backfill one-shot per i cataloghi esistenti (seminati PRIMA dei secondari):
// riempie `secondary` SOLO dove è undefined (mai sopra una scelta utente),
// usando la tabella del seed per nome (case-insensitive); non-seed → [].
// Stesso riferimento se nulla da fare → niente save inutile (pattern seed).
export function backfillCatalogSecondaries(blob) {
  const list = cat(blob);
  if (!list.length || list.every((e) => e.secondary !== undefined)) return blob;
  const byName = new Map(Object.entries(SEED_SECONDARY).map(([k, v]) => [norm(k), v]));
  const out = clone(blob);
  out.catalog = cat(out).map((e) => e.secondary !== undefined ? e :
    { ...e, secondary: cleanSecondary(byName.get(norm(e.name)) ?? [], e.muscle) });
  return out;
}
```

- [ ] **Step 4: Run test**

Run: `node --test tests/catalog.test.js tests/store.merge.test.js`
Expected: tutti PASS. Se test preesistenti asseriscono la forma esatta delle voci seed (`{id,name,muscle,note}`), aggiornarli aggiungendo `secondary`/`img` attesi.

- [ ] **Step 5: Suite completa**

Run: `node --test`
Expected: tutti PASS (le voci nuove non rompono sheets/store: `hydrate`/`dehydrate`/`mergeBlobs` clonano il catalogo per intero)

- [ ] **Step 6: Commit**

```bash
git add catalog.js tests/catalog.test.js tests/store.merge.test.js
git commit -m "feat(catalog): secondary e img per voce, seed con secondari, backfill one-shot"
```

---

### Task 7: `media-map.js` — illustrazioni wger

**Files:**
- Create: `media-map.js`
- Test: `tests/media-map.test.js`

- [ ] **Step 1: Test falliti**

Creare `tests/media-map.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { mediaFor } from "../media-map.js";

test("mediaFor: voce mappata → due frame wger", () => {
  const m = mediaFor({ name: "Panca piana bilanciere", img: "" });
  assert.equal(m.img1, "https://wger.de/media/exercise-images/192/Bench-press-1.png");
  assert.equal(m.img2, "https://wger.de/media/exercise-images/192/Bench-press-2.png");
});

test("mediaFor: match case-insensitive con spazi", () => {
  assert.ok(mediaFor({ name: "  CRUNCH a terra " }));
});

test("mediaFor: override img vince sulla mappa (frame singolo)", () => {
  const m = mediaFor({ name: "Panca piana bilanciere", img: "https://x/y.png" });
  assert.deepEqual(m, { img1: "https://x/y.png" });
});

test("mediaFor: voce non mappata → null (fallback: solo figura)", () => {
  assert.equal(mediaFor({ name: "Esercizio inventato", img: "" }), null);
  assert.equal(mediaFor(null), null);
});
```

- [ ] **Step 2: Run, verificare FAIL**

Run: `node --test tests/media-map.test.js`
Expected: FAIL (modulo assente)

- [ ] **Step 3: Implementare**

Creare `media-map.js`:

```js
// media-map.js
// ---- Illustrazioni esercizi (puro, testabile in Node). Fonte: wger.de /
//      Everkinetic (licenza libera), hotlink — nessuna cache offline.
//      SOLO voci VERIFICATE (HEAD 200 su entrambi i frame): le altre cadono
//      sul fallback "solo figura" (pannello media non mostrato). La mappa
//      cresce nel tempo; per i casi singoli c'è l'override `img` per-voce. ----
const WGER = "https://wger.de/media/exercise-images";
const norm = (s) => String(s ?? "").trim().toLowerCase();

// nome seed (normalizzato) → "<id>/<NomeFile>" wger
const MAP = {
  "panca piana bilanciere": "192/Bench-press",
  "crunch a terra": "91/Crunches",
};

// { img1, img2 } per le voci mappate, { img1 } con il solo override utente,
// null se non c'è nulla (il chiamante non mostra il pannello media).
export function mediaFor(entry) {
  const ov = String(entry?.img ?? "").trim();
  if (ov) return { img1: ov };
  const base = MAP[norm(entry?.name)];
  return base ? { img1: `${WGER}/${base}-1.png`, img2: `${WGER}/${base}-2.png` } : null;
}
```

- [ ] **Step 4: Run test**

Run: `node --test tests/media-map.test.js`
Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add media-map.js tests/media-map.test.js
git commit -m "feat(media): media-map wger con override img e fallback"
```

---

### Task 8: `style.css` — `.crt-panel` e satelliti

**Files:**
- Modify: `style.css` (append in fondo, sezione commentata)

- [ ] **Step 1: Aggiungere gli stili**

Append in fondo a `style.css`:

```css
/* ==== Scan / heatmap anatomica ==================================== */
/* Pannello CRT blueprint: palette FISSA fuori dai temi (un "monitor
   incassato" — scuro anche su tema Carta). Griglia doppia in ::before,
   scanline in ::after; parentesi angolari e targhetta sono markup
   (CRT_CORNERS / .crt-tag in app.js). REGOLA: la targhetta ha la sua
   fascia riservata (padding-bottom 24px) — il contenuto non la tocca mai. */
.crt-panel{position:relative;overflow:hidden;background:#0c0e11;
  border:1px solid #2e343a;border-radius:11px;padding:12px 8px 24px;}
.crt-panel.big{padding:16px 8px 24px;}
.crt-panel::before{content:"";position:absolute;inset:0;pointer-events:none;
  background-image:linear-gradient(rgba(240,167,60,.05) 1px,transparent 1px),
    linear-gradient(90deg,rgba(240,167,60,.05) 1px,transparent 1px),
    linear-gradient(rgba(240,167,60,.12) 1px,transparent 1px),
    linear-gradient(90deg,rgba(240,167,60,.12) 1px,transparent 1px);
  background-size:14px 14px,14px 14px,70px 70px,70px 70px;}
.crt-panel::after{content:"";position:absolute;inset:0;pointer-events:none;
  background:repeating-linear-gradient(0deg,rgba(255,255,255,.045) 0 1px,transparent 1px 3px);}
.crt-tag{position:absolute;bottom:5px;right:22px;font-size:8px;
  letter-spacing:.16em;color:#f0a73c;opacity:.75;z-index:1;}
.crt-c{position:absolute;width:12px;height:12px;border:0 solid #f0a73c;opacity:.7;z-index:1;}
.crt-c.tl{top:5px;left:5px;border-width:2px 0 0 2px;}
.crt-c.tr{top:5px;right:5px;border-width:2px 2px 0 0;}
.crt-c.bl{bottom:5px;left:5px;border-width:0 0 2px 2px;}
.crt-c.br{bottom:5px;right:5px;border-width:0 2px 2px 0;}
/* Righello con coordinate: SOLO sui pannelli grandi (schermata Scan). */
.crt-ruler-x{position:absolute;top:1px;left:22px;right:8px;display:flex;
  justify-content:space-between;font-size:6.5px;color:#f0a73c;opacity:.5;z-index:1;}
.crt-ruler-y{position:absolute;top:12px;bottom:28px;left:3px;display:flex;
  flex-direction:column;justify-content:space-between;font-size:6.5px;
  color:#f0a73c;opacity:.5;z-index:1;}

/* Figura fronte+retro (stringa SVG da renderBody) */
.bd-pair{display:flex;gap:8px;justify-content:center;align-items:flex-start;position:relative;}
/* Legenda sotto la figura: palette fissa come il pannello */
.bd-leg{display:flex;justify-content:center;gap:12px;align-items:center;flex-wrap:wrap;
  row-gap:4px;font-size:9px;color:#9aa3ad;margin-top:9px;position:relative;white-space:nowrap;}
.bd-leg .sw{display:inline-block;width:10px;height:10px;border-radius:2.5px;vertical-align:-1px;}
.bd-leg .warn{color:#e0705a;}

/* Illustrazioni wger in resa "fosforo" sul pannello blueprint */
.bd-frames{display:flex;position:relative;}
.bd-frames img{flex:1;width:50%;display:block;
  filter:invert(1) grayscale(1) sepia(1) saturate(3) hue-rotate(-14deg)
    brightness(.95) contrast(1.2) drop-shadow(0 0 5px rgba(240,167,60,.55));
  mix-blend-mode:screen;}
.bd-frames img:only-child{width:70%;flex:none;margin:0 auto;}

/* Tabs della schermata Scan (stile plan-tabs ma 2 voci fisse) */
.scan-tabs{display:flex;gap:8px;margin-bottom:12px;}
.scan-tabs button{flex:1;padding:9px 8px;background:var(--surf2);color:var(--ink);
  border:1px solid var(--line);border-radius:10px;font:inherit;font-size:12px;
  font-weight:700;letter-spacing:.08em;cursor:pointer;}
.scan-tabs button.on{border-color:var(--acc);color:var(--acc);}
.scan-cap{font-size:10.5px;color:var(--dim,#7a828c);text-align:center;margin-top:10px;}

/* Pannello copertura giorno nell'editor scheda */
.pe-scan{margin:10px 0 4px;}

/* Chips multi-select dei secondari nel form catalogo */
.db-chips{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 8px;}
.db-chips .chip{padding:5px 10px;border:1px solid var(--line);border-radius:999px;
  background:var(--surf2);color:var(--ink);font:inherit;font-size:11.5px;cursor:pointer;}
.db-chips .chip.on{border-color:var(--acc);color:var(--acc);font-weight:700;}
.db-chips .chip.dis{opacity:.35;pointer-events:none;}

/* 5ª voce del drawer (Impostazioni) a tutta larghezza */
#drawerPanel .dr-item:nth-child(5){grid-column:1 / -1;}
```

- [ ] **Step 2: Verifica sintassi**

Run: `node --test`
Expected: tutti PASS (il CSS non è testato; la suite conferma di non aver rotto nulla)

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "feat(ui): stile .crt-panel blueprint, figura, chips e drawer a 5 voci"
```

---

### Task 9: Schermata Scan — overlay, drawer, popstate

**Files:**
- Modify: `index.html` (drawer ~righe 404-417; nuovo overlay dopo `dbOverlay`, ~riga 313)
- Modify: `app.js` (import ~righe 1-30; nuova sezione Scan dopo il blocco catalogo ~riga 694; drawer map ~riga 3075; popstate ~righe 3192-3221; wiring boot ~riga 3167)

- [ ] **Step 1: Markup overlay in `index.html`**

Dopo la chiusura di `#dbOverlay` (riga ~313, dopo `</div>` del blocco "Database esercizi"):

```html
  <!-- Scan: figura anatomica heatmap (overlay a schermo intero, stessa cornice) -->
  <div id="scanOverlay" class="focus-ov hidden" aria-hidden="true">
    <header class="focus-top">
      <button id="scanBack" class="focus-back" aria-label="Chiudi scan">←</button>
      <div class="focus-id">
        <div class="fn">Scan</div>
        <div id="scanSub" class="fs">—</div>
      </div>
    </header>
    <div class="sheets-body">
      <div class="scan-tabs" id="scanTabs">
        <button type="button" data-tab="week" class="on">SETTIMANA</button>
        <button type="button" data-tab="fresh">FRESCHEZZA</button>
      </div>
      <div id="scanBody"></div>
    </div>
  </div>
```

- [ ] **Step 2: Drawer a 5 voci in `index.html`**

Nel `#drawerPanel` (righe 411-416), inserire la voce Scan come TERZA (dopo catalog, prima di calendar) e aggiornare gli emoji hint della maniglia (riga 409):

```html
      <span class="dh-hint"><span>📒</span><span>🗂️</span><span>🩻</span><span>📅</span><span>⚙</span></span>
```

```html
    <div id="drawerPanel" class="drawer-panel" role="menu">
      <button class="dr-item" data-act="sheets" role="menuitem"><span class="e">📒</span><span class="t">Schede</span></button>
      <button class="dr-item" data-act="catalog" role="menuitem"><span class="e">🗂️</span><span class="t">Database esercizi</span></button>
      <button class="dr-item" data-act="scan" role="menuitem"><span class="e">🩻</span><span class="t">Scan</span></button>
      <button class="dr-item" data-act="calendar" role="menuitem"><span class="e">📅</span><span class="t">Calendario</span></button>
      <button class="dr-item" data-act="settings" role="menuitem"><span class="e">⚙</span><span class="t">Impostazioni</span></button>
    </div>
```

(L'ordine: Schede, Database, Scan, Calendario, Impostazioni; la 5ª va a tutta larghezza via CSS del Task 8.)

- [ ] **Step 3: Logica Scan in `app.js`**

Estendere gli import in testa al file:

```js
import { renderBody, heatByGroup, freshnessByGroup, dayCoverage } from "./body.js";
import { mediaFor } from "./media-map.js";
```

e aggiungere `muscleContributions, lastTrainedByGroup` all'import da `./session.js`.

Dopo il blocco catalogo (dopo `openCatalogDelete`, ~riga 694), aggiungere:

```js
// ---- Scan: figura anatomica heatmap (overlay, stessa logica history). ----
let scanOpen = false;
let scanTab = "week"; // "week" | "fresh"

// Parentesi HUD angolari e righello: markup ripetuto dei pannelli CRT.
const CRT_CORNERS = '<i class="crt-c tl"></i><i class="crt-c tr"></i><i class="crt-c bl"></i><i class="crt-c br"></i>';
const CRT_RULER =
  `<div class="crt-ruler-x">${[0, 10, 20, 30, 40, 50, 60].map((n) => `<span>${n}</span>`).join("")}</div>` +
  `<div class="crt-ruler-y">${[0, 10, 20, 30].map((n) => `<span>${n}</span>`).join("")}</div>`;

function openScan() {
  scanOpen = true;
  history.pushState({ gymScan: true }, "");
  renderScan();
}
function closeScan() {
  if (!scanOpen) return;
  if (history.state && history.state.gymScan) history.back(); // → popstate chiude
  else { scanOpen = false; renderScan(); }
}

// Legenda della vista settimana: scala poco→tanto + spento (palette fissa).
function scanLegendWeek() {
  const sw = (o) => `<span class="sw" style="background:#f0a73c;opacity:${o}"></span>`;
  return `<div class="bd-leg">poco ${[0.3, 0.55, 0.8, 1].map(sw).join("")} tanto` +
    `<span><span class="sw" style="background:#1c2127;border:1px solid #2c343c"></span> non allenato</span></div>`;
}

function renderScan() {
  const ov = document.getElementById("scanOverlay");
  if (!scanOpen) {
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");
    if (openIndex === null && !nutritionOpen && !planOpen) document.body.style.overflow = "";
    return;
  }
  for (const b of document.querySelectorAll("#scanTabs button")) {
    b.classList.toggle("on", b.dataset.tab === scanTab);
  }
  const body = document.getElementById("scanBody");
  const plan = Array.isArray(data.plan) ? data.plan : [];
  const catalog = dehydrate(data).catalog ?? [];
  if (scanTab === "week") {
    // Heat dai volumi della settimana corrente (quella selezionata in home).
    const contribs = plan.flatMap((d) => muscleContributions(data, currentWeek, d.day, d));
    const { zones } = heatByGroup(contribs, catalog);
    const wTag = currentWeek.split("-")[1] || currentWeek; // "2026-W23" → "W23"
    document.getElementById("scanSub").textContent = `◈ SCAN · settimana ${wTag}`;
    body.innerHTML =
      `<div class="crt-panel big">${CRT_RULER}${renderBody({ zones, w: 108 })}` +
      `${scanLegendWeek()}${CRT_CORNERS}<span class="crt-tag">SCAN·${wTag}</span></div>` +
      (contribs.length ? "" : `<div class="scan-cap">nessuna serie loggata questa settimana</div>`);
  } else {
    const todayIso = new Date().toISOString().slice(0, 10);
    const { zones, never, warnGroups, neverGroups } = freshnessByGroup(lastTrainedByGroup(data), todayIso);
    document.getElementById("scanSub").textContent = "◈ SCAN · freschezza";
    const warnTxt = warnGroups.length
      ? `<div class="bd-leg"><span class="warn">⚠ fermi da ≥6 giorni: ${warnGroups.map((g) => g.toLowerCase()).join(" · ")}</span></div>` : "";
    const neverTxt = neverGroups.length
      ? `<div class="bd-leg"><span class="warn"><span class="sw" style="border:1px dashed #e0705a"></span> mai allenato: ${neverGroups.map((g) => g.toLowerCase()).join(" · ")}</span></div>` : "";
    body.innerHTML =
      `<div class="crt-panel big">${CRT_RULER}${renderBody({ zones, cold: never, w: 108 })}` +
      `${warnTxt}${neverTxt}${CRT_CORNERS}<span class="crt-tag">SCAN·FRESH</span></div>` +
      `<div class="scan-cap">acceso = allenato da poco · spento = sta recuperando</div>`;
  }
  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}
```

- [ ] **Step 4: Wiring (drawer, popstate, back, tabs)**

In `app.js`:

1. Drawer map (riga ~3075): aggiungere `scan: openScan`:
```js
    const map = { nutrition: openNutrition, calendar: openCalendar, sheets: openSheets, catalog: openCatalog, settings: openSettings, scan: openScan };
```
2. Popstate, ramo dialog-ripristino (righe ~3201-3205): aggiungere il caso Scan:
```js
      else if (scanOpen) history.pushState({ gymScan: true }, "");
```
(subito dopo il caso `catalogOpen`).
3. Popstate, chiusure in coda (righe ~3215-3220): aggiungere:
```js
    if (scanOpen) { scanOpen = false; renderScan(); }
```
4. Boot wiring (vicino a `dbBack`, riga ~3167):
```js
  document.getElementById("scanBack").addEventListener("click", closeScan);
  document.getElementById("scanTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    scanTab = b.dataset.tab; renderScan();
  });
```

- [ ] **Step 5: Verifica manuale + suite**

Run: `node --test`
Expected: tutti PASS

Verifica manuale (server statico, es. `npx serve .` o `python -m http.server`): aprire l'app, menu → Scan: la voce è 3ª, Impostazioni a tutta larghezza; tab SETTIMANA mostra la figura col heat della settimana corrente, FRESCHEZZA le fasce; il pannello è scuro anche su tema Carta; il back del telefono chiude SOLO l'overlay; targhetta mai sovrapposta alla legenda.

- [ ] **Step 6: Commit**

```bash
git add index.html app.js
git commit -m "feat(ui): schermata Scan con tab settimana/freschezza e drawer a 5 voci"
```

---

### Task 10: Database esercizi — pannelli figura+media e form esteso

**Files:**
- Modify: `app.js` (`dbDetHTML` ~riga 538; `wireDetail` ~riga 622; `openCatalogForm` ~riga 635; boot ~riga 3267)

- [ ] **Step 1: Pannelli nel dettaglio voce (`dbDetHTML`)**

In `dbDetHTML`, dopo il blocco "andamento" e PRIMA del blocco "nota" (riga ~555), inserire:

```js
  h += `<div style="margin-top:9px"><span class="sec">muscoli</span></div>`;
  const zones = {};
  for (const z of GROUP_ZONES[entry.muscle] ?? []) zones[z] = 1;
  const secZones = new Set((entry.secondary ?? []).flatMap((g) => GROUP_ZONES[g] ?? []));
  const secTxt = (entry.secondary ?? []).length
    ? ` <span style="color:#7FC8FF">◐ ${(entry.secondary ?? []).map((g) => g.toLowerCase()).join(" · ")}</span>` : "";
  h += `<div class="crt-panel">${renderBody({ zones, secondaries: secZones, w: 88 })}` +
    `<div class="bd-leg"><span style="color:#f0a73c">● ${dbEsc(entry.muscle.toLowerCase())}</span>${secTxt}</div>` +
    `${CRT_CORNERS}<span class="crt-tag">TGT·${dbEsc(String(entry.id).replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 8))}</span></div>`;
  const media = mediaFor(entry);
  if (media) {
    h += `<div class="crt-panel bd-media" style="margin-top:9px">` +
      `<div class="bd-frames"><img src="${dbEsc(media.img1)}" alt="">` +
      (media.img2 ? `<img src="${dbEsc(media.img2)}" alt="">` : "") + `</div>` +
      `${CRT_CORNERS}<span class="crt-tag">MOV·0↔1</span></div>`;
  }
```

Estendere l'import da `./body.js` con `GROUP_ZONES` (già aggiunto `renderBody` nel Task 9).

- [ ] **Step 2: Fallback `onerror` in `wireDetail`**

In `wireDetail` (riga ~622), aggiungere prima della riga `k.querySelector(".edit")…`:

```js
  // Hotlink wger: offline o immagine sparita → si nasconde l'intero pannello
  // media e resta il fallback "solo figura" (nessun pannello rotto).
  k.querySelectorAll(".bd-media img").forEach((img) => {
    img.onerror = () => { const p = img.closest(".bd-media"); if (p) p.style.display = "none"; };
  });
```

- [ ] **Step 3: Form con chips secondari + campo img (`openCatalogForm`)**

In `openCatalogForm`, dopo le righe `const name0/grp0` (~riga 641) aggiungere:

```js
  const sec0 = isEdit ? (entry.secondary ?? []) : [];
  const img0 = isEdit ? (entry.img ?? "") : "";
```

Nel template di `mbody.innerHTML`, dopo il `</select>` del gruppo (riga ~649), inserire:

```js
    `<label class="editlabel">muscoli secondari</label>` +
    `<div class="db-chips" id="dbFSec">` +
    MUSCLE_GROUPS.map((m) =>
      `<button type="button" class="chip${sec0.includes(m) ? " on" : ""}${m === grp0 ? " dis" : ""}" data-g="${m}">${m.toLowerCase()}</button>`).join("") +
    `</div>` +
    `<label class="editlabel">immagine (URL, opzionale)</label>` +
    `<input id="dbFImg" value="${dbEsc(img0)}" placeholder="https://… (vuota = automatica)" autocomplete="off">` +
```

Dopo `nm.oninput = check; grp.onchange = check; check();` (riga ~664) aggiungere:

```js
  const secBox = document.getElementById("dbFSec");
  secBox.addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c || c.classList.contains("dis")) return;
    c.classList.toggle("on");
  });
  // Cambiando il primario: il suo chip si disabilita (e si spegne se era acceso).
  grp.addEventListener("change", () => {
    for (const c of secBox.querySelectorAll(".chip")) {
      const isPrimary = c.dataset.g === grp.value;
      c.classList.toggle("dis", isPrimary);
      if (isPrimary) c.classList.remove("on");
    }
  });
```

Nell'`ok.onclick` (riga ~666), sostituire le due chiamate di mutazione con:

```js
    const secondary = [...document.querySelectorAll("#dbFSec .chip.on")].map((b) => b.dataset.g);
    const img = document.getElementById("dbFImg").value.trim();
    if (isEdit) mutateCatalog((b) => renameCatalogEntry(b, entry.id, { name, muscle, secondary, img }));
    else mutateCatalog((b) => addCatalogEntry(b, { name, muscle, secondary, img }));
```

- [ ] **Step 4: Backfill one-shot al boot**

In `boot()`, dopo `_maybe = migrateExerciseName(_maybe, "Croci ai cavi", "Croci ai cavi in piedi");` (riga ~3270), aggiungere:

```js
    // Backfill one-shot dei secondari sui cataloghi seminati prima della heatmap
    // (solo voci con secondary undefined; idempotente, stesso ref se nulla da fare).
    _maybe = backfillCatalogSecondaries(_maybe);
```

ed estendere l'import da `./catalog.js` con `backfillCatalogSecondaries`.

- [ ] **Step 5: Verifica manuale + suite**

Run: `node --test`
Expected: tutti PASS

Verifica manuale: aprire Database esercizi → "Panca piana bilanciere": pannello figura (petto pieno ambra, spalle/tricipiti blu dopo il backfill) + pannello MOV con i due frame in fosforo; una voce non mappata (es. "Pectoral machine") NON mostra il pannello media; form: chips funzionanti, il primario è disabilitato, salvataggio persiste.

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat(ui): pannelli figura+media nel DB esercizi, form con secondari e img"
```

---

### Task 11: Editor scheda — pannello copertura giorno

**Files:**
- Modify: `app.js` (`renderPlanEditor`, dopo il blocco `bar`, ~riga 183)

- [ ] **Step 1: Inserire il pannello**

In `renderPlanEditor`, subito dopo `body.appendChild(bar);` (riga ~183), aggiungere:

```js
    // Pannello copertura muscolare del giorno: cosa copre questo giorno della
    // scheda (presenze, non volumi). Zone non coperte spente normali, mai rosse.
    const cov = dayCoverage(dp, dehydrate(data).catalog ?? []);
    if (Object.keys(cov.zones).length) {
      const pan = document.createElement("div");
      pan.className = "crt-panel pe-scan";
      pan.innerHTML = renderBody({ zones: cov.zones, w: 78 }) + CRT_CORNERS +
        `<span class="crt-tag">DAY·${dbEsc(String(dp.day))}</span>`;
      body.appendChild(pan);
    }
```

- [ ] **Step 2: Verifica manuale + suite**

Run: `node --test`
Expected: tutti PASS

Verifica manuale: aprire Modifica scheda: sotto la barra del giorno compare la figura con i gruppi coperti; un giorno senza esercizi (o senza gruppi assegnati) NON mostra il pannello; il pannello segue il giorno cambiando tab.

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat(ui): pannello copertura muscolare del giorno nell'editor scheda"
```

---

### Task 12: Service worker, suite completa e verifica finale

**Files:**
- Modify: `sw.js` (righe 5-29)

- [ ] **Step 1: Cache SW**

In `sw.js`: bump `const CACHE = "gymsched-v63";` → `"gymsched-v64"` e aggiungere ad `ASSETS` (dopo `"./catalog.js"`):

```js
  "./body.js",
  "./body-data.js",
  "./media-map.js",
```

- [ ] **Step 2: Suite completa**

Run: `node --test`
Expected: TUTTI i test PASS (i 341 preesistenti + i nuovi)

- [ ] **Step 3: Verifica integrale da browser**

Checklist manuale (server statico locale):
1. Menu: 5 voci, Scan 3ª, Impostazioni a tutta larghezza, hint maniglia con 🩻.
2. Scan SETTIMANA: heat coerente coi volumi della settimana corrente; legenda poco→tanto; targhetta `SCAN·W…` mai sovrapposta.
3. Scan FRESCHEZZA: fasce corrette; gruppi mai allenati tratteggiati in rosso; ⚠ in legenda per i fermi da ≥6 giorni.
4. Tema Carta: i pannelli CRT restano scuri (monitor incassato).
5. DB esercizi: figura + media (Panca piana, Crunch a terra), fallback senza pannello per gli altri; form chips+img.
6. Editor scheda: pannello DAY per giorno con esercizi.
7. Back del telefono: chiude un overlay alla volta (Scan incluso), i dialog prima degli overlay.
8. Offline (DevTools): l'app parte; il pannello media sparisce (onerror), il resto funziona.

- [ ] **Step 4: Commit**

```bash
git add sw.js
git commit -m "chore(sw): bump cache v64 con body.js, body-data.js e media-map.js"
```

---

## Note di esecuzione

- **NON committare** gli screenshot `verifica-*.png` nella root (untracked, vanno lasciati lì o cancellati).
- `mockups/` e `.superpowers/` sono gitignorate: niente `git add` lì dentro (il mockup di riferimento è già versionato come `mockups/scan-anatomia-rev1.html`).
- Al termine: merge su `main` SOLO dopo che `feat/a11y-accordion` è stato risolto (chiedere all'utente l'ordine di integrazione), poi push → rollout GitHub Pages.
- Popolare `MAP` di `media-map.js` con altri esercizi è lavoro di contenuto post-feature: verificare ogni id con `Invoke-WebRequest -Method Head https://wger.de/media/exercise-images/<id>/<Nome>-1.png` prima di aggiungerlo.
