# gym-schedule — Design / Spec

**Data:** 2026-05-25
**Autore:** Tomas Coronato
**Stato:** approvato (design), in attesa di review della spec scritta

## 1. Obiettivo

Web app personale (utente singolo) per gestire la propria scheda di allenamento e
loggare carico/reps seduta per seduta. Gestibile da PC, accessibile da telefono in
palestra, con i dati **sempre sincronizzati** tra i dispositivi. Include un **timer
di recupero** che parte automaticamente a fine esercizio.

Non-obiettivi (YAGNI): multi-utente, autenticazione/login, condivisione social,
grafici avanzati, app nativa, supporto offline-first completo.

## 2. Stack & hosting

- **Frontend:** HTML + CSS + JavaScript puro (vanilla). Nessun framework, **nessun
  build step**.
- **Hosting:** GitHub Pages dal repo pubblico `xBacco/gym-schedule` (branch `main`,
  root).
- **Motivazione del JS lato client:** GitHub Pages serve solo file statici; un
  backend Python richiederebbe un server. La logica resta volutamente semplice e
  commentata.

## 3. Modello di sincronizzazione (Approccio A — repo come database)

- I dati vivono in `data.json` **nello stesso repo**.
- L'app legge `data.json` e lo riscrive tramite la **GitHub Contents API**, usando un
  **token fine-grained** dell'utente (permesso *Contents: read & write* limitato al
  solo repo `gym-schedule`).
- Il token è inserito una volta per dispositivo e salvato in `localStorage` del
  browser. **Non viene mai committato nel repo.**
- Ogni salvataggio è un commit → la **cronologia git è lo storico** dei dati.

## 4. Struttura del repo

```
gym-schedule/
├─ index.html        # struttura pagina
├─ style.css         # stile (palette calda, coerente con scheda-interattiva.html)
├─ plan.js           # LA SCHEDA: 3 giorni, esercizi, serie/rip/rec + restSeconds
├─ timer.js          # logica timer di recupero (isolata)
├─ store.js          # motore dati: load/save/merge + GitHub API + buffer locale
├─ app.js            # rendering UI + wiring eventi (usa store.js e timer.js)
├─ data.json         # database: log per settimana (scritto via API)
├─ README.md
└─ docs/superpowers/specs/2026-05-25-gym-schedule-webapp-design.md
```

Confini dei moduli:
- `plan.js` — **solo dati** statici, nessuna logica.
- `timer.js` — **solo logica timer**, nessuna dipendenza da dati/sync.
- `store.js` — logica dati e rete, testabile in isolamento (funzioni pure per
  merge/chiavi).
- `app.js` — orchestrazione UI; dipende da `plan`, `store`, `timer`.

## 5. Modello dati (`data.json`)

```json
{
  "updatedAt": "2026-05-25T17:30:00Z",
  "weeks": {
    "2026-W22": {
      "label": "Sett. 1",
      "entries": {
        "A": { "0": "60kg 8/8/7", "2": "..." },
        "B": {},
        "C": {}
      }
    }
  }
}
```

- Chiave settimana in formato ISO `YYYY-Www` (es. `2026-W22`).
- `entries[day][exerciseIndex]` = stringa libera (es. "60kg 8/8/7").
- `label` = etichetta leggibile modificabile dall'utente.
- File iniziale: `{ "updatedAt": null, "weeks": {} }`.

## 6. La scheda (`plan.js`) con tempi di recupero

Ogni esercizio: `[nome, serieRip, recTesto, restSeconds, isSuperset]`.

### Giorno A — Petto + Tricipiti
1. Panca piana bilanciere — 4×6-8 — 2-3 min — **150s**
2. Lento avanti manubri — 3×8-10 — 2 min — **120s**
3. Croci ai cavi — 3×12-15 — 75 sec — **75s**
4. Pulldown al cavo alto, presa larga — 3×10-12 — 90 sec — **90s**
5. Pushdown tricipiti + Curl manubri (superset) — 3×12-15 / 3×12-15 — 75 sec — **75s**
6. Polpacci in piedi — 3×12-15 — 60 sec — **60s**
7. Crunch a terra + Plank (superset) — 3×15-20 / 3×max — 45 sec — **45s**

### Giorno B — Dorso + Bicipiti + Gambe
1. Stacco rumeno — 3×8-10 — 2-3 min — **150s**
2. Rematore bilanciere — 4×8-10 — 2-3 min — **150s**
3. Affondi camminata o Goblet squat — 3×10-12 — 90-120 s — **120s**
4. Panca inclinata manubri — 3×8-10 — 90 sec — **90s**
5. Curl EZ + Skullcrusher (superset) — 3×8-10 / 3×10-12 — 75 sec — **75s**
6. Face pull — 3×15-20 — 60 sec — **60s**
7. Leg raise + Russian twist (superset) — 3×12-15 / 3×20 — 45 sec — **45s**

### Giorno C — Spalle + Braccia
1. Lento avanti bilanciere — 4×6-8 — 2 min — **120s**
2. Alzate laterali (manubri o cavo) — 3×12-15 — 60 sec — **60s**
3. Spinte manubri panca piana (o chest press) — 3×10-12 — 90 sec — **90s**
4. Rematore al cavo, presa neutra — 3×10-12 — 90 sec — **90s**
5. Curl EZ + Skullcrusher (superset) — 3×8-10 / 3×10-12 — 75 sec — **75s**
6. Curl concentrato + Pushdown (superset) — 2×15 / 2×15 — 60 sec — **60s**
7. Crunch inverso + Plank laterale (superset) — 3×15 / 3×max/lato — 45 sec — **45s**

