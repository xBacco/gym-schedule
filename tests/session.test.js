import test from "node:test";
import assert from "node:assert/strict";
import { parseTargetTrack, parseTarget, activeSetIndex, isEntryComplete, activeExerciseIndex, nextExercisePreview } from "../session.js";
import { withSet, withoutSet, withSupersetSet, withoutSupersetSet } from "../session.js";
import { bestKg, bestKgBefore, isWeekRecord, isSetRecord, progressionDelta, withNote, previousNote, previousSetInSession, previousWeekSet, lastWorkingSet, sessionVolume, volumeByMuscle, exerciseTrend, topSetSeries, chartGeometry } from "../session.js";
import { historyIsBodyweight, bestReps, bestRepsBefore } from "../session.js";
import { sessionDates, monthGrid, sessionHasDoneSet } from "../session.js";
import { muscleContributions, lastTrainedByGroup } from "../session.js";
import { isDumbbell, volumeMeta, exerciseVolume, setVolume, platesOn, supersetTrackKeys, trackMuscle } from "../session.js";
import { emptyData, setEntry, getEntry } from "../store.js";

test("sessionDates: estrae le date da weeks[].dates, ordinate per data", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", 0, "x", "2026-05-25T08:00:00Z");
  d = setEntry(d, "2026-W21", "B", 0, "y", "2026-05-20T08:00:00Z");
  assert.deepEqual(sessionDates(d), [
    { date: "2026-05-20", weekKey: "2026-W21", day: "B" },
    { date: "2026-05-25", weekKey: "2026-W22", day: "A" },
  ]);
});

test("sessionDates: ignora le settimane senza dates (storico vecchio)", () => {
  const d = { updatedAt: null, weeks: { "2025-W10": { label: "x", entries: { A: { "0": "v" } } } } };
  assert.deepEqual(sessionDates(d), []);
});

test("monthGrid: maggio 2026 (mese 0-based = 4) inizia di venerdì", () => {
  const g = monthGrid(2026, 4); // 1 maggio 2026 è venerdì (Lun=0 -> col 4)
  for (const w of g) assert.equal(w.length, 7);
  assert.equal(g[0][3], null);
  assert.equal(g[0][4], "2026-05-01");
  const flat = g.flat().filter(Boolean);
  assert.equal(flat.length, 31);
  assert.equal(flat[0], "2026-05-01");
  assert.equal(flat[30], "2026-05-31");
});

test("monthGrid: febbraio 2024 (bisestile) ha 29 giorni", () => {
  const flat = monthGrid(2024, 1).flat().filter(Boolean);
  assert.equal(flat.length, 29);
  assert.equal(flat[28], "2024-02-29");
});

test("parseTargetTrack: 'NxR' con range", () => {
  assert.deepEqual(parseTargetTrack("4 × 6-8"), { sets: 4, reps: "6-8" });
  assert.deepEqual(parseTargetTrack("2×15"), { sets: 2, reps: "15" });
});

test("parseTargetTrack: reps non numeriche ('max')", () => {
  assert.deepEqual(parseTargetTrack("3 × max"), { sets: 3, reps: "max" });
});

test("parseTargetTrack: stringa vuota -> default 1 serie", () => {
  assert.deepEqual(parseTargetTrack(""), { sets: 1, reps: "" });
});

test("parseTarget: normale prende la prima parte", () => {
  assert.deepEqual(parseTarget("4 × 6-8"), { sets: 4, reps: "6-8" });
});

test("parseTarget: superset divide su '/' nelle due tracce", () => {
  assert.deepEqual(parseTarget("3 × 12-15 / 3 × 12-15", true), {
    a: { sets: 3, reps: "12-15" },
    b: { sets: 3, reps: "12-15" },
  });
});

test("parseTarget: superset con una sola parte ricade su quella per la B", () => {
  assert.deepEqual(parseTarget("3 × 10", true), {
    a: { sets: 3, reps: "10" },
    b: { sets: 3, reps: "10" },
  });
});

test("parseTarget: superset preserva qualificatori dopo il primo '/' (es. 'max/lato')", () => {
  assert.deepEqual(parseTarget("3 × 15 / 3 × max/lato", true), {
    a: { sets: 3, reps: "15" },
    b: { sets: 3, reps: "max/lato" },
  });
});

test("parseTarget: superset con conteggi/reps asimmetrici", () => {
  assert.deepEqual(parseTarget("3 × 8-10 / 3 × 10-12", true), {
    a: { sets: 3, reps: "8-10" },
    b: { sets: 3, reps: "10-12" },
  });
});

test("parseTarget gestisce reps a numero singolo (senza range)", () => {
  assert.deepEqual(parseTarget("3 × 10"), { sets: 3, reps: "10" });
  assert.deepEqual(parseTarget("3 × 10 / 3 × 10", true), {
    a: { sets: 3, reps: "10" },
    b: { sets: 3, reps: "10" },
  });
});

test("activeSetIndex: prima serie non done", () => {
  assert.equal(activeSetIndex([]), 0);
  assert.equal(activeSetIndex([{ done: true }, { done: false }]), 1);
  assert.equal(activeSetIndex([{ done: true }, { done: true }]), 2);
});

test("activeSetIndex: input non-array -> 0", () => {
  assert.equal(activeSetIndex(null), 0);
  assert.equal(activeSetIndex(undefined), 0);
});

test("isEntryComplete: normale completo se raggiunge il target di serie e tutte done", () => {
  const ex = { setsReps: "1 × 8", superset: false };
  assert.equal(isEntryComplete("", ex), false);
  assert.equal(isEntryComplete({ sets: [{ reps: "8", kg: "70", done: true }] }, ex), true);
  assert.equal(isEntryComplete({ sets: [{ reps: "8", kg: "70", done: false }] }, ex), false);
});

test("isEntryComplete: normale NON completo se serie done < target", () => {
  const ex = { setsReps: "4 × 6-8", superset: false };
  assert.equal(isEntryComplete({ sets: [{ reps: "8", kg: "70", done: true }] }, ex), false);
  const four = { sets: [0, 1, 2, 3].map(() => ({ reps: "8", kg: "70", done: true })) };
  assert.equal(isEntryComplete(four, ex), true);
});

test("isEntryComplete: superset completo quando entrambe le tracce raggiungono il target", () => {
  const ex = { setsReps: "1 × 15 / 1 × 15", superset: true };
  assert.equal(isEntryComplete("", ex), false);
  const v = { a: { sets: [{ reps: "15", kg: "25", done: true }] }, b: { sets: [{ reps: "15", kg: "12", done: true }] } };
  assert.equal(isEntryComplete(v, ex), true);
});

test("isEntryComplete: superset con traccia B vuota (corpo libero) non blocca", () => {
  const ex = { setsReps: "1 × 15 / 1 × max", superset: true };
  const half = { a: { sets: [{ reps: "15", kg: "25", done: true }] }, b: { sets: [] } };
  assert.equal(isEntryComplete(half, ex), true);
});

test("isEntryComplete: superset con traccia A vuota e B completa -> true", () => {
  const ex = { setsReps: "1 × 15 / 1 × 12", superset: true };
  const v = { a: { sets: [] }, b: { sets: [{ reps: "15", kg: "12", done: true }] } };
  assert.equal(isEntryComplete(v, ex), true);
});

