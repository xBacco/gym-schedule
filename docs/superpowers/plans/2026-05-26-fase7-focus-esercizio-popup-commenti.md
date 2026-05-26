# Fase 7 — Focus esercizio a schermo intero + popup commento veloce — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trasformare l'esercizio aperto da fisarmonica inline a overlay a schermo intero con scroll bloccato, uscita via ← o auto a fine esercizio, e sostituire i chip commento inline con un bottone che apre un popup ad applicazione immediata.

**Architecture:** Si introduce un overlay `#focusOverlay` (figlio di `<body>`, `position:fixed`) con header fisso, corpo non-scrollabile e footer ancorato. `renderList()` smette di renderizzare il focus dentro `.item .body` e si limita alle righe; toccare una riga imposta `openIndex` e mostra l'overlay. `renderFocusNormal`/`renderFocusSuperset` vengono adattate per renderizzare nel corpo dell'overlay e mettere la CTA nel footer. I superset usano sotto-tab A/B (variabile `supersetTab`). I commenti passano da `buildQuickCommentChips` inline a `buildQuickCommentButton` + `<dialog id="qcDialog">` ad applicazione immediata, riusato anche per editare serie già fatte.

**Tech Stack:** Vanilla JS ES modules, niente framework. Logica pura in `store.js`/`session.js` (testata con `node --test`, immutata). Rendering/wiring DOM in `app.js`. Stili in `style.css`. PWA: `sw.js`.

**Convenzione di test del progetto:** la logica pura è già testata e non cambia; questi interventi sono rendering/wiring DOM, quindi **non** si aggiungono unit test ma si verifica in **browser reale** (server HTTP locale + Playwright/manuale). Ad ogni task: `node --test` deve restare verde (104 test) e si verifica visivamente nel browser.

**Come servire/verificare nel browser (vale per tutti i task):**
```powershell
# da PowerShell, NON Bash (sandbox inaffidabile qui)
Push-Location C:\Users\TomasCoro\gym-schedule
Start-Process powershell -ArgumentList '-NoExit','-Command','python -m http.server 8780'
# poi aprire http://localhost:8780/index.html in un browser (ES modules: file:// non funziona)
```
`node --test` (gate logico):
```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test 2>&1 | Select-Object -Last 6; Pop-Location
```
Atteso sempre: `pass 104`, `fail 0`.

