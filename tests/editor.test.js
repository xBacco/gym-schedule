import { test } from "node:test";
import assert from "node:assert/strict";
import { genId, addExercise, removeExercise, reorderExercise, updateExercise } from "../editor.js";

const samplePlan = () => [
  { day: "A", title: "A", exercises: [
    { id: "aaa1", name: "Panca", setsReps: "3 × 8", recText: "2 min", restSeconds: 120, superset: false },
    { id: "aaa2", name: "Lento", setsReps: "3 × 10", recText: "2 min", restSeconds: 120, superset: false },
  ] },
  { day: "B", title: "B", exercises: [
    { id: "bbb1", name: "Stacco", setsReps: "3 × 8", recText: "2 min", restSeconds: 120, superset: false },
  ] },
];

test("genId: stringa breve non collidente e non vuota", () => {
  const id = genId(["aaa1", "aaa2"]);
  assert.equal(typeof id, "string");
  assert.ok(id.length >= 4);
  assert.ok(!["aaa1", "aaa2"].includes(id));
});

test("genId: rigenera se collide con esistenti", () => {
  const existing = Array.from({ length: 50 }, (_, i) => `id${i}`);
  const id = genId(existing);
  assert.ok(!existing.includes(id));
});

test("addExercise: aggiunge in fondo al giorno con id nuovo, immutabile", () => {
  const plan = samplePlan();
  const next = addExercise(plan, "A", { name: "Dips", setsReps: "3 × 10", recText: "90 sec", restSeconds: 90, superset: false });
  assert.equal(plan[0].exercises.length, 2, "originale invariato");
  const exA = next.find((d) => d.day === "A").exercises;
  assert.equal(exA.length, 3);
  assert.equal(exA[2].name, "Dips");
  assert.ok(exA[2].id && !["aaa1", "aaa2"].includes(exA[2].id));
});

test("removeExercise: toglie per id, immutabile", () => {
  const plan = samplePlan();
  const next = removeExercise(plan, "A", "aaa1");
  assert.equal(plan[0].exercises.length, 2, "originale invariato");
  const exA = next.find((d) => d.day === "A").exercises;
  assert.deepEqual(exA.map((e) => e.id), ["aaa2"]);
});

test("removeExercise: id inesistente -> piano invariato (clone)", () => {
  const plan = samplePlan();
  const next = removeExercise(plan, "A", "zzz9");
  assert.deepEqual(next.find((d) => d.day === "A").exercises.map((e) => e.id), ["aaa1", "aaa2"]);
});

test("reorderExercise: sposta da fromIdx a toIdx, immutabile", () => {
  const plan = samplePlan();
  const next = reorderExercise(plan, "A", 0, 1);
  assert.deepEqual(plan[0].exercises.map((e) => e.id), ["aaa1", "aaa2"], "originale invariato");
  assert.deepEqual(next.find((d) => d.day === "A").exercises.map((e) => e.id), ["aaa2", "aaa1"]);
});

test("reorderExercise: indici fuori range -> clamp/no-op senza crash", () => {
  const plan = samplePlan();
  const next = reorderExercise(plan, "A", 0, 9);
  assert.equal(next.find((d) => d.day === "A").exercises.length, 2);
});

test("updateExercise: applica patch per id, preserva l'id, immutabile", () => {
  const plan = samplePlan();
  const next = updateExercise(plan, "A", "aaa1", { name: "Panca piana", restSeconds: 150 });
  assert.equal(plan[0].exercises[0].name, "Panca", "originale invariato");
  const ex = next.find((d) => d.day === "A").exercises[0];
  assert.equal(ex.id, "aaa1", "id preservato");
  assert.equal(ex.name, "Panca piana");
  assert.equal(ex.restSeconds, 150);
});