test("activeExerciseIndex: primo esercizio non completo", () => {
  const plan = { exercises: [{ id: "e0", superset: false }, { id: "e1", superset: false }, { id: "e2", superset: false }] };
  assert.equal(activeExerciseIndex(emptyData(), "2026-W22", "A", plan), 0);
  let d = setEntry(emptyData(), "2026-W22", "A", "e0", { sets: [{ reps: "8", kg: "70", done: true }] }, "t");
  assert.equal(activeExerciseIndex(d, "2026-W22", "A", plan), 1);
});

test("activeExerciseIndex: tutti completi -> 0 (wrap, non solo perché è il primo)", () => {
  const plan = { exercises: [{ id: "e0", superset: false }, { id: "e1", superset: false }] };
  let d = setEntry(emptyData(), "2026-W22", "A", "e0", { sets: [{ reps: "8", kg: "70", done: true }] }, "t1");
  d = setEntry(d, "2026-W22", "A", "e1", { sets: [{ reps: "8", kg: "70", done: true }] }, "t2");
  assert.equal(activeExerciseIndex(d, "2026-W22", "A", plan), 0);
});

test("withSet: aggiorna una serie esistente (merge del patch)", () => {
  const e = { sets: [{ reps: "8", kg: "70", done: false }], note: "n" };
  assert.deepEqual(withSet(e, 0, { kg: "72.5", done: true }), {
    sets: [{ reps: "8", kg: "72.5", done: true, feel: "", warmup: false, failed: false, failNote: "", comments: [] }],
    note: "n",
  });
});

test("withSet: estende l'array se l'indice supera la lunghezza", () => {
  assert.deepEqual(withSet("", 0, { reps: "8", kg: "70", done: true }), {
    sets: [{ reps: "8", kg: "70", done: true, feel: "", warmup: false, failed: false, failNote: "", comments: [] }],
    note: "",
  });
  const e = { sets: [{ reps: "8", kg: "70", done: true }] };
  assert.equal(withSet(e, 2, { reps: "6", kg: "70" }).sets.length, 3);
});

test("withoutSet: rimuove la serie all'indice", () => {
  const e = { sets: [{ reps: "8", kg: "70", done: true }, { reps: "6", kg: "70", done: false }] };
  assert.deepEqual(withoutSet(e, 0).sets, [{ reps: "6", kg: "70", done: false, feel: "", warmup: false, failed: false, failNote: "", comments: [] }]);
});

test("withSupersetSet: aggiorna solo la traccia indicata", () => {
  const v = { a: { sets: [{ reps: "15", kg: "25", done: false }] }, b: { sets: [{ reps: "15", kg: "12", done: false }] }, note: "" };
  const out = withSupersetSet(v, "b", 0, { done: true });
  assert.equal(out.a.sets[0].done, false);
  assert.equal(out.b.sets[0].done, true);
});

test("withoutSupersetSet: rimuove dalla traccia indicata", () => {
  const v = { a: { sets: [{ reps: "15", kg: "25", done: true }, { reps: "15", kg: "25", done: false }] }, b: { sets: [] }, note: "" };
  assert.equal(withoutSupersetSet(v, "a", 1).a.sets.length, 1);
});

test("withSet/withSupersetSet: non mutano l'input (immutabilità)", () => {
  const e = { sets: [{ reps: "8", kg: "70", done: false }], note: "n" };
  const out = withSet(e, 0, { kg: "72.5", done: true });
  assert.equal(e.sets[0].kg, "70");      // originale invariato
  assert.equal(e.sets[0].done, false);
  assert.notEqual(out.sets[0], e.sets[0]); // oggetto serie nuovo

  const sv = { a: { sets: [{ reps: "15", kg: "25", done: false }] }, b: { sets: [] }, note: "" };
  const sout = withSupersetSet(sv, "a", 0, { done: true });
  assert.equal(sv.a.sets[0].done, false);  // originale invariato
  assert.equal(sout.a.sets[0].done, true);
});

test("bestKg: massimo kg su tutte le settimane per quell'esercizio", () => {
  let d = setEntry(emptyData(), "2026-W20", "A", 0, { sets: [{ reps: "8", kg: "60" }] }, "t1");
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "65" }, { reps: "6", kg: "70" }] }, "t2");
  assert.equal(bestKg(d, "A", 0), 70);
});

test("bestKg: gestisce i decimali con virgola", () => {
  let d = setEntry(emptyData(), "2026-W22", "A", 0, { sets: [{ reps: "8", kg: "72,5" }] }, "t1");
  assert.equal(bestKg(d, "A", 0), 72.5);
});

test("bestKg: nessun dato -> null", () => {
  assert.equal(bestKg(emptyData(), "A", 0), null);
});

test("bestKg: con track restringe ai set della traccia indicata del superset", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", "s1", {
    a: { sets: [{ reps: "8", kg: "30", done: true }], note: "" },
    b: { sets: [{ reps: "8", kg: "12", done: true }], note: "" },
    note: "",
  });
  assert.equal(bestKg(d, "A", "s1", "a"), 30);
  assert.equal(bestKg(d, "A", "s1", "b"), 12);
});

test("progressionDelta: differenza arrotondata o null", () => {
  assert.equal(progressionDelta("72.5", "70"), 2.5);
  assert.equal(progressionDelta("70", "72.5"), -2.5);
  assert.equal(progressionDelta("70", "70"), 0);
  assert.equal(progressionDelta("", "70"), null);
  assert.equal(progressionDelta("70", ""), null);
});

test("withNote imposta la nota preservando le serie (normale)", () => {
  const entry = { sets: [{ reps: "8", kg: "70", done: true }], note: "" };
  const out = withNote(entry, "presa stretta", false);
  assert.equal(out.note, "presa stretta");
  assert.equal(out.sets.length, 1);
  assert.equal(out.sets[0].kg, "70");
});

test("withNote su superset preserva entrambe le tracce", () => {
  const entry = { a: { sets: [{ reps: "12", kg: "20", done: true }] }, b: { sets: [] }, note: "" };
  const out = withNote(entry, "spalla tirava", true);
  assert.equal(out.note, "spalla tirava");
  assert.equal(out.a.sets.length, 1);
  assert.equal(out.b.sets.length, 0);
});

test("previousNote prende la nota della settimana precedente più recente", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "70", done: true }], note: "presa media" }, "t");
  d = setEntry(d, "2026-W22", "A", 0, { sets: [], note: "" }, "t");
  assert.equal(previousNote(d, "A", 0, "2026-W22", false), "presa media");
});

test("previousNote ritorna '' se non c'è nota precedente", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "70", done: true }], note: "" }, "t");
  assert.equal(previousNote(d, "A", 0, "2026-W22", false), "");
});

test("previousSetInSession: ultima serie done con indice < index", () => {
  const entry = { sets: [
    { reps: "8", kg: "70", done: true },
    { reps: "8", kg: "72.5", done: true },
    { reps: "", kg: "", done: false },
  ] };
  assert.deepEqual(previousSetInSession(entry, 2), { reps: "8", kg: "72.5" });
  assert.deepEqual(previousSetInSession(entry, 1), { reps: "8", kg: "70" });
});