## 7. Flussi di sincronizzazione

### Caricamento (apertura app)
1. Leggi `data.json` (via Contents API se c'è token, altrimenti raw URL pubblico in
   sola lettura).
2. Determina la settimana corrente (chiave ISO della data odierna); se non esiste,
   mostra l'ultima disponibile o invita a creare la settimana.
3. Renderizza la scheda con i valori della settimana selezionata.
4. Pulsante **Aggiorna** + ricarica automatica su evento `visibilitychange`
   (ritorno sulla scheda).

### Salvataggio (modifica di un campo)
1. Scrivi subito in `localStorage` (buffer "in attesa di sync").
2. Debounce ~1,5 s dopo l'ultima digitazione (o `blur` del campo).
3. `GET` `data.json` → ottieni `sha` e contenuto più recente.
4. **Merge** della modifica locale nel contenuto remoto (non sovrascrivere altri
   campi).
5. `PUT` con il `sha` → commit. Messaggio commit: `log: <settimana> <giorno> <es.>`.
6. In caso di **409 (sha cambiato)**: rileggi, ri-merge, riprova una volta; se
   fallisce ancora, mostra avviso e mantieni il buffer locale.

### Gestione settimane
- Selettore in alto: settimane esistenti + voce **"Nuova settimana"**.
- Creando una settimana nuova: i valori della settimana precedente compaiono come
  **placeholder** (testo grigio) per riferimento, senza essere copiati nei dati.

## 8. Timer di recupero (`timer.js` + UI in `app.js`)

- **Sorgente durata:** `restSeconds` dell'esercizio.
- **Avvio automatico:** al `blur` di un campo carico/reps non vuoto, parte il
  recupero di quell'esercizio.
- **Avvio manuale:** ogni card esercizio ha un pulsante **⏱** per (ri)avviare il suo
  recupero tra le serie.
- **Widget fisso** in basso: countdown, nome esercizio, controlli **pausa/riprendi**,
  **+15s / −15s**, **stop**.
- **Fine recupero:** `navigator.vibrate()` + **beep** generato via WebAudio
  (oscillatore, nessun file audio). L'`AudioContext` viene sbloccato al primo
  gesto utente (Android Chrome supporta vibrazione e audio).
- **Robustezza:** il timer memorizza un **timestamp di fine** (`Date.now() + durata`)
  e ricalcola il tempo rimanente a ogni tick e su `visibilitychange`, così il blocco
  schermo non lo falsa. Pensato per uso a schermo acceso.

## 9. Gestione errori (no silent failure)

- **Rete assente / errore API:** ogni modifica resta nel buffer `localStorage`;
  indicatore di stato mostra **"in attesa di sync ⧗"**; ritenta al salvataggio
  successivo o al ritorno online. Mai perdita dati silenziosa.
- **Token mancante/scaduto/non valido (401/403):** messaggio chiaro e richiesta di
  reinserire il token. Modalità sola lettura se non c'è token.
- **Conflitto 409:** re-fetch + merge + un retry; poi avviso esplicito.
- **`data.json` assente:** l'app lo crea con la struttura iniziale al primo salvataggio.
- Indicatore di stato sempre visibile: **"salvato sul cloud ✓"** / **"in attesa ⧗"** /
  **"errore ⚠"**.

## 10. Testing

- **Test unitari (Node, `assert`, nessuna libreria):** funzioni pure di `store.js`:
  - calcolo chiave-settimana ISO da una data;
  - merge di una entry in un `data.json` esistente senza perdere altri campi;
  - validazione/normalizzazione della forma del JSON;
  - parsing/utility del timer (formattazione mm:ss, ricalcolo da timestamp).
- **Smoke test manuale / Playwright:** carica pagina → compila un campo → verifica
  buffer locale e (con token di test su repo di prova) il commit; verifica avvio
  timer al blur.
- Le chiamate di rete in `store.js` sono isolate dietro funzioni iniettabili, così i
  test girano senza toccare GitHub.

## 11. Sicurezza & privacy

- Repo **pubblico**: `data.json` (carico/reps) è visibile a chi ha il link.
  Sensibilità bassa, accettata dall'utente.
- Il **token non è mai nel repo**: vive solo in `localStorage` del browser.
- Token **fine-grained** limitato al solo repo `gym-schedule`, permesso *Contents*:
  blast radius minimo se compromesso. Revocabile in qualsiasi momento da GitHub.

## 12. Prerequisiti su GitHub (a carico dell'utente, con guida passo-passo)

1. Repo `xBacco/gym-schedule` esistente e **pubblico**.
2. **Token fine-grained** con *Contents: read & write* sul solo repo.
3. **GitHub Pages** attivo (Settings → Pages → branch `main` / root).

## 13. Sequenza di build (alto livello, dettagli nel piano)

1. Scaffolding repo + `data.json` iniziale + `README`.
2. `plan.js` con scheda e `restSeconds`.
3. `style.css` + `index.html` (layout mobile, palette calda).
4. `store.js` (load/save/merge/buffer/API) + test unitari.
5. `timer.js` (countdown, vibrazione, beep) + test utility.
6. `app.js` (rendering, settimane, wiring timer + salvataggio).
7. Smoke test end-to-end.
8. Deploy Pages + collaudo da telefono.
