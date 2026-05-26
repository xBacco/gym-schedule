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
  const n = track.sets.length;
  return n > 0 && n >= targetSets && track.sets.every((s) => s.done);
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
    if (!isEntryComplete(getEntry(data, weekKey, day, i), exs[i])) return i;
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

// Max kg loggato per un esercizio normale su tutte le settimane (null se assente).
export function bestKg(data, day, idx) {
  let best = null;
  for (const k of Object.keys(data?.weeks ?? {})) {
    const e = normalizeEntry(getEntry(data, k, day, idx));
    for (const s of e.sets) {
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