test("previousSetInSession: salta le serie non done", () => {
  const entry = { sets: [
    { reps: "8", kg: "70", done: true },
    { reps: "5", kg: "0", done: false },
  ] };
  assert.deepEqual(previousSetInSession(entry, 2), { reps: "8", kg: "70" });
});

test("previousSetInSession: nessuna serie done precedente -> null", () => {
  assert.equal(previousSetInSession({ sets: [{ reps: "8", kg: "70", done: false }] }, 1), null);
  assert.equal(previousSetInSession({ sets: [] }, 0), null);
});

test("previousSetInSession: traccia superset", () => {
  const entry = { a: { sets: [{ reps: "12", kg: "20", done: true }] },
                  b: { sets: [{ reps: "15", kg: "10", done: true }] } };
  assert.deepEqual(previousSetInSession(entry, 1, "b"), { reps: "15", kg: "10" });
});

test("previousWeekSet: stessa serie della settimana precedente con dato", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", 0, { sets: [
    { reps: "8", kg: "67.5", done: true }, { reps: "8", kg: "70", done: true },
  ] });
  const r = previousWeekSet(d, "A", 0, "2026-W22", 1);
  assert.deepEqual({ reps: r.reps, kg: r.kg, week: r.week }, { reps: "8", kg: "70", week: "2026-W21" });
});

test("previousWeekSet: fallback all'ultima serie se l'indice non esiste", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "67.5", done: true }] });
  const r = previousWeekSet(d, "A", 0, "2026-W22", 3);
  assert.equal(r.kg, "67.5");
});

test("previousWeekSet: salta settimane vuote e senza storico -> null", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", 0, { sets: [{ reps: "8", kg: "65", done: true }] });
  d = setEntry(d, "2026-W21", "A", 0, { sets: [] });
  assert.equal(previousWeekSet(d, "A", 0, "2026-W22", 0).kg, "65");
  assert.equal(previousWeekSet(d, "A", 0, "2026-W20", 0), null);
});

const PLAN_AB = { exercises: [
  { id: "pab0", name: "Panca", setsReps: "4 × 8" },
  { id: "pab1", name: "Croci", setsReps: "3 × 12", superset: true },
] };

test("sessionVolume: somma reps*kg delle serie done (normale + superset)", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "pab0", { sets: [
    { reps: "8", kg: "70", done: true },   // 560
    { reps: "8", kg: "70", done: false },  // esclusa (non done)
  ] });
  d = setEntry(d, "2026-W22", "A", "pab1", {
    a: { sets: [{ reps: "12", kg: "20", done: true }] },  // 240
    b: { sets: [{ reps: "15", kg: "10", done: true }] },  // 150
  });
  assert.equal(sessionVolume(d, "2026-W22", "A", PLAN_AB), 560 + 240 + 150);
});

test("sessionVolume: 0 senza serie done e ignora valori non numerici", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "pab0", { sets: [{ reps: "max", kg: "", done: true }] });
  assert.equal(sessionVolume(d, "2026-W22", "A", PLAN_AB), 0);
});

test("sessionHasDoneSet: true se almeno una serie è done (normale)", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "pab0", { sets: [{ reps: "8", kg: "70", done: true }] }, "2026-05-25T08:00:00Z");
  assert.equal(sessionHasDoneSet(d, "2026-W22", "A", PLAN_AB), true);
});

test("sessionHasDoneSet: false con data stampata ma nessuna serie done (sessione di prova annullata)", () => {
  let d = emptyData();
  // sessione di prova: la data resta stampata in weeks[].dates, ma nessuna serie è done
  d = setEntry(d, "2026-W22", "A", "pab0", { sets: [{ reps: "8", kg: "70", done: false }] }, "2026-05-25T08:00:00Z");
  assert.ok(d.weeks["2026-W22"].dates.A, "la data resta in weeks[].dates");
  assert.equal(sessionHasDoneSet(d, "2026-W22", "A", PLAN_AB), false);
});

test("sessionHasDoneSet: true se la traccia B del superset ha una serie done", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "pab1", { a: { sets: [] }, b: { sets: [{ reps: "15", kg: "10", done: true }] } }, "t");
  assert.equal(sessionHasDoneSet(d, "2026-W22", "A", PLAN_AB), true);
});

test("sessionHasDoneSet: conta una serie done a corpo libero (reps senza kg, volume 0)", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "pab0", { sets: [{ reps: "12", kg: "", done: true }] }, "t");
  assert.equal(sessionVolume(d, "2026-W22", "A", PLAN_AB), 0);
  assert.equal(sessionHasDoneSet(d, "2026-W22", "A", PLAN_AB), true);
});

test("sessionHasDoneSet: false senza dayPlan", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "pab0", { sets: [{ reps: "8", kg: "70", done: true }] }, "t");
  assert.equal(sessionHasDoneSet(d, "2026-W22", "A", null), false);
});

test("exerciseTrend: top-set kg delle ultime n settimane, ordine crescente", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", 0, { sets: [{ reps: "8", kg: "65", done: true }, { reps: "8", kg: "67.5", done: true }] });
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "70", done: true }] });
  d = setEntry(d, "2026-W22", "A", 0, { sets: [{ reps: "8", kg: "72.5", done: true }] });
  assert.deepEqual(exerciseTrend(d, "A", 0, "2026-W22", 3), [
    { week: "2026-W20", kg: 67.5 }, { week: "2026-W21", kg: 70 }, { week: "2026-W22", kg: 72.5 },
  ]);
});

test("exerciseTrend: salta settimane senza kg e limita a n", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W19", "A", 0, { sets: [{ reps: "8", kg: "60", done: true }] });
  d = setEntry(d, "2026-W20", "A", 0, { sets: [{ reps: "8", kg: "", done: true }] });
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "70", done: true }] });
  d = setEntry(d, "2026-W22", "A", 0, { sets: [{ reps: "8", kg: "72.5", done: true }] });
  assert.deepEqual(exerciseTrend(d, "A", 0, "2026-W22", 2), [
    { week: "2026-W21", kg: 70 }, { week: "2026-W22", kg: 72.5 },
  ]);
});

test("exerciseTrend: nessuno storico -> array vuoto", () => {
  assert.deepEqual(exerciseTrend(emptyData(), "A", 0, "2026-W22", 3), []);
});

test("warmup escluso da volume, PR e trend", () => {
  const dayPlan = { exercises: [{ id: "e0", name: "Panca", setsReps: "4 × 8" }] };
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "e0", { sets: [
    { reps: 8, kg: 40,   done: true, warmup: true },   // riscaldamento: NON conta
    { reps: 8, kg: 72.5, done: true, warmup: false },
    { reps: 8, kg: 72.5, done: true, warmup: false },
  ] });
  // volume: solo le due working = 8*72.5*2 = 1160 (il warmup 8*40=320 escluso)
  assert.equal(sessionVolume(d, "2026-W22", "A", dayPlan), 1160);
  // PR e trend con un warmup "pesante" fittizio (90): NON deve risultare
  let d2 = emptyData();
  d2 = setEntry(d2, "2026-W22", "A", 0, { sets: [
    { reps: 3, kg: 90, done: true, warmup: true },
    { reps: 8, kg: 72.5, done: true, warmup: false },
  ] });
  assert.equal(bestKg(d2, "A", 0), 72.5);
  const tr = exerciseTrend(d2, "A", 0, "2026-W22", 3);
  assert.equal(tr[tr.length - 1].kg, 72.5);
});

