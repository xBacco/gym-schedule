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
  // --- già presenti ---
  "panca piana bilanciere": "192/Bench-press",
  "crunch a terra": "91/Crunches",

  // --- petto ---
  "spinte manubri panca piana": "97/Dumbbell-bench-press",
  "spinte su panca inclinata (manubri)": "41/Incline-bench-press",
  "croci ai cavi": "71/Cable-crossover",
  "dips": "83/Bench-dips",

  // --- schiena ---
  "rematore bilanciere": "109/Barbell-rear-delt-row",
  "rematore al cavo": "143/Cable-seated-rows",

  // --- gambe ---
  "stacco rumeno": "161/Dead-lifts",
  "affondi con manubri": "113/Walking-lunges",

  // --- spalle ---
  "lento avanti bilanciere": "119/seated-barbell-shoulder-press-large",
  "lento avanti manubri": "123/dumbbell-shoulder-press-large",
  "alzate laterali": "148/lateral-dumbbell-raises-large",

  // --- bicipiti ---
  "curl manubri": "81/Biceps-curl",
  "curl ez": "74/Bicep-curls",
  "curl concentrato": "193/Preacher-curl-3",

  // --- tricipiti ---
  "skullcrusher/french press": "84/Lying-close-grip-triceps-press-to-chin",

  // --- core ---
  "leg raise": "125/Leg-raises",
};

// { img1, img2 } per le voci mappate, { img1 } con il solo override utente,
// null se non c'è nulla (il chiamante non mostra il pannello media).
export function mediaFor(entry) {
  const ov = String(entry?.img ?? "").trim();
  if (ov) return { img1: ov };
  const base = MAP[norm(entry?.name)];
  return base ? { img1: `${WGER}/${base}-1.png`, img2: `${WGER}/${base}-2.png` } : null;
}
