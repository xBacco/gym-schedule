# Allenamento guidato — Design

> Data: 2026-05-27 · Progetto: gym-schedule (PWA offline, vanilla JS ES modules, dati su GitHub)

## Obiettivo

Rendere l'esecuzione dell'allenamento più "guidata" con tre interventi indipendenti emersi da un allenamento reale:

1. **Anteprima del prossimo esercizio** dentro l'overlay dell'esercizio aperto.
2. **Notifica di fine recupero** quando l'app non è in primo piano (best-effort, senza backend).
3. **Fix**: il popup del commento veloce si apre in alto a sinistra invece che centrato.

**Fuori scope (deciso con l'utente):** immagini/GIF di esecuzione per esercizio. Rimandato.

## Vincoli del progetto

- PWA **senza backend**: i dati stanno su GitHub (cross-origin), non c'è un server che possa inviare push.
- Logica pura in `session.js`/`store.js`/`timer.js`/`wakelock.js` testata con `node --test` (gate). Rendering/wiring DOM in `app.js`, non testato in Node → verifica in browser reale (Playwright, server HTTP locale).
- Commit + push diretti su `main` (no PR); prima del push `git fetch` + `git pull --ff-only`.
- Bump di `CACHE` in `sw.js` quando cambia un file dell'app-shell.
- Tema **Amber** (`--acc:#E8A93C`).

---

## 1. Anteprima "prossimo esercizio"

**Cosa:** in fondo all'overlay dell'esercizio aperto, una striscia fissa **sopra il pulsante "Serie fatta"** che mostra il prossimo esercizio del giorno corrente.

**Contenuto:** `Prossimo → <nome> · <target>` (es. `Prossimo → Rematore bilanciere · 3 × 8-10`). Solo informativa, **non cliccabile**.

**Ultimo esercizio:** quando non c'è un successivo, mostrare una riga discreta `Ultimo esercizio della sessione` (senza freccia, attenuata).

**Posizione (variante A, scelta dall'utente):** la striscia sta nel footer dell'overlay, sopra la CTA, sempre visibile senza scrollare. Durante il recupero la barra timer (`#timerBar`, `position:fixed; bottom:0`) compare più in basso e non la copre.

**Logica pura (testabile):** nuovo helper in `session.js`:

```js
// Ritorna i dati per la striscia "prossimo" dato il giorno e l'indice corrente.
// { last: true } se idx è l'ultimo esercizio; altrimenti { last:false, name, target }.
export function nextExercisePreview(exercises, idx) { ... }
```

dove `target` è `setsReps` dell'esercizio successivo. (Nessun parsing complesso: si mostra `setsReps` così com'è, come fa già la lista.)

**Rendering:** una funzione DOM condivisa `buildNextStrip(exercises, idx)` chiamata sia da `renderFocusNormal` sia da `renderFocusSuperset`, che appende la striscia nel `footer` prima della CTA.

---

## 2. Notifica di fine recupero (best-effort, niente backend)

### Realtà tecnica
A schermo **completamente bloccato / app uccisa**, una notifica affidabile **non è ottenibile** con questa architettura: il JS in pagina viene sospeso e non c'è un server push. Le uniche vie garantite (Push API con server, Notification Triggers) sono rispettivamente fuori scope e non disponibili nei browser. Si copre quindi:

- **App in primo piano** → avviso in-app potenziato (sempre affidabile).
- **App in background ma viva** (altra scheda del browser, app minimizzata di recente, telefono posato con schermo acceso grazie al Wake Lock già attivo durante il recupero) → notifica di sistema.
- **Schermo bloccato / app terminata** → non garantito (limite di piattaforma, documentato in Impostazioni).

### Interruttore in Impostazioni
- Nuovo checkbox in ⚙ (`#notifyToggle`), label **"Avvisi recupero"**, **off di default**.
- Stato persistito in `localStorage` con chiave `gymsched_notify` ("1"/"0").
- Al passaggio **off → on**, dentro il gesto del tap, chiamare `Notification.requestPermission()`:
  - se `granted` → resta attivo;
  - se `denied`/`default` → riportare il toggle a off e mostrare un hint ("Permesso negato dal browser/sistema").
- Hint sotto al toggle che documenta il limite: *"A schermo bloccato o app chiusa la notifica potrebbe non arrivare."*

### Comportamento a fine recupero (`timer.onEnd`)
Stato attuale: vibra `[200,100,200]` + `beep()` + nasconde la barra dopo 1,5 s. Si aggiunge:

- Se `document.hidden` **e** notifiche abilitate+`granted`:
  `registration.showNotification("Recupero finito", { body: "<esercizio> · prossima serie", tag: "rest-done", renotify: true, vibrate: [200,100,200], icon: <icona app> })`.
  (Si usa la registrazione del service worker già presente.)
- Se l'app è **in primo piano** (`!document.hidden`): mostrare un **banner in-app temporaneo ~2,5 s** "RECUPERO FINITO" ben visibile (oltre a vibrazione + beep). Niente notifica di sistema ridondante quando l'app è già a fuoco.

### Tap sulla notifica
- Handler `notificationclick` in `sw.js`: `event.notification.close()` + focus/apertura della finestra esistente (`clients.matchAll` → `client.focus()`, altrimenti `clients.openWindow("./")`).

### Note
- L'esercizio per il `body` della notifica è la `label` già passata al `RestTimer` (`ex.name`), disponibile nel callback.
- Nessun cambiamento alla logica del countdown (resta `timer.js` invariato).

---

## 3. Fix popup commento veloce centrato

**Causa:** il reset globale `*{ ... margin:0 ... }` (riga 7 di `style.css`) sovrascrive il `margin:auto` che lo user-agent applica ai `<dialog>` modali per centrarli; la regola `dialog{}` non lo ripristina, quindi il dialog si incolla in alto a sinistra. Riguarda tutti i `<dialog>` modali (commento veloce, modifica serie, impostazioni), ma è più evidente sul popup commento veloce su mobile.

**Fix:** aggiungere `margin:auto;` alla regola `dialog{}` in `style.css`. Ricentra tutti i dialog modali con una sola modifica.

**Verifica:** in browser reale (Playwright) su viewport stretto (es. 380×780): aprire il popup commento veloce e confermare che è centrato; controllare di passaggio anche modifica-serie e impostazioni.

---

## Testing

- **`node --test` (gate):** nuovo test per `nextExercisePreview` (caso normale → `{last:false,name,target}`; ultimo esercizio → `{last:true}`). Atteso: suite a **115 test**.
- **Browser (Playwright):**
  - striscia "Prossimo" visibile sopra la CTA negli esercizi normali e superset; riga "Ultimo esercizio della sessione" sull'ottavo;
  - toggle "Avvisi recupero" in Impostazioni chiede il permesso e si comporta bene su grant/deny;
  - popup commento veloce centrato su viewport stretto.
- **Bump cache:** `gymsched-v13` → `gymsched-v14` (cambiano `app.js`, `style.css`, `sw.js`, `index.html`).

## File toccati (previsti)

- `session.js` — nuovo `nextExercisePreview` (logica pura).
- `tests/session.test.js` — test del nuovo helper.
- `app.js` — `buildNextStrip` + chiamata in `renderFocusNormal`/`renderFocusSuperset`; toggle notifiche in Impostazioni + persistenza; logica notifica in `timer.onEnd`; banner in-app.
- `index.html` — checkbox "Avvisi recupero" + hint nel dialog impostazioni; markup banner in-app.
- `style.css` — `margin:auto` su `dialog`; stile striscia "Prossimo"; stile banner in-app; stile toggle.
- `sw.js` — handler `notificationclick`; bump `CACHE` a `gymsched-v14`.
