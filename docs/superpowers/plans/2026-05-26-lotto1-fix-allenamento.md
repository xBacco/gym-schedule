# Lotto 1 — Fix allenamento · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correggere i 5 problemi della schermata focus esercizio (kg che si azzerano, sensazione prima della serie, serie confermata non annullabile, modifica reps/kg con `prompt()`, timer che copre le note).

**Architecture:** Tutto lato rendering in `app.js` + `style.css` + un nuovo `<dialog>` in `index.html`. Nessun cambio al formato dati: si riusano gli helper puri esistenti (`withSet`, `withoutSet`, `withSupersetSet`, `withoutSupersetSet`). La sensazione si chiede dopo la conferma, durante il recupero (striscia sopra il timer), e resta modificabile da un popup centrato sulla serie già fatta.

**Tech Stack:** Vanilla JS (ES modules), HTML `<dialog>`, CSS con le variabili del tema esistenti. Test: `node --test` (solo logica pura, già verde — non deve regredire).

**Spec:** `docs/superpowers/specs/2026-05-26-lotto1-fix-allenamento-design.md`

**Verifica nel browser (usata in ogni task):**
- Server già attivo: `http://localhost:8781/index.html` (o riavvia: `python -m http.server 8781 --directory C:\Users\TomasCoro\gym-schedule`).
- Per vedere il codice nuovo e non quello cachato dal service worker: apri DevTools → Application → Service Workers → **Unregister**, poi ricarica. In alternativa apri in finestra anonima.

---

## File Structure

- `index.html` — aggiungere `<dialog id="setDialog">` (popup serie) e `<div id="feelAsk">` (striscia sensazione sopra il timer).
- `style.css` — stili `.set-dialog`, `.mini`, `.acts`, `.feelask`; spazio note quando il timer è attivo (`body.timer-on .focus-body`).
- `app.js` — nuove funzioni `buildMiniStepper`, `openSetDialog`, `wireSetDialog`, `showFeelAsk`/`hideFeelAsk`; modifiche a `setRow`, `renderFocusNormal`, `trackBlock`, `startRest`, timer wiring, `boot`.
- `sw.js` — bump `CACHE` a `gymsched-v10`.
- Nessun file di test nuovo: la logica pura non cambia. `node --test` deve restare verde.

---

## Task 1: Scaffolding — markup dialog + striscia feel + stili

**Files:**
- Modify: `index.html` (dopo il blocco `<dialog id="qcDialog">`, e vicino a `#timerBar`)
- Modify: `style.css` (in fondo)

- [ ] **Step 1: Aggiungere il `<dialog>` della serie in `index.html`**

Inserire subito dopo la chiusura di `<dialog id="qcDialog">…</dialog>` (riga ~89):

```html
  <!-- Popup modifica serie già fatta -->
  <dialog id="setDialog" class="set-dialog">
    <div class="modal-h">
      <span id="setDlgTitle" class="t"></span>
      <button id="setDlgClose" class="x" type="button" aria-label="Chiudi">✕</button>
    </div>
    <div class="editlabel" style="text-align:left">Com'è andata</div>
    <div id="setDlgRpe"></div>
    <div class="editlabel" style="text-align:left">Modifica</div>
    <div id="setDlgEdit"></div>
    <div class="acts">
      <button id="setDlgUndo" type="button">↩ Annulla conferma</button>
      <button id="setDlgDelete" type="button" class="danger">🗑 Elimina serie</button>
    </div>
  </dialog>
```

- [ ] **Step 2: Aggiungere la striscia "com'è andata?" in `index.html`**

Inserire subito PRIMA di `<div id="timerBar" …>` (riga ~92):

```html
  <!-- Striscia sensazione durante il recupero -->
  <div id="feelAsk" class="feelask hidden">
    <div class="q">Serie <span id="feelAskN"></span> · <b>com'è andata?</b></div>
    <div id="feelAskBar"></div>
  </div>
```

- [ ] **Step 3: Aggiungere gli stili in fondo a `style.css`**