**Commit:** dopo ogni task, commit + push su `main` (preferenza utente). Su PowerShell usare `git commit -F <file>` per messaggi multilinea; prima del push fare `git fetch` + `git pull --ff-only` (l'app pusha commit `log:` da telefono).

---

## File Structure

- `index.html` — aggiunge l'elemento overlay `#focusOverlay` (header/body/footer) come figlio diretto di `<body>`, e il `<dialog id="qcDialog">` per i commenti. Modifica.
- `style.css` — stili `.focus-ov`, `.focus-top`, `.focus-body`, `.focus-foot`, sotto-tab `.ss-tabs`, bottone `.qc-btn` + riepilogo `.qc-sel`, e regole popup commenti. Modifica.
- `app.js` — il grosso: orchestrazione overlay (`renderFocusOverlay`), modifica `renderList` (solo righe + apertura overlay), adattamento `renderFocusNormal`/`renderFocusSuperset`/`trackBlock` (corpo+footer, header serie X/Y, auto-close), sotto-tab superset, `buildQuickCommentButton` + popup, riuso popup per editare serie fatte. Modifica.
- `sw.js` — bump cache `gymsched-v4` → `gymsched-v5`. Modifica.

Nessun file nuovo. Nessuna modifica a `store.js`/`session.js`/`plan.js`/`data.json`.

---

## Task 1: Scaffolding overlay + popup (HTML/CSS, nessun comportamento)

**Files:**
- Modify: `index.html` (dopo `<div id="volRow"></div>`, e nuovo `<dialog>`)
- Modify: `style.css` (in fondo)

- [ ] **Step 1: Aggiungi l'overlay e il dialog commenti in `index.html`**

Inserire SUBITO PRIMA del commento `<!-- Rest timer -->` (riga ~68, quindi fuori da `.wrap`, come figlio di `<body>`):

```html
  <!-- Focus esercizio a schermo intero -->
  <div id="focusOverlay" class="focus-ov hidden" aria-hidden="true">
    <header class="focus-top">
      <button id="focusBack" class="focus-back" aria-label="Chiudi esercizio">←</button>
      <div class="focus-id">
        <div id="focusName" class="fn"></div>
        <div id="focusSet" class="fs"></div>
      </div>
    </header>
    <div id="focusBody" class="focus-body"></div>
    <div id="focusFoot" class="focus-foot"></div>
  </div>

  <!-- Popup commento veloce -->
  <dialog id="qcDialog" class="qc-dialog">
    <div class="qc-head">
      <h2>Commento veloce</h2>
      <button id="qcClose" class="qc-x" aria-label="Chiudi">✕</button>
    </div>
    <p class="hint">Tocca i tag da aggiungere a questa serie.</p>
    <div id="qcOptions" class="qc-options"></div>
  </dialog>
```

- [ ] **Step 2: Aggiungi gli stili in fondo a `style.css`**

```css
/* ---- Fase 7: focus esercizio a schermo intero ---- */
.focus-ov{position:fixed;inset:0;z-index:40;background:var(--bg);display:flex;flex-direction:column;}
.focus-ov.hidden{display:none;}
.focus-top{flex:0 0 auto;display:flex;align-items:center;gap:12px;
  padding:calc(env(safe-area-inset-top,0px) + 16px) 16px 13px;
  border-bottom:1px solid var(--line);background:var(--surf);}
.focus-back{width:40px;height:40px;flex:0 0 auto;border-radius:11px;background:var(--surf2);
  border:1px solid var(--line);color:var(--ink);font-size:20px;cursor:pointer;}
.focus-id .fn{font-size:17px;font-weight:800;line-height:1.15;}
.focus-id .fs{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--acc);margin-top:3px;}
.focus-body{flex:1;min-height:0;overflow:hidden;padding:14px 16px;}
.focus-foot{flex:0 0 auto;padding:11px 16px calc(env(safe-area-inset-bottom,0px) + 12px);
  border-top:1px solid var(--line);background:var(--surf);}
.focus-foot .cta{margin-top:0;}
/* dentro l'overlay la CTA vive nel footer, non nel corpo */

/* sotto-tab A/B per i superset */
.ss-tabs{display:flex;gap:7px;margin-bottom:12px;}
.ss-tabs button{flex:1;background:var(--surf2);border:1px solid var(--line);color:var(--dim);
  border-radius:11px;padding:9px 0;font-weight:700;font-size:13px;cursor:pointer;}
.ss-tabs button.on{background:var(--acc);border-color:var(--acc);color:var(--acc-ink);}

/* bottone commento veloce + riepilogo tag */
.qc-btn{width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;
  background:var(--surf2);border:1px solid var(--line);border-radius:12px;padding:11px 13px;
  color:var(--ink);font-size:14px;cursor:pointer;margin-top:11px;}
.qc-btn .cnt{font-family:"JetBrains Mono",monospace;font-size:12px;color:var(--acc-ink);
  background:var(--acc);border-radius:999px;padding:2px 9px;font-weight:700;}
.qc-btn .cnt.zero{display:none;}
.qc-sel{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px;}
.qc-sel .tag{font-size:11.5px;color:var(--acc);background:#352815;border:1px solid var(--acc);
  border-radius:999px;padding:3px 10px;}

/* popup commenti */
.qc-dialog{max-width:340px;width:90vw;}
.qc-head{display:flex;align-items:center;justify-content:space-between;}
.qc-head h2{margin:0;font-size:16px;}
.qc-x{background:transparent;border:none;color:var(--dim);font-size:16px;cursor:pointer;}
.qc-options{display:flex;flex-direction:column;gap:8px;margin-top:12px;}
.qc-opt{display:flex;align-items:center;gap:11px;background:var(--surf2);border:1px solid var(--line);
  border-radius:12px;padding:12px 13px;font-size:14px;color:var(--ink);cursor:pointer;text-align:left;}
.qc-opt.on{border-color:var(--acc);background:#352815;color:var(--acc);font-weight:700;}
.qc-opt.write{color:var(--acc);border-style:dashed;}
```

- [ ] **Step 3: Verifica build (nessuna regressione)**

Servire e aprire `http://localhost:8780/index.html`. Atteso: l'app si comporta esattamente come prima (l'overlay è `.hidden`, il dialog è chiuso). Nessun errore in console.

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test 2>&1 | Select-Object -Last 6; Pop-Location
```
Atteso: `pass 104`, `fail 0`.

- [ ] **Step 4: Commit**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git fetch origin; git pull --ff-only origin main
git add index.html style.css
git commit -m "feat(ui): scaffolding overlay focus + dialog commenti (fase7)"
git push origin main
Pop-Location
```

