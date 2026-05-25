# Gym Schedule — Redesign UI/UX (direzione "A+C, focus C")

**Data:** 2026-05-25
**Stato:** direzione visiva approvata, scope feature definito. Da qui → piano di implementazione.
**Mockup di riferimento (fonte di verità visiva):** `mockups/` + companion `candidato-AC.html`.

---

## 1. Contesto e obiettivo

App esistente: diario di allenamento statico (GitHub Pages, repo `xBacco/gym-schedule`), `data.json`
come "DB" scritto via API GitHub. Stack: HTML + CSS + JS vanilla a moduli (`app.js`, `store.js`,
`plan.js`, `timer.js`). Il piano allenamenti (`PLAN` in `plan.js`) è statico; `data.json` contiene
solo il log (pesi/rip svolti per settimana).

L'app è **già deployata e live** su https://xbacco.github.io/gym-schedule/ (vibrazione + beep WebAudio,
timer di recupero, recupero editabile per esercizio già implementati). **Questo lavoro è un redesign
del layer grafico e del modello di logging _sopra_ l'app esistente**, non un progetto da zero.

L'utente si allena 3×/settimana (giorni A/B/C), obiettivo **definizione + massa lean**, quindi la
**progressione di carico** è centrale. L'app si usa **dal telefono, in palestra, col pollice**.

Obiettivo di questo lavoro: rifare la **parte grafica e l'ergonomia di logging** con un'identità
**iconica ma minimale e usabilissima**, abbandonando il vecchio look (crema + terracotta + serif,
stile "Claude/editoriale" — esplicitamente non più voluto).

## 2. Direzione visiva scelta

Fusione di due esplorazioni: **struttura/UX della "C" (focus + stepper)** + **identità della "A"
(mono minimal)**. Focus sulla C.

- **Fondo** quasi-nero `#0E0F0E`; superfici `#151715` / `#1B1E1B`; linee hairline `#242824`.
- **Testo** `#ECEAE5`; secondario `#7C807A`; debole `#54574F` (alzare leggermente il contrasto
  rispetto al mockup per leggibilità — vedi §6).
- **Accento unico: verde `#3FE0A8`** (azione, stato, timer, progressione). Inchiostro su verde:
  `#07231B`. Usato col contagocce, mai decorativo.
- **Tipografia:** numeri e label tecniche in **JetBrains Mono** (DNA "IDE"); titoli/nomi in **Inter**.
- **Forme:** angoli arrotondati (14–20px), niente ombre pesanti, profondità con variazioni di fondo.
- **Niente:** gradienti, glow, emoji come icone funzionali, look "AI generico".

## 3. Schermata sessione (layout)

Singola colonna, `max-width` ~440px, mobile-first. Dall'alto:

1. **Header**: kicker mono `DAY A · SETT. 22 · PUSH`, titolo giorno (`Petto + Tricipiti`),
   **barra di progresso a N segmenti** (uno per esercizio) + `01/07`.
2. **Esercizio attivo "in focus"** (card grande):
   - nome + indice + target (`obj 4×6-8`);
   - **serie già fatte** come righe mono pulite (`1  8 × 72.5 kg  ▲ +2.5`), con spunta;
   - **blocco di inserimento** della serie corrente: **stepper carico** + ripetizioni + confronto
     "la volta scorsa";
   - **pallini serie** (fatte / corrente / da fare);
   - CTA **"Serie fatta · avvia recupero"**.
3. **Prossimi esercizi** collassati in righe compatte (indice, nome, target, best), **superset marcati**.
4. **Timer di recupero**: barra **fissa in basso**, clock mono grande, controlli `−15 / ⏸ / +15 / ✕`.

## 4. Regole di interazione (il cuore)

### 4.1 Logging per-serie
- Ogni esercizio ha **N serie**, ognuna con **ripetizioni e carico indipendenti**.
- Serie aggiungibili/rimovibili (non vincolate al target: il target è solo un suggerimento).

### 4.2 Stepper carico
- **Step fisso da 0.5 kg** (`−0.5` / `+0.5`) — l'utente usa anche dischi piccoli.
- Il valore della serie si **precompila dal valore della stessa serie/esercizio della volta scorsa**.
  Es.: settimana 1 Panca 50 kg → settimana 2 il contatore parte da **50.0 kg**, non da 0; si aggiusta
  col +/−. Se non esiste storico, parte vuoto/dal target.
- Ripetizioni editabili allo stesso modo (default = rip della volta scorsa, o target).

### 4.3 Superset
- Un esercizio "superset" ha **due tracce A e B**, ciascuna con le proprie serie (rip/kg indipendenti).
- Stesso modello di precompilazione e stepper per entrambe le tracce.

### 4.4 Progressione (confronto)
- Per ogni serie/esercizio mostrare **il dato della volta scorsa** (`era 6×70`) e una marcatura
  **`▲ +x`** quando il carico supera quello precedente. È il motore della progressione: sempre visibile.

