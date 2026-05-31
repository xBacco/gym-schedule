# V2 · Piano 1 — Onboarding & crea-scheda-da-zero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere a qualunque utente nuovo di partire da una scheda vuota e
crearne una propria da zero (giorni dinamici), rimuovendo la scheda hardcoded del
proprietario dal percorso dei nuovi utenti.

**Architecture:** La logica delle mutazioni di scheda vive in `editor.js` come
funzioni pure (già il pattern del repo), testate con `node --test`. Il boot di un
utente nuovo parte da `emptyData()` con `schema` corrente così le migrazioni sono
no-op e non serve più il seed `PLAN`. L'UI (empty-state + tab giorni dinamici) sta
in `app.js`/`index.html` ed è verificata manualmente su mobile.

**Tech Stack:** Vanilla JS (ESM), `node --test` + `node:assert/strict`, PWA con
service worker. Nessuna dipendenza nuova.

---

## File map

- `store.js` — `emptyData()` arricchita (`plan: []`, `schema` corrente); nuovo
  predicato `planIsEmpty(data)`.
- `editor.js` — nuove mutazioni pure: `nextDayCode`, `addDay`, `renameDay`,
  `removeDay`.
- `app.js` — empty-state (mostra/wire `› crea scheda`), editor con tab giorni
  dinamici (aggiungi/rinomina/elimina), rimozione di `offerSeedIfEmpty`/`SEED_URL`/
  handler `btnImportDemo` e della dipendenza da `PLAN` nel boot.
- `index.html` — markup empty-state + controlli giorni nell'editor; rimozione del
  markup `seedDialog`/`btnImportDemo`.
- `tests/store.test.js`, `tests/editor.test.js` — nuovi test.
- `sw.js` — bump versione cache.

**Costante schema corrente:** lo schema più alto applicato dalle migrazioni è **5**
(`patchPlanV5`). Tutti i riferimenti sotto a "schema corrente" = `5`.

---

### Task 0: Preservare la V1

**Files:** nessuno (operazioni git).

- [ ] **Step 1: Assicurarsi che il working tree sia pulito e aggiornato**

Run (PowerShell, dalla root del progetto `C:\Users\TomasCoro\gym-schedule`):
```
git fetch; git pull --rebase; git status
```
Expected: "nothing to commit, working tree clean".

- [ ] **Step 2: Creare tag e branch di preservazione V1**

Run:
```
git tag v1-classic
git branch v1
git push origin v1-classic
git push origin v1
```
Expected: tag e branch creati e pushati. La V2 prosegue su `main`.

---

### Task 1: `emptyData()` parte già migrata (niente seed `PLAN`)

**Files:**
- Modify: `store.js` (funzione `emptyData`, ~riga 26)
- Test: `tests/store.test.js`

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungere in `tests/store.test.js`:
```js
import { emptyData, planIsEmpty } from "../store.js";

test("emptyData: parte con plan vuoto e schema corrente (5)", () => {
  const d = emptyData();
  assert.deepEqual(d.weeks, {});
  assert.deepEqual(d.plan, []);
  assert.equal(d.schema, 5);
});
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `node --test tests/store.test.js`
Expected: FAIL (`d.plan` è `undefined`, `d.schema` è `undefined`; inoltre
`planIsEmpty` non è ancora esportata → ReferenceError import).

- [ ] **Step 3: Implementazione minima**

In `store.js` sostituire `emptyData`:
```js
export function emptyData() {
  return { updatedAt: null, weeks: {}, plan: [], schema: 5 };
}
```

- [ ] **Step 4: Eseguire il test del modulo**

Run: `node --test tests/store.test.js`
Expected: il test `emptyData` PASSA (il test su `planIsEmpty` resta rosso finché
Task 5 non esporta la funzione; va bene proseguire — oppure spostare l'import di
`planIsEmpty` al Task 5). Per ora rimuovere temporaneamente l'uso di `planIsEmpty`
dall'import se blocca l'esecuzione.

- [ ] **Step 5: Verificare l'intera suite (regressioni su emptyData)**

Run: `npm test`
Expected: nessuna regressione. Se un test asseriva la forma esatta di `emptyData()`
(es. `deepEqual` con `{updatedAt,weeks}`), aggiornarlo per includere `plan` e
`schema`. Mostrare l'eventuale diff e correggere.

- [ ] **Step 6: Commit**

```
git add store.js tests/store.test.js
git commit -m "feat(store): emptyData parte gia migrata (plan vuoto, schema 5)"
```

---

### Task 2: `nextDayCode` + `addDay` (giorni dinamici)

**Files:**
- Modify: `editor.js`
- Test: `tests/editor.test.js`

- [ ] **Step 1: Scrivere i test che falliscono**

Aggiungere in `tests/editor.test.js`:
```js
import { addDay, nextDayCode } from "../editor.js";