---

## Task 2: Overlay focus per esercizi normali (apertura, scroll lock, ←, auto-close)

**Files:**
- Modify: `app.js` — `renderList` (746-778), `render` (788-793), `renderFocusNormal` (507-621), nuova `renderFocusOverlay`, nuovi handler back.

- [ ] **Step 1: Aggiungi i riferimenti DOM e la variabile di stato in cima ad `app.js`**

Vicino a `let openIndex = null;` (riga 26) aggiungere:

```js
let supersetTab = "a"; // sotto-tab attivo nel focus di un superset
```

- [ ] **Step 2: Modifica `renderList` per NON renderizzare più il focus inline**

Sostituire il corpo del `forEach` che gestisce `.body` (righe 769-776). Rimuovere il blocco:

```js
    item.appendChild(r);
    const body = document.createElement("div"); body.className = "body";
    if (i === openIndex) {
      if (ex.superset) renderFocusSuperset(ex, i, body);
      else renderFocusNormal(ex, i, body);
    }
    item.appendChild(body);
    root.appendChild(item);
```

con:

```js
    item.appendChild(r);
    root.appendChild(item);
```

E nel click handler della riga (riga 755), quando si apre un nuovo esercizio resettare il sotto-tab:

```js
    r.addEventListener("click", () => { openIndex = (openIndex === i ? null : i); supersetTab = "a"; render(); });
```

- [ ] **Step 3: Scrivi `renderFocusOverlay` (nuova funzione, dopo `renderList`)**

```js
function renderFocusOverlay() {
  const ov = document.getElementById("focusOverlay");
  const body = document.getElementById("focusBody");
  const foot = document.getElementById("focusFoot");
  if (openIndex === null) {
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    return;
  }
  const ex = dayPlan().exercises[openIndex];
  if (!ex) { openIndex = null; renderFocusOverlay(); return; }
  document.getElementById("focusName").textContent = ex.name;
  body.textContent = "";
  foot.textContent = "";
  if (ex.superset) renderFocusSuperset(ex, openIndex, body, foot);
  else renderFocusNormal(ex, openIndex, body, foot);
  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}
```

- [ ] **Step 4: Aggancia il pulsante ← e includi l'overlay in `render`**

Modificare `render` (righe 788-793):

```js
function render() {
  renderHeader();
  renderProgress();
  renderList();
  renderVolRow();
  renderFocusOverlay();
}
```

Vicino agli altri wiring di avvio (es. dopo la registrazione SW o vicino agli altri `addEventListener` di bottoni statici), aggiungere una sola volta:

```js
document.getElementById("focusBack").addEventListener("click", () => { openIndex = null; render(); });
```

- [ ] **Step 5: Adatta `renderFocusNormal` per corpo+footer e header "serie X/Y"**

Cambiare la firma e spostare la CTA nel footer. Firma (riga 507):

```js
function renderFocusNormal(ex, idx, container, footer) {
```

Subito dopo aver calcolato `curIdx` (riga 512), aggiornare l'indicatore di serie nell'header:

```js
  document.getElementById("focusSet").textContent =
    `serie ${Math.min(curIdx + 1, tgt.sets)} / ${tgt.sets}`;
```

Sostituire l'append della CTA (righe 606-619) in modo che vada nel `footer` e che a esercizio completo si chiuda l'overlay (torno alla lista) invece di avanzare:

