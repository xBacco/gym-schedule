// media-map.js
// ---- Illustrazioni esercizi (puro, testabile in Node). Fonte: wger.de /
//      Everkinetic (licenza libera), hotlink — nessuna cache offline.
//      SOLO voci VERIFICATE (HEAD 200 su entrambi i frame): le altre cadono
//      sul fallback "solo figura" (pannello media non mostrato). La mappa
//      cresce nel tempo; per i casi singoli c'è l'override `img` per-voce. ----
const WGER = "https://wger.de/media/exercise-images";
const norm = (s) => String(s ?? "").trim().toLowerCase();

// nome seed (normalizzato) → "<id>/<NomeFile>" wger
const MAP = {
  "panca piana bilanciere": "192/Bench-press",
  "crunch a terra": "91/Crunches",
};

// { img1, img2 } per le voci mappate, { img1 } con il solo override utente,
// null se non c'è nulla (il chiamante non mostra il pannello media).
export function mediaFor(entry) {
  const ov = String(entry?.img ?? "").trim();
  if (ov) return { img1: ov };
  const base = MAP[norm(entry?.name)];
  return base ? { img1: `${WGER}/${base}-1.png`, img2: `${WGER}/${base}-2.png` } : null;
}
