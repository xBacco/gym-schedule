# A11y tastiera accordion (gestore + catalogo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere azionabili da tastiera gli header accordion del gestore schede (`.sh-h`) e del catalogo esercizi (`.db-ghd`/`.db-krow`), con `aria-expanded`, focus ring `:focus-visible` e ripristino del focus dopo i re-render.

**Architecture:** Approccio B della spec (`docs/superpowers/specs/2026-06-04-a11y-accordion-design.md`): i div clickable esistenti ricevono `role="button"`, `tabindex="0"`, `aria-expanded` e un keydown Enter/Spazio che riusa il click-handler già presente via `el.click()`. Un helper condiviso `a11yToggle` + una variabile modulo `a11yRefocus` gestiscono il ripristino del focus dopo che `renderSheets`/`renderCatalog` ricostruiscono il DOM. Zero cambi visivi al tocco, zero cambi al modello dati.

**Tech Stack:** Vanilla JS (app.js), CSS (style.css), test esistenti `node --test` (nessun test nuovo: il wiring vive nel layer impuro, per convenzione repo non unit-testato), verifica da tastiera con Playwright MCP.

**Convenzioni repo:** commit conventional in italiano, `git commit -m` semplice (MAI here-string con `@`), lavorare in `C:\Users\TomasCoro\Desktop\PERSONAL\siti-app\set.log`. I numeri di riga si riferiscono a HEAD `3bec7fd`; usare le àncore di codice citate, non i numeri, se nel frattempo il file è cambiato.

---

### Task 1: Helper `a11yToggle` + ripristino focus

**Files:**
- Modify: `app.js` (dopo `mkBtn`, ~riga 393, prima del commento di `mkPrompt`)

- [ ] **Step 1: Inserire helper e variabile modulo**

In `app.js`, subito dopo la chiusura di `mkBtn` (àncora: la riga `}` che segue `b.addEventListener("click", (e) => { e.stopPropagation(); onClick(e); });` / `return b;`) e PRIMA del commento `// Riga prompt stile terminale`, inserire:

```js
// Selettore dell'header accordion da rifocalizzare dopo il prossimo re-render.
// Valorizzato SOLO dal ramo keydown di a11yToggle: i render ricostruiscono il
// DOM e distruggono l'elemento focusato, da mouse/touch non serve ripristino.
let a11yRefocus = null;

// Rende un div clickable azionabile da tastiera (header accordion):
// role/tabindex/aria-expanded + Enter/Spazio che riusa il click-handler già
// presente via el.click(). refocusSel: selettore per ritrovare l'header dopo
// il re-render (ancorato al contenitore, vedi spec).
function a11yToggle(el, expanded, refocusSel) {
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-expanded", String(expanded));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault(); // Spazio non deve scrollare la pagina
      a11yRefocus = refocusSel;
      el.click();
    }
  });
}

// Da chiamare in coda ai render che ricostruiscono accordion accessibili.
function a11yRestoreFocus() {
  if (!a11yRefocus) return;
  const el = document.querySelector(a11yRefocus);
  a11yRefocus = null;
  if (el) el.focus();
}
```

- [ ] **Step 2: Verificare che i test restino verdi**

Run (in `set.log`): `npm test`
Expected: 341 pass, 0 fail

- [ ] **Step 3: Commit**

```bash
git add app.js
git commit -m "feat(a11y): helper a11yToggle e ripristino focus post-render"
```

---

### Task 2: Header del gestore schede azionabili da tastiera

**Files:**
- Modify: `app.js` — `renderSheets` (~righe 294-382)

- [ ] **Step 1: Wiring dell'header `.sh-h`**

In `renderSheets`, dentro il loop `for (const s of sums)`, subito dopo la riga `h.append(ar, nm);` (àncora: creazione di `ar`/`nm` con classi `sh-ar`/`sh-nm`), aggiungere:

```js
    h.dataset.id = s.id;
    a11yToggle(h, open, `#sheetsBody .sh-h[data-id="${s.id}"]`);
```

NB: nessun nuovo click-handler — il click su `.sh-h` risale per bubbling al
handler già presente su `.sh-blk` (riga `blk.addEventListener("click", ...)`).
Il blocco intero resta cliccabile al tocco, invariato.

- [ ] **Step 2: Ripristino focus in coda al render**

Sempre in `renderSheets`, dopo l'ultima riga `body.appendChild(inner);` e prima della `}` di chiusura della funzione, aggiungere:

```js
  a11yRestoreFocus();
