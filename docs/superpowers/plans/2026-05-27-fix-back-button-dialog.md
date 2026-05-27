# Fix back-button sui dialog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Il tasto "indietro" di Android chiude il dialog in cima (grafico/set/ex/qc), non l'overlay sotto.

**Architecture:** Guardia centralizzata nel solo gestore `popstate` di `app.js`. I dialog non vengono registrati nella history; quando il back scatta con un dialog aperto, lo chiudiamo e ri-pushamo la voce di history dell'overlay sottostante. I percorsi di chiusura normali dei dialog (bottone/backdrop/Esc) restano invariati.

**Tech Stack:** Vanilla JS, History API, `<dialog>` nativi. Nessuna dipendenza. Verifica via Playwright MCP (il comportamento history/DOM non è coperto da `node --test`).

Spec: `docs/superpowers/specs/2026-05-27-back-button-dialog-design.md`

---

### Task 1: Guardia dialog nel gestore popstate

**Files:**
- Modify: `app.js` (gestore `popstate`, attualmente ~righe 1760-1764)

- [ ] **Step 1: Sostituire il gestore popstate**

Trovare il blocco attuale:

```js
  window.addEventListener("popstate", () => {
    if (openIndex !== null) { hideFeelAsk(); openIndex = null; render(); }
    if (nutritionOpen) { nutritionOpen = false; renderNutritionOverlay(); }
    if (planOpen) { planOpen = false; renderPlanEditor(); }
  });
```

Sostituirlo con:

```js
  window.addEventListener("popstate", () => {
    // Un dialog modale è il layer in cima: il tasto indietro chiude quello, non
    // l'overlay sotto. Lo richiudiamo e ripristiniamo la voce di history
    // dell'overlay sottostante (consumata dal back), così resta aperto e un
    // secondo "indietro" lo chiuderà. I dialog non sono registrati nella history,
    // quindi le loro chiusure normali (bottone/backdrop/Esc) non passano di qui.
    const openDlg = [...document.querySelectorAll("dialog[open]")].pop();
    if (openDlg) {
      openDlg.close();
      if (planOpen) history.pushState({ gymPlan: true }, "");
      else if (nutritionOpen) history.pushState({ gymNutrition: true }, "");
      else if (openIndex !== null) history.pushState({ gymFocus: true }, "");
      return;
    }
    if (openIndex !== null) { hideFeelAsk(); openIndex = null; render(); }
    if (nutritionOpen) { nutritionOpen = false; renderNutritionOverlay(); }
    if (planOpen) { planOpen = false; renderPlanEditor(); }
  });
```

Note:
- `querySelectorAll(...).pop()` = ultimo dialog aperto in ordine DOM (robustezza nel caso improbabile di dialog annidati; in pratica uno solo è aperto).
- `setDialog`: chiuso da `popstate`, `setDlgAction` resta `null` → il suo handler `close` (app.js ~949) lo tratta come "cancel". Nessuna gestione extra necessaria.

- [ ] **Step 2: Lint/sanity dei test unitari esistenti**

Run (PowerShell): `cd C:\Users\TomasCoro\gym-schedule; npm test`
Expected: 147 test, 0 fail (la modifica non tocca codice testato da `node --test`).

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "fix: il tasto indietro chiude il dialog in cima, non l'overlay sotto"
```

---

### Task 2: Bump cache service worker

**Files:**
- Modify: `sw.js:5`

- [ ] **Step 1: Bump versione cache**

Cambiare `const CACHE = "gymsched-v21";` in `const CACHE = "gymsched-v22";`

- [ ] **Step 2: Commit**

```bash
git add sw.js
git commit -m "chore: bump cache a gymsched-v22 (fix back-button dialog)"
```

---

### Task 3: Verifica browser (Playwright MCP)

**Files:** nessuno (solo verifica)

- [ ] **Step 1: Servire l'app su porta pulita**

Run (PowerShell, background): `cd C:\Users\TomasCoro\gym-schedule; python -m http.server 8099`
(porta diversa da eventuali istanze con cache vecchia)

- [ ] **Step 2: Aprire e preparare lo stato**

Con Playwright MCP: `browser_navigate` a `http://localhost:8099/`. Attendere il caricamento (`browser_snapshot`).

- [ ] **Step 3: Verificare chart sopra focus**

Aprire un esercizio (tap sulla prima riga della lista → focus), poi tap su `📈` (#chartBtn) → il grafico (#chartDialog) si apre.
- `browser_evaluate`: `() => { history.back(); return null; }`
- Atteso: #chartDialog **chiuso**, focus **ancora aperto** (`document.getElementById("chartDialog").open === false` e `document.getElementById("focusOverlay").classList.contains("hidden") === false`).
- `browser_evaluate`: `() => { history.back(); return null; }` di nuovo.
- Atteso: focus **chiuso** (#focusOverlay ha classe `hidden`).

- [ ] **Step 4: Verificare setDialog (azione = cancel sul back)**

Aprire un esercizio, aprire il dialog di modifica di una serie (#setDialog), poi `history.back()`.
- Atteso: #setDialog chiuso, focus ancora aperto, nessuna modifica salvata alla serie.

- [ ] **Step 5: Verificare exDialog sopra editor scheda**

Aprire l'editor scheda (`✎` #planEditBtn → #planOverlay), aprire #exDialog (es. "+ nuovo esercizio" o modifica), poi `history.back()`.
- Atteso: #exDialog chiuso, editor scheda ancora aperto; secondo `history.back()` chiude l'editor.

- [ ] **Step 6: Fermare il server**

Chiudere il processo `http.server`.

---

## Self-Review

- **Spec coverage:** guardia popstate (Task 1) = soluzione approccio A; tutti e 4 i dialog coperti perché la guardia è generica su `dialog[open]`; setDialog edge case verificato (default cancel); cache bump (Task 2); verifica Playwright per chart/set/ex (Task 3). exDialog sopra editor incluso. ✓
- **Placeholder scan:** nessun TBD/TODO; codice completo mostrato. ✓
- **Type consistency:** `openDlg`, flag `planOpen`/`nutritionOpen`/`openIndex` coerenti col codice esistente. ✓