```css
/* ---- Lotto 1: popup serie + striscia sensazione ---- */
.set-dialog{max-width:330px;width:90vw;}
.set-dialog .modal-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;}
.set-dialog .modal-h .t{font-size:16px;font-weight:800;}
.set-dialog .modal-h .x{background:transparent;border:none;color:var(--dim);font-size:18px;cursor:pointer;line-height:1;}
.set-dialog .editlabel{margin-top:14px;}
.mini{display:flex;align-items:center;gap:10px;margin-top:9px;}
.mini .lab{font-family:"JetBrains Mono",monospace;font-size:10px;color:var(--dim);width:34px;text-transform:uppercase;letter-spacing:.1em;}
.mini .b{min-width:48px;height:44px;border-radius:11px;background:var(--field);border:1px solid var(--line);
  color:var(--acc);font-weight:700;font-family:"JetBrains Mono",monospace;font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none;touch-action:none;}
.mini .b:active{background:var(--acc);color:var(--acc-ink);}
.mini .num{flex:1;text-align:center;font-family:"JetBrains Mono",monospace;font-size:24px;font-weight:700;}
.mini .num .u{font-size:12px;color:var(--dim);}
.acts{display:flex;gap:9px;margin-top:16px;}
.acts button{flex:1;border-radius:11px;padding:12px 8px;font-family:inherit;font-weight:700;font-size:13px;cursor:pointer;
  border:1px solid var(--line);background:var(--surf2);color:var(--ink);}
.acts .danger{color:var(--down);border-color:#633a24;}

.feelask{position:fixed;left:50%;transform:translateX(-50%);bottom:74px;width:100%;max-width:440px;z-index:55;
  background:var(--surf);border-top:1px solid var(--line);padding:10px 14px 12px;}
.feelask.hidden{display:none;}
.feelask .q{font-family:"JetBrains Mono",monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);margin-bottom:7px;}
.feelask .q b{color:var(--ink);}
.feelask .rpebar{margin:0;}

/* il timer (fixed) non deve più coprire le note del focus */
body.timer-on .focus-body{padding-bottom:160px;}
```

- [ ] **Step 4: Verifica nel browser**

Ricarica (con SW sganciato). Atteso: nessun cambiamento visibile ancora (gli elementi sono nascosti / non cablati) e **nessun errore in console**. Il dialog e la striscia esistono nel DOM ma non vengono mostrati.

- [ ] **Step 5: Commit**

```
git add index.html style.css
git commit -m "feat(focus): scaffolding popup serie + striscia sensazione"
```

---

## Task 2: `buildMiniStepper` + `openSetDialog` + `wireSetDialog`

**Files:**
- Modify: `app.js` (nuove funzioni vicino a `buildEditBlock`; `wireSetDialog` chiamato in `boot`)

- [ ] **Step 1: Aggiungere `buildMiniStepper` in `app.js`**

Inserire subito dopo `buildEditBlock` (dopo riga ~420):

```js
// Stepper compatto per il popup serie: muta state[field] in place.
// step < 1 ⇒ campo kg (1 decimale, " kg"); altrimenti reps (intero).
function buildMiniStepper(label, state, field, step) {
  const row = document.createElement("div"); row.className = "mini";
  const lab = document.createElement("span"); lab.className = "lab"; lab.textContent = label;
  const dec = document.createElement("button"); dec.type = "button"; dec.className = "b"; dec.textContent = "−";
  const num = document.createElement("span"); num.className = "num";
  const inc = document.createElement("button"); inc.type = "button"; inc.className = "b"; inc.textContent = "+";
  const isKg = step < 1;
  const paint = () => {
    const n = parseFloat(String(state[field]).replace(",", "."));
    if (!Number.isFinite(n)) { num.textContent = "—"; return; }
    num.textContent = "";
    num.appendChild(document.createTextNode(isKg ? n.toFixed(1) : String(Math.round(n))));
    if (isKg) { const u = document.createElement("span"); u.className = "u"; u.textContent = " kg"; num.appendChild(u); }
  };
  const stepBy = (d) => {
    const n = parseFloat(String(state[field]).replace(",", "."));
    const base = Number.isFinite(n) ? n : 0;
    state[field] = String(Math.max(0, Math.round((base + d) * 100) / 100));
    paint();
  };
  bindHold(dec, () => stepBy(-step));
  bindHold(inc, () => stepBy(step));
  paint();
  row.append(lab, dec, num, inc);
  return row;
}
```

