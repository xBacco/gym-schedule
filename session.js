// ---- Logica di sessione (pura, testabile in Node). Render in app.js. ----
import { getEntry, normalizeEntry, normalizeSet, normalizeSupersetEntry } from "./store.js";

// "4 × 6-8" -> { sets: 4, reps: "6-8" } ; tollera 'x'/'×' e reps non numeriche.
export function parseTargetTrack(str) {
  const s = String(str ?? "").trim();
  const m = s.match(/^(\d+)\s*[×x]\s*(.+)$/i);
  if (!m) return { sets: 1, reps: s };
  return { sets: parseInt(m[1], 10), reps: m[2].trim() };
}

// Normale -> { sets, reps } (prima parte prima di " / ").
// Superset -> { a, b } o { a, b, c }. Separatore = slash CIRCONDATO DA SPAZI
// (" / "), così qualificatori senza spazi ("8/lato", "max/lato") restano nella
// loro traccia. Si splittano i primi (n-1) separatori; l'ultima traccia tiene il resto.
export function parseTarget(setsReps, superset = false, n = 2) {
  const s = String(setsReps ?? "");
  if (superset) {
    const parts = splitTracks(s, n);
    const out = { a: parseTargetTrack(parts[0] ?? s), b: parseTargetTrack(parts[1] ?? parts[0] ?? s) };
    if (n >= 3) out.c = parseTargetTrack(parts[2] ?? parts[1] ?? parts[0] ?? s);
    return out;
  }
  return parseTargetTrack(splitTracks(s, 1)[0] ?? s);
}

// Splitta una stringa sui primi (n-1) separatori " / " (slash tra spazi);
// l'ultimo elemento conserva tutto il resto. Ritorna fino a n segmenti trimmati.
function splitTracks(s, n) {
  const re = /\s+\/\s+/g;
  const parts = [];
  let last = 0, m, count = 0;
  while (count < n - 1 && (m = re.exec(s)) !== null) {
    parts.push(s.slice(last, m.index));
    last = re.lastIndex;
    count++;
  }
  parts.push(s.slice(last));
  return parts.map((p) => p.trim());
}

// Indice della serie corrente = prima non done (o length se tutte fatte).
export function activeSetIndex(sets) {
  const arr = Array.isArray(sets) ? sets : [];
  const i = arr.findIndex((s) => !s.done);
  return i === -1 ? arr.length : i;
}

// Una traccia/esercizio è "fatto" quando ha raggiunto il numero di serie suggerito
// e tutte le serie loggate sono done.
function trackComplete(track, targetSets) {
  const working = track.sets.filter((s) => !s.warmup).length;
  return working >= targetSets && working > 0 && track.sets.every((s) => s.done);
}

// Un esercizio è "completo" quando raggiunge il target di serie ed è tutto done.
// `ex` = { setsReps, superset }. Superset: una traccia vuota (corpo libero non
// loggata) non blocca se l'altra è completa; due tracce vuote -> non completo.
export function isEntryComplete(entry, ex) {
  if (ex && ex.superset) {
    const e = normalizeSupersetEntry(entry);
    const keys = supersetTrackKeys(ex);
    const n = keys.length;
    const tgt = parseTarget(ex.setsReps, true, n);
    const tracks = keys.map((k) => ({ track: e[k], tgt: tgt[k] }));
    if (tracks.every((t) => t.track.sets.length === 0)) return false;
    return tracks.every((t) => t.track.sets.length === 0 || trackComplete(t.track, t.tgt.sets));
  }
  const e = normalizeEntry(entry);
  const tgt = parseTarget(ex?.setsReps, false);
  return trackComplete(e, tgt.sets);
}

// Indice dell'esercizio "in focus" = primo non completo (0 se tutti completi).
export function activeExerciseIndex(data, weekKey, day, dayPlan) {
  const exs = dayPlan?.exercises ?? [];
  for (let i = 0; i < exs.length; i++) {
    if (!isEntryComplete(getEntry(data, weekKey, day, exs[i].id), exs[i])) return i;
  }
  return 0;
}

// Entry normale: aggiorna/aggiunge la serie `index` col patch dato (immutabile).
export function withSet(entry, index, patch) {
  const e = normalizeEntry(entry);
  const sets = e.sets.slice();
  while (sets.length <= index) sets.push({ reps: "", kg: "", done: false });
  sets[index] = normalizeSet({ ...sets[index], ...patch });
  return { sets, note: e.note };
}