```js
  const cta = document.createElement("button");
  cta.className = "cta"; cta.textContent = "Serie fatta · avvia recupero ▸";
  cta.addEventListener("click", () => {
    data = setEntry(data, currentWeek, currentDay, idx,
      withSet(v, curIdx, { reps: draft.reps, kg: draft.kg, done: true, feel: entry.sets[curIdx]?.feel ?? "", comments: draft.comments }), new Date().toISOString());
    persist(idx);
    startRest(getRest(currentDay, idx, ex.restSeconds), ex.name);
    if (isEntryComplete(getEntry(data, currentWeek, currentDay, idx), ex)) {
      openIndex = null; // esercizio finito → torna alla lista
    }
    render();
  });
  footer.appendChild(cta);
```

Lasciare `container.appendChild(buildNoteField(false, idx));` com'è (riga 620) — la nota resta nel corpo.

- [ ] **Step 6: Verifica nel browser**

Servire e aprire l'app. Toccando un esercizio normale (es. "Panca piana"):
- si apre a tutto schermo coprendo header/lista;
- la pagina sotto non scrolla (prova a trascinare);
- l'header mostra "serie X / Y" corretto;
- la CTA "Serie fatta" è in basso;
- toccando ← si torna alla lista;
- completando l'ultima serie l'overlay si chiude da solo e torna alla lista.

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test 2>&1 | Select-Object -Last 6; Pop-Location
```
Atteso: `pass 104`, `fail 0`.

- [ ] **Step 7: Commit**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git fetch origin; git pull --ff-only origin main
git add app.js
git commit -m "feat(ui): esercizio normale a schermo intero, scroll bloccato, auto-close (fase7)"
git push origin main
Pop-Location
```

---

## Task 3: Superset con sotto-tab A/B nell'overlay

**Files:**
- Modify: `app.js` — `renderFocusSuperset` (697-728), che oggi impila `a.wrap` e `b.wrap`.

- [ ] **Step 1: Adatta `renderFocusSuperset` a corpo+footer con sotto-tab**

Sostituire l'intera funzione `renderFocusSuperset` (righe 697-728) con:

```js
function renderFocusSuperset(ex, idx, container, footer) {
  const v = getEntry(data, currentWeek, currentDay, idx);
  const e = normalizeSupersetEntry(v);
  const tgt = parseTarget(ex.setsReps, true);
  const [nameA, nameB] = ex.name.includes(" + ") ? ex.name.split(" + ") : [ex.name, ex.name];
  const prev = previousSupersetSets(currentWeek, currentDay, idx);

  // sotto-tab A / B
  const tabs = document.createElement("div");
  tabs.className = "ss-tabs";
  [["a", nameA.trim()], ["b", nameB.trim()]].forEach(([key, name]) => {
    const b = document.createElement("button");
    b.textContent = `${key.toUpperCase()} · ${name}`;
    if (supersetTab === key) b.classList.add("on");
    b.addEventListener("click", () => { supersetTab = key; render(); });
    tabs.appendChild(b);
  });
  container.appendChild(tabs);

  const trendRow = buildTrendRow(exerciseTrend(data, currentDay, idx, currentWeek, 3, true), currentWeek);
  if (trendRow) container.appendChild(trendRow);

  const a = trackBlock("a", nameA.trim(), e.a, tgt.a, prev.a, draftA, idx);
  const b = trackBlock("b", nameB.trim(), e.b, tgt.b, prev.b, draftB, idx);
  // si mostra solo la traccia del tab attivo (blocco totale: una per volta)
  container.appendChild(supersetTab === "a" ? a.wrap : b.wrap);

  // header serie X/Y riferito alla traccia attiva
  const active = supersetTab === "a" ? a : b;
  const tgtT = supersetTab === "a" ? tgt.a : tgt.b;
  document.getElementById("focusSet").textContent =
    `serie ${Math.min(active.curIdx + 1, tgtT.sets)} / ${tgtT.sets} · ${supersetTab.toUpperCase()}`;

  const cta = document.createElement("button");
  cta.className = "cta"; cta.textContent = "Serie fatta (A+B) · avvia recupero ▸";
  cta.addEventListener("click", () => {
    let nv = withSupersetSet(v, "a", a.curIdx, { reps: draftA.reps, kg: draftA.kg, done: true, feel: e.a.sets[a.curIdx]?.feel ?? "", comments: draftA.comments });
    nv = withSupersetSet(nv, "b", b.curIdx, { reps: draftB.reps, kg: draftB.kg, done: true, feel: e.b.sets[b.curIdx]?.feel ?? "", comments: draftB.comments });
    data = setEntry(data, currentWeek, currentDay, idx, nv, new Date().toISOString());
    persist(idx);
    startRest(getRest(currentDay, idx, ex.restSeconds), ex.name);
    if (isEntryComplete(getEntry(data, currentWeek, currentDay, idx), ex)) {
      openIndex = null; // superset finito → torna alla lista
    }
    render();
  });
  footer.appendChild(cta);
  container.appendChild(buildNoteField(true, idx));
}
```

