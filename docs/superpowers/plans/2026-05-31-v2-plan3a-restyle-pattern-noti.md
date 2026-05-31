# V2 Piano 3a — Restyle schermate a "pattern noto" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare focus/logging (= sessione guidata), righe Home (sparkline + `› log`), Nutrizione, i dialog e le Impostazioni all'estetica Amber CRT già fissata in Piano 2, senza cambiare il comportamento funzionale.

**Architecture:** Lavoro CSS-heavy. Si ri-skinnano le classi DOM già prodotte dai renderer esistenti aggiungendo blocchi di override **in coda a `style.css`** (vincono per cascade, identico approccio a Piano 2 Task 4). Le uniche modifiche JS sono: (a) `renderList` aggiunge una sparkline SVG (riusando la funzione pura **già testata** `chartGeometry`) e un bottone `› log` per riga; (b) `renderFocusOverlay` popola una status bar; (c) il markup della `sv-body` Impostazioni passa da card a righe `key:value` preservando tutti gli id. Nessun nuovo modulo logico, nessun tocco a store/sync/auth/supabase/session/timer.

**Tech Stack:** Vanilla JS (ESM), CSS custom properties (token Amber CRT già in `style.css:1-21`), `node --test` (nessun DOM harness → le parti JS si verificano a vista contro i mockup), service worker cache versionata. Nessuna libreria nuova.

**Riferimenti:**
- Spec: `docs/superpowers/specs/2026-05-31-v2-plan3a-restyle-pattern-noti-design.md`.
- Mockup approvati (Visual Companion, persistono in `.superpowers/brainstorm/9794-1780261882/content/`): `03-esercizio.html` (focus/logging), `04-resto-3a.html` (nutrizione, sessione, dialog, impostazioni).
- Mockup Home di Piano 2: `mockups/v2-amber-crt/home.html` (righe con sparkline + `› log`).

**Server di anteprima:** un server statico può girare su `http://localhost:8123/` (root = repo). Se serve: `Start-Process -WindowStyle Hidden python -ArgumentList "-m","http.server","8123"`. L'app reale richiede login Supabase; per le viste loggabili solo localmente si confronta col mockup e si verifica dove possibile. La verifica E2E mobile completa resta a carico dell'utente.

**Nota su TDD:** la suite non ha un DOM (jsdom/happy-dom) → i renderer (`renderList`, focus, nutrition) **non** sono unit-testabili. La sola logica pura toccata è `chartGeometry`, **già coperta** dai test esistenti. Quindi: per ogni task la garanzia di non-regressione è "suite resta verde" + "verifica visiva contro il mockup". Non si inventano test DOM fittizi.

**Selettori reali già mappati (per evitare CSS a vuoto):**
- `renderList` (app.js:1884): `.item`(`.done`/`.open`) › `.r` › `.id`, `.mid`›(`.nm`(+`.ssbadge`), `.sub`(+`.ult`)), `.right`›(`.chk` | `.best`+`.bl`, +`.rec-badge`), `.caret`. **Nessun** `.ex-foot` oggi: va aggiunto.
- `setRow` (app.js:1416): `.srow`(`.cur`/`.warm`) › `.i`, `.v`(`.x .u .svol`), `.tag`(`.down`), `.chk`, `.rpe`(+feel/`.fail`), `.rm`, `.cmt`(`.fail-note`), `.editset`, `.wbadge`.
- `buildEditBlock` (app.js:970): `.editblock` › `.editlabel`, `.stepper`›(`.mb`, `.val`›(`.num`,`.u`), `.mb`), `.plates`.
- `buildTrendRow` (953): `.trend` › span(`.cur`)›(`.tw`,`.tk`). `buildNextStrip` (1958): `.nextstrip` › `.nx-target`. Inoltre `.dots .dt`(`.on/.cur/.warm`), `.addset`(`.warm`), `.fail-link`, `.restedit`(`.rl/.rstep/.rval`).
- Overlay focus (index.html:194): `.focus-ov .focus-top .focus-back .focus-id .fn .fs .focus-body .focus-foot`, `#focusName #focusSet #chartBtn`.
- `nutrition.js`: `.nutri-intro`, `.acc`(`.open`) › `.acc-h`›(`.ic`,`.ti`,`.cv`) + `.acc-c`; blocchi `p.muted`, `ul/li`, `.tip`, `.meal`(`.key`)›(`.mh`(+`.time`), `.mt`); `.nutri-foot`.
- Dialog (index.html:251-329): `.qc-dialog .qc-head .qc-x .qc-options`; `.set-dialog .modal-h .t .x .editlabel .confirm .acts .danger .failtoggle .failnote`; `.ex-dialog .ex-inp .notifyrow`.
- Impostazioni (index.html:96-188): `.settings-v2-host .settings-v2 .sv-head .sv-title .sv-x .sv-body .sv-card .sv-card-h .sv-card-t .sv-email .sv-row-2 .sv-mini .sv-grid-2 .sv-field .sv-qclist .sv-add .sv-toggle .sv-toggle-ic .sv-toggle-lbl .sv-switch .sv-switch-track .sv-details .sv-recovery .sv-block .sv-hint .sv-foot .sv-pill`. Id da preservare: `barInput platesInput notifyToggle fxGlowToggle fxScanToggle btnLogout btnForceUpdate qcList qcInput qcAdd accountEmail btnRecoverCloud btnImportLegacy settingsClose`.