### 4.5 Timer di recupero
- **Parte automaticamente** quando si tocca "Serie fatta" (durata = recupero suggerito dell'esercizio).
- A fine recupero: **vibrazione + suono**; la schermata **scorre/porta alla serie successiva**.
- Controlli: `−15s`, pausa/play, `+15s`, stop. Sempre visibile (barra fissa).
- Il timer continua anche cambiando esercizio nella stessa sessione.

## 5. Feature in scope

| # | Feature | Descrizione | Priorità |
|---|---------|-------------|----------|
| 1 | **Offline-first** | Scrittura immediata in `localStorage`; l'UI non aspetta mai la rete. | MUST |
| 2 | **Sync GitHub batch** | Sync verso `data.json` **non a ogni tasto** ma accorpata (es. all'avvio del recupero o ogni ~30s / a fine esercizio). Evita spam di commit e limiti API. | MUST |
| 3 | **Wake Lock** | Schermo sempre acceso durante la sessione attiva. | MUST/⭐ |
| 4 | **Avviso fine timer** | `navigator.vibrate` + beep WebAudio a fine recupero. **Già esistente** — riusare. | ⭐ |
| 5 | **Auto-start recupero + scroll** | "Serie fatta" → timer parte; fine timer → vai alla serie dopo. Oggi il timer parte al blur del campo: **cambiare trigger** al pulsante "Serie fatta". | ⭐ |
| 6 | **Confronto volta scorsa** | Vedi §4.4. | ⭐ |
| 7 | **PWA** | `manifest.json` + service worker: installabile su home, funziona offline. | ⭐ |
| 8 | **Nota rapida per esercizio** | Campo nota breve per esercizio, persistente tra le settimane (es. "presa stretta", "spalla tirava"). | in scope |
| 9 | **Calcolatore dischi** | Dato il carico target, mostra i dischi per lato. Assunzione default: bilanciere 20 kg, set dischi standard configurabile. | in scope |

## 6. Note di qualità (baseline)
- Input numerici: `inputmode="decimal"` quando si digita a mano (oltre allo stepper).
- **Contrasto**: alzare un filo i grigi deboli su fondo nero (testo secondario ≥ ~4.5:1 dove leggibile conta).
- Tap target ≥ 44px (stepper, CTA, controlli timer già conformi).
- API che richiedono HTTPS (Wake Lock, vibrate, audio, SW): ok, GitHub Pages è HTTPS.

## 7. Modello dati (estensione `data.json`)

Tenere il **piano statico separato** dal **log**. Bozza per settimana:

```jsonc
weeks: {
  "2026-W22": {
    label: "2026-W22",
    entries: {
      // esercizio normale
      "A:01": { sets: [ {reps: 8, kg: 72.5, done: true}, ... ], note: "presa media" },
      // superset → due tracce
      "A:05": {
        a: { sets: [ {reps:15, kg:25, done:true}, ... ] },
        b: { sets: [ {reps:15, kg:12, done:true}, ... ] },
        note: ""
      }
    }
  }
}
```

- `id` esercizio = `<giorno>:<indice>` (stabile rispetto a `PLAN`).
- **Precompilazione**: per la settimana corrente, leggere l'`entries` della settimana precedente
  con stesso `id` per derivare i default di kg/rip per serie.

### Migrazione dal modello attuale
Oggi `entries[id]` è un **singolo** `{kg, reps}` (con retrocompat per stringhe legacy via
`normalizeEntry` in `store.js`). Il redesign passa a **per-serie** (`sets: [...]`). Serve estendere
`normalizeEntry` per portare:
- stringa legacy → `{sets: [{reps, kg}]}` (1 serie);
- `{kg, reps}` singolo → `{sets: [{reps, kg}]}` (1 serie);
- già `{sets:[...]}` → invariato.
La migrazione è **non distruttiva** (i dati 2026-W22 esistenti restano leggibili).

## 8. Fuori scope (registrati per il futuro, non MVP)
- Long-press su +/− per ripetizione veloce.
- "Ripeti serie precedente" (copia rip+kg con un tap).
- Volume di sessione + mini-trend ultime 3 settimane per esercizio.
- Distinzione serie di riscaldamento vs working set.
- RPE / tag "com'è andata".

## 9. Decisioni (chiuse il 2026-05-25)
1. **Calcolatore dischi**: bilanciere **20 kg**; dischi di default **20 / 15 / 10 / 5 / 2.5 / 1.25 kg** per lato,
   **configurabili in ⚙ Impostazioni** (set dischi posseduti). Mostra i dischi per lato dato il carico.
2. **Sync batch**: il commit verso `data.json` avviene **all'avvio del recupero** ("Serie fatta"),
   più un flush di sicurezza all'uscita/chiusura sessione. Niente commit per singolo tasto.
3. **Suono fine timer**: **beep generato via WebAudio** (già in uso) — nessun asset, funziona offline.
4. **Serie già fatte modificabili** al tocco: **sì**, correzione al volo di rip/kg di una serie chiusa.
```
