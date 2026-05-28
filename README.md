# gym-schedule

Web app per la scheda di allenamento: log carico/reps per settimana, sync cross-device,
timer di recupero, multi-utente con account email + password.

## Come funziona
- Sito statico su **GitHub Pages**.
- Backend: **Supabase** (Postgres + Auth, free tier).
- Ogni utente ha un account. I dati sono privati e isolati via Row Level Security.
- Offline-first: in palestra l'app funziona senza segnale, sync al rientro.

## Setup utente
1. Apri https://xbacco.github.io/gym-schedule/
2. *Registrati* con email + password (min 8 char).
3. Conferma l'email tramite il link che ricevi.
4. Login → editor scheda vuoto, costruisci la tua.

## Sviluppo locale

```bash
npm test                    # 215+ test
python -m http.server 8765  # server statico
# poi apri http://localhost:8765
```

I file `supabase-client.js` contengono URL + anon key del progetto Supabase
(pubblici per design, RLS è il vero gate). Per uno sviluppo isolato crea un tuo
progetto Supabase ed esegui lo schema in `docs/superpowers/specs/2026-05-28-multi-user-supabase-design.md`.

## Architettura
Vedi `docs/superpowers/specs/2026-05-28-multi-user-supabase-design.md` per lo spec
completo e `docs/superpowers/plans/2026-05-28-multi-user-supabase.md` per il piano
di implementazione.