test("nextDayCode: prima lettera maiuscola libera", () => {
  assert.equal(nextDayCode([]), "A");
  assert.equal(nextDayCode([{ day: "A", title: "x", exercises: [] }]), "B");
  assert.equal(
    nextDayCode([{ day: "A", exercises: [] }, { day: "C", exercises: [] }]),
    "B"
  );
});

test("addDay: aggiunge un giorno vuoto con code univoco e titolo dato", () => {
  const plan = [{ day: "A", title: "Petto", exercises: [] }];
  const out = addDay(plan, "Schiena");
  assert.equal(out.length, 2);
  assert.equal(out[1].day, "B");
  assert.equal(out[1].title, "Schiena");
  assert.deepEqual(out[1].exercises, []);
  // purezza: input invariato
  assert.equal(plan.length, 1);
});

test("addDay: titolo vuoto -> fallback al code del giorno", () => {
  const out = addDay([], "");
  assert.equal(out[0].day, "A");
  assert.equal(out[0].title, "A");
});
```

- [ ] **Step 2: Eseguire e verificare il fallimento**

Run: `node --test tests/editor.test.js`
Expected: FAIL (`addDay`/`nextDayCode` non esportate).

- [ ] **Step 3: Implementazione minima**

In `editor.js` aggiungere:
```js
// Primo code di giorno libero: A..Z, poi id base36 univoco. I `day` sono opachi e
// stabili (le entries delle settimane sono keyate per `day`): rinominare cambia
// solo il titolo, non il code.
export function nextDayCode(plan) {
  const used = new Set(plan.map((d) => d.day));
  for (let i = 0; i < 26; i++) {
    const c = String.fromCharCode(65 + i);
    if (!used.has(c)) return c;
  }
  return genId([...used]);
}

export function addDay(plan, title) {
  const day = nextDayCode(plan);
  const t = (title || "").trim() || day;
  return [...plan, { day, title: t, exercises: [] }];
}
```

- [ ] **Step 4: Eseguire e verificare il successo**

Run: `node --test tests/editor.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add editor.js tests/editor.test.js
git commit -m "feat(editor): addDay + nextDayCode per giorni dinamici"
```

---

### Task 3: `renameDay`

**Files:**
- Modify: `editor.js`
- Test: `tests/editor.test.js`

- [ ] **Step 1: Test che fallisce**

```js
import { renameDay } from "../editor.js";

test("renameDay: cambia solo il titolo, non il code ne le entries", () => {
  const plan = [{ day: "A", title: "Petto", exercises: [{ id: "x1", name: "Panca" }] }];
  const out = renameDay(plan, "A", "Petto/Tricipiti");
  assert.equal(out[0].day, "A");
  assert.equal(out[0].title, "Petto/Tricipiti");
  assert.equal(out[0].exercises[0].id, "x1");
  assert.equal(plan[0].title, "Petto"); // purezza
});