test("trackComplete: il target conta solo i working set", () => {
  const ex = { name: "Panca", setsReps: "4 × 8" };
  // 1 warmup + 3 working, tutte done -> NON completo (servono 4 working)
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", 0, { sets: [
    { reps: 8, kg: 40,   done: true, warmup: true },
    { reps: 8, kg: 72.5, done: true, warmup: false },
    { reps: 8, kg: 72.5, done: true, warmup: false },
    { reps: 8, kg: 72.5, done: true, warmup: false },
  ] });
  assert.equal(isEntryComplete(getEntry(d, "2026-W22", "A", 0), ex), false);
  // 1 warmup + 4 working, tutte done -> completo
  let d2 = emptyData();
  d2 = setEntry(d2, "2026-W22", "A", 0, { sets: [
    { reps: 8, kg: 40,   done: true, warmup: true },
    { reps: 8, kg: 72.5, done: true, warmup: false },
    { reps: 8, kg: 72.5, done: true, warmup: false },
    { reps: 8, kg: 72.5, done: true, warmup: false },
    { reps: 8, kg: 72.5, done: true, warmup: false },
  ] });
  assert.equal(isEntryComplete(getEntry(d2, "2026-W22", "A", 0), ex), true);
});

test("previousSetInSession salta i warmup", () => {
  const entry = { sets: [
    { reps: 8, kg: 40, done: true, warmup: true },
    { reps: 8, kg: 72.5, done: true, warmup: false },
    { reps: "", kg: "", done: false, warmup: false },
  ] };
  // dalla serie 3 (index 2): l'ultima working done è la index 1 (72.5), non il warmup 40
  assert.deepEqual(previousSetInSession(entry, 2), { reps: "8", kg: "72.5" });
});

test("previousWeekSet si allinea ai soli working set", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", 0, { sets: [
    { reps: 8, kg: 40, done: true, warmup: true },   // warmup: ignorato nell'allineamento
    { reps: 8, kg: 70, done: true, warmup: false },  // working #0
    { reps: 8, kg: 72.5, done: true, warmup: false },// working #1
  ] });
  // setIndex 0 -> primo working (70), non il warmup
  assert.deepEqual(previousWeekSet(d, "A", 0, "2026-W22", 0), { reps: "8", kg: "70", week: "2026-W21" });
});

// ── failed set ────────────────────────────────────────────────────────────────

test("failed escluso da volume, PR e trend (esattamente come warmup)", () => {
  const dayPlan = { exercises: [{ id: "e0", name: "Panca", setsReps: "3 × 8" }] };
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "e0", { sets: [
    { reps: 8, kg: 50,   done: true, failed: true },   // fallita: NON conta nelle stats
    { reps: 8, kg: 72.5, done: true, failed: false },
    { reps: 8, kg: 72.5, done: true, failed: false },
  ] });
  // volume: solo le due working = 8*72.5*2 = 1160 (la failed 8*50=400 esclusa)
  assert.equal(sessionVolume(d, "2026-W22", "A", dayPlan), 1160);
  // PR: la failed da 90 NON deve comparire come record
  let d2 = emptyData();
  d2 = setEntry(d2, "2026-W22", "A", 0, { sets: [
    { reps: 3, kg: 90, done: true, failed: true },
    { reps: 8, kg: 72.5, done: true, failed: false },
  ] });
  assert.equal(bestKg(d2, "A", 0), 72.5);
  // trend: top-set deve essere 72.5, non 90
  const tr = exerciseTrend(d2, "A", 0, "2026-W22", 3);
  assert.equal(tr[tr.length - 1].kg, 72.5);
});

test("failed escluso da previousSetInSession", () => {
  const entry = { sets: [
    { reps: 8, kg: 72.5, done: true, failed: false },
    { reps: 8, kg: 80,   done: true, failed: true },  // failed: da saltare
    { reps: "", kg: "",  done: false, failed: false },
  ] };
  // dalla serie index 2: l'ultima non-failed done è la index 0 (72.5)
  assert.deepEqual(previousSetInSession(entry, 2), { reps: "8", kg: "72.5" });
});

test("failed escluso da previousWeekSet", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", 0, { sets: [
    { reps: 8, kg: 70,  done: true, failed: false },  // working #0
    { reps: 8, kg: 100, done: true, failed: true },   // failed: ignorato nell'allineamento
  ] });
  // setIndex 0 -> primo working non-failed (70), non la failed da 100
  assert.deepEqual(previousWeekSet(d, "A", 0, "2026-W22", 0), { reps: "8", kg: "70", week: "2026-W21" });
});

test("lastWorkingSet: serie più pesante dell'ultima settimana precedente", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", 0, { sets: [
    { reps: "8", kg: "67.5", done: true },
    { reps: "6", kg: "72.5", done: true },
    { reps: "8", kg: "70", done: true },
  ] });
  assert.deepEqual(lastWorkingSet(d, "A", 0, "2026-W22"), { reps: "6", kg: "72.5", week: "2026-W21" });
});

test("lastWorkingSet: esclude warmup e serie failed dal max", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", 0, { sets: [
    { reps: "10", kg: "90", warmup: true },        // warmup escluso
    { reps: "1", kg: "100", done: true, failed: true }, // failed escluso
    { reps: "8", kg: "70", done: true },
  ] });
  assert.deepEqual(lastWorkingSet(d, "A", 0, "2026-W22"), { reps: "8", kg: "70", week: "2026-W21" });
});

test("lastWorkingSet: salta settimane senza kg numerico e quelle >= weekKey", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", 0, { sets: [{ reps: "8", kg: "65", done: true }] });
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "max", kg: "", done: true }] }); // nessun kg numerico
  d = setEntry(d, "2026-W22", "A", 0, { sets: [{ reps: "8", kg: "80", done: true }] }); // == weekKey, escluso
  assert.deepEqual(lastWorkingSet(d, "A", 0, "2026-W22"), { reps: "8", kg: "65", week: "2026-W20" });
});

test("lastWorkingSet: salta una settimana con sole serie warmup/failed", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", 0, { sets: [{ reps: "8", kg: "65", done: true }] });
  d = setEntry(d, "2026-W21", "A", 0, { sets: [
    { reps: "10", kg: "90", warmup: true },             // tutte filtrate
    { reps: "1", kg: "100", done: true, failed: true },
  ] });
  assert.deepEqual(lastWorkingSet(d, "A", 0, "2026-W22"), { reps: "8", kg: "65", week: "2026-W20" });
});

test("lastWorkingSet: nessuno storico utile -> null", () => {
  assert.equal(lastWorkingSet(emptyData(), "A", 0, "2026-W22"), null);
});