export function withoutSet(entry, index) {
  const e = normalizeEntry(entry);
  const sets = e.sets.slice();
  if (index >= 0 && index < sets.length) sets.splice(index, 1);
  return { sets, note: e.note };
}

// Superset: stessa cosa sulla traccia "a"/"b".
export function withSupersetSet(entry, track, index, patch) {
  const e = normalizeSupersetEntry(entry);
  const t = track === "b" || track === "c" ? track : "a";
  return { ...e, [t]: withSet(e[t], index, patch) };
}

export function withoutSupersetSet(entry, track, index) {
  const e = normalizeSupersetEntry(entry);
  const t = track === "b" || track === "c" ? track : "a";
  return { ...e, [t]: withoutSet(e[t], index) };
}

// Imposta la nota (a livello esercizio) preservando le serie. `superset` sceglie
// la forma dell'entry. La nota è sempre top-level, sia normale sia superset.
export function withNote(entry, note, superset = false) {
  const text = String(note ?? "");
  if (superset) {
    const e = normalizeSupersetEntry(entry);
    return { ...e, note: text };
  }
  const e = normalizeEntry(entry);
  return { sets: e.sets, note: text };
}

// Nota più recente loggata in una settimana precedente per quell'esercizio
// (le note sono persistenti tra le settimane). "" se nessuna.
export function previousNote(data, day, exId, weekKey, superset = false) {
  const keys = Object.keys(data?.weeks ?? {})
    .filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k) && k < weekKey).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    const v = getEntry(data, keys[i], day, exId);
    const e = superset ? normalizeSupersetEntry(v) : normalizeEntry(v);
    if (e.note && e.note.trim()) return e.note;
  }
  return "";
}

// Max kg loggato per un esercizio su tutte le settimane (null se assente).
// `track` opzionale ("a"/"b") restringe alla traccia indicata del superset.
export function bestKg(data, day, exId, track = null) {
  let best = null;
  for (const k of Object.keys(data?.weeks ?? {})) {
    const t = entryTrack(getEntry(data, k, day, exId), track);
    for (const s of t.sets) {
      if (s.warmup || s.failed) continue;
      const v = parseNum(s.kg);
      if (v !== null && (best === null || v > best)) best = v;
    }
  }
  return best;
}

// Max kg working delle settimane precedenti a `weekKey` (per capire se è un nuovo PR).
export function bestKgBefore(data, day, exId, weekKey, track = null) {
  let best = null;
  for (const k of Object.keys(data?.weeks ?? {})) {
    if (k >= weekKey) continue;
    const t = entryTrack(getEntry(data, k, day, exId), track);
    for (const s of t.sets) {
      if (s.warmup || s.failed) continue;
      const v = parseNum(s.kg);
      if (v !== null && (best === null || v > best)) best = v;
    }
  }
  return best;
}

// true se TUTTO lo storico working (no warmup/failed) dell'esercizio è senza
// kg (vuoto, non numerico o 0): esercizio "a corpo libero" per la logica PR.
// Vacuamente true senza storico (primo allenamento → primo PR, come per i kg).
export function historyIsBodyweight(data, day, exId, track = null) {
  for (const k of Object.keys(data?.weeks ?? {})) {
    const t = entryTrack(getEntry(data, k, day, exId), track);
    for (const s of t.sets) {
      if (s.warmup || s.failed) continue;
      const v = parseNum(s.kg);
      if (v !== null && v > 0) return false;
    }
  }
  return true;
}

// Max reps working su tutte le settimane (gemello di bestKg, metrica reps).
export function bestReps(data, day, exId, track = null) {
  let best = null;
  for (const k of Object.keys(data?.weeks ?? {})) {
    const t = entryTrack(getEntry(data, k, day, exId), track);
    for (const s of t.sets) {
      if (s.warmup || s.failed) continue;
      const v = parseNum(s.reps);
      if (v !== null && (best === null || v > best)) best = v;
    }
  }
  return best;
}

// Max reps working delle settimane precedenti a `weekKey` (gemello di bestKgBefore).
export function bestRepsBefore(data, day, exId, weekKey, track = null) {
  let best = null;
  for (const k of Object.keys(data?.weeks ?? {})) {
    if (k >= weekKey) continue;
    const t = entryTrack(getEntry(data, k, day, exId), track);
    for (const s of t.sets) {
      if (s.warmup || s.failed) continue;
      const v = parseNum(s.reps);
      if (v !== null && (best === null || v > best)) best = v;
    }
  }
  return best;
}

