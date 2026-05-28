# Multi-utente con Supabase — Design

**Data:** 2026-05-28
**Stato:** approvato per implementazione
**Autore:** Claude + Tomas

## Obiettivo

Rendere `gym-schedule` un'app multi-utente con signup pubblico, dati per-utente isolati, e
preservare l'esperienza offline-first esistente. Oggi l'app è "single-tenant": scheda
hardcoded per Tomas, `data.json` unico nel repo `xBacco/gym-schedule`, token GitHub PAT
condiviso. Questo modello non scala oltre l'utente attuale.

## Vincoli e decisioni

- **Scala target:** 10+ utenti aperti, signup self-service.
- **Backend:** Supabase free tier (Postgres + Auth gestita).
- **Onboarding scheda:** editor vuoto, ogni utente costruisce la propria.
- **Auth:** email + password (no social provider in prima release).
- **Storico Tomas:** migrazione one-shot dal `data.json` GitHub.
- **Offline:** offline-first vero — localStorage SoT in-session, sync trasparente.
- **Privacy:** tutto privato, ogni utente vede solo i suoi dati (RLS).
- **Hosting app:** invariato — static site su GitHub Pages.

## Architettura

```
[Browser PWA]                          [Supabase project]
+----------------+                     +--------------------+
|  app.js        |  --auth (PKCE)-->   |  auth.users        |
|  editor.js     |                     +--------------------+
|  session.js    |
|  ...           |  --insert/update--> +--------------------+
|  store.js      |   (jsonb blob)      |  user_data         |
|   └─ Supabase  |  <--select------    |   user_id PK FK    |
|      client    |                     |   data jsonb       |
|                |                     |   version bigint   |
|  localStorage  |                     |   updated_at       |
|  (cache SoT)   |                     +--------------------+
+----------------+                     RLS: user_id=auth.uid()
```

L'app resta statica su GitHub Pages. Cambia solo il *trasporto* dei dati: invece di
GitHub Contents API, Supabase. La logica applicativa (PR, volume per muscolo, prefill,
editor, drag&drop, calendario) resta invariata.

## Schema database

```sql
create table public.user_data (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{"weeks":{},"updatedAt":null}'::jsonb,
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

create policy "own row select" on public.user_data
  for select using (auth.uid() = user_id);

create policy "own row insert" on public.user_data
  for insert with check (auth.uid() = user_id);

create policy "own row update" on public.user_data
  for update using (auth.uid() = user_id)
              with check (auth.uid() = user_id);

create or replace function public.user_data_touch() returns trigger as $$
begin
  new.updated_at := now();
  new.version := old.version + 1;
  return new;
end $$ language plpgsql;

create trigger user_data_touch_trg
  before update on public.user_data
  for each row execute function public.user_data_touch();

create or replace function public.on_auth_user_created() returns trigger as $$
begin
  insert into public.user_data (user_id) values (new.id);
  return new;
end $$ language plpgsql security definer;

create trigger on_auth_user_created_trg
  after insert on auth.users
  for each row execute function public.on_auth_user_created();
```

**Forma del blob `data`:** identica al `data.json` attuale (`{weeks, plan, updatedAt}`).
Nessun cambio di schema lato applicativo.

**Optimistic locking:** `save()` confronta `version` per detectare conflitti. Trigger
bump-version garantisce che ogni `update` incrementi.

**Capacity:** ~20 KB/utente oggi, ~200 KB estrapolato a 5 anni. Free tier (500 MB)
regge >2500 utenti pieni.

## Auth flow

**Schermata login** (nuova `<section id="auth-screen">` in `index.html`) con tre stati:

- **Accedi:** `supabase.auth.signInWithPassword({email, password})`.
- **Registrati:** `supabase.auth.signUp({email, password})`. Email di conferma obbligatoria.
- **Reset password:** `supabase.auth.resetPasswordForEmail(email, {redirectTo: app#reset})`.

**Sessione:** Supabase persiste JWT in localStorage, refresh trasparente. `getSession()` al
boot determina se mostrare login o app. `onAuthStateChange()` gestisce logout/scadenza.

**Logout:** voce in ⚙ Impostazioni → `signOut()` + pulisce `gymsched_user_<uid>_*` da
localStorage + reload.

**Profilo minimo:** solo email. Niente display name / peso / foto in prima release.

**Errori login:** banner inline localizzato italiano. Mappiamo codici Supabase comuni:
`invalid_credentials`, `email_not_confirmed`, `user_already_registered`.

## Offline-first: sync e conflitti