```

- [ ] **Step 3: Verificare che i test restino verdi**

Run: `npm test`
Expected: 341 pass, 0 fail

- [ ] **Step 4: Commit**

```bash
git add app.js
git commit -m "feat(a11y): header gestore schede azionabili da tastiera"
```

---

### Task 3: Gruppi e voci del catalogo azionabili da tastiera

**Files:**
- Modify: `app.js` — `renderCatalog` (~righe 526-575)

- [ ] **Step 1: Wiring header gruppo `.db-ghd`**

In `renderCatalog`, sostituire la riga (àncora: unico `hd.onclick` della funzione):

```js
    if (!f) hd.onclick = () => { dbOpenGroups[muscle] = !(dbOpenGroups[muscle] !== false); renderCatalog(); };
```

con:

```js
    if (!f) {
      hd.onclick = () => { dbOpenGroups[muscle] = !(dbOpenGroups[muscle] !== false); renderCatalog(); };
      hd.dataset.muscle = muscle;
      a11yToggle(hd, isOpen, `#dbTree .db-ghd[data-muscle="${muscle}"]`);
    }
```

(Col filtro attivo i gruppi non sono clickabili e restano forzati aperti: niente role/tabindex in quel caso — deliberato, vedi spec.)

- [ ] **Step 2: Wiring riga esercizio `.db-krow`**

Sempre in `renderCatalog`, sostituire la riga (àncora: unico `querySelector(".db-krow")` della funzione):

```js
      k.querySelector(".db-krow").onclick = () => { dbOpenEx = isExOpen ? null : entry.id; renderCatalog(); };
```

con:

```js
      const krow = k.querySelector(".db-krow");
      krow.onclick = () => { dbOpenEx = isExOpen ? null : entry.id; renderCatalog(); };
      krow.dataset.id = entry.id;
      a11yToggle(krow, isExOpen, `#dbTree .db-krow[data-id="${entry.id}"]`);
```

- [ ] **Step 3: Ripristino focus in coda al render**

In fondo a `renderCatalog`, dopo il blocco `if (f && !any) { ... }` e prima della `}` di chiusura della funzione, aggiungere:

```js
  a11yRestoreFocus();
```

(Nel ramo no-results il selettore non matcha nulla e `a11yRestoreFocus` è un no-op: ok.)

- [ ] **Step 4: Verificare che i test restino verdi**

Run: `npm test`
Expected: 341 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add app.js
git commit -m "feat(a11y): gruppi e voci catalogo azionabili da tastiera"
```

---

### Task 4: Focus ring `:focus-visible`

**Files:**
- Modify: `style.css` (in coda al file)

- [ ] **Step 1: Aggiungere la regola**

In coda a `style.css`, aggiungere:

```css
/* ---- A11y: focus ring tastiera sugli header accordion (gestore + catalogo).
   :focus-visible → visibile solo navigando da tastiera, design al tocco invariato. */
.sh-h:focus-visible,#dbOverlay .db-ghd:focus-visible,#dbOverlay .db-krow:focus-visible{
  outline:1px solid var(--acc);outline-offset:2px;border-radius:4px;}
```

- [ ] **Step 2: Commit**

```bash
git add style.css
git commit -m "feat(a11y): focus ring tastiera sugli header accordion"
```

---

### Task 5: Bump cache service worker

**Files:**
- Modify: `sw.js:5`

- [ ] **Step 1: Bump della cache**

In `sw.js`, sostituire:

```js
const CACHE = "gymsched-v63";
```

con:

```js
const CACHE = "gymsched-v64";
```

- [ ] **Step 2: Commit**

```bash
git add sw.js
git commit -m "chore(sw): bump cache v64 per rollout a11y accordion"
```

---

### Task 6: Verifica da tastiera con Playwright (no-login)

**Files:** nessuna modifica al codice prevista (solo verifica; eventuali fix → commit dedicati).

Setup — trucco verifica senza login (vedi memory `gestore-editor-redesign-decision`):
sessione Supabase fake in localStorage + dati seed namespacizzati + route abort verso
`*.supabase.co` → `store.load()` fallisce con errore di rete (non AuthError) → il boot
cade nel ramo `catch` "offline ⧗" e renderizza dai dati cache (app.js ~3180-3238).
ATTENZIONE: senza route abort il token fake produce 401 → AuthError → signOut+reload loop.

- [ ] **Step 1: Servire l'app**

Run (in `set.log`, in background): `npx http-server -p 8123 -c-1`
Expected: server su `http://127.0.0.1:8123`

- [ ] **Step 2: Preparare la pagina con sessione fake + seed**

Con i tool Playwright MCP:
1. `browser_navigate` → `http://127.0.0.1:8123`
2. Installare il route abort (via `browser_run_code_unsafe`, API Playwright):
   `context.route("**://*.supabase.co/**", (r) => r.abort())`
3. Iniettare in localStorage via `browser_evaluate`:

```js
() => {
  const uid = "verify-uid";
  localStorage.setItem("sb-skxqdklhhixekjekujfe-auth-token", JSON.stringify({
    access_token: "fake", token_type: "bearer",
    expires_at: Math.floor(Date.now() / 1000) + 86400, expires_in: 86400,
    refresh_token: "fake",
    user: { id: uid, email: "verify@local", aud: "authenticated", role: "authenticated" },
  }));
  const blob = {
    schema: 6, updatedAt: "2026-06-04T00:00:00.000Z", activeSheetId: "s1",
    sheets: [
      { id: "s1", name: "Forza Massa", plan: [{ day: "A", title: "Petto",
        exercises: [{ id: "e1", name: "Panca piana", sets: 3, reps: "8", muscle: "Petto" }] }], weeks: {} },
      { id: "s2", name: "Richiamo", plan: [{ day: "A", title: "Dorso",
        exercises: [{ id: "e2", name: "Rematore", sets: 3, reps: "10", muscle: "Dorso" }] }], weeks: {} },
    ],
    catalog: [
      { id: "c1", name: "Panca piana", muscle: "Petto", note: "" },
      { id: "c2", name: "Rematore", muscle: "Dorso", note: "" },
    ],
  };
  localStorage.setItem(`gymsched_user_${uid}_data`, JSON.stringify(blob));
  localStorage.setItem(`gymsched_user_${uid}_version`, "1");
  localStorage.setItem(`gymsched_user_${uid}_dirty`, "false");
}
```

4. `browser_navigate` di nuovo su `http://127.0.0.1:8123` (reload col seed attivo)
5. Verificare con `browser_snapshot` che l'app sia renderizzata (home con scheda, status "offline ⧗") e che la console non abbia errori dell'app (gli abort di rete verso supabase.co sono attesi)

- [ ] **Step 3: Verifica tastiera — gestore schede**

1. Aprire il gestore: hamburger menu → voce "Schede" (click normale, ok)
2. Con `browser_press_key` Tab ripetuto: il focus deve raggiungere l'header `.sh-h` della scheda chiusa (`richiamo/`)
3. Premere Enter. Verificare via `browser_evaluate`:
   - il blocco si è espanso (`.sh-blk.open` con `[data-id="s2"]` presente)
   - `document.activeElement` è di nuovo `.sh-h[data-id="s2"]` (focus restore)
   - `aria-expanded === "true"` sull'header focusato
4. Tab successivo: il focus raggiunge il bottone "↪ attiva" dentro `.sh-acts`
5. Premere Spazio sull'header (tornare con Shift+Tab): il blocco si richiude, `aria-expanded === "false"`, focus ancora sull'header
6. `browser_take_screenshot` con focus visibile sull'header (focus ring accent)

- [ ] **Step 4: Verifica tastiera — catalogo**

1. Chiudere il gestore (bottone indietro), aprire dal menu "Database esercizi"
2. Tab fino all'header gruppo `.db-ghd` (es. "petto"); Enter → il gruppo collassa, `aria-expanded === "false"`, focus restituito a `.db-ghd[data-muscle="Petto"]`
3. Enter di nuovo → riapre; Tab fino a `.db-krow` di "Panca piana"; Enter → dettaglio inline aperto, focus restituito a `.db-krow[data-id="c1"]`, `aria-expanded === "true"`
4. Tab successivi: il focus raggiunge la textarea nota e i bottoni "✎ modifica" / "× elimina"
5. `browser_take_screenshot` del focus ring su un header del catalogo

- [ ] **Step 5: Verifica secondo tema**

Cambiare tema dalle Impostazioni (o via `browser_evaluate` sul localStorage del tema + reload), ripetere un controllo rapido del focus ring (screenshot su un header focusato): il ring usa `var(--acc)` e deve restare visibile in entrambi i temi.

- [ ] **Step 6: Pulizia e test finale**

1. Fermare http-server; chiudere il browser Playwright
2. Run: `npm test`
Expected: 341 pass, 0 fail

---

## Self-review (fatto in scrittura)

- **Spec coverage:** helper (§1→Task 1), gestore (§2→Task 2), catalogo (§3→Task 3), focus restore (§4→Task 1-3), CSS (§5→Task 4), verifica (§6→Task 6). Extra oltre spec: bump SW (Task 5), richiesto dalla convenzione repo per il rollout di app.js/style.css.
- **Placeholder:** nessun TBD/TODO; ogni step di codice ha il codice completo.
- **Coerenza nomi:** `a11yToggle(el, expanded, refocusSel)` e `a11yRestoreFocus()` usati identici nei Task 2-3; selettori ancorati `#sheetsBody`/`#dbTree` coerenti con la spec.