---

## File Structure

- **Modify `app.js`** — `renderList` (sparkline + `› log`); import di `chartGeometry`; `renderFocusOverlay` popola la status bar focus.
- **Modify `index.html`** — status bar dentro `#focusOverlay`; rifacimento markup `sv-body` Impostazioni in righe `key:value` (id preservati).
- **Modify `style.css`** — blocchi di override in coda: righe Home (`.ex-foot/.spark/.logbtn`), focus/logging, nutrizione accordion, dialog, Impostazioni terminale.
- **Modify `sw.js`** — bump cache `gymsched-v44` → `gymsched-v45`.

Ogni task = un cambiamento autocontenuto e committabile.

---

## Task 1: Righe Home — sparkline + bottone `› log`

I due dettagli rimandati da Piano 2. La sparkline riusa la funzione pura **già testata** `chartGeometry` (session.js:365), evitando geometria duplicata.

**Files:**
- Modify: `app.js` (import; `renderList` app.js:1884-1935)
- Modify: `style.css` (append)

- [ ] **Step 1: Importare `chartGeometry` in app.js**

Trova l'import da `./session.js` (app.js:14-20, il blocco che importa `sessionVolume, volumeByMuscle, exerciseTrend, nextExercisePreview, …`) e aggiungi `chartGeometry` alla lista dei nomi importati. Esempio (adatta alla riga reale):

```js
  sessionVolume, volumeByMuscle, exerciseTrend, nextExercisePreview, chartGeometry,
```

- [ ] **Step 2: Aggiungere il piede riga (sparkline + `› log`) in `renderList`**

In `renderList` (app.js:1884), **dopo** `item.appendChild(r);` (riga 1932) e **prima** di `root.appendChild(item);` (riga 1933), inserisci:

```js
    // Piede riga: sparkline (storico top-set) + azione log esplicita.
    const foot = document.createElement("div");
    foot.className = "ex-foot";
    const exIdF = exIdAt(i);
    const trend = exerciseTrend(data, currentDay, exIdF, currentWeek, 4, !!ex.superset);
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "spark");
    svg.setAttribute("height", "18");
    svg.setAttribute("width", "100%");
    svg.setAttribute("viewBox", "0 0 120 18");
    svg.setAttribute("preserveAspectRatio", "none");
    if (trend.length >= 2) {
      const geo = chartGeometry(trend, { width: 120, height: 18, padX: 2, padTop: 3, padBottom: 3, padRight: 4 });
      const pl = document.createElementNS(NS, "polyline");
      pl.setAttribute("points", geo.points.map((p) => `${p.x},${p.y}`).join(" "));
      pl.setAttribute("fill", "none");
      pl.setAttribute("stroke", "var(--ac2)");
      pl.setAttribute("stroke-width", "1.5");
      svg.appendChild(pl);
      const last = geo.points[geo.points.length - 1];
      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", String(last.x)); dot.setAttribute("cy", String(last.y));
      dot.setAttribute("r", "2.2"); dot.setAttribute("fill", "var(--acc)");
      svg.appendChild(dot);
    } else {
      const pl = document.createElementNS(NS, "polyline");
      pl.setAttribute("points", "2,9 60,9 118,9");
      pl.setAttribute("fill", "none"); pl.setAttribute("stroke", "var(--ctc)"); pl.setAttribute("stroke-width", "1.5");
      svg.appendChild(pl);
    }
    const logbtn = document.createElement("button");
    logbtn.type = "button";
    logbtn.className = "logbtn" + (isComplete(i) ? " fulldone" : "");
    logbtn.textContent = isComplete(i) ? "✓ fatto" : "› log";
    logbtn.addEventListener("click", (e) => { e.stopPropagation(); openFocus(i); });
    foot.append(svg, logbtn);
    item.appendChild(foot);
```