**Source of truth:**
- **In-session:** localStorage.
- **Tra device:** Supabase.

**Chiavi localStorage:**
```
gymsched_user_<uid>_data       → {weeks, plan, updatedAt}
gymsched_user_<uid>_version    → bigint (ultima versione confermata da remote)
gymsched_user_<uid>_dirty      → bool
gymsched_user_<uid>_lastPush   → ISO timestamp
```

**Ciclo scrittura:**
```
user tap "✓"
  → store.setEntry(data, ...)
  → write localStorage (immediato, UI non blocca mai)
  → mark dirty=true
  → schedule pushIfDirty() (debounce 2s, anche su visibilitychange="hidden")

pushIfDirty():
  SupabaseStore.save(data, version)
   ├─ success → version++, dirty=false, lastPush=now
   ├─ ConflictError → reconcile()
   └─ network error → resta dirty, retry con backoff (10s, 30s, 60s, capped)
```

**Reconcile (conflict resolution):**
```
reconcile():
  remote = SupabaseStore.load()
  local = readLocal()
  merged = mergeBlobs(local, remote)
  SupabaseStore.save(merged, remote.version)
   └─ se di nuovo ConflictError (race con un terzo device) → richiama reconcile()
      (capped a N=3 retry per evitare loop patologici)
```