// true se il top-set working di `weekKey` supera STRETTAMENTE lo storico precedente.
// Metrica: kg di default; max reps se l'intero storico è a corpo libero (kg
// sempre vuoto/0) — così dips & co. senza zavorra generano PR sulle ripetizioni.
export function isWeekRecord(data, day, exId, weekKey, track = null) {
  const bw = historyIsBodyweight(data, day, exId, track);
  const t = entryTrack(getEntry(data, weekKey, day, exId), track);
  let top = null;
  for (const s of t.sets) {
    if (s.warmup || s.failed) continue;
    const v = parseNum(bw ? s.reps : s.kg);
    if (v !== null && (top === null || v > top)) top = v;
  }
  if (top === null) return false;
  const prev = bw
    ? bestRepsBefore(data, day, exId, weekKey, track)
    : bestKgBefore(data, day, exId, weekKey, track);
  return prev === null || top > prev;
}

// Micro-helper per il badge live: kg numerico e maggiore stretto del massimo precedente.
export function isSetRecord(prevBest, kg) {
  const v = parseNum(kg);
  if (v === null) return false;
  return prevBest === null || v > prevBest;
}

// Delta carico (cur - prev) arrotondato a 2 decimali; null se uno non è numerico.
export function progressionDelta(curKg, prevKg) {
  const c = parseFloat(String(curKg).replace(",", "."));
  const p = parseFloat(String(prevKg).replace(",", "."));
  if (!Number.isFinite(c) || !Number.isFinite(p)) return null;
  return Math.round((c - p) * 100) / 100;
}

// Traccia (normale o superset-a/b) di un'entry, normalizzata.
function entryTrack(entry, track) {
  if (track === "a" || track === "b" || track === "c") return normalizeSupersetEntry(entry)[track];
  return normalizeEntry(entry);
}

// {reps,kg} dell'ultima serie done con indice < `index` nella sessione corrente; null se assente.
export function previousSetInSession(entry, index, track = null) {
  const t = entryTrack(entry, track);
  const start = Math.min(index, t.sets.length) - 1;
  for (let i = start; i >= 0; i--) {
    if (t.sets[i].done && !t.sets[i].warmup && !t.sets[i].failed) return { reps: t.sets[i].reps, kg: t.sets[i].kg };
  }
  return null;
}

// {reps,kg,week} dalla settimana precedente con dato per quell'esercizio; null se assente.
// Ritorna il set a `setIndex`, o l'ultimo disponibile di quella settimana.
export function previousWeekSet(data, day, exId, weekKey, setIndex, track = null) {
  const keys = Object.keys(data?.weeks ?? {})
    .filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k) && k < weekKey).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    const t = entryTrack(getEntry(data, keys[i], day, exId), track);
    const working = t.sets.filter((s) => !s.warmup && !s.failed);
    if (working.length) {
      const s = working[setIndex] ?? working[working.length - 1];
      return { reps: s.reps, kg: s.kg, week: keys[i] };
    }
  }
  return null;
}

// {reps,kg,week} della serie working PIÙ PESANTE (kg numerico max) dell'ultima
// settimana precedente (< weekKey) che ne ha una; null se nessuno storico utile.
// Scandisce indietro: salta le settimane senza alcun kg numerico working.
// track: null = normale, "a"/"b" = traccia del superset.
export function lastWorkingSet(data, day, exId, weekKey, track = null) {
  const keys = Object.keys(data?.weeks ?? {})
    .filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k) && k < weekKey).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    const t = entryTrack(getEntry(data, keys[i], day, exId), track);
    let best = null;
    for (const s of t.sets) {
      if (s.warmup || s.failed) continue;
      const k = parseNum(s.kg);
      if (k !== null && (best === null || k > parseNum(best.kg))) best = { reps: s.reps, kg: s.kg };
    }
    if (best) return { ...best, week: keys[i] };
  }
  return null;
}