- [ ] **Step 2: Aggiungere lo stato e `openSetDialog`/`wireSetDialog` in `app.js`**

Inserire dopo `buildMiniStepper`:

```js
// Stato del popup serie (una sola istanza riusata). I callback sono cablati una
// volta in wireSetDialog; openSetDialog riempie stato + callback e mostra.
let setDlgState = null, setDlgCbs = null, setDlgAction = null;

// opts: { title, reps, kg, feel, onApply(reps,kg,feel), onUndo(), onDelete() }
function openSetDialog(opts) {
  const dlg = document.getElementById("setDialog");
  setDlgCbs = opts;
  setDlgState = { reps: String(opts.reps ?? ""), kg: String(opts.kg ?? ""), feel: opts.feel || "" };
  setDlgAction = null;
  document.getElementById("setDlgTitle").textContent = opts.title;

  const rpeBox = document.getElementById("setDlgRpe");
  const repaintRpe = () => {
    rpeBox.replaceChildren(buildRpeBar(setDlgState.feel, (f) => { setDlgState.feel = f; repaintRpe(); }));
  };
  repaintRpe();

  document.getElementById("setDlgEdit").replaceChildren(
    buildMiniStepper("reps", setDlgState, "reps", 1),
    buildMiniStepper("kg", setDlgState, "kg", 0.5),
  );
  dlg.showModal();
}

function wireSetDialog() {
  const dlg = document.getElementById("setDialog");
  document.getElementById("setDlgUndo").addEventListener("click", () => { setDlgAction = "undo"; dlg.close(); });
  document.getElementById("setDlgDelete").addEventListener("click", () => { setDlgAction = "delete"; dlg.close(); });
  document.getElementById("setDlgClose").addEventListener("click", () => { setDlgAction = "cancel"; dlg.close(); });
  // tap sullo sfondo = chiudi applicando i valori correnti
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => {
    if (!setDlgCbs) return;
    const { onApply, onUndo, onDelete } = setDlgCbs;
    const a = setDlgAction; setDlgAction = null;
    if (a === "undo") onUndo();
    else if (a === "delete") onDelete();
    else if (a !== "cancel") onApply(setDlgState.reps, setDlgState.kg, setDlgState.feel);
    setDlgCbs = null; setDlgState = null;
  });
}
```

- [ ] **Step 3: Chiamare `wireSetDialog()` in `boot`**

In `boot()`, accanto a `wireSettings();` / `wireTimerControls();` (riga ~1003), aggiungere:

```js
  wireSetDialog();
```

- [ ] **Step 4: Verifica nel browser (console)**

Ricarica (SW sganciato). In console esegui:
```js
openSetDialog({ title: "Serie 2 · 8 × 60 kg", reps: "8", kg: "60", feel: "ok",
  onApply: (r,k,f)=>console.log("apply",r,k,f), onUndo: ()=>console.log("undo"), onDelete: ()=>console.log("delete") })
```
Atteso: popup centrato con titolo, "giusta" preselezionato, stepper reps=8 e kg=60.0; i +/− cambiano i numeri; toccando fuori o ✕ si chiude e logga `apply 8 60 ok` (o i valori modificati); "Annulla conferma" logga `undo`; "Elimina serie" logga `delete`. **Nota:** `openSetDialog` non è esportata globalmente; per il test in console aggiungi temporaneamente `window.openSetDialog = openSetDialog;` in fondo ad `app.js`, poi rimuovilo prima del commit.

- [ ] **Step 5: Commit**

```
git add app.js
git commit -m "feat(focus): popup serie (buildMiniStepper, openSetDialog, wireSetDialog)"
```

---

## Task 3: Esercizio normale — togliere RPE bar, cablare popup, stabilizzare la bozza

**Files:**
- Modify: `app.js` — `setRow` (riga ~447), `renderFocusNormal` (riga ~524)

- [ ] **Step 1: Cambiare la firma e i tocchi di `setRow`**

`setRow` non gestisce più feel-ciclo né commenti-prompt: per le serie fatte chiama `onOpen`. Nuova firma `setRow(i, set, prev, isCurrent, onRemove, onOpen)`.

