# V2 — Restyle “terminale/informatico” + onboarding multi-utente

Data: 2026-05-31
Stato: design approvato nei mockup, in attesa di review dello spec scritto.

## 1. Obiettivo

Rendere l'app utilizzabile **da chiunque**: un utente nuovo non deve trovare la
scheda personale del proprietario, ma una schermata vuota da cui **creare la
propria scheda da zero**. In parallelo, restyle completo dell'interfaccia con una
identità visiva **“console + telemetria”** (tema **Amber CRT**).

La base multi-utente (Supabase, dati namespacizzati per `uid`) **esiste già** e non
va riscritta: questo lavoro è prevalentemente **UI/UX + flusso di onboarding**, con
un piccolo intervento sui dati (rimozione della scheda hardcoded dal percorso dei
nuovi utenti).

## 2. Decisioni fissate (dai mockup)

- **Onboarding = empty-state** (opzione A). Niente template generici fatti da noi
  (le schede sono troppo soggettive). Eventuali template restano un'idea futura
  *personale* (duplicare le proprie schede), fuori da questo spec.
- **Tema = Amber CRT** (Visione B): fosfori ambra, glow leggero, scanline.
- **Terminale = estetica, non interazione**: look da console (monospace, status
  bar, prompt `>`/`$`, bordi, telemetria) ma **interazione a tap** normale. Nessuna
  riga di comando obbligatoria per loggare le serie.
- **Nessuna feature AI** in questo spec (valutata e rimandata: richiede proxy
  server-side per la API key + un modello di costo; vedi §10).
- **Dati del proprietario preservati**: scheda + progressi restano sul suo account.
  La scheda personale oggi hardcoded in `plan.js` non deve più comparire ai nuovi
  utenti.

## 3. Design System — “Amber CRT console”

Implementato in `style.css` (più eventuali variabili CSS). Nessuna libreria nuova.

**Palette (CSS custom properties su `:root`):**
```
--bg:   #0c0a06   /* near-black caldo            */
--panel:#16120a   /* superfici/box               */
--line: #2a2012   /* bordi                       */
--fg:   #c2a86a   /* testo base                  */
--tx:   #f0dca0   /* testo in evidenza           */
--ac:   #ffd36b   /* accento azioni (giallo-oro) */
--ac2:  #e0a04a   /* accento dati/telemetria     */
--dim:  #5a4a2a   /* testo attenuato/meta        */
--warn: #e0705a   /* errori/alert (rosso caldo)  */
--ctb:  #2a1f08   /* sfondo CTA                  */
--ctc:  #4a3712   /* bordo CTA                   */
```
- **Glow** sui testi accento: `text-shadow: 0 0 5px #ffd36b44` (sobrio, non ovunque).
- **Scanline** opzionale come overlay `repeating-linear-gradient` a bassissima
  opacità sull'app-shell; deve poter essere **disattivata** (accessibilità /
  preferenza). Rispettare `prefers-reduced-motion` (niente animazioni del cursore).
- **Type**: stack monospace di sistema
  (`ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace`). Nessun web-font
  (resta PWA offline, niente fetch font).

**Componenti ricorrenti (firma visiva):**
- `status bar` in alto e in basso ad ogni schermata: sinistra `◈ <contesto>`,
  destra stato/contatori. Altezza fissa, font ~10px.
- `box` bordato (`--line`, radius 6–7px) per liste, celle telemetria, righe serie.
- `cta` = sfondo `--ctb`, bordo `--ctc`, testo `--ac`, prefisso `›`/`[ ]`.
- `stepper` kg/rip: bottoni quadrati `−`/`+` con bordo `--ctc`.
- `chip`: tab giorni e selettori (stato attivo = sfondo `--ctb`).
- `sparkline`/grafici: SVG, tratto `--ac2`, punto finale `--ac`.
- Motivi testuali: `$`/`>` prompt, `#` commenti/meta, `//` note, `★` PR, `▓░`
  barre, `✓ ! ~` simboli di stato nel log.

## 4. Schermate (comportamento + note)

Tutte le schermate adottano il design system. Comportamento funzionale invariato
rispetto a oggi salvo dove indicato.