test("renameDay: titolo vuoto -> resta il code come titolo", () => {
  const out = renameDay([{ day: "A", title: "Petto", exercises: [] }], "A", "  ");
  assert.equal(out[0].title, "A");
});
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test tests/editor.test.js`
Expected: FAIL (`renameDay` non esportata).

- [ ] **Step 3: Implementazione**

In `editor.js`:
```js
export function renameDay(plan, day, title) {
  return plan.map((d) =>
    d.day === day ? { ...d, title: (title || "").trim() || d.day } : d
  );
}
```

- [ ] **Step 4: Verificare il successo**

Run: `node --test tests/editor.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add editor.js tests/editor.test.js
git commit -m "feat(editor): renameDay (solo titolo, code stabile)"
```

---

### Task 4: `removeDay`

**Files:**
- Modify: `editor.js`
- Test: `tests/editor.test.js`

- [ ] **Step 1: Test che fallisce**

```js
import { removeDay } from "../editor.js";

test("removeDay: elimina il giorno indicato, lascia gli altri", () => {
  const plan = [
    { day: "A", title: "Petto", exercises: [] },
    { day: "B", title: "Schiena", exercises: [] },
  ];
  const out = removeDay(plan, "A");
  assert.equal(out.length, 1);
  assert.equal(out[0].day, "B");
  assert.equal(plan.length, 2); // purezza
});

test("removeDay: day inesistente -> plan invariato (copia)", () => {
  const plan = [{ day: "A", title: "Petto", exercises: [] }];
  const out = removeDay(plan, "Z");
  assert.deepEqual(out, plan);
});
```

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test tests/editor.test.js`
Expected: FAIL (`removeDay` non esportata).

- [ ] **Step 3: Implementazione**

In `editor.js`:
```js
export function removeDay(plan, day) {
  return plan.filter((d) => d.day !== day);
}
```

- [ ] **Step 4: Verificare il successo**

Run: `node --test tests/editor.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add editor.js tests/editor.test.js
git commit -m "feat(editor): removeDay"
```

---

### Task 5: predicato `planIsEmpty`

**Files:**
- Modify: `store.js`
- Test: `tests/store.test.js`

- [ ] **Step 1: Test che fallisce**

