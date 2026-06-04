# Feedback sessione 2026-06-03: timer, suoni, feedback serie, PR reps — Design

**Data:** 2026-06-04
**Origine:** feedback dell'utente dopo la prima sessione reale (giorno A, ~40 min) con l'app.
**Mockup validati:** `.superpowers/brainstorm/18981-1780557616/content/` — `timerbar-layout.html` (scelta B), `timer-expired-v5-terminal.html` (scelta B "boot log"), `timer-expired-v2.html` (suoni soft + slider volume).

## Obiettivo

Sette interventi mirati emersi dall'uso reale in palestra: barra timer più leggibile, stato "timer scaduto" persistente in stile terminale, suoni di countdown udibili in cuffia, auto-chiusura del pannello feedback serie, "dura" in rosso, PR a reps per esercizi a corpo libero, disambiguazione "Croci ai cavi".

## 1. Barra timer — layout "due righe"

**Oggi** (`index.html:424-435`, `style.css:200-210`): una riga unica, label troncata a 170px con ellipsis, tempo 34px e 4 bottoni compressi.

**Nuovo layout:**
- **Riga 1:** nome esercizio per intero (`white-space:normal`, niente ellipsis) a sinistra; bottone ✕ (chiudi timer, testuale, senza sfondo) a destra.
- **Riga 2:** tempo `40px` a sinistra; bottoni `−10` `⏸` `+10` a destra con `gap:10px` e padding `11px 16px`.
- Padding barra `14px 18px 16px`; il ✕ perde lo stile `t-stop` pieno (non serve più un bottone primario per chiudere).
- Più aria sopra: la strip "prossimo esercizio / ultimo esercizio della sessione" mantiene un margine inferiore adeguato rispetto alla barra (≥16px visivi).
- **Ultimi 3 secondi:** il tempo passa a `var(--down)` con animazione `tick` (scale 1→1.14→1, ~0.9s) per secondo.

## 2. Timer scaduto — barra "boot log" persistente

**Oggi** (`app.js:1188-1204`): a 0:00 vibrazione 200ms, `beep()`, notifica PWA, banner "Recupero finito" che scompare dopo 1.5s. Problema: l'utente non se ne accorge.

**Nuovo:** allo 0:00 la barra timer si trasforma in place in uno stato "GO" in stile boot log dell'app:

```
[ ok ] recupero completato · 1:30
> vai ./pushdown_curl --serie 3█
```

- Riga 1: `[ ok ]` in verde (`--ok`), "recupero completato" + durata recupero impostata.
- Riga 2: `> vai` grande (19px, bold, colore accento) + slug esercizio e `--serie N` in tono dim + cursore block lampeggiante (steps(1), 1s).
- Lo slug è il nome esercizio in minuscolo con `_` al posto degli spazi, troncato se serve; `N` è la prossima serie da fare. Se il recupero era dell'ultima serie dell'ultimo esercizio: `> fine ./sessione --done`.
- **Persistente:** resta finché l'utente non tocca la barra (qualunque punto). Il tocco la chiude. Niente auto-dismiss.
- **Temi:** su Carta fondo `--field`, bordo superiore 2px `--acc`, testo ambra/inchiostro. Su Graphite fondo `--field` (quasi nero), glow oro sul testo accento (`text-shadow`), scanline CRT leggera (repeating-linear-gradient) — coerente con `body.fx-glow`.
- Vibrazione e notifica PWA invariate. Il vecchio banner 1.5s viene rimosso.

## 3. Suoni countdown (Web Audio)

**Oggi:** un solo `beep()` (onda quadra) allo scadere — stridulo in cuffia.