Nota: la CTA registra entrambe le tracce (A+B) com'era prima; i sotto-tab servono solo a mostrare una traccia per volta per stare senza scroll.

- [ ] **Step 2: Verifica nel browser**

Aprire un superset (es. giorno A "Pushdown tricipiti + Curl manubri", oppure "Crunch a terra + Plank"):
- compaiono i sotto-tab A/B; tocco un tab → mostra solo quella traccia;
- l'header mostra "serie X / Y · A" (o B);
- la CTA "Serie fatta (A+B)" in basso registra entrambe;
- a superset completo (entrambe le tracce) l'overlay si chiude e torna alla lista.

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test 2>&1 | Select-Object -Last 6; Pop-Location
```
Atteso: `pass 104`, `fail 0`.

- [ ] **Step 3: Commit**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git fetch origin; git pull --ff-only origin main
git add app.js
git commit -m "feat(ui): superset a schermo intero con sotto-tab A/B (fase7)"
git push origin main
Pop-Location
```

---

## Task 4: Commento veloce → bottone + popup ad applicazione immediata

**Files:**
- Modify: `app.js` — nuova `buildQuickCommentButton` + `openQcDialog`; sostituzione del blocco chip in `renderFocusNormal` (559-569) e in `trackBlock` (678-688); riuso del popup al posto di `prompt()` per editare serie fatte (righe 540-546 e 658-665).

- [ ] **Step 1: Scrivi `openQcDialog` e `buildQuickCommentButton` (dopo `buildQuickCommentChips`, ~riga 250)**

```js
// Apre il popup tag. selected = array corrente; onChange(nuovoArray) chiamato a ogni tap (applica subito).
function openQcDialog(selected, onChange) {
  const dlg = document.getElementById("qcDialog");
  const opts = document.getElementById("qcOptions");
  const draftSel = selected.slice();
  const paint = () => {
    opts.textContent = "";
    getQuickComments().forEach((text) => {
      const o = document.createElement("button");
      o.type = "button";
      o.className = "qc-opt" + (draftSel.includes(text) ? " on" : "");
      o.textContent = text;
      o.addEventListener("click", () => {
        const i = draftSel.indexOf(text);
        if (i === -1) draftSel.push(text); else draftSel.splice(i, 1);
        onChange(draftSel.slice());   // applica subito
        paint();
      });
      opts.appendChild(o);
    });
    const w = document.createElement("button");
    w.type = "button"; w.className = "qc-opt write"; w.textContent = "＋ scrivi un commento…";
    w.addEventListener("click", () => {
      const t = prompt("Commento:");
      const val = t && t.trim();
      if (val && !draftSel.includes(val)) { draftSel.push(val); onChange(draftSel.slice()); paint(); }
    });
    opts.appendChild(w);
  };
  paint();
  if (!dlg.open) dlg.showModal();
}

// Bottone "commento veloce (n)" + riepilogo tag. onOpen() apre il popup.
function buildQuickCommentButton(selected, onOpen) {
  const wrap = document.createElement("div");
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "qc-btn";
  const lab = document.createElement("span"); lab.textContent = "💬 commento veloce";
  const cnt = document.createElement("span");
  cnt.className = "cnt" + (selected.length ? "" : " zero");
  cnt.textContent = String(selected.length);
  btn.append(lab, cnt);
  btn.addEventListener("click", onOpen);
  wrap.appendChild(btn);
  if (selected.length) {
    const sel = document.createElement("div"); sel.className = "qc-sel";
    selected.forEach((t) => { const s = document.createElement("span"); s.className = "tag"; s.textContent = t; sel.appendChild(s); });
    wrap.appendChild(sel);
  }
  return wrap;
}
```