test("lastWorkingSet: traccia 'a'/'b' di un superset", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", "ss", {
    a: { sets: [{ reps: "12", kg: "20", done: true }, { reps: "10", kg: "22.5", done: true }] },
    b: { sets: [{ reps: "15", kg: "10", done: true }] },
  });
  assert.deepEqual(lastWorkingSet(d, "A", "ss", "2026-W22", "a"), { reps: "10", kg: "22.5", week: "2026-W21" });
  assert.deepEqual(lastWorkingSet(d, "A", "ss", "2026-W22", "b"), { reps: "15", kg: "10", week: "2026-W21" });
});

test("isEntryComplete: la serie failed (done+failed) conta per il completamento", () => {
  // target 3 × 8: 2 normali done + 1 done+failed = 3 done totali -> completo
  const ex = { setsReps: "3 × 8", superset: false };
  const entry = { sets: [
    { reps: "8", kg: "72.5", done: true,  failed: false },
    { reps: "8", kg: "72.5", done: true,  failed: false },
    { reps: "6", kg: "72.5", done: true,  failed: true  }, // non riuscita ma done
  ] };
  assert.equal(isEntryComplete(entry, ex), true);
});

test("nextExercisePreview: ritorna nome+target del successivo", () => {
  const ex = [{ name: "A", setsReps: "3 × 10" }, { name: "B", setsReps: "3 × 12" }];
  assert.deepEqual(nextExercisePreview(ex, 0), { last: false, name: "B", target: "3 × 12" });
});

test("nextExercisePreview: ultimo esercizio -> { last: true }", () => {
  const ex = [{ name: "A", setsReps: "3 × 10" }, { name: "B", setsReps: "3 × 12" }];
  assert.deepEqual(nextExercisePreview(ex, 1), { last: true });
});

test("bestKg: funziona con chiavi-id opache (non numeriche)", () => {
  const data = { weeks: {
    "2026-W21": { entries: { A: { "k7m2": { sets: [{ reps: "8", kg: "40", done: true }] } } } },
    "2026-W22": { entries: { A: { "k7m2": { sets: [{ reps: "8", kg: "45", done: true }] } } } },
  } };
  assert.equal(bestKg(data, "A", "k7m2"), 45);
});

test("exerciseTrend: traccia per id opaco su più settimane", () => {
  const data = { weeks: {
    "2026-W21": { entries: { A: { "zz9": { sets: [{ reps: "8", kg: "40", done: true }] } } } },
    "2026-W22": { entries: { A: { "zz9": { sets: [{ reps: "8", kg: "42", done: true }] } } } },
  } };
  const t = exerciseTrend(data, "A", "zz9", "2026-W22", 3, false);
  assert.deepEqual(t.map((x) => x.kg), [40, 42]);
});

test("topSetSeries: top-set per settimana, ordine crescente, normale", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", "e0", { sets: [{ reps: "8", kg: "65", done: true }, { reps: "8", kg: "67.5", done: true }] });
  d = setEntry(d, "2026-W22", "A", "e0", { sets: [{ reps: "8", kg: "72.5", done: true }] });
  assert.deepEqual(topSetSeries(d, "A", "e0", "2026-W22"), [
    { week: "2026-W20", kg: 67.5 }, { week: "2026-W22", kg: 72.5 },
  ]);
});

test("topSetSeries: salta settimane senza kg e quelle oltre weekKey", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", "e0", { sets: [{ reps: "8", kg: "", done: true }] });
  d = setEntry(d, "2026-W21", "A", "e0", { sets: [{ reps: "8", kg: "70", done: true }] });
  d = setEntry(d, "2026-W23", "A", "e0", { sets: [{ reps: "8", kg: "80", done: true }] });
  assert.deepEqual(topSetSeries(d, "A", "e0", "2026-W22"), [{ week: "2026-W21", kg: 70 }]);
});

test("topSetSeries: esclude warmup e serie non riuscite", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "e0", { sets: [
    { reps: "8", kg: "100", done: true, warmup: true },
    { reps: "8", kg: "90", done: true, failed: true },
    { reps: "8", kg: "72.5", done: true },
  ] });
  assert.deepEqual(topSetSeries(d, "A", "e0", "2026-W22"), [{ week: "2026-W22", kg: 72.5 }]);
});

test("topSetSeries: traccia 'a'/'b' di un superset", () => {
  const data = { weeks: {
    "2026-W22": { entries: { A: { ss: {
      a: { sets: [{ reps: "10", kg: "20", done: true }] },
      b: { sets: [{ reps: "10", kg: "15", done: true }] },
    } } } },
  } };
  assert.deepEqual(topSetSeries(data, "A", "ss", "2026-W22", "a"), [{ week: "2026-W22", kg: 20 }]);
  assert.deepEqual(topSetSeries(data, "A", "ss", "2026-W22", "b"), [{ week: "2026-W22", kg: 15 }]);
});

test("topSetSeries: nessuno storico -> array vuoto", () => {
  assert.deepEqual(topSetSeries(emptyData(), "A", "e0", "2026-W22"), []);
});

test("chartGeometry: serie vuota -> niente punti", () => {
  assert.deepEqual(chartGeometry([]), { points: [], polyline: "", yTicks: [], min: null, max: null });
});

test("chartGeometry: punto singolo a metà altezza, centrato in x", () => {
  const g = chartGeometry([{ week: "2026-W22", kg: 50 }]);
  // default width 260, padX 34, margine destro 8 -> plotW 218 -> x centro = 34 + 109 = 143
  // span 0 -> banda ±1 -> kg a metà -> y = 20 + 0.5*(150-20-26) = 72
  assert.deepEqual(g.points, [{ x: 143, y: 72, week: "2026-W22", kg: 50 }]);
  assert.equal(g.min, 50);
  assert.equal(g.max, 50);
});

test("chartGeometry: due punti, il massimo sta più in alto (y minore)", () => {
  const g = chartGeometry([{ week: "2026-W21", kg: 40 }, { week: "2026-W22", kg: 50 }]);
  // dataMin 40, dataMax 50, span 10, pad 1.5 -> lo 38.5 hi 51.5; plotH 104
  // x: 34 e 252 (34+218); y: 40 -> 112, 50 -> 32
  assert.deepEqual(g.points, [
    { x: 34, y: 112, week: "2026-W21", kg: 40 },
    { x: 252, y: 32, week: "2026-W22", kg: 50 },
  ]);
  assert.equal(g.polyline, "34,112 252,32");
  assert.deepEqual(g.yTicks, [{ value: 50, y: 32 }, { value: 40, y: 112 }]);
});

test("chartGeometry: valori uguali non dividono per zero", () => {
  const g = chartGeometry([{ week: "2026-W21", kg: 50 }, { week: "2026-W22", kg: 50 }]);
  assert.ok(g.points.every((p) => p.y === 72));
  assert.equal(g.polyline, "34,72 252,72");
  assert.deepEqual(g.yTicks, [{ value: 50, y: 72 }]);
});

test("chartGeometry: yTicks arrotondati e a metà se valori uguali", () => {
  const g = chartGeometry([{ week: "2026-W22", kg: 60.5 }]);
  assert.deepEqual(g.yTicks, [{ value: 60.5, y: 72 }]);
});

