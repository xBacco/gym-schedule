# Offline reale — vendoring del client Supabase (design)

Data: 2026-06-12
Sotto-progetto: **#1 di 9** del programma "tutte e 4" (Fondamenta → Refactor → Feature → Capacitor).

## Problema

`supabase-client.js` importa `createClient` da `https://esm.sh/@supabase/supabase-js@2`
(cross-origin). Il service worker (`sw.js`) cacha solo asset **same-origin**, quindi quel
bundle non è nella cache dell'app-shell. `app.js` importa `supabase` direttamente
(`app.js:17`), perciò se l'import esm.sh non si risolve l'intero grafo dei moduli non si
valuta e **l'app non fa boot offline**. Oggi "a volte funziona" solo perché il browser può
avere esm.sh nella cache HTTP da una visita online precedente: comportamento **non
deterministico**. Per un'app da palestra (segnale scarso/assente) è il difetto che la fa
sentire "non vera".

## Obiettivo

L'app fa boot e gira **interamente offline** in modo deterministico, eliminando l'unica
dipendenza JS runtime cross-origin. La semantica di sync **non cambia**.

## Non-obiettivi (fuori scope)

- Far riuscire le chiamate di rete Supabase offline: impossibile. La coda esistente
  (`gymsched_pending` / `getPending` / `applyPending` in `app.js`, stato `pending` in
  `sync.js`) già bufferizza le scritture offline e sincronizza al rientro. **Invariato.**
- Il fetch legacy di `data.json` da `api.github.com` (recovery on-demand in Impostazioni):
  non serve al boot. **Invariato.**
- Nessun build step permanente per il sito statico: esbuild gira **solo** quando si
  (ri)vendorizza, come già fa `scripts/vendor-body-data.cjs`.

## Approccio scelto

Vendoring **una-tantum con esbuild** (deciso 2026-06-12). Le alternative scartate erano un
bundle pronto da esm.sh/jsDelivr (`?bundle` / `+esm`): zero tooling ma rischio di sub-import
o dynamic-import residui → offline non garantito. esbuild è l'unica strada che **garantisce**
un singolo file autonomo senza richieste di rete nascoste (incluso realtime/websocket).

## Modifiche

1. **`package.json` → `devDependencies`**: `@supabase/supabase-js` (versione **pinnata
   esatta**, l'attuale 2.x risolta al momento del vendoring) + `esbuild` (pinnato). Solo
   dev-time: **non vengono spediti**.

2. **`scripts/vendor-supabase.cjs`** (nuovo): lancia esbuild via API Node con
   `entryPoints: ['@supabase/supabase-js']`, `bundle: true`, `format: 'esm'`,
   `platform: 'browser'`, `target: 'es2020'`, `minify: true`, output `vendor/supabase.js`.
   Dopo il build esegue un **assert anti-rete**: se l'output contiene un `from "http…"` /
   `import "http…"` o un dynamic-import remoto, esce con errore (non scrive un file rotto).
   Stampa versione risolta + dimensione in byte.

3. **`vendor/supabase.js`** (nuovo, **committato**): l'artefatto che viene spedito e cachato
   dal SW. Header generato: sorgente, versione esatta, "generato — non editare".

4. **`supabase-client.js`**: cambia la riga di import da
   `https://esm.sh/@supabase/supabase-js@2` a `./vendor/supabase.js`. Nient'altro:
   l'API `createClient` e la config (`persistSession`, `autoRefreshToken`,
   `detectSessionInUrl`) restano identiche.

5. **`sw.js`**: aggiunge `"./vendor/supabase.js"` agli `ASSETS`; bump `CACHE`
   `gymsched-v78` → `gymsched-v79`.

6. **`.gitignore`**: assicura `node_modules/` ignorato; `vendor/supabase.js` **versionato**.

## Test

- **Guard test unitario** (`tests/vendor-supabase.test.js`, gira in `npm test`): asserisce
  che `vendor/supabase.js` esiste e **non contiene import remoti** (`from "http…"` /
  `import("http…")`). Blocca l'invariante per sempre: se qualcuno reintroduce un CDN, il
  test diventa rosso. Inoltre asserisce che `supabase-client.js` importi dal path locale,
  non da un URL.
- **Verifica offline reale (Playwright)**: avvia il server statico, carica l'app, attende la
  registrazione del SW, mette il browser **offline**, ricarica → l'app fa boot e mostra la
  schermata di login (o la sessione cachata) senza errori di modulo in console. È uno smoke
  mirato; la suite E2E completa è il sotto-progetto #4a.

## Rischi

- supabase-js v2 è pubblicato per i bundler; con `platform: 'browser'` esbuild risolve il
  campo browser (WebSocket nativo invece di `ws`). Atteso: bundle ESM singolo pulito,
  ~100–150 KB minificato, cachato una sola volta. Rischio basso.
- Se una release futura di supabase-js introducesse un dynamic-import non bundlabile,
  l'assert anti-rete dello script lo intercetta al momento del re-vendoring.

## Criteri di completamento

- `npm test` verde (442 esistenti + nuovo guard test).
- `vendor/supabase.js` presente, autonomo, importato localmente.
- Boot offline verificato con Playwright (SW attivo + context offline + reload OK).
- `CACHE` bumpato a `v79`.
