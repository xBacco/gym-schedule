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

// Migrazione una-tantum schema 1 -> 2: crea `data.plan` dal seed (assegnando id),
// riscrive le entry da chiavi-indice a chiavi-id. Idempotente (guard su schema),
// non muta l'input. `seedPlan` è il PLAN di plan.js (così editor.js resta puro).
export function migrate(data, seedPlan) {
  if (data && data.schema >= 2) return data; // già migrato, no-op
  const out = structuredClone(data || { updatedAt: null, weeks: {} });

  // 1. plan dal seed, con id stabili (ordine = ordine storico dei log).
  const used = [];
  out.plan = seedPlan.map((d) => ({
    day: d.day,
    title: d.title,
    exercises: d.exercises.map((e) => {
      const id = genId(used);
      used.push(id);
      return { ...e, id };
    }),
  }));

  // 2. mappa giorno -> [id per indice], per riscrivere le entry.
  const idsByDay = {};
  for (const d of out.plan) idsByDay[d.day] = d.exercises.map((e) => e.id);

  // 3. riscrive le entry indice->id; gli indici senza esercizio diventano orfani.
  for (const wk of Object.values(out.weeks || {})) {
    const entries = wk.entries || {};
    for (const day of Object.keys(entries)) {
      const ids = idsByDay[day] || [];
      const remapped = {};
      for (const key of Object.keys(entries[day])) {
        const i = Number(key);
        if (Number.isInteger(i) && ids[i]) remapped[ids[i]] = entries[day][key];
        else remapped[`_orphan_${key}`] = entries[day][key];
      }
      entries[day] = remapped;
    }
  }

  out.schema = 2;
  return out;
}

// Migrazione schema 2 -> 3: backfill di muscle/muscleB su data.plan esistente,
// abbinando per (day, name) al seed. Idempotente (guard schema >= 3), non muta
// l'input. Va invocata DOPO migrate (che crea data.plan). Esercizi non abbinati
// (rinominati/custom) restano senza muscle -> bucket "Altro" nel breakdown.
export function backfillMuscles(data, seedPlan) {
  if (data && data.schema >= 3) return data;
  const out = structuredClone(data || { updatedAt: null, weeks: {} });
  const seedIdx = new Map();
  for (const d of seedPlan) {
    for (const e of d.exercises) seedIdx.set(`${d.day} ${e.name}`, { muscle: e.muscle, muscleB: e.muscleB });
  }
  if (Array.isArray(out.plan)) {
    for (const d of out.plan) {
      for (const e of d.exercises) {
        if (e.muscle != null) continue;
        const seed = seedIdx.get(`${d.day} ${e.name}`);
        if (!seed) continue;
        if (seed.muscle != null) e.muscle = seed.muscle;
        if (seed.muscleB != null) e.muscleB = seed.muscleB;
      }
    }
  }
  out.schema = 3;
  return out;
}

// Merge dopo un conflitto di salvataggio: il ramo conflitto riparte dal remoto e
// ri-applica i log pendenti, ma gli edit strutturali della scheda NON sono nel
// buffer pending → andrebbero persi. Questo conserva il `plan` locale (intento più
// recente dell'utente; last-writer-wins, coerente con un singolo utente su 2
// dispositivi). Se non c'è un plan locale valido, ritorna `merged` invariato.
export function keepLocalPlan(merged, localPlan) {
  return Array.isArray(localPlan) && localPlan.length ? { ...merged, plan: localPlan } : merged;
}
