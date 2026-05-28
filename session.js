// ---- Logica di sessione (pura, testabile in Node). Render in app.js. ----
import { getEntry, normalizeEntry, normalizeSet, normalizeSupersetEntry } from "./store.js";

// "4 × 6-8" -> { sets: 4, reps: "6-8" } ; tollera 'x'/'×' e reps non numeriche.
export function parseTargetTrack(str) {
  const s = String(str ?? "").trim();
  const m = s.match(/^(\d+)\s*[×x]\s*(.+)$/i);
  if (!m) return { sets: 1, reps: s };
  return { sets: parseInt(m[1], 10), reps: m[2].trim() };
}

// Normale -> { sets, reps } (prima parte prima di "/").
// Superset -> { a, b } splittando sul PRIMO "/" (così qualificatori come "max/lato" restano in B).
export function parseTarget(setsReps, superset = false) {
  const s = String(setsReps ?? "");
  const i = s.indexOf("/");
  if (superset) {
    const aPart = i === -1 ? s : s.slice(0, i);
    const bPart = i === -1 ? s : s.slice(i + 1);
    return { a: parseTargetTrack(aPart), b: parseTargetTrack(bPart) };
  }
  return parseTargetTrack(i === -1 ? s : s.slice(0, i));
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
    const tgt = parseTarget(ex.setsReps, true);
    const aEmpty = e.a.sets.length === 0, bEmpty = e.b.sets.length === 0;
    if (aEmpty && bEmpty) return false;
    const aOk = aEmpty || trackComplete(e.a, tgt.a.sets);
    const bOk = bEmpty || trackComplete(e.b, tgt.b.sets);
    return aOk && bOk;
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
  const t = track === "b" ? "b" : "a";
  return { ...e, [t]: withSet(e[t], index, patch) };
}

export function withoutSupersetSet(entry, track, index) {
  const e = normalizeSupersetEntry(entry);
  const t = track === "b" ? "b" : "a";
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

// Max kg loggato per un esercizio normale su tutte le settimane (null se assente).
export function bestKg(data, day, exId) {
  let best = null;
  for (const k of Object.keys(data?.weeks ?? {})) {
    const t = entryTrack(getEntry(data, k, day, exId), null);
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

// true se il top-set working di `weekKey` supera STRETTAMENTE lo storico precedente.
export function isWeekRecord(data, day, exId, weekKey, track = null) {
  const t = entryTrack(getEntry(data, weekKey, day, exId), track);
  let top = null;
  for (const s of t.sets) {
    if (s.warmup || s.failed) continue;
    const v = parseNum(s.kg);
    if (v !== null && (top === null || v > top)) top = v;
  }
  if (top === null) return false;
  const prev = bestKgBefore(data, day, exId, weekKey, track);
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
  if (track === "a" || track === "b") return normalizeSupersetEntry(entry)[track];
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

function trackVolume(track) {
  let v = 0;
  for (const s of track.sets) {
    if (!s.done || s.warmup || s.failed) continue;
    const r = parseNum(s.reps), k = parseNum(s.kg);
    if (r !== null && k !== null) v += r * k;
  }
  return v;
}

// Volume totale (Σ reps*kg sulle serie done) del giorno; somma entrambe le tracce superset.
export function sessionVolume(data, weekKey, day, dayPlan) {
  const exs = dayPlan?.exercises ?? [];
  let total = 0;
  for (let i = 0; i < exs.length; i++) {
    const v = getEntry(data, weekKey, day, exs[i].id);
    if (exs[i]?.superset) {
      const e = normalizeSupersetEntry(v);
      total += trackVolume(e.a) + trackVolume(e.b);
    } else {
      total += trackVolume(normalizeEntry(v));
    }
  }
  return total;
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
      add(ex.muscle, trackVolume(e.a));
      add(ex.muscleB, trackVolume(e.b));
    } else {
      add(ex?.muscle, trackVolume(normalizeEntry(v)));
    }
  }
  return [...map.entries()]
    .map(([muscle, volume]) => ({ muscle, volume }))
    .sort((a, b) => b.volume - a.volume);
}

// Top-set (kg max) di una settimana per quell'esercizio; null se nessun kg numerico.
function weekTopKg(data, weekKey, day, exId, superset) {
  const v = getEntry(data, weekKey, day, exId);
  const tracks = superset
    ? [normalizeSupersetEntry(v).a, normalizeSupersetEntry(v).b]
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