// Helper: data con un esercizio "p1" normale, kg per settimana.
function dataKg(perWeek) {
  let d = emptyData();
  for (const [wk, kgs] of Object.entries(perWeek)) {
    const sets = kgs.map((kg) => ({ reps: "8", kg: String(kg), done: true }));
    d = setEntry(d, wk, "A", "p1", { sets, note: "" });
  }
  return d;
}

test("bestKgBefore: massimo escludendo la settimana data", () => {
  const d = dataKg({ "2026-W20": [50, 60], "2026-W21": [70], "2026-W22": [55] });
  assert.equal(bestKgBefore(d, "A", "p1", "2026-W22"), 70);
  assert.equal(bestKgBefore(d, "A", "p1", "2026-W21"), 60);
});

test("bestKgBefore: null se nessuna altra settimana ha dati", () => {
  const d = dataKg({ "2026-W22": [55] });
  assert.equal(bestKgBefore(d, "A", "p1", "2026-W22"), null);
});

test("bestKgBefore: ignora warmup e failed", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", "p1", { sets: [
    { reps: "8", kg: "100", done: true, warmup: true },
    { reps: "8", kg: "90", done: true, failed: true },
    { reps: "8", kg: "60", done: true },
  ], note: "" });
  assert.equal(bestKgBefore(d, "A", "p1", "2026-W22"), 60);
});

test("bestKgBefore: ignora le settimane successive a weekKey", () => {
  const d = dataKg({ "2026-W20": [50], "2026-W22": [100] });
  // Da W21 in poi W22 esiste ma è dopo: non deve essere conteggiata.
  assert.equal(bestKgBefore(d, "A", "p1", "2026-W21"), 50);
});

test("isWeekRecord: true se la settimana batte strettamente lo storico", () => {
  const d = dataKg({ "2026-W20": [60], "2026-W22": [65] });
  assert.equal(isWeekRecord(d, "A", "p1", "2026-W22"), true);
});

test("isWeekRecord: false se pareggia il massimo (non stretto)", () => {
  const d = dataKg({ "2026-W20": [60], "2026-W22": [60] });
  assert.equal(isWeekRecord(d, "A", "p1", "2026-W22"), false);
});

test("isWeekRecord: true al primo dato in assoluto", () => {
  const d = dataKg({ "2026-W22": [40] });
  assert.equal(isWeekRecord(d, "A", "p1", "2026-W22"), true);
});

test("isWeekRecord: false se la settimana non ha kg working", () => {
  const d = dataKg({ "2026-W20": [60] });
  assert.equal(isWeekRecord(d, "A", "p1", "2026-W22"), false);
});

test("isSetRecord: prevBest null e kg numerico -> true", () => {
  assert.equal(isSetRecord(null, "40"), true);
});
test("isSetRecord: kg maggiore stretto del prevBest -> true", () => {
  assert.equal(isSetRecord(60, "65"), true);
});
test("isSetRecord: pareggio non è record -> false", () => {
  assert.equal(isSetRecord(60, "60"), false);
});
test("isSetRecord: kg non numerico -> false", () => {
  assert.equal(isSetRecord(60, ""), false);
});

test("volumeByMuscle: somma per gruppo, ordina desc, esclude i zero", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "p1", { sets: [{ reps: "10", kg: "50", done: true }], note: "" }); // 500
  d = setEntry(d, "2026-W22", "A", "p2", { sets: [{ reps: "10", kg: "20", done: true }], note: "" }); // 200
  const dayPlan = { day: "A", exercises: [
    { id: "p1", muscle: "Petto", superset: false },
    { id: "p2", muscle: "Spalle", superset: false },
  ] };
  assert.deepEqual(volumeByMuscle(d, "2026-W22", "A", dayPlan), [
    { muscle: "Petto", volume: 500 },
    { muscle: "Spalle", volume: 200 },
  ]);
});

test("volumeByMuscle: superset attribuisce A->muscle, B->muscleB", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "s1", {
    a: { sets: [{ reps: "10", kg: "30", done: true }], note: "" }, // 300 -> Tricipiti
    b: { sets: [{ reps: "10", kg: "10", done: true }], note: "" }, // 100 -> Bicipiti
    note: "",
  });
  const dayPlan = { day: "A", exercises: [
    { id: "s1", muscle: "Tricipiti", muscleB: "Bicipiti", superset: true },
  ] };
  assert.deepEqual(volumeByMuscle(d, "2026-W22", "A", dayPlan), [
    { muscle: "Tricipiti", volume: 300 },
    { muscle: "Bicipiti", volume: 100 },
  ]);
});

test("volumeByMuscle: muscolo mancante finisce in 'Altro'", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "p1", { sets: [{ reps: "10", kg: "40", done: true }], note: "" });
  const dayPlan = { day: "A", exercises: [{ id: "p1", superset: false }] };
  assert.deepEqual(volumeByMuscle(d, "2026-W22", "A", dayPlan), [{ muscle: "Altro", volume: 400 }]);
});

test("volumeByMuscle: accumula stesso muscolo da esercizi diversi", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "p1", { sets: [{ reps: "10", kg: "50", done: true }], note: "" }); // 500
  d = setEntry(d, "2026-W22", "A", "p2", { sets: [{ reps: "10", kg: "30", done: true }], note: "" }); // 300
  const dayPlan = { day: "A", exercises: [
    { id: "p1", muscle: "Petto", superset: false },
    { id: "p2", muscle: "Petto", superset: false },
  ] };
  assert.deepEqual(volumeByMuscle(d, "2026-W22", "A", dayPlan), [{ muscle: "Petto", volume: 800 }]);
});

// ── Volume manubri ×2 (punto 6) + unità a tempo "sec" (punto 12b) ──

test("isDumbbell: riconosce 'manubri'/'manubrio' nel nome", () => {
  assert.equal(isDumbbell("Lento avanti manubri"), true);
  assert.equal(isDumbbell("Pullover con manubrio"), true);
  assert.equal(isDumbbell("Curl manubri + French press"), true);
  assert.equal(isDumbbell("Panca piana bilanciere"), false);
  assert.equal(isDumbbell(""), false);
  assert.equal(isDumbbell(null), false);
});

test("volumeMeta: i manubri raddoppiano il fattore, il bilanciere no", () => {
  assert.deepEqual(volumeMeta({ name: "Lento avanti manubri" }, null), { factor: 2, unit: "reps" });
  assert.deepEqual(volumeMeta({ name: "Panca piana bilanciere" }, null), { factor: 1, unit: "reps" });
});

test("volumeMeta: superset valuta i manubri per singola traccia (nome A / nome B)", () => {
  const ex = { name: "Curl manubri + French press", superset: true };
  assert.deepEqual(volumeMeta(ex, "a"), { factor: 2, unit: "reps" }); // Curl manubri
  assert.deepEqual(volumeMeta(ex, "b"), { factor: 1, unit: "reps" }); // French press
});