- [ ] **Step 2: Aggancia chiusura del dialog (una volta, vicino agli altri wiring statici)**

```js
document.getElementById("qcClose").addEventListener("click", () => document.getElementById("qcDialog").close());
document.getElementById("qcDialog").addEventListener("click", (e) => {
  if (e.target.id === "qcDialog") e.target.close(); // tap sul backdrop
});
```

- [ ] **Step 3: Sostituisci i chip inline in `renderFocusNormal`**

Rimpiazzare il blocco (righe ~559-569: da `const qcLabel = ...` fino a `refreshChips();`) con:

```js
  let qcEl;
  const refreshQc = () => {
    const fresh = buildQuickCommentButton(draft.comments, () => {
      openQcDialog(draft.comments, (next) => { draft.comments = next; refreshQc(); });
    });
    if (qcEl) qcEl.replaceWith(fresh); else container.appendChild(fresh);
    qcEl = fresh;
  };
  refreshQc();
```

- [ ] **Step 4: Sostituisci i chip inline in `trackBlock`**

Rimpiazzare il blocco analogo (righe ~678-688) con:

```js
  let qcEl;
  const refreshQc = () => {
    const fresh = buildQuickCommentButton(state.comments, () => {
      openQcDialog(state.comments, (next) => { state.comments = next; refreshQc(); });
    });
    if (qcEl) qcEl.replaceWith(fresh); else wrap.appendChild(fresh);
    qcEl = fresh;
  };
  refreshQc();
```

- [ ] **Step 5: Usa il popup anche per editare i commenti di una serie GIÀ fatta (normale)**

In `renderFocusNormal`, l'ultimo argomento di `setRow` (righe 540-546) oggi usa `prompt()`. Sostituirlo con:

```js
    } : null, set.done ? () => {
      openQcDialog(set.comments ?? [], (next) => {
        data = setEntry(data, currentWeek, currentDay, idx, withSet(v, i, { comments: next }), new Date().toISOString());
        persist(idx); render();
      });
    } : null));
```

- [ ] **Step 6: Usa il popup anche per editare i commenti di una serie già fatta (superset)**

In `trackBlock`, il blocco analogo con `prompt()` (righe 658-665) diventa:

```js
    } : null, set.done ? () => {
      openQcDialog(set.comments ?? [], (next) => {
        const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, idx), trackKey, i, { comments: next });
        data = setEntry(data, currentWeek, currentDay, idx, nv, new Date().toISOString());
        persist(idx); render();
      });
    } : null));
```

- [ ] **Step 7: Verifica nel browser**

- Sotto i feel chip c'è il bottone "💬 commento veloce (n)"; n parte da 0.
- Tap → popup con i tag preset; ogni tap attiva/disattiva il tag e il conteggio sul bottone si aggiorna **subito** (chiudo toccando ✕ o fuori).
- I tag scelti compaiono in piccolo sotto il bottone.
- Salvando la serie i commenti vengono memorizzati; toccando il riepilogo commenti di una serie già fatta si riapre lo stesso popup e la modifica si salva.
- I preset si gestiscono ancora in ⚙ Impostazioni.

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test 2>&1 | Select-Object -Last 6; Pop-Location
```
Atteso: `pass 104`, `fail 0`.

- [ ] **Step 8: Commit**

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git fetch origin; git pull --ff-only origin main
git add app.js
git commit -m "feat(ui): commento veloce in popup ad applicazione immediata (fase7)"
git push origin main
Pop-Location
```

---

## Task 5: Rifinitura "blocco totale" + bump PWA + verifica finale

