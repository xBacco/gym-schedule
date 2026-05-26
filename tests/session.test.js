import test from "node:test";
import assert from "node:assert/strict";
import { parseTargetTrack, parseTarget, activeSetIndex, isEntryComplete, activeExerciseIndex } from "../session.js";
import { withSet, withoutSet, withSupersetSet, withoutSupersetSet } from "../session.js";
import { bestKg, progressionDelta, withNote, previousNote, previousSetInSession, previousWeekSet } from "../session.js";
import { emptyData, setEntry } from "../store.js";

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
    sets: [{ reps: "8", kg: "72.5", done: true, feel: "" }],
    note: "n",
  });
});

test("withSet: estende l'array se l'indice supera la lunghezza", () => {
  assert.deepEqual(withSet("", 0, { reps: "8", kg: "70", done: true }), {
    sets: [{ reps: "8", kg: "70", done: true, feel: "" }],
    note: "",
  });
  const e = { sets: [{ reps: "8", kg: "70", done: true }] };
  assert.equal(withSet(e, 2, { reps: "6", kg: "70" }).sets.length, 3);
});

test("withoutSet: rimuove la serie all'indice", () => {
  const e = { sets: [{ reps: "8", kg: "70", done: true }, { reps: "6", kg: "70", done: false }] };
  assert.deepEqual(withoutSet(e, 0).sets, [{ reps: "6", kg: "70", done: false, feel: "" }]);
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
