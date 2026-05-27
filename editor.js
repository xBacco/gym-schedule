// ---- Editor della scheda: mutazioni pure su `plan` + identità stabile + migrazione. ----

// ID opaco breve (base36). Rigenera finché non è univoco rispetto a `existingIds`.
export function genId(existingIds = []) {
  const taken = new Set(existingIds);
  let id;
  do {
    id = Math.random().toString(36).slice(2, 7); // 5 char base36
  } while (id.length < 4 || taken.has(id));
  return id;
}

// Tutti gli id di esercizio già usati nel piano (per evitare collisioni).
function allIds(plan) {
  const ids = [];
  for (const d of plan) for (const e of d.exercises) if (e.id) ids.push(e.id);
  return ids;
}

function mapDay(plan, day, fn) {
  return plan.map((d) => (d.day === day ? { ...d, exercises: fn(d.exercises.slice()) } : d));
}

export function addExercise(plan, day, ex) {
  const id = genId(allIds(plan));
  return mapDay(plan, day, (exs) => { exs.push({ ...ex, id }); return exs; });
}

export function removeExercise(plan, day, id) {
  return mapDay(plan, day, (exs) => exs.filter((e) => e.id !== id));
}

export function reorderExercise(plan, day, fromIdx, toIdx) {
  return mapDay(plan, day, (exs) => {
    if (fromIdx < 0 || fromIdx >= exs.length) return exs;
    const to = Math.max(0, Math.min(toIdx, exs.length - 1));
    const [moved] = exs.splice(fromIdx, 1);
    exs.splice(to, 0, moved);
    return exs;
  });
}

export function updateExercise(plan, day, id, patch) {
  return mapDay(plan, day, (exs) => exs.map((e) => (e.id === id ? { ...e, ...patch, id: e.id } : e)));
}