// Parsing numerico tollerante alla virgola decimale; null se non numerico.
function parseNum(x) {
  const v = parseFloat(String(x).replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

// Riconosce gli esercizi a manubri/manubrio: il carico è per lato, quindi il
// volume conta entrambe le mani (×2). Match sul nome, case-insensitive.
export function isDumbbell(name) {
  return /manubr/i.test(String(name ?? ""));
}

// Chiavi traccia di un superset, dedotte dal nome: 2 pezzi " + " = duo [a,b],
// 3 pezzi = trio [a,b,c]. Non-superset -> []. Fonte unica dell'arità.
export function supersetTrackKeys(ex) {
  if (!ex?.superset) return [];
  const parts = String(ex?.name ?? "").split(" + ").length;
  return parts >= 3 ? ["a", "b", "c"] : ["a", "b"];
}

// Muscolo della singola traccia: a->muscle, b->muscleB, c->muscleC.
export function trackMuscle(ex, track) {
  if (track === "c") return ex?.muscleC;
  if (track === "b") return ex?.muscleB;
  return ex?.muscle;
}

// Nome della singola traccia di un esercizio ("A + B" nei superset).
export function trackName(ex, track) {
  const name = String(ex?.name ?? "");
  const parts = name.includes(" + ") ? name.split(" + ") : [name];
  if (track === "c") return (parts[2] ?? parts[0]).trim();
  if (track === "b") return (parts[1] ?? parts[0]).trim();
  return (parts[0] ?? name).trim();
}

// Fattore volume (1 o 2) e unità ("reps"|"sec") di una traccia di un esercizio.
// track: null/"a" = traccia normale/A ; "b" = traccia B del superset.
// Override esplicito ex.vol2 / ex.vol2B (boolean); assente -> derivazione dal
// nome traccia (manubri = ×2, regex isDumbbell).
export function volumeMeta(ex, track) {
  const ov = track === "c" ? ex?.vol2C : track === "b" ? ex?.vol2B : ex?.vol2;
  const unit = (track === "c" ? ex?.unitC : track === "b" ? ex?.unitB : ex?.unit) === "sec" ? "sec" : "reps";
  const factor = typeof ov === "boolean"
    ? (ov ? 2 : 1)
    : (isDumbbell(trackName(ex, track)) ? 2 : 1);
  return { factor, unit };
}

// True se la traccia mostra la riga "per lato" (calcolo dischi). Override
// esplicito ex.plates / ex.platesB; assente -> bar impostato oppure nome
// traccia che indica un bilanciere (bilanciere/stacco/squat/EZ).
export function platesOn(ex, track) {
  const ov = track === "c" ? ex?.platesC : track === "b" ? ex?.platesB : ex?.plates;
  if (typeof ov === "boolean") return ov;
  if (typeof ex?.bar === "number" && Number.isFinite(ex.bar) && ex.bar > 0) return true;
  return /bilancier|stacco|squat|\bez\b/i.test(trackName(ex, track));
}

// Volume di una singola serie (reps*kg*fattore). 0 se a tempo (sec), non done,
// warmup o failed, o senza valori numerici.
export function setVolume(set, { factor = 1, unit = "reps" } = {}) {
  if (unit === "sec" || !set?.done || set.warmup || set.failed) return 0;
  const r = parseNum(set.reps), k = parseNum(set.kg);
  return (r !== null && k !== null) ? r * k * factor : 0;
}

function trackVolume(track, meta = {}) {
  let v = 0;
  for (const s of track.sets) v += setVolume(s, meta);
  return v;
}

// Volume totale di un esercizio: somma le serie working (superset = A + B), con
// ×2 manubri e tracce a tempo (sec) escluse dal volume in kg.
export function exerciseVolume(entry, ex) {
  if (ex?.superset) {
    const e = normalizeSupersetEntry(entry);
    return supersetTrackKeys(ex).reduce((sum, k) => sum + trackVolume(e[k], volumeMeta(ex, k)), 0);
  }
  return trackVolume(normalizeEntry(entry), volumeMeta(ex, null));
}

// Volume totale del giorno (Σ exerciseVolume).
export function sessionVolume(data, weekKey, day, dayPlan) {
  const exs = dayPlan?.exercises ?? [];
  let total = 0;
  for (const ex of exs) total += exerciseVolume(getEntry(data, weekKey, day, ex.id), ex);
  return total;
}

// True se la sessione ha almeno UNA serie completata (done) tra gli esercizi del
// piano. È il criterio "allenamento avvenuto" per il calendario: la data in
// weeks[].dates è solo uno stamp set-if-absent e resta anche se poi si svuotano
// le serie (es. sessione di prova annullata), quindi non basta a dire "fatto".
// Conta anche le serie a corpo libero (volume 0): basta che siano done.
export function sessionHasDoneSet(data, weekKey, day, dayPlan) {
  for (const ex of dayPlan?.exercises ?? []) {
    const v = getEntry(data, weekKey, day, ex.id);
    const tracks = ex?.superset
      ? supersetTrackKeys(ex).map((k) => normalizeSupersetEntry(v)[k])
      : [normalizeEntry(v)];
    if (tracks.some((t) => t.sets.some((st) => st.done))) return true;
  }
  return false;
}

// Volume settimanale per gruppo muscolare: [{muscle, volume}] ordinato desc.
// Traccia normale/A -> ex.muscle, traccia B del superset -> ex.muscleB. Muscolo
// assente -> "Altro". Riusa trackVolume (serie done, no warmup/failed).
export function volumeByMuscle(data, weekKey, day, dayPlan) {
  const exs = dayPlan?.exercises ?? [];
  const map = new Map();
  const add = (muscle, vol) => {
    if (vol <= 0) return;
    const key = muscle && String(muscle).trim() ? String(muscle) : "Altro";
    map.set(key, (map.get(key) ?? 0) + vol);
  };
  for (const ex of exs) {
    const v = getEntry(data, weekKey, day, ex.id);
    if (ex?.superset) {
      const e = normalizeSupersetEntry(v);
      for (const k of supersetTrackKeys(ex)) add(trackMuscle(ex, k), trackVolume(e[k], volumeMeta(ex, k)));
    } else {
      add(ex?.muscle, trackVolume(normalizeEntry(v), volumeMeta(ex, null)));
    }
  }
  return [...map.entries()]
    .map(([muscle, volume]) => ({ muscle, volume }))
    .sort((a, b) => b.volume - a.volume);
}

// Contributi volume per-traccia CON NOME (per la heatmap anatomica: i gruppi
// secondari si risolvono per nome a valle, in body.js/heatByGroup). Come
// volumeByMuscle ma non aggregato; tracce a volume 0 escluse.
export function muscleContributions(data, weekKey, day, dayPlan) {
  const out = [];
  for (const ex of dayPlan?.exercises ?? []) {
    const v = getEntry(data, weekKey, day, ex.id);
    const name = String(ex?.name ?? "");
    if (ex?.superset) {
      const e = normalizeSupersetEntry(v);
      for (const k of supersetTrackKeys(ex)) {
        out.push({ muscle: trackMuscle(ex, k), name: trackName(ex, k), volume: trackVolume(e[k], volumeMeta(ex, k)) });
      }
    } else {
      out.push({ muscle: ex?.muscle, name, volume: trackVolume(normalizeEntry(v), volumeMeta(ex, null)) });
    }
  }
  return out.filter((c) => c.volume > 0);
}

// Top-set (kg max) di una settimana per quell'esercizio; null se nessun kg numerico.
function weekTopKg(data, weekKey, day, exId, superset) {
  const v = getEntry(data, weekKey, day, exId);
  const tracks = superset
    ? (() => { const e = normalizeSupersetEntry(v); return [e.a, e.b, e.c]; })()
    : [normalizeEntry(v)];
  let best = null;
  for (const t of tracks) {
    for (const s of t.sets) {
      if (s.warmup || s.failed) continue;
      const k = parseNum(s.kg);
      if (k !== null && (best === null || k > best)) best = k;
    }
  }
  return best;
}

// Serie completa [{week, kg}] del top-set per settimana <= weekKey con un kg numerico,
// ordine crescente. track: null = normale, "a"/"b" = traccia del superset.
// Esclude warmup e serie non riuscite (come weekTopKg), ma su una sola traccia.
// Calcola il top-set inline (non riusa weekTopKg) perché weekTopKg fonde entrambe le tracce superset.
export function topSetSeries(data, day, exId, weekKey, track = null) {
  const keys = Object.keys(data?.weeks ?? {})
    .filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k) && k <= weekKey).sort();
  const out = [];
  for (const k of keys) {
    const v = getEntry(data, k, day, exId);
    const t = entryTrack(v, track);
    let best = null;
    for (const s of t.sets) {
      if (s.warmup || s.failed) continue;
      const kg = parseNum(s.kg);
      if (kg !== null && (best === null || kg > best)) best = kg;
    }
    if (best !== null) out.push({ week: k, kg: best });
  }
  return out;
}

