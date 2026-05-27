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
    const e = normalizeEntry(getEntry(data, k, day, exId));
    for (const s of e.sets) {
      if (s.warmup || s.failed) continue;
      const v = parseFloat(String(s.kg).replace(",", "."));
      if (Number.isFinite(v) && (best === null || v > best)) best = v;
    }
  }
  return best;
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
export function topSetSeries(data, day, exId, weekKey, track = null) {
  const keys = Object.keys(data?.weeks ?? {})
    .filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k) && k <= weekKey).sort();
  const out = [];
  for (const k of keys) {
    const v = getEntry(data, k, day, exId);
    const t = track ? normalizeSupersetEntry(v)[track] : normalizeEntry(v);
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

// Dati per la striscia "prossimo esercizio" nell'overlay.
// exercises: array degli esercizi del giorno; idx: indice di quello aperto.
// Se non c'è un successivo (ultimo esercizio o idx fuori range) -> { last: true }.
// Altrimenti -> { last: false, name, target } del successivo.
export function nextExercisePreview(exercises, idx) {
  const next = Array.isArray(exercises) ? exercises[idx + 1] : undefined;
  if (!next) return { last: true };
  return { last: false, name: next.name, target: next.setsReps };
}
