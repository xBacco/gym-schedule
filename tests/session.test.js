import test from "node:test";
import assert from "node:assert/strict";
import { parseTargetTrack, parseTarget, activeSetIndex, isEntryComplete, activeExerciseIndex } from "../session.js";
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

test("isEntryComplete: normale completo solo se ha serie e tutte done", () => {
  assert.equal(isEntryComplete("", false), false);
  assert.equal(isEntryComplete({ sets: [{ reps: "8", kg: "70", done: true }] }, false), true);
  assert.equal(isEntryComplete({ sets: [{ reps: "8", kg: "70", done: false }] }, false), false);
});

test("isEntryComplete: superset considera solo le tracce con serie loggate", () => {
  assert.equal(isEntryComplete("", true), false);
  const v = { a: { sets: [{ reps: "15", kg: "25", done: true }] }, b: { sets: [{ reps: "15", kg: "12", done: true }] } };
  assert.equal(isEntryComplete(v, true), true);
  const half = { a: { sets: [{ reps: "15", kg: "25", done: true }] }, b: { sets: [] } };
  assert.equal(isEntryComplete(half, true), true); // B a corpo libero non loggata -> non blocca
});

test("activeExerciseIndex: primo esercizio non completo", () => {
  const plan = { exercises: [{ superset: false }, { superset: false }, { superset: false }] };
  assert.equal(activeExerciseIndex(emptyData(), "2026-W22", "A", plan), 0);
  let d = setEntry(emptyData(), "2026-W22", "A", 0, { sets: [{ reps: "8", kg: "70", done: true }] }, "t");
  assert.equal(activeExerciseIndex(d, "2026-W22", "A", plan), 1);
});

test("isEntryComplete: superset con traccia A vuota e B completa -> true", () => {
  const v = { a: { sets: [] }, b: { sets: [{ reps: "15", kg: "12", done: true }] } };
  assert.equal(isEntryComplete(v, true), true);
});

test("activeExerciseIndex: tutti completi -> 0 (wrap, non solo perché è il primo)", () => {
  const plan = { exercises: [{ superset: false }, { superset: false }] };
  let d = setEntry(emptyData(), "2026-W22", "A", 0, { sets: [{ reps: "8", kg: "70", done: true }] }, "t1");
  d = setEntry(d, "2026-W22", "A", 1, { sets: [{ reps: "8", kg: "70", done: true }] }, "t2");
  assert.equal(activeExerciseIndex(d, "2026-W22", "A", plan), 0);
});
