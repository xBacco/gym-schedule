# Smoke test E2E (Playwright) — design

Data: 2026-06-12
Sotto-progetto: **#4a di 9** del programma "tutte e 4". Apre il blocco Refactor: è la rete
di sicurezza che protegge il successivo split di `app.js` (#4b).

## Problema

La suite attuale (`node --test`, 446 test) copre i moduli puri ma **non** verifica che l'app
si monti e si wire-i nel browser. Ogni release nella memoria finisce con "verifica iPhone =
utente": non c'è un controllo automatico end-to-end. Prima di rifattorizzare il monolite
`app.js` (4123 righe) serve una rete: un test che dica "dopo lo split l'app fa ancora boot,
monta la shell, funziona offline, senza errori console".

## Obiettivo

Una suite E2E headless, committata e riproducibile, che codifica la verifica di boot
(online + offline) già fatta a mano per #1. Deterministica, senza dipendenze esterne
(niente Supabase/account).

## Scope (deciso 2026-06-12)

**A — Shell + offline, senza login.** Scartati: B (happy path autenticato reale, flaky) e
C (autenticato con Supabase mockato, più setup). C resta un possibile incremento futuro.

## Non-obiettivi

- Login/auth E2E.
- CI (GitHub Actions): opzionale, fuori da questo sotto-progetto.
- Far girare gli E2E dentro `npm test`: restano separati (`npm run e2e`) per tenere la
  suite unit veloce.

## Componenti

1. **devDep `@playwright/test`** (pinnato). I binari del browser (`chromium`) si installano
   con `npx playwright install chromium`: locali, **non committati**, non spediti al runtime.
2. **`scripts/static-server.cjs`** (nuovo, **zero dipendenze**, node `http`+`fs`): serve la
   root del repo con i MIME corretti — fondamentale `text/javascript` per i moduli ESM e il
   service worker, più `application/json`, `image/svg+xml`, `text/css`, `image/png`,
   `text/html`. `/` → `index.html`. Porta da argomento/env (default 8766).
3. **`playwright.config.js`** (root): `testDir: 'e2e'`, un project `chromium`,
   `use.baseURL` su `http://localhost:8766`, `webServer` che lancia
   `node scripts/static-server.cjs 8766` e attende il 200, `reuseExistingServer: !process.env.CI`.
4. **`e2e/boot.spec.js`** — 2 test:
   - **boot online**: `goto /` → la schermata login è visibile (testo "autenticazione
     richiesta"), `title === "set.log"`, **nessuna** richiesta verso `esm.sh`/CDN, **nessun**
     errore console o `pageerror`.
   - **boot offline**: `goto /` → attendi `navigator.serviceWorker.ready` → `setOffline(true)`
     → `reload` → la schermata login è ancora visibile, nessun errore → `setOffline(false)`.
5. **`package.json`**: nuovo script `"e2e": "playwright test"`. `npm test` invariato.
6. **`.gitignore`**: aggiunge `test-results/` e `playwright-report/`.
7. **README**: una riga su `npm run e2e` + prerequisito `npx playwright install chromium`.

## Test / criteri di completamento

- `npm run e2e` → 2 test verdi (su una macchina con chromium installato).
- `npm test` → 446 verdi invariati.
- Nessun file di artefatti E2E committato per errore.

## Rischi

- I binari del browser pesano (download una-tantum). Su macchina pulita serve
  `npx playwright install chromium` prima del primo run. Documentato nel README.
- Il `webServer` di Playwright deve servire i `.js` come `text/javascript`, altrimenti i
  moduli ESM e il SW non si caricano: il server custom lo garantisce esplicitamente.
