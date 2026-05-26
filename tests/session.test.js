import test from "node:test";
import assert from "node:assert/strict";
import { parseTargetTrack, parseTarget, activeSetIndex, isEntryComplete, activeExerciseIndex } from "../session.js";
import { withSet, withoutSet, withSupersetSet, withoutSupersetSet } from "../session.js";
import { bestKg, progressionDelta, withNote, previousNote, previousSetInSession, previousWeekSet, sessionVolume, exerciseTrend } from "../session.js";
import { emptyData, setEntry, getEntry } from "../store.js";

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
  const plan = { exercises: [{ superset: false }, { superset: false }, { superset: false }] };
  assert.equal(activeExerciseIndex(emptyData(), "2026-W22", "A", plan), 0);
  let d = setEntry(emptyData(), "2026-W22", "A", 0, { sets: [{ reps: "8", kg: "70", done: true }] }, "t");
  assert.equal(activeExerciseIndex(d, "2026-W22", "A", plan), 1);
});

test("activeExerciseIndex: tutti completi -> 0 (wrap, non solo perché è il primo)", () => {
  const plan = { exercises: [{ superset: false }, { superset: false }] };
  let d = setEntry(emptyData(), "2026-W22", "A", 0, { sets: [{ reps: "8", kg: "70", done: true }] }, "t1");
  d = setEntry(d, "2026-W22", "A", 1, { sets: [{ reps: "8", kg: "70", done: true }] }, "t2");
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
  { name: "Panca", setsReps: "4 × 8" },
  { name: "Croci", setsReps: "3 × 12", superset: true },
] };

test("sessionVolume: somma reps*kg delle serie done (normale + superset)", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", 0, { sets: [
    { reps: "8", kg: "70", done: true },   // 560
    { reps: "8", kg: "70", done: false },  // esclusa (non done)
  ] });
  d = setEntry(d, "2026-W22", "A", 1, {
    a: { sets: [{ reps: "12", kg: "20", done: true }] },  // 240
    b: { sets: [{ reps: "15", kg: "10", done: true }] },  // 150
  });
  assert.equal(sessionVolume(d, "2026-W22", "A", PLAN_AB), 560 + 240 + 150);
});

test("sessionVolume: 0 senza serie done e ignora valori non numerici", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", 0, { sets: [{ reps: "max", kg: "", done: true }] });
  assert.equal(sessionVolume(d, "2026-W22", "A", PLAN_AB), 0);
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
  const dayPlan = { exercises: [{ name: "Panca", setsReps: "4 × 8" }] };
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", 0, { sets: [
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
  const dayPlan = { exercises: [{ name: "Panca", setsReps: "3 × 8" }] };
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", 0, { sets: [
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
