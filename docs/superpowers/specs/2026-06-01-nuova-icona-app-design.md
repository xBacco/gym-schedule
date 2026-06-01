# Nuova icona app — manubrio + CPU (F1 K2)

**Data:** 2026-06-01
**Stato:** approvato (design), pronto per il piano

## Obiettivo

Sostituire l'icona dell'app (oggi un bilanciere ambra minimale) con un'icona
che fonde palestra e informatica: un **manubrio** i cui pesi sono collegati a un
**processore (CPU) centrale**. Coerente con l'estetica Amber CRT dell'app.

## Design scelto

Variante **F1 K2**, decisa al termine del brainstorming con Visual Companion:

- **Manubrio orizzontale**: per ogni lato un disco grande + un disco piccolo
  esterno (stessa impostazione "a dischi" già gradita nelle iterazioni E/G2).
- **CPU centrale**: chip quadrato con contorno ambra su sfondo, core pieno,
  **3 piedini per lato** sopra e sotto, collegato ai dischi da due piste per lato.
- **Sobrio (no glow)**: coerente col look SOBRIO di default dell'app.
- Palette invariata: sfondo `#100E0A`, tratto `#E8A93C`.
- Geometria su `viewBox 0 0 512 512`, angoli `rx=112`. Tutto il contenuto sta
  entro la safe-zone maskable (raggio ~205px dal centro), quindi resta integro
  anche col ritaglio circolare/squircle di Android.

### Artwork finale (`icon.svg`)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="112" fill="#100E0A"/>
  <g fill="#E8A93C">
    <rect x="150" y="191" width="40" height="130" rx="16"/>
    <rect x="322" y="191" width="40" height="130" rx="16"/>
    <rect x="104" y="215" width="30" height="82" rx="12"/>
    <rect x="378" y="215" width="30" height="82" rx="12"/>
  </g>
  <g stroke="#E8A93C" stroke-width="7" stroke-linecap="round">
    <line x1="190" y1="244" x2="228" y2="244"/>
    <line x1="190" y1="268" x2="228" y2="268"/>
    <line x1="284" y1="244" x2="322" y2="244"/>
    <line x1="284" y1="268" x2="322" y2="268"/>
  </g>
  <g fill="#E8A93C">
    <rect x="236" y="214" width="8" height="14" rx="2"/>
    <rect x="252" y="214" width="8" height="14" rx="2"/>
    <rect x="268" y="214" width="8" height="14" rx="2"/>
    <rect x="236" y="284" width="8" height="14" rx="2"/>
    <rect x="252" y="284" width="8" height="14" rx="2"/>
    <rect x="268" y="284" width="8" height="14" rx="2"/>
  </g>
  <rect x="228" y="228" width="56" height="56" rx="6" fill="#100E0A" stroke="#E8A93C" stroke-width="7"/>
  <rect x="246" y="246" width="20" height="20" rx="4" fill="#E8A93C"/>
</svg>
```

## Modifiche

1. **`icon.svg`** — sostituire il contenuto con l'artwork finale sopra.

2. **`icon-180.png`** (nuovo) — PNG 180×180 generato dall'SVG, per
   `apple-touch-icon` (iOS Safari non rende gli SVG come icona home).
   Generazione: render dell'`icon.svg` in browser headless (Playwright già
   disponibile) a 180×180 e salvataggio del PNG. Lo sfondo è già nell'SVG, quindi
   il PNG è opaco.

3. **`index.html`** — `apple-touch-icon` deve puntare al PNG:
   `<link rel="apple-touch-icon" href="./icon-180.png">`.

4. **`sw.js`** — due cose:
   - bump `CACHE`: `gymsched-v47` → `gymsched-v48` (l'`icon.svg` è in precache,
     senza bump il vecchio disegno resta cachato);
   - aggiungere `"./icon-180.png"` alla lista di precache dell'app-shell.

5. **`manifest.json`** — invariato. Continua a puntare a `icon.svg`
   (`purpose: "any maskable"`); colori `#100E0A` invariati.

## Non in scope (YAGNI)

- Set completo di PNG multi-size (192/512) per Android: il manifest usa già l'SVG
  scalabile con `sizes:"any"`, basta quello.
- Splash screen iOS dedicate.
- Toggle/varianti glow dell'icona.

## Verifica

- `node --test` resta verde (nessuna logica toccata, solo asset).
- `node --check` sui file JS modificati (`sw.js`).
- Verifica visiva: l'icona si legge bene a 40–48px; controllo del PNG generato.
- In esecuzione sul telefono: dopo il banner cache **v48**, l'icona home aggiornata
  (Android via manifest SVG, iOS via PNG).

## Note operative

- Memory di progetto: commit + push automatici su `main` (fetch+pull prima).
- Bump cache **v48** è la chiave perché l'icona si propaghi sui client installati.