**Nuovi suoni** — tutti sinusoide, attacco 50ms, coda esponenziale:
- **−10s:** doppio do5 (523 Hz, 0.25s, secondo a +0.35s). Scatta solo al passaggio per 10s: se il countdown parte (o viene portato con −10) già sotto i 10s, niente avviso.
- **3·2·1:** un tick mi5 (659 Hz, 0.18s) a ciascuno degli ultimi 3 secondi (sincrono con l'animazione rossa del tempo).
- **0:00:** arpeggio do-mi-sol (523/659/784 Hz, scaglionati 0/0.18/0.36s).
- **Volume:** default 10%, regolabile 0–40% con slider nelle **Impostazioni** ("Volume timer"), persistito nelle preferenze (stesso storage delle altre impostazioni). A 0% i suoni sono spenti (resta la vibrazione).
- L'`AudioContext` va creato/sbloccato al primo gesto utente (vincolo iOS): inizializzazione lazy al primo avvio timer.

## 4. Auto-chiusura pannello feedback serie

**Oggi** (`app.js:2112-2123`): dopo "Serie fatta" appare `showFeelAsk` (giusta/ok/dura) e resta finché l'utente non torna indietro manualmente — copre il prossimo esercizio.

**Nuovo:**
- Dopo il tap sul giudizio: il pannello mostra lo stato selezionato per ~1.2s, poi si chiude da solo e torna alla vista esercizio/lista.
- **Se era l'ultima serie dell'esercizio:** alla chiusura del pannello si chiude anche l'esercizio (collapse dell'`item.open`) e la vista scorre al prossimo esercizio della sessione, che si apre. Se era l'ultimo esercizio: nessuna apertura, resta la lista con lo stato sessione.
- Il timer di recupero parte comunque subito al "Serie fatta" (invariato).
- Annullabilità: durante gli ~1.2s un secondo tap su un altro giudizio lo sostituisce e azzera il timer di chiusura.

## 5. "Dura" in rosso

**Oggi:** `--rpe-hard` è arancio-bruno (#b8642a Carta / #FFB37F Graphite) — troppo vicino a "ok".

**Nuovo:** `--rpe-hard` passa ai toni di `--down`: **#c0442e** su Carta, **#e0705a** su Graphite; `--rpe-hard-bg` segue (rgba rossa ~.12/.07). Vale per chip nella riga serie (`.rpe.hard`), bottoni della rpe-bar (`.rb.hard.on`) e ovunque sia riusato il token. "Fallita" usa già `--fail-bg`/down: verificare che "dura" e "fallita" restino distinguibili (dura = testo/bordo rosso pieno; fallita mantiene il suo stile barrato/bg).

## 6. PR a reps per esercizi a corpo libero

**Oggi** (`session.js:135-169`, `app.js:2113-2114`): il PR confronta solo i kg del top-set; con kg vuoto (`parseNum` → null) non scatta mai.

**Nuovo:**
- Un esercizio è "a corpo libero" per la logica PR quando **tutte le serie storiche non-warmup/non-failed hanno kg vuoto o 0**.
- In quel caso `bestKgBefore`/`isWeekRecord`/`isSetRecord` confrontano il **max reps in una singola serie** invece del kg (stessa struttura top-set, metrica reps).
- Se in futuro l'utente aggiunge zavorra (kg > 0), la metrica torna automaticamente kg (lo storico reps non genera falsi PR: appena esiste un kg > 0 storico, si confronta solo su kg).
- Badge PR in lista e toast 🏆 invariati nella forma.

## 7. Catalogo: "Croci ai cavi" → "Croci ai cavi in piedi"

- Rinominare la voce seed in `catalog.js:17` (gruppo Petto). L'id seed (`seed-2`) resta invariato.
- **Migrazione dati utente:** al reconcile post-load, se nel catalogo o nella scheda esiste un esercizio con nome esatto "Croci ai cavi" (case-insensitive, trim), rinominarlo in "Croci ai cavi in piedi" — una tantum, idempotente. Lo storico log resta agganciato (la chiave è l'id, non il nome; la migrazione tocca solo il display name).
- Variante eseguita: in piedi, chiusura ad altezza petto (eventuale nota descrittiva nel campo note dell'esercizio se presente nel modello).

## Non-obiettivi

- Nessuna modifica alla durata delle pause o alla struttura della scheda (i 40 min del giorno A erano pause tagliate, non un bug).
- Niente suoni custom configurabili oltre al volume.
- Il flash a schermo intero e il banner overlay (mockup scartati) non si fanno.

## Test

Suite esistente (314 verdi) + nuovi test:
- `session.js`: PR a reps — corpo libero puro (PR scatta su max reps), misto storico kg (resta su kg), transizione corpo libero → zavorrato.
- Migrazione nome "Croci ai cavi": rinomina una tantum, idempotente su run ripetuti, non tocca id/log.
- Timer: stato GO al raggiungimento di 0 (callback onEnd → trasformazione barra), chiusura al tap.
- Feel-ask: auto-chiusura dopo il tap, collapse esercizio su ultima serie, sostituzione giudizio entro la finestra.
- Suoni/volume: persistenza preferenza volume; nessun suono a volume 0.

## Verifica manuale

Sessione di prova (anche simulata a PC): serie fatta → feel → auto-close; ultima serie → collapse + apertura prossimo; timer a 13s → avviso a 10s, tick 3-2-1 rossi, boot log persistente, tocco per chiudere; tema Graphite per glow/scanline; dips senza kg → toast PR al superamento reps.
