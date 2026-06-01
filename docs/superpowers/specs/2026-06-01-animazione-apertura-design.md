# Animazione d'apertura (splash) — S1 "assembla + terminale"

**Data:** 2026-06-01
**Stato:** approvato (design), in implementazione

## Obiettivo

Splash d'apertura semplice ma curato, equilibrio palestra + informatica, basato
sulla nuova icona (manubrio + CPU). Parte a ogni avvio, dura ~1s, poi svanisce.

## Design scelto (S1, rifinito)

Sequenza one-shot (~1s), su sfondo `#0c0a06`, accento `#E8A93C`:

1. I due gruppi di dischi **scivolano** dai lati sulla barra (translateX → 0).
2. La **CPU** appare con un piccolo "pop" (scale .5→1.12→1) e il **core** lampeggia
   (accensione).
3. Le **piste** (legs) compaiono.
4. **In parallelo** alla formazione: compare il prompt **`>`** e
   **`scheda-palestra`** si scrive a macchina (effetto typewriter, `steps`),
   con cursore a blocco lampeggiante. La `a` finale resta interamente visibile
   (larghezza typing portata a `16ch`).

Poi lo stato finale (icona montata + testo completo) **resta fermo** finché non
viene rimosso via JS.

## Comportamento (deciso col Visual Companion)

- **Ogni avvio**, durata minima **~1.15s** (così il typing finisce, ~0.95s).
- Si rimuove quando **animazione min trascorsa E boot pronto** (`Promise.all`).
  Su boot lento lo splash resta come loader; **safety timeout 6s** lo toglie
  comunque.
- **`prefers-reduced-motion: reduce`** → niente animazione: stato finale statico,
  rimozione dopo ~0.25s.
- Fade-out via transition opacity (~0.44s), poi `el.remove()`.

## Modifiche

1. **`index.html`** — markup `#splash` (svg icona coi gruppi animabili
   `.p-l/.p-r/.legs/.chip/.core` + `.cap` con `.pr`/`.type`/`.cur`), inserito a
   inizio `<body>` (overlay sopra tutto). Visibile da subito senza JS.
2. **`style.css`** — blocco `#splash` in coda: layout overlay full-screen
   `z-index:1000`, keyframes one-shot (`sp-pl/sp-pr/sp-chip/sp-core/sp-legs/sp-fade/sp-type`),
   `.splash-out{opacity:0;transition}`, regole `@media (prefers-reduced-motion)`.
3. **`app.js`** — blocco splash a livello modulo (prima di `window load`):
   promise `ready` + `minDelay` + `safety`, `dismissSplash()`. Funzione
   `splashBootReady()` chiamata in `boot()`: (a) nel ramo senza sessione prima del
   `return`; (b) dopo il blocco load dati (`try/catch`), nel ramo con sessione.
4. **`sw.js`** — bump `CACHE` `gymsched-v48` → `gymsched-v49` (cambiano file
   app-shell: index.html, style.css, app.js).

## Non in scope

- Splash "solo primo avvio" (serviva flag persistente — scartato).
- Suoni, varianti glow, splash diversi per auth vs app.

## Verifica

- `node --check app.js sw.js`; `node --test` resta verde (nessuna logica testata
  toccata).
- Verifica visiva: screenshot/registrazione dello splash che parte e svanisce su
  un server locale (Playwright). Controllo `prefers-reduced-motion`.
- Sul telefono dopo banner cache **v49**.

## Note operative

- Commit + push automatici su `main` (fetch+pull prima).
- Bump cache **v49** necessario per propagare lo splash ai client installati.