1. **Benvenuto / empty-state** (NUOVA, per scheda vuota)
   - Mostrata quando `data.plan` è assente/vuoto **e** `data.weeks` è vuoto.
   - Prompt centrale `$ crea scheda`, due celle telemetria a `00` / `0kg`, CTA
     `› crea la prima scheda`. Nessun riferimento alla scheda del proprietario.
2. **Home** — selettore settimana `‹ W## ›`, tab giorni `[A] B C…`, righe esercizio
   numerate con azione `› log`; serie già fatte mostrano `✓ NxR`; sparkline volume.
3. **Esercizio (logging)** — target + `// ultima volta`; serie come righe (`s1 ✓`),
   serie attiva con stepper kg/rip + chip *feel*; CTA `› registra serie`.
4. **Timer recupero** — countdown monospace grande, barra ASCII `[▓░]`, “prossima
   serie”, cue sonori (riusa `timer.js`); bottoni `+15″` / `salta ›`.
5. **Note / commenti / extra** — PR come badge `★`, note `//`, log datato con
   simboli `✓ ! ~`, meta `#muscoli`, manubri ×2 / EZ.
6. **Sessione guidata** — focus esercizio corrente, barra avanzamento giorno,
   prec/poi, cronometro durata (riusa `session.js`).
7. **Progressione** — selettore esercizio, grafico carico (SVG teal/amber), KPI
   `MAX / Δ / VOL`, righe-settimana con barre `▓` e `★` sui PR.
8. **Calendario** — griglia mese coi giorni allenati marcati `N·A/B/C`, riepilogo
   del giorno, streak.
9. **Impostazioni** — stesso tema; voci come righe `key: value`; lo switch/scuro
   attuale diventa coerente (il tema chiaro/scuro odierno è assorbito dal tema CRT;
   valutare se mantenere un toggle “scanline on/off” e “glow on/off”).
10. **Editor scheda** — vedi §5.

## 5. Flusso “crea scheda da zero”

Oggi l'editor (`renderPlanEditor`) assume **giorni fissi** (tab A/B/C…) e la scheda
nasce dal seed `PLAN`. Per un utente nuovo non ci sono giorni. Cambiamenti:

- **Creazione giorni dinamica**: l'editor deve poter **aggiungere/rinominare/
  eliminare giorni** (oggi i tab sono statici). Stato vuoto editor → CTA
  `+ aggiungi giorno`.
- **Primo giorno**: l'utente dà un nome (es. “Petto/Tricipiti”), poi aggiunge
  esercizi con il dialog esistente (`openExDialog`: nome, serie×rip, recupero;
  più i campi già presenti muscle/superset/manubri/EZ).
- **Schema dati**: i giorni restano in `data.plan` (già così dopo `migrate`). La
  differenza è che la lista giorni diventa **editabile** e non più derivata da un
  insieme fisso `A/B/C`. Gli `id` esercizio restano stabili (logica `genId`
  esistente).
- L'empty-state (schermata §4.1) è il punto d'ingresso: `› crea scheda` apre
  l'editor vuoto.

Resa grafica scelta: **editor vuoto minimale** (variante “C1” dei mockup), coerente
col tema, con `+ aggiungi giorno` / `+ aggiungi esercizio`.

## 6. Modifiche al codice (mappa, non esaustiva)

- `style.css` — **riscrittura del tema** sulle nuove variabili. Grosso del lavoro.
- `index.html` — markup status bar, empty-state, ritocchi struttura (tab giorni
  dinamici, contenitore empty-state).
- `app.js`:
  - `offerSeedIfEmpty()` → sostituito/affiancato dalla logica empty-state: un nuovo
    utente con scheda vuota vede la schermata Benvenuto, **non** l'offerta di
    importare la scheda del proprietario (vedi §7).
  - `renderPlanEditor()` + dintorni → supporto **giorni dinamici** (add/rename/del).
  - render delle varie viste → classi/markup del nuovo tema.
- `plan.js` — la costante `PLAN` (scheda personale del proprietario) **non deve più
  essere il seed dei nuovi utenti**. Resta al massimo come dato per la migrazione
  del solo account proprietario (vedi §8) o viene spostata fuori dal percorso comune.