Sostituire il blocco del valore (righe ~463-471):

```js
  if (set.done && onOpen) {
    v.addEventListener("click", () => onOpen());
  }
```

Sostituire il blocco del tag feel (righe ~493-500) con: il tag, se presente, apre il popup invece di ciclare:

```js
  if (set.done && !set.warmup && set.feel) {
    const fl = document.createElement("span");
    fl.className = "rpe " + set.feel;
    fl.textContent = RPE_LABEL[set.feel] ?? "giusta";
    fl.title = "Tocca per modificare";
    if (onOpen) fl.addEventListener("click", (e) => { e.stopPropagation(); onOpen(); });
    row.appendChild(fl);
  }
```

Mostrare la ✕ di rimozione solo per serie NON fatte (le serie fatte si eliminano dal popup). Sostituire il blocco `if (onRemove)` (righe ~501-505):

```js
  if (onRemove && !set.done) {
    const rm = document.createElement("span"); rm.className = "rm"; rm.textContent = "✕";
    rm.addEventListener("click", (e) => { e.stopPropagation(); onRemove(); });
    row.appendChild(rm);
  }
```

Rendere la riga commenti display-only (rimuovere l'edit via prompt). Sostituire il blocco commenti (righe ~506-512):

```js
  if (set.done && Array.isArray(set.comments) && set.comments.length) {
    const c = document.createElement("div"); c.className = "cmt";
    c.textContent = set.comments.join(" · ");
    row.appendChild(c);
  }
```

- [ ] **Step 2: Aggiornare le chiamate a `setRow` in `renderFocusNormal`**

Sostituire l'intero ciclo che costruisce le righe (righe ~546-567) con:

```js
  for (let i = 0; i < total; i++) {
    const set = entry.sets[i] || { reps: "", kg: "", done: false };
    const isCurrent = i === curIdx;
    const canRemove = i < entry.sets.length && entry.sets.length > 0;
    const onRemove = canRemove ? () => {
      data = setEntry(data, currentWeek, currentDay, idx, withoutSet(v, i), new Date().toISOString());
      persist(idx); render();
    } : null;
    const onOpen = set.done ? () => openSetDialog({
      title: `Serie ${i + 1} · ${set.reps || "—"} × ${set.kg || "—"} kg`,
      reps: set.reps, kg: set.kg, feel: set.feel,
      onApply: (reps, kg, feel) => {
        data = setEntry(data, currentWeek, currentDay, idx, withSet(v, i, { reps, kg, feel }), new Date().toISOString());
        persist(idx); render();
      },
      onUndo: () => {
        data = setEntry(data, currentWeek, currentDay, idx, withSet(v, i, { done: false }), new Date().toISOString());
        persist(idx); render();
      },
      onDelete: () => {
        data = setEntry(data, currentWeek, currentDay, idx, withoutSet(v, i), new Date().toISOString());
        persist(idx); render();
      },
    }) : null;
    setsBox.appendChild(setRow(i, set, prev[i] || null, isCurrent, onRemove, onOpen));
  }
```

- [ ] **Step 3: Togliere la RPE bar dalla serie corrente**

Rimuovere completamente il blocco (righe ~573-577):

```js
  container.appendChild(buildRpeBar(entry.sets[curIdx]?.feel ?? "", (feel) => {
    data = setEntry(data, currentWeek, currentDay, idx,
      withSet(v, curIdx, { feel }), new Date().toISOString());
    persist(idx); render();
  }));
```

- [ ] **Step 4: Stabilizzare la bozza (`draft`) tra i redraw**

Sostituire l'assegnazione di `draft` (righe ~534-538) con una guardia per chiave:

```js
  const draftKey = `${currentDay}-${idx}-${curIdx}-${entry.sets.length}`;
  if (draft._key !== draftKey) {
    draft = {
      kg: prev[curIdx]?.kg ?? "",
      reps: prev[curIdx]?.reps ?? repsLow(tgt.reps),
      comments: (entry.sets[curIdx]?.comments ?? []).slice(),
      _key: draftKey,
    };
  }
```

- [ ] **Step 5: Verifica nel browser**

Ricarica (SW sganciato). In un esercizio normale (es. giorno A · Panca piana):
1. Scrivi un peso col +0.5 → tocca una serie già fatta sopra (apre il popup) → chiudi: il peso digitato **non si azzera** (#2).
2. La barra facile/giusta/dura **non è più** sopra "Serie fatta" (#3).
3. Tocca una serie fatta → popup: cambia reps/kg, premi "Annulla conferma" → la serie torna in corso; riapri un'altra → "Elimina serie" la rimuove (#12/#13).
4. `npm test` (in PowerShell: `node --test`) resta verde.

- [ ] **Step 6: Commit**

```
git add app.js
git commit -m "feat(focus): popup su serie fatta + niente RPE pre-serie + bozza stabile (normale)"
```

---

## Task 4: Superset — togliere RPE bar, cablare popup, stabilizzare le bozze A/B

**Files:**
- Modify: `app.js` — `trackBlock` (riga ~646)

- [ ] **Step 1: Stabilizzare `state` (draftA/draftB) in `trackBlock`**

Sostituire le tre assegnazioni dirette (righe ~659-661):

```js
  const curIdx = activeSetIndex(trackEntry.sets);
  state.kg = prevSets[curIdx]?.kg ?? "";
  state.reps = prevSets[curIdx]?.reps ?? repsLow(tgtTrack.reps);
  state.comments = (trackEntry.sets[curIdx]?.comments ?? []).slice();
```

con:

```js
  const curIdx = activeSetIndex(trackEntry.sets);
  const stateKey = `${currentDay}-${idx}-${trackKey}-${curIdx}-${trackEntry.sets.length}`;
  if (state._key !== stateKey) {
    state.kg = prevSets[curIdx]?.kg ?? "";
    state.reps = prevSets[curIdx]?.reps ?? repsLow(tgtTrack.reps);
    state.comments = (trackEntry.sets[curIdx]?.comments ?? []).slice();
    state._key = stateKey;
  }
```

- [ ] **Step 2: Cablare il popup nelle righe del superset**

Sostituire il ciclo che costruisce le righe (righe ~666-685) con:

```js
  for (let i = 0; i < total; i++) {
    const set = trackEntry.sets[i] || { reps: "", kg: "", done: false };
    const onOpen = set.done ? () => openSetDialog({
      title: `${trackKey.toUpperCase()} · Serie ${i + 1} · ${set.reps || "—"} × ${set.kg || "—"} kg`,
      reps: set.reps, kg: set.kg, feel: set.feel,
      onApply: (reps, kg, feel) => {
        const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, idx), trackKey, i, { reps, kg, feel });
        data = setEntry(data, currentWeek, currentDay, idx, nv, new Date().toISOString());
        persist(idx); render();
      },
      onUndo: () => {
        const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, idx), trackKey, i, { done: false });
        data = setEntry(data, currentWeek, currentDay, idx, nv, new Date().toISOString());
        persist(idx); render();
      },
      onDelete: () => {
        const nv = withoutSupersetSet(getEntry(data, currentWeek, currentDay, idx), trackKey, i);
        data = setEntry(data, currentWeek, currentDay, idx, nv, new Date().toISOString());
        persist(idx); render();
      },
    }) : null;
    setsBox.appendChild(setRow(i, set, prevSets[i] || null, i === curIdx, null, onOpen));
  }
```

- [ ] **Step 3: Importare `withoutSupersetSet`**

In cima ad `app.js`, nell'import da `./session.js` (righe ~7-12), aggiungere `withoutSupersetSet` all'elenco:

```js
  withSet, withoutSet, withSupersetSet, withoutSupersetSet, withNote, previousNote,
```

- [ ] **Step 4: Togliere la RPE bar dalla traccia corrente del superset**

Rimuovere il blocco (righe ~691-695):

```js
  wrap.appendChild(buildRpeBar(trackEntry.sets[curIdx]?.feel ?? "", (feel) => {
    const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, idx), trackKey, curIdx, { feel });
    data = setEntry(data, currentWeek, currentDay, idx, nv, new Date().toISOString());
    persist(idx); render();
  }));
```

- [ ] **Step 5: Verifica nel browser**

Ricarica (SW sganciato). In un superset (es. giorno B · Curl EZ + Skullcrusher):
1. Niente barra facile/giusta/dura sotto l'editor.
2. Scrivi un peso, apri il popup su una serie A o B già fatta, chiudi: il peso non si azzera.
3. Popup su serie A: modifica/annulla/elimina funziona sulla traccia A; idem su B.
4. `node --test` resta verde.

- [ ] **Step 6: Commit**

```
git add app.js
git commit -m "feat(focus): popup serie + niente RPE pre-serie + bozze stabili (superset)"
```

---

## Task 5: Striscia "com'è andata?" durante il recupero (#3)

**Files:**
- Modify: `app.js` — nuove `showFeelAsk`/`hideFeelAsk`; handler CTA in `renderFocusNormal` (riga ~628) e `renderFocusSuperset` (riga ~751); `timer.onEnd` (riga ~125) e `wireTimerControls` (riga ~984)

- [ ] **Step 1: Aggiungere lo stato e le funzioni della striscia**

Inserire dopo `hideFeelAsk`… ovvero subito dopo `wireSetDialog` (Task 2):

```js
// Sensazione chiesta dopo la conferma, durante il recupero. lastDone descrive la
// serie appena conclusa: { idx, superset:false, setIndex } oppure
// { idx, superset:true, aIdx, bIdx } (il superset rate entrambe le tracce).
let lastDone = null;

function showFeelAsk(info) {
  lastDone = info;
  const n = info.superset ? info.aIdx : info.setIndex;
  document.getElementById("feelAskN").textContent = String(n + 1);
  const bar = buildRpeBar("", (feel) => {
    if (!feel) { hideFeelAsk(); return; }
    let v = getEntry(data, currentWeek, currentDay, lastDone.idx);
    let nv;
    if (lastDone.superset) {
      nv = withSupersetSet(v, "a", lastDone.aIdx, { feel });
      nv = withSupersetSet(nv, "b", lastDone.bIdx, { feel });
    } else {
      nv = withSet(v, lastDone.setIndex, { feel });
    }
    data = setEntry(data, currentWeek, currentDay, lastDone.idx, nv, new Date().toISOString());
    persist(lastDone.idx);
    hideFeelAsk();
    render();
  });
  document.getElementById("feelAskBar").replaceChildren(bar);
  document.getElementById("feelAsk").classList.remove("hidden");
}

function hideFeelAsk() {
  document.getElementById("feelAsk").classList.add("hidden");
  lastDone = null;
}
```

- [ ] **Step 2: Chiamare `showFeelAsk` alla conferma di una serie normale**

Nel handler CTA di `renderFocusNormal` (dentro `cta.addEventListener("click", …)`, riga ~628), subito dopo `startRest(...)` e prima di `render()`:

```js
    startRest(getRest(currentDay, idx, ex.restSeconds), ex.name);
    showFeelAsk({ idx, superset: false, setIndex: curIdx });
    render();
```

- [ ] **Step 3: Chiamare `showFeelAsk` alla conferma di un superset**

Nel handler CTA di `renderFocusSuperset` (riga ~751), subito dopo `startRest(...)`:

```js
    startRest(getRest(currentDay, idx, ex.restSeconds), ex.name);
    showFeelAsk({ idx, superset: true, aIdx: a.curIdx, bIdx: b.curIdx });
    render();
```

- [ ] **Step 4: Nascondere la striscia quando il timer finisce o viene fermato**

In `timer.onEnd` (riga ~125), aggiungere `hideFeelAsk();` all'inizio del callback:

```js
  onEnd: () => {
    hideFeelAsk();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    beep();
    setTimeout(() => document.getElementById("timerBar").classList.add("hidden"), 1500);
  },
```

In `wireTimerControls`, nel handler di `tStop` (riga ~984), aggiungere `hideFeelAsk();`:

```js
  document.getElementById("tStop").addEventListener("click", () => {
    timer.stop();
    hideFeelAsk();
    document.getElementById("timerBar").classList.add("hidden");
  });
```

- [ ] **Step 5: Verifica nel browser**

Ricarica (SW sganciato). Fai una serie e premi "Serie fatta":
1. Parte il recupero e sopra il timer appare «Serie N · com'è andata?» coi tre tasti.
2. Tocca "dura" → la serie appena fatta mostra il tag "dura"; la striscia sparisce.
3. Se non tocchi nulla e il timer finisce (o premi ✕), la striscia sparisce e la serie resta senza sensazione.
4. In un superset, toccando un tasto si segna la stessa sensazione su A e B.
5. `node --test` resta verde.

- [ ] **Step 6: Commit**

```
git add app.js
git commit -m "feat(focus): sensazione chiesta durante il recupero (#3)"
```

---

## Task 6: Note non coperte dal timer (#11) + bump cache + verifica finale

**Files:**
- Modify: `app.js` — `startRest` (riga ~132), `timer.onEnd` (riga ~125), `tStop` (riga ~984)
- Modify: `sw.js`

- [ ] **Step 1: Attivare lo spazio note quando parte il recupero**

In `startRest` (riga ~132), aggiungere il toggle della classe sul body:

```js
function startRest(seconds, label) {
  ensureAudio(); // unlock audio within the user gesture
  wakeLock.enable();
  document.body.classList.add("timer-on");
  document.getElementById("timerBar").classList.remove("hidden");
  document.getElementById("tToggle").textContent = "⏸";
  timer.start(seconds, label);
}
```

- [ ] **Step 2: Togliere la classe a fine/stop timer**

In `timer.onEnd` (riga ~125), dentro il `setTimeout`:

```js
    setTimeout(() => {
      document.getElementById("timerBar").classList.add("hidden");
      document.body.classList.remove("timer-on");
    }, 1500);
```

In `tStop` (riga ~984):

```js
  document.getElementById("tStop").addEventListener("click", () => {
    timer.stop();
    hideFeelAsk();
    document.getElementById("timerBar").classList.add("hidden");
    document.body.classList.remove("timer-on");
  });
```

- [ ] **Step 3: Bump della cache del service worker**

In `sw.js` riga 5: `const CACHE = "gymsched-v9";` → `const CACHE = "gymsched-v10";`

- [ ] **Step 4: Verifica nel browser**

Ricarica (SW sganciato). In un esercizio, scorri fino alla nota e premi "Serie fatta":
1. Parte il timer: la **nota resta visibile** (c'è spazio sotto), non più coperta (#11).
2. A fine timer / stop, lo spazio extra sparisce.

- [ ] **Step 5: Test completo + verifica regressione**

In PowerShell:
```
cd C:\Users\TomasCoro\gym-schedule; node --test
```
Atteso: tutti i test passano (stesso numero di prima, 0 fail).

- [ ] **Step 6: Commit**

```
git add app.js sw.js
git commit -m "fix(focus): note non coperte dal timer (#11) + bump cache v10"
```

---

## Self-Review (eseguito in fase di scrittura)

- **Copertura spec:** #2 (Task 3 step 4 + Task 4 step 1) · #3 (Task 3 step 3, Task 4 step 4, Task 5) · #15 (Task 3/4 popup feel) · #12 (Task 2 + Task 3/4 onApply) · #13 (onUndo/onDelete Task 3/4) · #11 (Task 6). Tutte coperte.
- **Placeholder:** nessuno; codice completo in ogni step.
- **Coerenza tipi/nomi:** `openSetDialog(opts)` con `onApply/onUndo/onDelete`; `setRow(i,set,prev,isCurrent,onRemove,onOpen)`; `showFeelAsk(info)`/`hideFeelAsk()`; `lastDone` con forma normale/superset coerente tra Task 5 e i CTA. `withoutSupersetSet` importato (Task 4 step 3).

## Note di rischio
- `setRow` è usata sia da normale sia da superset: la nuova firma a 6 argomenti va aggiornata in **entrambi** i chiamanti (Task 3 step 2 e Task 4 step 2). Verificare che non restino chiamate alla vecchia firma.
- Rimosso l'editing dei commenti via `prompt()` su serie fatta (display-only). I commenti si impostano ancora sulla serie corrente con le chip; l'editing post-hoc dei commenti è fuori scope per il Lotto 1.