**`mergeBlobs(local, remote)`** — funzione pura in `store.js`, testabile in Node:
- `plan`: vince *local* (è l'utente che lo modifica via editor). Riusa la logica
  di `keepLocalPlan` esistente.
- `weeks[wk].entries[day][exId].sets`: vince quello con più set non-vuoti. Pareggio →
  `updatedAt` top-level più recente. Fallback "last writer wins" a granularità set.
- `weeks[wk].dates`: union, set-if-absent.
- `updatedAt` top-level: `max(local, remote)`.

**Boot:**
```
1. supabase.auth.getSession()
   ├─ no session → mostra login
   └─ session valida → continua

2. readLocal() per <uid> corrente
   ├─ esiste, dirty=true → render UI col locale; in parallelo load remote + reconcile/push
   ├─ esiste, dirty=false → load remote in background; se version cambiata → reconcile
   └─ non esiste → blocking load remote; seed se serve (vedi migrazione)

3. render app
```

**Service worker:** continua a cachare solo asset statici. Richieste Supabase passano
fuori dal SW (URL diverso). Bump cache → `gymsched-v31`.

**Esplicitamente fuori scope:** queue di operazioni granulari (CRDT), Supabase Realtime.
Push del blob intero ogni volta; reconcile on-boot e on-focus copre il caso PC+telefono.

## Migrazione storico Tomas

One-shot, opt-in con dialog esplicito al primo login.

```
firstLogin():
  if (user_data.data.weeks is empty):
    seedUrl = "https://xbacco.github.io/gym-schedule/data.json"
    seed = fetch(seedUrl).json()
    if (seed.weeks && Object.keys(seed.weeks).length > 0):
       mostra dialog "Trovata scheda demo con N settimane (range)."
       [Importa]  [Parto da zero]  ← default
    if (Importa):
       SupabaseStore.save(seed, version)
       writeLocal(seed)
```

**Gate:** dialog esplicito, default "parto da zero". Per Tomas → un click e ha lo
storico. Per altri utenti → opzione di provare la scheda demo come esempio.

**Idempotenza:** il prompt automatico parte solo se `weeks` è vuoto. Re-import esplicito
disponibile via bottone "Importa scheda demo" in ⚙.

**Backup pre-migrazione:** snapshot manuale `data.backup.<date>.json` prima del cut-over.
Nessun codice serve, solo nota in `README.md` / changelog.

**Dismissione GitHub Contents API:** completata dopo che Tomas ha migrato in produzione.
Codice e UI relativi rimossi. `data.json` resta nel repo come demo seed pubblico.

## Cambiamenti al codice

### File modificati

**`store.js`** (cuore del refactor)
- Mantieni: tutte le funzioni pure (`isoWeekKey`, `ensureWeek`, `setEntry`,
  `normalizeEntry`, `prefillSets`, `platesPerSide`, `parsePlateSet`, `toBase64`,
  `fromBase64`, `ConflictError`, `AuthError`).
- Rimuovi: `GitHubStore` (dopo migrazione Tomas in prod).
- Aggiungi: `SupabaseStore` con interfaccia `{ load(): {data, version}, save(data,
  version): newVersion }`.
- Aggiungi: `mergeBlobs(local, remote)` pura.

**`app.js`**
- Boot: `supabase.auth.getSession()` invece di check del token GitHub.
- Chiavi localStorage ri-namespacizzate con `gymsched_user_<uid>_*`.
- Logout handler.
- `pushIfDirty()` con debounce + retry/backoff (sostituisce l'attuale `saveToCloud()`).
- Reconcile on `visibilitychange="visible"`.

**`index.html`**
- Aggiunta `<section id="auth-screen">`.
- Import Supabase JS SDK via CDN (`https://esm.sh/@supabase/supabase-js@2`).
- ⚙ Impostazioni: rimuovi sezione "token GitHub", aggiungi "Account" con email + Esci.

**`sw.js`**
- Bump cache `gymsched-v31`.
- Aggiungi `auth.js` + `supabase-client.js` agli asset cachati.

**`plan.js`**
- `seedPlan()` accetta flag `{ empty: true }` per nuovi signup (parte vuoti).

**Invariati:** `editor.js`, `session.js`, `nutrition.js`, `timer.js`, `wakelock.js`.

**`README.md`** — riscritto: nuovo onboarding, niente più token GitHub, env per dev locale.

### File nuovi

- **`auth.js`** — ~150 righe. Render UI login/signup/reset, `onAuthStateChange`.
- **`supabase-client.js`** — ~10 righe. Singleton `createClient(URL, ANON_KEY)`.
- **`tests/store.merge.test.js`** — ~20 casi di test puri su `mergeBlobs`.
- **`tests/supabase-store.test.js`** — mock fetch, verifica payload/headers/error mapping.

### File rimossi (cut-over finale)

- Tutta la classe `GitHubStore` da `store.js`.
- Tutti i riferimenti al token GitHub in `app.js` e `index.html`.
- `data.json` nel repo **resta** come demo seed pubblica (immutabile post-cutover).

### Test impact

- 183 test attuali → verdi durante tutto il refactor.
- Test `GitHubStore` integration → trasformati in test `SupabaseStore` (stessa shape,
  fetch mockata).
- Nuovi test merge: ~20.
- **Totale stimato: 195-200 test.**

## Sicurezza

- **Anon key Supabase:** pubblica per design, RLS è il vero gate. Verifica con script:
  accesso senza login → fallisce; utente A legge riga B → fallisce.
- **Email confirmation:** obbligatoria (anti-spam signup). Dashboard Supabase →
  Authentication → Settings.
- **Rate limit:** default Supabase su `auth.*` (~30/h per IP). Sufficiente.
- **Password policy:** min 8 char (dashboard Supabase).
- **XSS audit:** verifica che `app.js` usi `textContent` per nomi esercizi/note
  utente-input, non `innerHTML`. Audit incluso nello sprint.

## Costi

| Risorsa | Free tier | Proiezione 10 utenti |
|---|---|---|
| MAU | 50.000 | 10 |
| DB | 500 MB | 2 MB |
| Bandwidth | 5 GB/mese | <100 MB |

Margine ~5000x. Tier Pro $25/mese disponibile se mai serve.

## Edge case

1. **Sessione scaduta a metà allenamento:** JWT auto-refresh per 30 giorni. Se scade:
   401 → banner re-login → reconcile al rientro.
2. **Cambio account stesso device:** logout pulisce `gymsched_user_<uid>_*` del profilo
   uscente; nuovo login legge solo le sue chiavi.
3. **Due device stesso utente in conflitto:** identico al modello GitHub attuale. Secondo
   `save` riceve `ConflictError` → `reconcile` via `mergeBlobs`.
4. **Browser senza localStorage:** Supabase fallisce graceful con messaggio. Edge case
   noto, accettiamo.
5. **Email rimbalzata:** bottone "Reinvia email di conferma" → `supabase.auth.resend()`.
6. **Cancellazione account:** rimandata a release futura. In questa release: "Esci e
   cancella dati locali" senza eliminare l'account Supabase (resta dormiente).
7. **Password persa:** link reset → app intercetta hash `#access_token` → form "nuova
   password" → `updateUser({password})`.
8. **PWA installata:** localStorage condiviso col browser host, sessione persiste.

## Fuori scope (esplicito)

- Social login (Google/GitHub).
- Sharing di schede tra utenti.
- Cruscotto admin.
- 2FA.
- Cancellazione account hard (rimandata a release futura).
- Export/import JSON (backlog #4, indipendente).
- Backlog #5–#8 (riepilogo fine-sessione, versione cache, weightMultiplier, timer durata).

## Stima

5-7 giorni-uomo di lavoro lineare, ipotizzando una sessione/giorno.