- `editor.js` — `migrate/backfillMuscles` invariati per i dati esistenti; va gestito
  il caso “nessun seed” senza crash (oggi `migrate(data)` è chiamato senza `seedPlan`
  e si salva solo perché i dati esistenti hanno già `schema>=2`; per i nuovi utenti
  va garantito un percorso pulito che non richieda `PLAN`).
- `store.js`/`sync.js`/`auth.js`/`supabase-client.js` — **nessuna modifica logica**
  (solo UI). Il backend multi-utente resta com'è.
- `sw.js` — **bump versione cache** (asset cambiati). Mantenere il meccanismo
  banner-update v38 (polling + waiting-check + forza-aggiornamento).
- `tests/` — aggiornare snapshot/UI test impattati; nuovi test per giorni dinamici
  ed empty-state (vedi §9).

## 7. Onboarding & demo

- Utente **nuovo** → empty-state. Nessun import automatico della scheda altrui.
- L'attuale `seedDialog` (“importa scheda demo da `data.json` pubblico”) viene
  **rimosso dal flusso del nuovo utente**. Opzioni (da confermare in review):
  - (a) eliminarlo del tutto;
  - (b) mantenerlo come voce esplicita e neutra in Impostazioni (“importa scheda di
    esempio”), **senza** che la demo sia la scheda personale del proprietario.
  - Raccomandazione: **(a)** per l'MVP (più pulito), con possibilità di import file
    `.json` dell'utente (export/import è già nel backlog migliorie #4).

## 8. Dati del proprietario (account esistente)

- Scheda + progressi del proprietario **restano** (sono già sul suo account Supabase,
  namespacizzati). Nessuna perdita.
- La scheda personale hardcoded (`PLAN`) viene tolta dal percorso comune; per il
  proprietario è già materializzata in `data.plan` sul suo account, quindi continua
  a vederla normalmente.
- Extra richiesto: poter **salvare la propria scheda come template personale**
  riutilizzabile. → Marcato come **fast-follow** (non MVP): serve un piccolo
  contenitore `data.templates` + “duplica in nuova scheda”. Fuori da questo spec se
  allunga troppo; lo spec di V2 si concentra su restyle + empty-state.

## 9. Testing

- Mantenere verdi i test esistenti (era 215; aggiornare quelli UI-dipendenti).
- Nuovi test:
  - empty-state mostrato quando `plan` e `weeks` sono vuoti; nascosto quando c'è una
    scheda;
  - editor: aggiungi giorno / rinomina / elimina; `id` stabili dopo le operazioni;
  - nessun crash nel boot di un utente nuovo senza `PLAN`/seed;
  - toggle scanline/glow non rompe il render.
- Verifica E2E manuale su mobile (priorità mobile-first) per logging serie e timer.

## 10. Fuori scope (esplicito)

- **Generazione scheda con AI** (mockup “I2”): richiederebbe un proxy server-side
  (Supabase Edge Function) per nascondere la API key + un modello di costo
  (free-con-quota / BYOK / a pagamento con Stripe). Rimandata a valutazione separata.
- **Template generici** preconfezionati da noi.
- **Template personali** (duplica le tue schede): fast-follow, vedi §8.

## 11. Preservazione V1

Prima di iniziare la V2:
- creare **tag git `v1-classic`** sul commit corrente e un **branch `v1`** (ramo di
  manutenzione / rollback). La V2 prosegue sul ramo principale.
- Aggiornare la memoria di progetto con il punto di taglio V1 → V2.

## 12. Sequenza di build (alto livello)

1. Tag/branch V1.
2. Design system in `style.css` (+ variabili) — applicato all'app-shell e a 1
   schermata pilota (Home) per validare il tema sul device reale.
3. Empty-state + giorni dinamici nell'editor (sblocca “crea da zero”).
4. Rimozione seed personale dal percorso nuovi utenti (`offerSeedIfEmpty`/`PLAN`).
5. Restyle schermata per schermata (Esercizio, Timer, Note, Sessione, Progressione,
   Calendario, Impostazioni).
6. Bump cache SW + test + verifica mobile.