**Files:**
- Modify: `style.css` (compattazione spaziature dentro l'overlay), `sw.js` (cache v5).

- [ ] **Step 1: Compatta le spaziature dentro l'overlay per far stare tutto senza scroll**

Aggiungere in fondo a `style.css` (override mirati, valgono solo dentro il focus):

```css
.focus-body .sets{margin-top:8px;}
.focus-body .editblock{margin-top:10px;padding:11px;}
.focus-body .rpebar{margin:9px 0 2px;}
.focus-body .qc-btn{margin-top:9px;}
.focus-body .dots{margin-top:11px;}
.focus-body .trend{margin-top:0;}
.focus-body .track-h{margin-bottom:6px;}
```

(Se restano elementi che sforano su schermi molto piccoli, ridurre ulteriormente i `margin`/`padding` qui — NON aggiungere scroll, è una scelta di design.)

- [ ] **Step 2: Assicura che la barra timer resti sopra l'overlay**

Verificare la regola `.timerbar` in `style.css`: deve avere `z-index` maggiore di 40 (l'overlay). Se non ce l'ha o è ≤ 40, aggiungere/alzare:

```css
.timerbar{z-index:60;}
```

(Aggiungere come override in fondo se la regola esistente non è comoda da editare.)

- [ ] **Step 3: Bump cache service worker**

In `sw.js` riga 5:

```js
const CACHE = "gymsched-v5";
```

- [ ] **Step 4: Verifica finale completa nel browser**

Percorso completo:
- esercizio normale: apri → fit senza scroll → completa tutte le serie → auto-close;
- superset: apri → sotto-tab A/B → fit senza scroll su entrambe → completa → auto-close;
- popup commenti applica subito + riepilogo + edit serie fatta;
- ← chiude sempre; la lista dietro non scrolla mai mentre l'overlay è aperto;
- avvia un recupero (timer) e verifica che la barra timer sia visibile sopra l'overlay;
- nessun errore in console.

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule; node --test 2>&1 | Select-Object -Last 6; Pop-Location
```
Atteso: `pass 104`, `fail 0`.

- [ ] **Step 5: Rimuovi il mockup temporaneo e committa tutto**

Il mockup `mockups/fase7/index.html` era stato forzato in git solo per il test su mobile: va rimosso dal tracking (resta in locale, è comunque gitignored).

```powershell
Push-Location C:\Users\TomasCoro\gym-schedule
git fetch origin; git pull --ff-only origin main
git rm --cached mockups/fase7/index.html
git add style.css sw.js
git commit -m "feat(ui): rifinitura blocco totale + cache v5; togli mockup dal tracking (fase7)"
git push origin main
Pop-Location
```

- [ ] **Step 6: Aggiorna la memory**

Aggiornare `gym-schedule-phases.md` con "Fase 7 completata" (overlay focus a schermo intero, sotto-tab superset A/B, popup commenti, cache v5) e la riga indice in `MEMORY.md`.

---

## Self-Review (compilato dall'autore del piano)

**Spec coverage:**
- Focus a schermo intero + scroll bloccato → Task 2 (normale) + Task 3 (superset) + Task 1 (overlay/CSS).
- Uscita ← + auto a fine → Task 2 step 4-5, Task 3 step 1.
- Superset sotto-tab A/B → Task 3.
- Popup commenti "applica subito" + conteggio + riepilogo + edit serie fatta + preset in Impostazioni → Task 4.
- Footer CTA ancorato / fit senza scroll → Task 1 (layout flex) + Task 5 (compattazione).
- Bump `sw.js` v5 → Task 5.
- Nessuna modifica al modello dati → rispettata (solo rendering/wiring).

**Placeholder scan:** nessun TODO/TBD; ogni step ha codice o comando concreto.

**Type/identifier consistency:** `openIndex`, `supersetTab`, `renderFocusOverlay`, `renderFocusNormal(ex,idx,container,footer)`, `renderFocusSuperset(ex,idx,container,footer)`, `buildQuickCommentButton(selected,onOpen)`, `openQcDialog(selected,onChange)`, id DOM `focusOverlay/focusBody/focusFoot/focusName/focusSet/focusBack/qcDialog/qcOptions/qcClose` coerenti tra HTML, CSS e tutti i task. Funzioni esistenti riusate con firme invariate: `setEntry`, `withSet`, `withSupersetSet`, `getEntry`, `persist`, `startRest`, `isEntryComplete`, `getQuickComments`, `toggleComment`, `previousSupersetSets`, `buildTrendRow`, `trackBlock`.