// Ultime n settimane <= weekKey con dato: [{week, kg}] in ordine crescente. Salta le vuote.
export function exerciseTrend(data, day, exId, weekKey, n = 3, superset = false) {
  const keys = Object.keys(data?.weeks ?? {})
    .filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k) && k <= weekKey).sort();
  const out = [];
  for (let i = keys.length - 1; i >= 0 && out.length < n; i--) {
    const kg = weekTopKg(data, keys[i], day, exId, superset);
    if (kg !== null) out.unshift({ week: keys[i], kg });
  }
  return out;
}

// Geometria SVG del grafico progressione. series: [{week, kg}] in ordine crescente.
// Scala Y su min/max dei dati con margine (NON parte da 0). Ritorna coordinate pronte.
export function chartGeometry(series, opts = {}) {
  const { width = 260, height = 150, padX = 34, padTop = 20, padBottom = 26, padRight = 8 } = opts;
  if (!Array.isArray(series) || series.length === 0) {
    return { points: [], polyline: "", yTicks: [], min: null, max: null };
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  const kgs = series.map((p) => p.kg);
  const dataMin = Math.min(...kgs), dataMax = Math.max(...kgs);
  const span = dataMax - dataMin;
  const pad = span === 0 ? 1 : span * 0.15;
  const lo = dataMin - pad, hi = dataMax + pad;
  const plotW = width - padX - padRight;
  const plotH = height - padTop - padBottom;
  const n = series.length;
  const xAt = (i) => (n === 1 ? padX + plotW / 2 : padX + (i * plotW) / (n - 1));
  const yAt = (kg) => padTop + (1 - (kg - lo) / (hi - lo)) * plotH;
  const points = series.map((p, i) => ({ x: r2(xAt(i)), y: r2(yAt(p.kg)), week: p.week, kg: p.kg }));
  const polyline = points.map((p) => `${p.x},${p.y}`).join(" ");
  const yTicks = dataMax === dataMin
    ? [{ value: r2(dataMax), y: r2(yAt(dataMax)) }]
    : [
        { value: r2(dataMax), y: r2(yAt(dataMax)) },
        { value: r2(dataMin), y: r2(yAt(dataMin)) },
      ];
  return { points, polyline, yTicks, min: dataMin, max: dataMax };
}

// Tutte le sessioni datate: [{ date:"YYYY-MM-DD", weekKey, day }], ordinate per
// data crescente. Ignora le settimane senza `dates` (storico pre-calendario).
export function sessionDates(data) {
  const out = [];
  for (const [weekKey, week] of Object.entries(data?.weeks ?? {})) {
    if (!week?.dates) continue;
    for (const [day, date] of Object.entries(week.dates)) {
      out.push({ date, weekKey, day });
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

// Gruppo → data ISO dell'ultima sessione con almeno una serie done non-warmup
// per quel gruppo. Conta anche corpo libero/a tempo (volume 0): per la
// freschezza vale l'aver allenato, non i kg. Solo gruppi PRIMARI (i secondari
// pesano solo sulla vista settimana). Scansiona le settimane della scheda attiva.
export function lastTrainedByGroup(data) {
  const out = {};
  const plan = Array.isArray(data?.plan) ? data.plan : [];
  for (const s of sessionDates(data)) {
    const dp = plan.find((d) => d.day === s.day);
    if (!dp) continue;
    for (const ex of dp.exercises ?? []) {
      const v = getEntry(data, s.weekKey, s.day, ex.id);
      const tracks = ex?.superset
        ? [{ t: normalizeSupersetEntry(v).a, m: ex.muscle }, { t: normalizeSupersetEntry(v).b, m: ex.muscleB }]
        : [{ t: normalizeEntry(v), m: ex?.muscle }];
      for (const { t, m } of tracks) {
        if (!m) continue;
        if (!t.sets.some((st) => st.done && !st.warmup)) continue;
        if (!out[m] || s.date > out[m]) out[m] = s.date;
      }
    }
  }
  return out;
}

// Griglia del mese: array di righe, ogni riga 7 celle allineate Lun→Dom.
// Cella = "YYYY-MM-DD" per i giorni del mese, null per il padding ai bordi.
// month è 0-based (come Date.getMonth()).
export function monthGrid(year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startCol = (new Date(year, month, 1).getDay() + 6) % 7; // Lun=0..Dom=6
  const mm = String(month + 1).padStart(2, "0");
  const cells = [];
  for (let i = 0; i < startCol; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${year}-${mm}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

// Dati per la striscia "prossimo esercizio" nell'overlay.
// exercises: array degli esercizi del giorno; idx: indice di quello aperto.
// Se non c'è un successivo (ultimo esercizio o idx fuori range) -> { last: true }.
// Altrimenti -> { last: false, name, target } del successivo.
export function nextExercisePreview(exercises, idx) {
  const next = Array.isArray(exercises) ? exercises[idx + 1] : undefined;
  if (!next) return { last: true };
  return { last: false, name: next.name, target: next.setsReps };
}
