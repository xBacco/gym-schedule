# A11y tastiera sugli accordion — gestore schede + catalogo esercizi

**Data:** 2026-06-04
**Origine:** finding dei reviewer (Task 5 del redesign gestore/editor): le azioni dentro
gli accordion non sono raggiungibili da tastiera perché gli header sono div clickable
senza focus né keydown.
**Approccio scelto:** B — div esistenti + ARIA leggero (role/tabindex/aria-expanded +
keydown), helper condiviso, focus restore via data-attribute. Scelto rispetto ad A
(conversione in veri `<button>`, rischio regressioni CSS sul design appena approvato)
e C (`<details>/<summary>`, confligge con stato in variabili JS + re-render totale).

## Ambito

Solo i due accordion del finding:

- **Gestore schede** (`renderSheets`, app.js): header `.sh-h` dentro `.sh-blk`
- **Catalogo esercizi** (`renderCatalog`, app.js): header gruppo `.db-ghd` e riga
  esercizio `.db-krow`

**Fuori scope** (stesso pattern, eventuale passata futura): riga volume `volcard`,
celle calendario `.cal-cell`, punti grafico progressione, span clickabili nei dialog
di logging, nutrition.js.

## Design

### 1. Helper condiviso (app.js, vicino a `mkBtn`)

```js
// Rende un div clickable azionabile da tastiera (accordion header).
function a11yToggle(el, expanded) {
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  el.setAttribute("aria-expanded", String(expanded));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
  });
}
```

`el.click()` riusa il click-handler già presente (zero duplicazione di logica);
`preventDefault` evita lo scroll della pagina con Spazio.

### 2. Gestore (`renderSheets`)

- `a11yToggle(h, open)` sull'header `.sh-h` + `h.dataset.id = s.id`
- Il click su `.sh-h` risale per bubbling al handler già presente su `.sh-blk`:
  nessun nuovo click-handler
- Il blocco intero `.sh-blk` resta cliccabile al tocco, comportamento invariato

### 3. Catalogo (`renderCatalog`)

- `.db-ghd` (gruppo): `a11yToggle(hd, isOpen)` + `hd.dataset.muscle = muscle`,
  **solo quando non c'è filtro attivo** (col filtro i gruppi non sono clickabili
  e restano forzati aperti)
- `.db-krow` (esercizio): `a11yToggle(row, isExOpen)` + `row.dataset.id = entry.id`

### 4. Ripristino focus post-re-render

Ogni toggle ricostruisce il DOM (`renderSheets`/`renderCatalog` rifanno innerHTML),
distruggendo l'elemento focusato: dopo Enter il focus cadrebbe sul body.

Soluzione minima: nel ramo keydown dell'helper, prima di `el.click()`, salvare un
selettore di ritrovo in una variabile modulo, **ancorato al contenitore** per
evitare collisioni (`data-id` esiste già anche sulle textarea nota del catalogo):
es. `a11yRefocus = '#sheetsBody .sh-h[data-id="…"]'`,
`'#dbTree .db-ghd[data-muscle="…"]'` o `'#dbTree .db-krow[data-id="…"]'`.
In coda a `renderSheets` e `renderCatalog`, se la variabile è valorizzata, fare
`document.querySelector(sel)?.focus()` e azzerarla. Il focus via mouse/touch non
è toccato: il salvataggio avviene solo nel ramo keydown.

### 5. CSS (style.css)

```css
.sh-h:focus-visible,.db-ghd:focus-visible,.db-krow:focus-visible{
  outline:1px solid var(--acc);outline-offset:2px;border-radius:4px;}
```

`:focus-visible` = ring visibile solo navigando da tastiera; design al tocco
invariato. Nessun altro cambio visivo.

### 6. Test e verifica

- Nessun unit test nuovo: il wiring vive in app.js (layer impuro, per convenzione
  repo non unit-testato); i 341 test esistenti devono restare verdi
- Verifica Playwright da tastiera col trucco no-login (vedi memory
  gestore-editor-redesign-decision): Tab fino all'header → Enter apre → focus
  mantenuto sull'header → Tab raggiunge i bottoni azione interni → `aria-expanded`
  coerente con lo stato, su gestore e catalogo, entrambi i temi

## Vincoli

- Zero cambi al modello dati e zero cambi visivi al design al tocco
- Convenzioni repo: commit conventional in italiano, `-m` semplice