```js
test("planIsEmpty: true se manca plan o e vuoto", () => {
  assert.equal(planIsEmpty(emptyData()), true);
  assert.equal(planIsEmpty({ weeks: {} }), true);
  assert.equal(planIsEmpty({ plan: [] }), true);
  assert.equal(planIsEmpty(null), true);
});

test("planIsEmpty: false se c'e almeno un giorno", () => {
  assert.equal(planIsEmpty({ plan: [{ day: "A", title: "x", exercises: [] }] }), false);
});
```
(Riusa l'import `planIsEmpty` già aggiunto nel Task 1.)

- [ ] **Step 2: Verificare il fallimento**

Run: `node --test tests/store.test.js`
Expected: FAIL (`planIsEmpty` non esportata).

- [ ] **Step 3: Implementazione**

In `store.js`:
```js
export function planIsEmpty(data) {
  return !data || !Array.isArray(data.plan) || data.plan.length === 0;
}
```

- [ ] **Step 4: Verificare il successo**

Run: `node --test tests/store.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```
git add store.js tests/store.test.js
git commit -m "feat(store): predicato planIsEmpty"
```

---

### Task 6: Rimuovere il seed demo dal boot e mettere in sicurezza l'avvio vuoto

**Files:**
- Modify: `app.js` (boot ~righe 2270–2351), `index.html` (markup `seedDialog`/
  `btnImportDemo`)
- Test: `npm test` (regressione)

Contesto: oggi nel boot `data = { ...remote.data, plan: remote.data.plan ?? seedPlan({ empty:true }) }`
poi `data = patchPlanV5(patchPlanV4(backfillMuscles(migrate(data), PLAN)))`, e infine
`await offerSeedIfEmpty()` che propone di importare la scheda del proprietario da
`SEED_URL`. Per un utente nuovo `migrate(data)` (senza seed) entrerebbe nel ramo di
migrazione perché `data.schema` è assente. Con `emptyData()` ora a `schema:5`
(Task 1) le migrazioni sono no-op e il crash sparisce; resta da togliere il seed.

- [ ] **Step 1: Rimuovere l'offerta seed e le sue dipendenze**

In `app.js`:
1. Eliminare la funzione `offerSeedIfEmpty()` per intero.
2. Eliminare le due chiamate `await offerSeedIfEmpty();` (nel boot e nell'handler
   `btnImportDemo`).
3. Eliminare la costante `const SEED_URL = ...`.
4. Eliminare l'intero handler `document.getElementById("btnImportDemo")...`.
5. Nel boot, semplificare il fallback plan: dato che `emptyData()` ora porta
   `plan: []`, sostituire
   `data = { ...remote.data, plan: remote.data.plan ?? seedPlan({ empty: true }) }`
   con
   `data = { ...remote.data, plan: Array.isArray(remote.data.plan) ? remote.data.plan : [] };`

- [ ] **Step 2: Rimuovere `import { PLAN, seedPlan }` se non più usato**

Cercare in `app.js` ogni uso residuo di `PLAN` e `seedPlan`:
Run: `node -e "const s=require('fs').readFileSync('app.js','utf8'); for (const m of ['PLAN','seedPlan']) console.log(m, (s.match(new RegExp('\\\\b'+m+'\\\\b','g'))||[]).length)"`
- `backfillMuscles(migrate(data), PLAN)` resta valido per i **dati esistenti** (utenti
  pre-V2 con `schema<3`): mantenere `PLAN` SOLO se ancora referenziato da quella riga.
  Se l'unica occorrenza rimasta di `seedPlan` era nel ramo rimosso, togliere `seedPlan`
  dall'import lasciando `import { PLAN } from "./plan.js";`.
Expected: dopo la pulizia, `seedPlan` = 0 usi, `PLAN` = usi solo nella catena
migrazione.

- [ ] **Step 3: Rimuovere il markup demo da `index.html`**

Eliminare da `index.html` il `<dialog id="seedDialog">…</dialog>` e ogni bottone
`id="btnImportDemo"` / `id="seedSummary"`. Verificare che non restino
`getElementById` orfani in `app.js` (già rimossi allo Step 1).

- [ ] **Step 4: Eseguire l'intera suite**

Run: `npm test`
Expected: PASS. Se `tests/app.push.test.js` o altri referenziano `offerSeedIfEmpty`/
`SEED_URL`/`seedPlan`, aggiornarli (mostrare il diff).

- [ ] **Step 5: Commit**

```
git add app.js index.html tests
git commit -m "refactor(boot): rimuove seed demo del proprietario dal flusso nuovi utenti"
```

---

### Task 7: Empty-state UI + apertura editor

**Files:**
- Modify: `index.html` (contenitore empty-state), `app.js` (render condizionale)
- Verifica: manuale (mobile)

- [ ] **Step 1: Markup empty-state**

In `index.html`, aggiungere un contenitore (nascosto di default) nella schermata
principale, es.:
```html
<section id="emptyState" class="empty-state hidden" aria-hidden="true">
  <p class="es-hint"># nessuna scheda</p>
  <p class="es-prompt">$ crea <span class="es-cur">scheda</span></p>
  <p class="es-sub">giorni · esercizi · recuperi — li definisci tu.</p>
  <button type="button" id="btnCreatePlan" class="es-cta">› crea la prima scheda</button>
</section>
```
(Lo styling tema arriverà nel Piano 2; qui basta che sia funzionale e leggibile.)

- [ ] **Step 2: Render condizionale nel `render()` di `app.js`**

Importare `planIsEmpty` da `store.js`. In `render()` (o nel boot dopo il caricamento
dati), mostrare `#emptyState` e nascondere la lista scheda quando
`planIsEmpty(data)`, e viceversa:
```js
const empty = planIsEmpty(data);
document.getElementById("emptyState").classList.toggle("hidden", !empty);
document.getElementById("emptyState").setAttribute("aria-hidden", String(!empty));
// nascondere/most rare i contenitori della home scheda (es. #dayTabs, lista esercizi, week select)
```
Identificare i contenitori della home esistenti e applicare lo stesso toggle
inverso. (Cercare in `index.html` gli `id` della home: `dayTabs`, contenitore
esercizi, week select.)

- [ ] **Step 3: Wire del bottone**

```js
document.getElementById("btnCreatePlan").addEventListener("click", () => {
  if (planIsEmpty(data)) { data = addDay(data.plan ? data : { ...data, plan: [] }, ""); }
  openPlanEditor();
});
```
Nota: aprire l'editor su un primo giorno appena creato evita un editor totalmente
vuoto. In alternativa aprire l'editor vuoto e lasciare che l'utente prema
"＋ Aggiungi giorno" (Task 8). Scegliere quest'ultima se più semplice; in tal caso
il click apre solo `openPlanEditor()`.

- [ ] **Step 4: Verifica manuale**

Avviare un server statico locale e aprire l'app con un profilo a scheda vuota.
Run (PowerShell): `python -m http.server 8000` poi aprire `http://localhost:8000`.
Expected: con scheda vuota appare l'empty-state; il bottone apre l'editor.

- [ ] **Step 5: Commit**

```
git add app.js index.html
git commit -m "feat(ui): empty-state per scheda vuota + apertura editor"
```

---

### Task 8: Editor con giorni dinamici (aggiungi/rinomina/elimina)

**Files:**
- Modify: `app.js` (`renderPlanEditor` ~righe 106–128 e dintorni), `index.html`
  (`#planTabs`)
- Verifica: manuale (mobile)

Contesto: oggi `#planTabs` ha bottoni statici A/B/C con `data-day`, e
`renderPlanEditor` usa `planEditDay`. Va reso dinamico dalla lista `planDays()`.

- [ ] **Step 1: Tab giorni generati dai dati**

In `renderPlanEditor`, generare i tab da `planDays()` invece che dal markup statico.
Per ogni giorno un bottone con label = `d.title` (fallback `d.day`) e `data-day=d.day`;
bottone attivo se `d.day === planEditDay`. Aggiungere in coda un bottone
`＋` per creare un giorno.

- [ ] **Step 2: Azione "aggiungi giorno"**

Importare `addDay`, `renameDay`, `removeDay` da `editor.js`. Handler del `＋`:
```js
const title = prompt("Nome del giorno (es. Petto/Tricipiti)");
if (title === null) return;
data = { ...data, plan: addDay(planDays(), title) };
planEditDay = data.plan[data.plan.length - 1].day;
persistPlan(); // usa il path di salvataggio plan esistente (vedi nota)
renderPlanEditor();
```
Nota: usare il **meccanismo di salvataggio scheda già esistente** (quello usato da
`addExercise`/`removeExercise` nell'editor — individuare la funzione che salva
`data.plan` e schedula il push, es. `pusher.schedule()` + `profileStorage.set`).
Riusare quella, non inventarne una nuova.

- [ ] **Step 3: Rinomina / elimina giorno**

Aggiungere nell'header dell'editor due azioni sul giorno corrente:
- "rinomina": `const t = prompt("Nuovo nome", dayTitle); if (t!==null){ data={...data, plan: renameDay(planDays(), planEditDay, t)}; persist+render }`
- "elimina": `if (planDays().length>1 && confirm("Eliminare il giorno?")){ const next=planDays().filter(d=>d.day!==planEditDay)[0].day; data={...data, plan: removeDay(planDays(), planEditDay)}; planEditDay=next; persist+render }`
  (Vietare l'eliminazione dell'ultimo giorno per non tornare a plan vuoto
  dall'editor; per svuotare del tutto si torna all'empty-state solo se 0 giorni —
  decisione: consentire di scendere a 0 e mostrare l'empty-state. Implementare la
  variante "consenti 0 giorni": rimuovere la guard `length>1` e, dopo `removeDay`, se
  `planDays().length===0` chiudere l'editor e far mostrare l'empty-state da
  `render()`.)

- [ ] **Step 4: Rimuovere i tab statici da `index.html`**

Svuotare `#planTabs` del markup A/B/C statico (ora popolato da JS). Verificare che
nessun altro codice dipenda dai bottoni statici.

- [ ] **Step 5: Verifica manuale**

Run: `python -m http.server 8000` → creare un giorno, aggiungere esercizi, rinominare,
eliminare; ricaricare e verificare la persistenza (e il sync se loggato).
Expected: i giorni si creano/rinominano/eliminano; gli `id` esercizio restano
stabili; le entries dei log non si rompono.

- [ ] **Step 6: Commit**

```
git add app.js index.html
git commit -m "feat(editor): giorni dinamici (aggiungi/rinomina/elimina)"
```

---

### Task 9: Bump cache SW + verifica finale

**Files:**
- Modify: `sw.js` (numero versione cache)
- Verifica: `npm test` + mobile

- [ ] **Step 1: Bump versione cache**

In `sw.js` incrementare il numero di versione della cache (es. `v38` → `v39`),
seguendo il meccanismo banner-update esistente.

- [ ] **Step 2: Suite completa**

Run: `npm test`
Expected: tutti i test verdi.

- [ ] **Step 3: Verifica manuale end-to-end (mobile-first)**

Profilo vuoto → empty-state → crea giorno → aggiungi esercizi → logga una serie →
ricarica (deve persistere) → forza aggiornamento SW se serve.

- [ ] **Step 4: Commit**

```
git add sw.js
git commit -m "chore(sw): bump cache per Piano 1 V2"
```

---

## Self-Review

- **Spec coverage:** §2 (empty-state, no template) → Task 6/7; §5 (crea da zero,
  giorni dinamici) → Task 2-4/8; §6 (`emptyData`/`PLAN`/`offerSeedIfEmpty`) → Task
  1/6; §8 (dati proprietario preservati — nessuna modifica ai dati esistenti, solo il
  percorso nuovi utenti) → coperto da Task 1/6; §11 (preservazione V1) → Task 0; §6
  (bump SW) → Task 9. **Restyle grafico (§3, §4) NON è in questo piano** → Piano 2 e 3.
- **Placeholder scan:** nessun TODO/“gestire edge case” senza codice; ogni step ha
  comando o codice.
- **Type consistency:** `addDay/renameDay/removeDay/nextDayCode` operano su `plan`
  (array di `{day,title,exercises}`); `planIsEmpty` su `data`. Coerenti tra task.
- **Rischio noto:** cambiare la forma di `emptyData()` può rompere test che ne
  asseriscono la forma esatta (Task 1 Step 5 lo gestisce) e va verificato l'uso in
  `mergeBlobs` (i default `safeLocal/safeRemote = emptyData()`): l'aggiunta di
  `plan:[]`/`schema:5` è additiva e non dovrebbe alterare il merge; confermare con
  `npm test`.

## Piani successivi (da scrivere separatamente)

- **Piano 2 — Design system "Amber CRT" + app-shell + Home pilota:** variabili CSS
  (§3 spec), riscrittura tema in `style.css`, status bar, applicazione alla home e
  all'empty-state, toggle scanline/glow + `prefers-reduced-motion`. Bump SW.
- **Piano 3 — Restyle schermata per schermata:** Esercizio/logging, Timer, Note,
  Sessione guidata, Progressione, Calendario, Impostazioni, Editor — tutte sul tema
  del Piano 2. Bump SW. Aggiornare eventuali test UI.