test("volumeMeta: unit 'sec' per traccia (unit -> normale/A, unitB -> B)", () => {
  const ss = { name: "Crunch a terra + Plank", superset: true, unitB: "sec" };
  assert.equal(volumeMeta(ss, "a").unit, "reps");
  assert.equal(volumeMeta(ss, "b").unit, "sec");
  assert.equal(volumeMeta({ name: "Plank", unit: "sec" }, null).unit, "sec");
});

test("setVolume: serie a manubri conta entrambi i lati (reps*kg*2)", () => {
  assert.equal(setVolume({ reps: "10", kg: "20", done: true }, { factor: 2, unit: "reps" }), 400);
  assert.equal(setVolume({ reps: "10", kg: "20", done: true }, { factor: 1, unit: "reps" }), 200);
});

test("setVolume: serie a tempo (sec) e serie non-done/warmup/failed -> 0", () => {
  assert.equal(setVolume({ reps: "45", kg: "", done: true }, { factor: 1, unit: "sec" }), 0);
  assert.equal(setVolume({ reps: "10", kg: "20", done: false }, { factor: 1, unit: "reps" }), 0);
  assert.equal(setVolume({ reps: "10", kg: "20", done: true, warmup: true }, { factor: 1, unit: "reps" }), 0);
  assert.equal(setVolume({ reps: "10", kg: "20", done: true, failed: true }, { factor: 1, unit: "reps" }), 0);
});

test("exerciseVolume: normale a manubri raddoppia", () => {
  const ex = { id: "db", name: "Lento avanti manubri", setsReps: "3 × 10" };
  const entry = { sets: [{ reps: "10", kg: "20", done: true }, { reps: "10", kg: "20", done: true }] };
  assert.equal(exerciseVolume(entry, ex), 800); // 2 serie × (10*20*2)
});

test("exerciseVolume: superset somma A(manubri ×2) + B(bilanciere ×1)", () => {
  const ex = { id: "ss", name: "Curl manubri + French press", setsReps: "3 × 10 / 3 × 10", superset: true };
  const entry = {
    a: { sets: [{ reps: "10", kg: "15", done: true }] }, // 10*15*2 = 300
    b: { sets: [{ reps: "10", kg: "20", done: true }] }, // 10*20*1 = 200
  };
  assert.equal(exerciseVolume(entry, ex), 500);
});

test("exerciseVolume: traccia a tempo (sec) esclusa dal volume kg", () => {
  const ex = { id: "pl", name: "Crunch a terra + Plank", setsReps: "3 × 15 / 3 × max", superset: true, unitB: "sec" };
  const entry = {
    a: { sets: [{ reps: "15", kg: "0", done: true }] }, // 15*0 = 0
    b: { sets: [{ reps: "45", kg: "", done: true }] },  // sec -> escluso
  };
  assert.equal(exerciseVolume(entry, ex), 0);
});

test("sessionVolume: applica ×2 ai manubri e somma per il giorno", () => {
  const dayPlan = { exercises: [
    { id: "db", name: "Lento avanti manubri", setsReps: "3 × 10" },
    { id: "bb", name: "Panca", setsReps: "3 × 8" },
  ] };
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "db", { sets: [{ reps: "10", kg: "20", done: true }] }); // 10*20*2 = 400
  d = setEntry(d, "2026-W22", "A", "bb", { sets: [{ reps: "8", kg: "70", done: true }] });  // 8*70 = 560
  assert.equal(sessionVolume(d, "2026-W22", "A", dayPlan), 960);
});

test("volumeByMuscle: manubri ×2 nel breakdown, traccia sec a 0", () => {
  const dayPlan = { exercises: [
    { id: "db", name: "Lento avanti manubri", setsReps: "3 × 10", muscle: "Spalle" },
    { id: "pl", name: "Crunch a terra + Plank", setsReps: "3 × 15 / 3 × max", superset: true, muscle: "Core", muscleB: "Core", unitB: "sec" },
  ] };
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", "db", { sets: [{ reps: "10", kg: "20", done: true }] }); // 400 Spalle
  d = setEntry(d, "2026-W22", "A", "pl", {
    a: { sets: [{ reps: "15", kg: "5", done: true }] }, // 75 Core
    b: { sets: [{ reps: "45", kg: "", done: true }] },  // sec -> 0
  });
  assert.deepEqual(volumeByMuscle(d, "2026-W22", "A", dayPlan), [
    { muscle: "Spalle", volume: 400 },
    { muscle: "Core", volume: 75 },
  ]);
});

// ---- PR a reps per esercizi a corpo libero ----

// helper locale: settimane → entry con sets [{reps, kg}]
function dataSets(weeksSets) {
  let d = emptyData();
  for (const [wk, sets] of Object.entries(weeksSets)) {
    d = setEntry(d, wk, "A", "dips1", { sets, note: "" });
  }
  return d;
}

test("historyIsBodyweight: true se tutti i working set sono senza kg (vuoto o 0)", () => {
  const d = dataSets({ "2026-W20": [{ reps: "8", kg: "", done: true }, { reps: "7", kg: "0", done: true }] });
  assert.equal(historyIsBodyweight(d, "A", "dips1"), true);
});

test("historyIsBodyweight: false appena esiste un kg > 0 storico", () => {
  const d = dataSets({ "2026-W20": [{ reps: "8", kg: "", done: true }], "2026-W21": [{ reps: "8", kg: "5", done: true }] });
  assert.equal(historyIsBodyweight(d, "A", "dips1"), false);
});

test("historyIsBodyweight: ignora warmup e failed con kg", () => {
  const d = dataSets({ "2026-W20": [
    { reps: "8", kg: "20", done: true, warmup: true },
    { reps: "8", kg: "10", done: true, failed: true },
    { reps: "8", kg: "", done: true },
  ] });
  assert.equal(historyIsBodyweight(d, "A", "dips1"), true);
});

test("bestReps / bestRepsBefore: max reps come bestKg ma su reps", () => {
  const d = dataSets({
    "2026-W20": [{ reps: "8", kg: "", done: true }, { reps: "10", kg: "", done: true }],
    "2026-W22": [{ reps: "9", kg: "", done: true }],
  });
  assert.equal(bestReps(d, "A", "dips1"), 10);
  assert.equal(bestRepsBefore(d, "A", "dips1", "2026-W22"), 10);
  assert.equal(bestRepsBefore(d, "A", "dips1", "2026-W20"), null);
});

test("isWeekRecord: corpo libero → record sul max reps", () => {
  const d = dataSets({
    "2026-W20": [{ reps: "8", kg: "", done: true }],
    "2026-W22": [{ reps: "9", kg: "", done: true }],
  });
  assert.equal(isWeekRecord(d, "A", "dips1", "2026-W22"), true);
});

test("isWeekRecord: corpo libero → niente record se non batte le reps", () => {
  const d = dataSets({
    "2026-W20": [{ reps: "10", kg: "", done: true }],
    "2026-W22": [{ reps: "10", kg: "", done: true }],
  });
  assert.equal(isWeekRecord(d, "A", "dips1", "2026-W22"), false);
});