(Usa `currentWeek` come nel resto di `renderList` — vedi righe 1904-1911. `openFocus(i)` è già l'handler della riga, riga 1893. `chartGeometry` ritorna `{points:[{x,y,week,kg}]}` su scala min/max dei dati.)

- [ ] **Step 3: CSS del piede riga (append in fondo a `style.css`)**

```css
/* ===== Piano 3a — righe Home: piede con sparkline + log ===== */
.item .ex-foot{ display:flex; align-items:center; gap:10px; padding:0 12px 11px 12px; }
.item .ex-foot .spark{ flex:1; height:18px; display:block; }
.item .ex-foot .logbtn{
  background:var(--ctb); border:1px solid var(--ctc); color:var(--acc);
  font-family:var(--mono); font-size:12px; border-radius:7px; padding:6px 13px;
  letter-spacing:.04em; cursor:pointer; flex:0 0 auto;
}
.item .ex-foot .logbtn.fulldone{ background:transparent; color:var(--dim); border-color:var(--line); }
```

- [ ] **Step 4: Suite verde**

Run: `node --test`
Expected: PASS — 255 test, 0 fail (nessun modulo logico toccato; `chartGeometry` invariata).

- [ ] **Step 5: Verifica visiva**

Apri l'app reale (o, senza login, confronta col mockup `mockups/v2-amber-crt/home.html`): ogni riga esercizio mostra sotto al nome una sparkline ambra (punto finale `--acc`) e un bottone `› log` (o `✓ fatto` se completato). Tap su `› log` apre il focus dell'esercizio, identico al tap sulla riga. Esercizi senza storico → tratto piatto attenuato senza punto.

- [ ] **Step 6: Commit**

```bash
git add app.js style.css
git commit -m "feat(home): sparkline storico + bottone › log per riga esercizio"
```

---

## Task 2: Focus / logging restyle (= sessione guidata)

Status bar in cima + re-skin delle classi interne verso `03-esercizio.html`. Solo CSS in coda + una status bar (markup statico popolato da JS). I renderer (`renderFocusNormal/Superset`) e il comportamento **non cambiano**.

**Files:**
- Modify: `index.html` (`#focusOverlay`, riga 194)
- Modify: `app.js` (`renderFocusOverlay`, riga 1995)
- Modify: `style.css` (append)

- [ ] **Step 1: Aggiungere la status bar nel markup del focus (index.html)**

In `#focusOverlay` (index.html:194), **subito dopo** `<div id="focusOverlay" …>` e **prima** di `<header class="focus-top">`, inserisci:

```html
    <div class="sbar focus-sbar">
      <span class="l" id="focusSbarCtx">◈ LOG</span>
      <span id="focusSbarCount">—</span>
    </div>
```

(`.sbar` è già definito in `style.css` da Piano 2 Task 4: si riusa.)

- [ ] **Step 2: Popolare la status bar in `renderFocusOverlay` (app.js)**

In `renderFocusOverlay` (app.js:1995), dopo che `ex`/`openIndex` sono noti e validi (cioè dopo il guard `if (!ex) { … return; }` alla riga ~2008, dove `openIndex` è l'indice valido), aggiungi:

```js
  const exsForBar = dayPlan().exercises;
  const ctxEl = document.getElementById("focusSbarCtx");
  const cntEl = document.getElementById("focusSbarCount");
  if (ctxEl) ctxEl.textContent = `◈ LOG · ${currentDay}`;
  if (cntEl) cntEl.textContent = `ex ${String(openIndex + 1).padStart(2, "0")}/${exsForBar.length} · ${currentWeek.split("-").pop()}`;
```

(Adatta il riferimento alla lista esercizi: in `renderFocusOverlay` esiste già un modo per ottenere `exercises`/`ex` — usa quello in scope. `dayPlan()` è l'helper usato altrove, es. `renderList` riga 1887.)

- [ ] **Step 3: CSS restyle focus (append in `style.css`)**

```css
/* ===== Piano 3a — Focus / logging (vs 03-esercizio.html) ===== */
.focus-ov .focus-sbar{ margin:0 0 8px; border-radius:0; border:none; border-bottom:1px solid var(--line); }
.focus-top{ display:flex; align-items:center; gap:10px; margin-bottom:6px; }
.focus-back{ color:var(--ac2); background:none; border:none; font-size:18px; cursor:pointer; }
.focus-id .fn{ color:var(--tx); font-size:16px; }
.focus-id .fs{ color:var(--dim); font-size:10px; letter-spacing:.08em; margin-top:1px; }
.focus-chart{ color:var(--ac2); background:none; border:none; font-size:15px; }

/* box target (trend è la riga storico, riusata come "ultima volta") */
.trend{ background:var(--surf); border:1px solid var(--line); border-radius:8px; padding:10px 12px; margin:6px 0 12px;
  display:flex; gap:14px; font-size:11px; color:var(--dim); }
.trend .tw{ color:var(--dim); } .trend .tk{ color:var(--tx); margin-left:4px; }
.trend .cur .tk{ color:var(--ac2); }

/* serie come righe */
.srow{ display:flex; align-items:center; gap:10px; padding:9px 12px; border:1px solid var(--line);
  border-radius:7px; margin-bottom:7px; font-size:13px; background:var(--surf); }
.srow .i{ color:var(--dim); min-width:22px; }
.srow .v{ color:var(--tx); flex:1; } .srow .v .u, .srow .v .x{ color:var(--dim); } .srow .v .svol{ color:var(--ac2); font-size:11px; }
.srow.cur{ border-color:var(--ctc); }
.srow .chk{ color:var(--ok); }
.srow .rpe{ color:var(--ac2); font-size:11px; } .srow .rpe.fail{ color:var(--down); }
.srow .tag{ color:var(--ok); font-size:11px; } .srow .tag.down{ color:var(--down); }
.srow .editset, .srow .rm{ color:var(--dim); cursor:pointer; }
.srow .wbadge{ color:var(--ac2); font-size:9px; letter-spacing:.1em; }
.srow .cmt{ flex-basis:100%; color:var(--dim); font-size:11px; } .srow .cmt.fail-note{ color:var(--down); }

/* blocco serie attiva = editblock */
.editblock{ border:1px solid var(--ctc); background:var(--ctb); border-radius:8px; padding:12px; margin:10px 0; }
.editblock .editlabel{ font-size:10px; color:var(--ac2); letter-spacing:.12em; text-transform:uppercase; }
.editblock .stepper{ display:flex; align-items:stretch; gap:0; margin-top:9px; }
.editblock .stepper .mb{ width:54px; min-width:54px; height:40px; display:flex; align-items:center; justify-content:center;
  background:var(--field); border:1px solid var(--ctc); color:var(--acc); font-family:var(--mono); font-size:13px; cursor:pointer; user-select:none; }
.editblock .stepper .mb:first-child{ border-radius:7px 0 0 7px; }
.editblock .stepper .mb:last-child{ border-radius:0 7px 7px 0; }
.editblock .stepper .val{ flex:1; display:flex; align-items:center; justify-content:center; height:40px;
  background:#100c06; border-top:1px solid var(--ctc); border-bottom:1px solid var(--ctc); }
.editblock .stepper .val .num{ width:64px; text-align:center; background:transparent; border:none; color:var(--tx); font-family:var(--mono); font-size:18px; }
.editblock .stepper .val .u{ color:var(--dim); font-size:11px; }
.editblock .plates{ color:var(--dim); font-size:11px; margin-top:6px; }

/* chip ripeti, fail link, dots, addset, next strip */
.repstep, .repchip{ background:var(--surf); border:1px solid var(--line); border-radius:6px; color:var(--ink); }
.fail-link{ background:none; border:none; color:var(--down); font-family:var(--mono); font-size:12px; margin-top:8px; cursor:pointer; }
.dots{ display:flex; gap:5px; margin:10px 0; } .dots .dt{ width:7px; height:7px; border-radius:50%; background:var(--line); }
.dots .dt.on{ background:var(--ac2); } .dots .dt.cur{ background:var(--acc); } .dots .dt.warm{ background:var(--ctc); }
.addset{ background:var(--ctb); border:1px solid var(--ctc); color:var(--acc); border-radius:7px; padding:7px 12px; font-family:var(--mono); font-size:12px; cursor:pointer; }
.addset.warm{ color:var(--ac2); }
.nextstrip{ border:1px dashed var(--ctc); border-radius:8px; padding:10px 12px; color:var(--fg); font-size:12px; margin-top:10px; }
.nextstrip .nx-target{ color:var(--tx); }
.restedit{ display:flex; align-items:center; gap:8px; color:var(--dim); font-size:12px; margin-top:8px; }
.restedit .rstep{ background:var(--surf); border:1px solid var(--line); color:var(--acc); border-radius:6px; padding:3px 8px; cursor:pointer; }
.restedit .rval{ color:var(--tx); }
```

(La CTA "registra serie" è renderizzata dal blocco edit/quick-comment: se la sua classe non è coperta sopra, verificarne il nome in `buildEditBlock`/dintorni e aggiungere una regola coerente con `.regbtn` del mockup — sfondo `--ctb`, bordo `--acc`, testo `--acc`. Questo è l'unico selettore da confermare a vista.)

- [ ] **Step 4: Suite verde**

Run: `node --test`
Expected: PASS — 255 test (solo CSS + status bar DOM-side).

- [ ] **Step 5: Verifica visiva vs `03-esercizio.html`**

Apri il focus di un esercizio nell'app reale e confronta col mockup: status bar `◈ LOG · <giorno>` + contatore a destra; box target/storico; serie come righe (`s1 ✓`, feel a destra); serie attiva in box `--ctb` con stepper `−/+` e valore centrale; CTA registra a piena larghezza; piede "prossimo". Itera i valori CSS finché coerente (spirito del mockup, non pixel-perfect). Verifica anche un esercizio **superset** (renderer diverso, stesse classi) e uno **a tempo** (`sec`).

- [ ] **Step 6: Commit**

```bash
git add index.html app.js style.css
git commit -m "feat(focus): restyle CRT logging/sessione (status bar, serie-righe, stepper, prossimo)"
```

---

## Task 3: Nutrizione — accordion CRT

Solo CSS sulle classi prodotte da `nutrition.js` (mappate sopra). Contenuto e logica invariati.

**Files:**
- Modify: `style.css` (append)

- [ ] **Step 1: CSS accordion nutrizione (append in `style.css`)**

```css
/* ===== Piano 3a — Nutrizione accordion (vs 04-resto-3a.html) ===== */
.nutri-body .nutri-intro{ color:var(--dim); font-size:12px; line-height:1.55; margin-bottom:12px; }
.nutri-body .nutri-intro b{ color:var(--ac2); }
.nutri-body .acc{ border:1px solid var(--line); border-radius:8px; margin-bottom:8px; background:var(--surf); overflow:hidden; }
.nutri-body .acc-h{ display:flex; align-items:center; gap:8px; padding:11px 12px; font-size:13px; color:var(--tx); cursor:pointer; }
.nutri-body .acc-h .ic{ font-size:14px; }
.nutri-body .acc-h .ti{ flex:1; }
.nutri-body .acc-h .cv{ color:var(--ac2); transition:transform .15s; }
.nutri-body .acc:not(.open) .acc-h .cv{ transform:rotate(-90deg); }
.nutri-body .acc-c{ padding:0 12px 12px; font-size:12px; color:var(--fg); line-height:1.55; }
.nutri-body .acc:not(.open) .acc-c{ display:none; }
.nutri-body .acc-c b{ color:var(--tx); }
.nutri-body .acc-c p.muted{ color:var(--dim); margin-bottom:8px; }
.nutri-body .acc-c ul{ margin:4px 0 4px 16px; } .nutri-body .acc-c li{ margin:3px 0; }
.nutri-body .acc-c .tip{ border-left:2px solid var(--ctc); padding:6px 10px; margin-top:8px; color:var(--ac2); background:#0e0b07; border-radius:0 6px 6px 0; }
.nutri-body .meal{ border-top:1px solid var(--line); padding-top:9px; margin-top:9px; }
.nutri-body .meal .mh{ color:var(--tx); font-size:12px; } .nutri-body .meal .mh .time{ color:var(--ac2); font-size:10px; margin-left:6px; }
.nutri-body .meal .mt{ color:var(--fg); font-size:11px; margin-top:2px; }
.nutri-body .meal.key{ background:#1c1608; border:1px solid var(--ctc); border-radius:7px; padding:9px 10px; }
.nutri-body .meal.key .mh{ color:var(--acc); }
.nutri-body .nutri-foot{ color:var(--dim); font-size:10px; letter-spacing:.08em; margin-top:12px; text-align:center; }
```

(Il toggle apri/chiudi usa la classe `open` su `.acc`, già gestita da `renderSection`. Le regole `:not(.open)` qui rispettano quel comportamento senza JS nuovo.)

- [ ] **Step 2: Suite verde**

Run: `node --test`
Expected: PASS — 255 test.

- [ ] **Step 3: Verifica visiva vs `04-resto-3a.html` (riquadro nutrizione)**

Apri la guida (drawer → 🥗). Sezioni a box, freccia `▾`/`▸` su apri/chiudi, "I principi" aperta di default; nel "Giorno di palestra" lo **★ Spuntino** evidenziato come box `--ctb`; footer `guida statica`. Apri/chiudi funziona.

- [ ] **Step 4: Commit**

```bash
git add style.css
git commit -m "feat(nutri): accordion Amber CRT (sezioni a box, pasto-chiave evidenziato)"
```

---

## Task 4: Dialog (qc / set / ex) — restyle CRT

Solo CSS, markup invariato. Verso `04-resto-3a.html` (dialog esercizio).

**Files:**
- Modify: `style.css` (append)

- [ ] **Step 1: CSS dialog (append in `style.css`)**

```css
/* ===== Piano 3a — Dialog CRT (vs 04-resto-3a.html) ===== */
.set-dialog, .qc-dialog{ background:var(--surf); border:1px solid var(--ctc); border-radius:10px; color:var(--ink);
  font-family:var(--mono); padding:14px; max-width:380px; }
.set-dialog::backdrop, .qc-dialog::backdrop{ background:#000a; }
.modal-h, .qc-head{ display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
.modal-h .t, .qc-head h2{ color:var(--tx); font-size:15px; font-weight:700; }
.modal-h .t::before, .qc-head h2::before{ content:"$ "; color:var(--ac2); }
.modal-h .x, .qc-x{ color:var(--dim); background:none; border:none; font-size:16px; cursor:pointer; }
.editlabel{ font-size:10px; color:var(--ac2); letter-spacing:.08em; text-transform:uppercase; margin:10px 0 4px; }
.ex-inp, .set-dialog input, .set-dialog select, .set-dialog textarea{
  width:100%; background:var(--field); border:1px solid var(--line); border-radius:7px;
  padding:9px 11px; color:var(--tx); font-family:var(--mono); font-size:13px; }
.ex-inp::placeholder, .set-dialog input::placeholder{ color:var(--dim); }
.confirm{ width:100%; margin-top:14px; background:var(--ctb); border:1px solid var(--acc); color:var(--acc);
  font-family:var(--mono); font-size:14px; padding:10px; border-radius:8px; letter-spacing:.05em; cursor:pointer; }
.failtoggle{ background:none; border:1px solid var(--line); color:var(--down); border-radius:7px; padding:7px 10px; font-family:var(--mono); cursor:pointer; }
.failnote{ margin-top:8px; }
.acts{ display:flex; gap:8px; margin-top:10px; }
.acts button{ flex:1; background:var(--surf); border:1px solid var(--line); color:var(--ink); border-radius:7px; padding:8px; font-family:var(--mono); cursor:pointer; }
.acts .danger{ color:var(--down); border-color:var(--ctc); }
.notifyrow{ display:flex; align-items:center; gap:8px; color:var(--ink); font-size:12px; margin:10px 0; }
.qc-options{ display:flex; flex-wrap:wrap; gap:7px; }
.qc-options button{ background:var(--surf); border:1px solid var(--line); color:var(--ink); border-radius:7px; padding:7px 11px; font-family:var(--mono); font-size:12px; cursor:pointer; }
.qc-options button.on{ background:var(--ctb); border-color:var(--ctc); color:var(--acc); }
.hint{ color:var(--dim); font-size:11px; margin-bottom:10px; }
```

(`<select>`/`<textarea>` ereditano lo stile input. Verificare a vista il contrasto delle `<option>` native: se illeggibili su qualche browser, è un limite del rendering nativo, non bloccante.)

- [ ] **Step 2: Suite verde**

Run: `node --test`
Expected: PASS — 255 test.

- [ ] **Step 3: Verifica visiva**

Apri: (a) dialog **aggiungi esercizio** (editor → + esercizio) — header `$ Esercizio`, label `# campo`, input scuri, CTA `✓ Salva`; (b) dialog **commento veloce** (durante una serie) — tag come chip; (c) dialog **modifica serie** (✎ su una serie fatta) — campi + `✗ Non riuscita` + azioni. Confronta col mockup dialog.

- [ ] **Step 4: Commit**

```bash
git add style.css
git commit -m "feat(dialog): restyle CRT per qc/set/ex (header $, label #, input field, CTA ✓)"
```

---

## Task 5: Impostazioni — righe terminale `key:value`

Rifacimento del markup `sv-body` da card a righe `# chiave : valore` per sezione, **preservando tutti gli id e gli handler**. Variante approvata in `04-resto-3a.html`.

**Files:**
- Modify: `index.html` (`sv-body`, righe 103-188)
- Modify: `style.css` (append)

- [ ] **Step 1: Sostituire il contenuto di `.sv-body` (index.html)**

Rimpiazza il blocco `<div class="sv-body"> … </div>` (da riga 103 `<div class="sv-body">` fino alla sua chiusura, riga ~188, **prima** di `<footer class="sv-foot">`) con il seguente. Mantiene **identici** tutti gli `id` (gli handler in app.js continuano a funzionare); cambia solo l'impaginazione in righe `key:value`:

```html
        <div class="sv-body sv-term">
          <div class="sv-sec">account</div>
          <div class="sv-line">
            <span class="k">email</span>
            <span class="v"><span id="accountEmail">…</span> <button type="button" id="btnLogout" class="sv-tag">esci</button></span>
          </div>
          <div class="sv-line">
            <span class="k">app</span>
            <span class="v"><button type="button" id="btnForceUpdate" class="sv-tag">🔄 aggiorna</button></span>
          </div>

          <div class="sv-sec">attrezzatura</div>
          <div class="sv-line">
            <span class="k">bilanciere kg</span>
            <span class="v"><input id="barInput" type="number" inputmode="decimal" step="0.5" min="0" placeholder="20" class="sv-inp"></span>
          </div>
          <div class="sv-line">
            <span class="k">dischi / lato</span>
            <span class="v"><input id="platesInput" type="text" inputmode="decimal" placeholder="20, 15, 10, 5" class="sv-inp"></span>
          </div>

          <div class="sv-sec">commenti veloci</div>
          <div id="qcList" class="sv-qclist"></div>
          <div class="sv-add qc-add">
            <input id="qcInput" type="text" placeholder="nuovo commento…" autocomplete="off">
            <button type="button" id="qcAdd">+</button>
          </div>

          <div class="sv-sec">interfaccia</div>
          <label class="sv-line sv-linetoggle">
            <span class="k">notifica recupero</span>
            <span class="v sv-switch"><input type="checkbox" id="notifyToggle"><span class="sv-switch-track"></span></span>
          </label>
          <label class="sv-line sv-linetoggle">
            <span class="k">bagliore glow</span>
            <span class="v sv-switch"><input type="checkbox" id="fxGlowToggle"><span class="sv-switch-track"></span></span>
          </label>
          <label class="sv-line sv-linetoggle">
            <span class="k">scanline crt</span>
            <span class="v sv-switch"><input type="checkbox" id="fxScanToggle"><span class="sv-switch-track"></span></span>
          </label>

          <details class="sv-card sv-details">
            <summary>
              <span class="sv-toggle-ic">🛟</span>
              <span class="sv-toggle-lbl">Recupero dati</span>
              <span class="sv-chev">›</span>
            </summary>
            <div class="sv-recovery">
              <button type="button" id="btnRecoverCloud" class="sv-block">☁️ Recupera log dal vecchio cloud</button>
              <button type="button" id="btnImportLegacy" class="sv-block">🆘 Importa dati locali (vecchio formato)</button>
              <p class="sv-hint">Usa solo se vedi la scheda vuota dopo l'aggiornamento Supabase. "Recupera cloud" unisce i log storici da data.json senza cancellare i nuovi.</p>
            </div>
          </details>
        </div>
```

(Tutti gli id richiesti dagli handler sono presenti: `accountEmail btnLogout btnForceUpdate barInput platesInput qcList qcInput qcAdd notifyToggle fxGlowToggle fxScanToggle btnRecoverCloud btnImportLegacy`. Il `.sv-switch`/`.sv-switch-track` resta per i toggle. Il `<details>` recupero resta com'era — già coerente.)

- [ ] **Step 2: CSS Impostazioni terminale (append in `style.css`)**

```css
/* ===== Piano 3a — Impostazioni stile terminale (vs 04-resto-3a.html) ===== */
.sv-term .sv-sec{ font-size:9px; color:var(--dim); letter-spacing:.14em; text-transform:uppercase; margin:14px 0 6px; }
.sv-term .sv-sec:first-child{ margin-top:0; }
.sv-term .sv-line{ display:flex; align-items:center; justify-content:space-between; gap:10px;
  border:1px solid var(--line); border-radius:7px; background:var(--surf); padding:10px 12px; margin-bottom:7px; font-size:12px; }
.sv-term .sv-line .k{ color:var(--ac2); } .sv-term .sv-line .k::before{ content:"# "; color:var(--dim); }
.sv-term .sv-line .v{ color:var(--tx); display:flex; align-items:center; gap:8px; justify-content:flex-end; text-align:right; }
.sv-term .sv-tag{ border:1px solid var(--ctc); border-radius:6px; padding:3px 9px; color:var(--acc); background:var(--ctb); font-family:var(--mono); font-size:11px; cursor:pointer; }
.sv-term .sv-inp{ width:120px; background:var(--field); border:1px solid var(--line); border-radius:6px; color:var(--tx); font-family:var(--mono); font-size:12px; padding:5px 8px; text-align:right; }
.sv-term .sv-qclist{ display:flex; flex-wrap:wrap; gap:6px; margin-bottom:7px; }
.sv-term .qc-add{ display:flex; gap:7px; } .sv-term .qc-add input{ flex:1; background:var(--field); border:1px solid var(--line); border-radius:6px; color:var(--tx); font-family:var(--mono); padding:6px 9px; }
.sv-term .qc-add button{ background:var(--ctb); border:1px solid var(--ctc); color:var(--acc); border-radius:6px; width:34px; cursor:pointer; }
```

(Lo `.sv-switch`/`.sv-switch-track` resta quello di Piano 1/2: i toggle continuano a funzionare. Se visivamente vuoi i toggle come `[on]/[off]` testuali, è opzionale e fuori dal minimo — gli switch attuali sono già coerenti col tema. Tienili a switch per non toccare il CSS dello switch.)

- [ ] **Step 3: Suite verde**

Run: `node --test`
Expected: PASS — 255 test (markup statico; nessun id rimosso).

- [ ] **Step 4: Verifica funzionale + visiva**

Apri Impostazioni (⚙). Verifica che **tutto funzioni ancora**: cambio bilanciere/dischi, aggiunta commento veloce, toggle notifica/glow/scanline (effetto live), Esci, Forza aggiornamento, Recupero dati (apri il `<details>`). Layout a righe `# chiave : valore` con sezioni. Confronta col mockup. (Gli id preservati garantiscono che gli handler `addEventListener` in app.js trovino i nodi.)

- [ ] **Step 5: Commit**

```bash
git add index.html style.css
git commit -m "feat(settings): impostazioni in righe terminale key:value (id/handler preservati)"
```

---

## Task 6: Bump cache SW + verifica finale + push

**Files:**
- Modify: `sw.js` (riga 5)

- [ ] **Step 1: Bump versione cache**

In `sw.js` riga 5, cambia `const CACHE = "gymsched-v44";` → `const CACHE = "gymsched-v45";`.

- [ ] **Step 2: Suite completa verde**

Run: `node --test`
Expected: PASS — 255 test, 0 fail. Annota il numero esatto.

- [ ] **Step 3: Console pulita**

Con il server attivo, ricarica l'app reale: nessun errore in console (in particolare nessun errore di import `chartGeometry`, nessun `getElementById(...).addEventListener` su null in Impostazioni).

- [ ] **Step 4: Commit + push**

```bash
git add sw.js
git commit -m "chore(sw): bump cache v45 per Piano 3a (restyle pattern noti)"
git fetch origin
git pull --ff-only
git push
```

- [ ] **Step 5: Aggiornare la memoria di progetto**

Aggiorna `gym-schedule-v2-restyle.md` nella memory: Piano 3a (focus/logging, sparkline+log Home, nutrizione, dialog, impostazioni terminale) FATTO; resta Piano 3b (Timer, Progressione, Editor, Calendario — mockup-first) + verifica E2E mobile. Segna nuovo HEAD e cache v45.

---

## Self-Review

**Spec coverage (§ spec → task):**
- §2 #1 Esercizio/logging + Sessione guidata → Task 2. ✓
- §2 #2 sparkline + `› log` righe Home → Task 1. ✓
- §2 #3 Nutrizione accordion → Task 3. ✓
- §2 #4 Dialog qc/set/ex → Task 4. ✓
- §2 #5 Impostazioni terminale (id preservati) → Task 5. ✓
- §5 `sw.js` bump v45 → Task 6. ✓
- §6 testing (suite verde, no test DOM fittizi, verifica visiva) → ogni task Step "Suite verde" + "Verifica visiva". ✓
- §7 sequenza build ①…⑦ → Task 1→6 (sessione guidata assorbita in Task 2 come da §4.1). ✓
- §8 fuori scope (3b: Timer/Progressione/Editor/Calendario) → non pianificati qui. ✓

**Placeholder scan:** nessun TBD/TODO. Due selettori sono dichiarati "da confermare a vista" (la classe CTA "registra serie" in Task 2 Step 3; le `<option>` native in Task 4) — sono note esplicite su rendering, non codice mancante; il resto dei selettori è mappato in testa al piano. ✓

**Type/nomi consistency:** `chartGeometry` importato (Task 1 Step 1) e usato (Step 2) con la firma reale `{points:[{x,y}]}`. `exerciseTrend(data, currentDay, exId, currentWeek, 4, superset)` coerente con session.js:352. Id Impostazioni (Task 5) = identici a quelli verificati in index.html:96-188 e usati dagli handler. Classi CSS = quelle mappate dai renderer reali. ✓

**Rischi (da spec §9):** (1) classi interne focus/nutrizione → mitigato mappandole in testa al piano da lettura reale del codice; (2) rifacimento markup Impostazioni → mitigato preservando tutti gli id + Step 4 di verifica funzionale; (3) sparkline per riga → `chartGeometry` è O(n) su ≤4 settimane, costo trascurabile.