test("isWeekRecord: appena compare un kg > 0 storico si torna alla metrica kg", () => {
  // W20 a corpo libero con 12 reps; W22 zavorrato 5kg x 8: record kg (prima nessun kg).
  const d = dataSets({
    "2026-W20": [{ reps: "12", kg: "", done: true }],
    "2026-W22": [{ reps: "8", kg: "5", done: true }],
  });
  assert.equal(isWeekRecord(d, "A", "dips1", "2026-W22"), true);
  // e le 12 reps storiche NON generano falsi PR reps in W23 a corpo libero
  const d2 = dataSets({
    "2026-W20": [{ reps: "12", kg: "", done: true }],
    "2026-W22": [{ reps: "8", kg: "5", done: true }],
    "2026-W23": [{ reps: "13", kg: "", done: true }],
  });
  assert.equal(isWeekRecord(d2, "A", "dips1", "2026-W23"), false); // metrica kg: top W23 = null
});

// ---- muscleContributions / lastTrainedByGroup (heatmap anatomica) ----

const heatData = () => ({
  plan: [{ day: "A", title: "Push", exercises: [
    { id: "x1", name: "Panca piana bilanciere", muscle: "Petto" },
    { id: "x2", name: "Spinte inclinata manubri", muscle: "Petto" },
    { id: "x3", name: "Plank + Crunch a terra", muscle: "Core", muscleB: "Core", superset: true, unit: "sec", unitB: "reps" },
  ] }],
  weeks: { "2026-W23": {
    dates: { A: "2026-06-02" },
    entries: { A: {
      x1: { sets: [{ reps: "8", kg: "80", done: true }, { reps: "5", kg: "60", done: true, warmup: true }] },
      x2: { sets: [{ reps: "10", kg: "20", done: true }] },
      x3: { a: { sets: [{ reps: "60", done: true }] }, b: { sets: [{ reps: "15", done: true }] } },
    } },
  } },
});

test("muscleContributions: per-traccia con nome, manubri x2, warmup/sec esclusi", () => {
  const d = heatData();
  const out = muscleContributions(d, "2026-W23", "A", d.plan[0]);
  // x1: 8*80=640 (warmup escluso) · x2: 10*20*2=400 (manubri) ·
  // x3 traccia A a tempo → volume 0 (esclusa) · traccia B reps senza kg → 0 (esclusa)
  assert.deepEqual(out, [
    { muscle: "Petto", name: "Panca piana bilanciere", volume: 640 },
    { muscle: "Petto", name: "Spinte inclinata manubri", volume: 400 },
  ]);
});

test("lastTrainedByGroup: data più recente per gruppo, anche con volume 0", () => {
  const d = heatData();
  // Core: serie done a tempo/senza kg → volume 0 ma ALLENATO (conta per freschezza)
  const out = lastTrainedByGroup(d);
  assert.equal(out.Petto, "2026-06-02");
  assert.equal(out.Core, "2026-06-02");
  assert.equal(out.Dorso, undefined);
});

test("lastTrainedByGroup: vince la data più recente tra più settimane", () => {
  const d = heatData();
  d.weeks["2026-W22"] = {
    dates: { A: "2026-05-26" },
    entries: { A: { x1: { sets: [{ reps: "8", kg: "70", done: true }] } } },
  };
  assert.equal(lastTrainedByGroup(d).Petto, "2026-06-02");
});

test("lastTrainedByGroup: serie solo warmup o non-done non contano", () => {
  const d = heatData();
  d.weeks["2026-W23"].entries.A = {
    x1: { sets: [{ reps: "5", kg: "60", done: true, warmup: true }, { reps: "8", kg: "80", done: false }] },
  };
  assert.equal(lastTrainedByGroup(d).Petto, undefined);
});

// ---- Task 1 batch sessione-ux: override vol2/vol2B ----
test("volumeMeta: vol2=true forza factor 2 anche senza 'manubri' nel nome", () => {
  const ex = { name: "Affondo bulgaro", vol2: true };
  assert.equal(volumeMeta(ex, null).factor, 2);
});

test("volumeMeta: vol2=false forza factor 1 anche con 'manubri' nel nome", () => {
  const ex = { name: "Lento avanti manubri", vol2: false };
  assert.equal(volumeMeta(ex, null).factor, 1);
});

test("volumeMeta: vol2 assente -> derivazione dal nome (comportamento attuale)", () => {
  assert.equal(volumeMeta({ name: "Lento avanti manubri" }, null).factor, 2);
  assert.equal(volumeMeta({ name: "Panca piana bilanciere" }, null).factor, 1);
});

test("volumeMeta: vol2B override sulla traccia B del superset", () => {
  const ex = { name: "Pushdown + Curl a corpo libero", superset: true, vol2B: true };
  assert.equal(volumeMeta(ex, "a").factor, 1);
  assert.equal(volumeMeta(ex, "b").factor, 2);
});

// ---- Task 2 batch sessione-ux: platesOn ----
test("platesOn: derivazione dal nome (bilanciere/stacco/squat/EZ)", () => {
  assert.equal(platesOn({ name: "Panca piana bilanciere" }, null), true);
  assert.equal(platesOn({ name: "Stacco rumeno" }, null), true);
  assert.equal(platesOn({ name: "Squat" }, null), true);
  assert.equal(platesOn({ name: "Curl EZ" }, null), true);
  assert.equal(platesOn({ name: "Pulldown presa larga" }, null), false);
  assert.equal(platesOn({ name: "Lento avanti manubri" }, null), false);
});

test("platesOn: bar impostato -> true anche senza match sul nome", () => {
  assert.equal(platesOn({ name: "Curl strano", bar: 10 }, null), true);
});

test("platesOn: override esplicito vince su derivazione", () => {
  assert.equal(platesOn({ name: "Panca piana bilanciere", plates: false }, null), false);
  assert.equal(platesOn({ name: "Affondo bulgaro", plates: true }, null), true);
});

test("platesOn: traccia B del superset con platesB", () => {
  const ex = { name: "Pushdown + Skullcrusher", superset: true, platesB: true };
  assert.equal(platesOn(ex, "a"), false);
  assert.equal(platesOn(ex, "b"), true);
});

test("supersetTrackKeys: non-superset -> []", () => {
  assert.deepEqual(supersetTrackKeys({ name: "Panca", superset: false }), []);
});

test("supersetTrackKeys: duo (2 pezzi nel nome) -> [a,b]", () => {
  assert.deepEqual(supersetTrackKeys({ name: "Curl + Skull", superset: true }), ["a", "b"]);
});

test("supersetTrackKeys: trio (3 pezzi) -> [a,b,c]", () => {
  assert.deepEqual(supersetTrackKeys({ name: "Dead bug + Crunch + Plank", superset: true }), ["a", "b", "c"]);
});

test("supersetTrackKeys: superset senza ' + ' nel nome -> [a,b] (fallback duo)", () => {
  assert.deepEqual(supersetTrackKeys({ name: "Solo nome", superset: true }), ["a", "b"]);
});

test("trackMuscle: a -> muscle, b -> muscleB, c -> muscleC", () => {
  const ex = { name: "A + B + C", superset: true, muscle: "Core", muscleB: "Spalle", muscleC: "Gambe" };
  assert.equal(trackMuscle(ex, "a"), "Core");
  assert.equal(trackMuscle(ex, "b"), "Spalle");
  assert.equal(trackMuscle(ex, "c"), "Gambe");
});
