import { test } from "node:test";
import assert from "node:assert/strict";
import { genId, addExercise, removeExercise, reorderExercise, updateExercise, migrate, backfillMuscles, keepLocalPlan } from "../editor.js";

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

// PLAN seed minimale a 2 giorni; gli indici dei log mappano l'ordine di questo seed.
const seed = () => [
  { day: "A", title: "Petto", exercises: [
    { name: "Panca", setsReps: "3 × 8", recText: "2 min", restSeconds: 120, superset: false },
    { name: "Lento", setsReps: "3 × 10", recText: "2 min", restSeconds: 120, superset: false },
  ] },
  { day: "B", title: "Dorso", exercises: [
    { name: "Stacco", setsReps: "3 × 8", recText: "2 min", restSeconds: 120, superset: false },
  ] },
];

test("migrate: dato vuoto -> crea plan dal seed con id, schema 2", () => {
  const out = migrate({ updatedAt: null, weeks: {} }, seed());
  assert.equal(out.schema, 2);
  assert.equal(out.plan.length, 2);
  assert.ok(out.plan[0].exercises[0].id, "id assegnato");
  assert.ok(out.plan[0].exercises[1].id !== out.plan[0].exercises[0].id, "id distinti");
});

test("migrate: riscrive le entry da chiavi-indice a chiavi-id", () => {
  const data = {
    updatedAt: null,
    weeks: { "2026-W22": { label: "W22", entries: {
      A: { "0": { sets: [{ reps: "8", kg: "50", done: true }], note: "" },
           "1": { sets: [{ reps: "10", kg: "20", done: true }], note: "" } },
      B: { "0": { sets: [{ reps: "8", kg: "80", done: true }], note: "" } },
    } } },
  };
  const out = migrate(data, seed());
  const idA0 = out.plan.find((d) => d.day === "A").exercises[0].id;
  const idA1 = out.plan.find((d) => d.day === "A").exercises[1].id;
  const entA = out.weeks["2026-W22"].entries.A;
  assert.ok(entA[idA0] && entA[idA0].sets[0].kg === "50");
  assert.ok(entA[idA1] && entA[idA1].sets[0].kg === "20");
  assert.ok(!("0" in entA) && !("1" in entA), "vecchie chiavi-indice rimosse");
});

test("migrate: indici orfani (oltre il piano) conservati sotto _orphan_<i>", () => {
  const data = {
    updatedAt: null,
    weeks: { "2026-W22": { label: "W22", entries: {
      A: { "0": { sets: [], note: "x" }, "5": { sets: [{ reps: "1", kg: "1", done: true }], note: "" } },
    } } },
  };
  const out = migrate(data, seed());
  const entA = out.weeks["2026-W22"].entries.A;
  assert.ok(entA["_orphan_5"], "log orfano conservato");
  assert.equal(entA["_orphan_5"].sets[0].kg, "1");
});

test("migrate: idempotente -> se schema>=2 ritorna invariato", () => {
  const data = { schema: 2, plan: seed().map((d) => ({ ...d, exercises: d.exercises.map((e, i) => ({ ...e, id: `x${i}` })) })), weeks: {} };
  const out = migrate(data, seed());
  assert.equal(out, data, "stesso riferimento: nessun lavoro");
});

test("migrate: non muta l'input (clona)", () => {
  const data = { updatedAt: null, weeks: { W: { label: "W", entries: { A: { "0": { sets: [], note: "" } } } } } };
  const snapshot = JSON.stringify(data);
  migrate(data, seed());
  assert.equal(JSON.stringify(data), snapshot, "input invariato");
});

test("keepLocalPlan: conserva il plan locale nel merge da conflitto, tiene i weeks del remoto", () => {
  const merged = { schema: 2, plan: samplePlan(), weeks: { "2026-W22": { label: "W22", entries: { A: { aaa1: { sets: [], note: "" } } } } } };
  const localPlan = reorderExercise(samplePlan(), "A", 0, 1); // edit strutturale locale: aaa2 prima di aaa1
  const out = keepLocalPlan(merged, localPlan);
  assert.deepEqual(out.plan.find((d) => d.day === "A").exercises.map((e) => e.id), ["aaa2", "aaa1"], "plan locale preservato");
  assert.ok(out.weeks["2026-W22"].entries.A.aaa1, "log del remoto mantenuti");
});

test("keepLocalPlan: localPlan vuoto o non-array -> merged invariato (stesso riferimento)", () => {
  const merged = { schema: 2, plan: samplePlan(), weeks: {} };
  assert.equal(keepLocalPlan(merged, []), merged);
  assert.equal(keepLocalPlan(merged, null), merged);
  assert.equal(keepLocalPlan(merged, undefined), merged);
});

test("keepLocalPlan: non muta merged (ritorna un nuovo oggetto)", () => {
  const merged = { schema: 2, plan: samplePlan(), weeks: {} };
  const snapshot = JSON.stringify(merged);
  const out = keepLocalPlan(merged, samplePlan());
  assert.notEqual(out, merged, "nuovo oggetto");
  assert.equal(JSON.stringify(merged), snapshot, "merged invariato");
});

const seedWithMuscles = () => [
  { day: "A", title: "A", exercises: [
    { name: "Panca", setsReps: "3 × 8", muscle: "Petto", superset: false },
    { name: "Curl+Push", setsReps: "3 × 10 / 3 × 10", muscle: "Bicipiti", muscleB: "Tricipiti", superset: true },
  ] },
];

test("backfillMuscles: copia muscle/muscleB dal seed per (day,name)", () => {
  const data = { schema: 2, weeks: {}, plan: [
    { day: "A", title: "A", exercises: [
      { id: "x1", name: "Panca", setsReps: "3 × 8", superset: false },
      { id: "x2", name: "Curl+Push", setsReps: "3 × 10 / 3 × 10", superset: true },
    ] },
  ] };
  const out = backfillMuscles(data, seedWithMuscles());
  assert.equal(out.schema, 3);
  assert.equal(out.plan[0].exercises[0].muscle, "Petto");
  assert.equal(out.plan[0].exercises[1].muscle, "Bicipiti");
  assert.equal(out.plan[0].exercises[1].muscleB, "Tricipiti");
});

test("backfillMuscles: idempotente (schema >= 3 -> no-op)", () => {
  const data = { schema: 3, weeks: {}, plan: [
    { day: "A", title: "A", exercises: [{ id: "x1", name: "Panca", superset: false }] },
  ] };
  const out = backfillMuscles(data, seedWithMuscles());
  assert.equal(out.plan[0].exercises[0].muscle, undefined);
});

test("backfillMuscles: esercizio rinominato non abbinato resta senza muscle", () => {
  const data = { schema: 2, weeks: {}, plan: [
    { day: "A", title: "A", exercises: [{ id: "x1", name: "Panca custom", superset: false }] },
  ] };
  const out = backfillMuscles(data, seedWithMuscles());
  assert.equal(out.schema, 3);
  assert.equal(out.plan[0].exercises[0].muscle, undefined);
});

test("backfillMuscles: non muta l'input", () => {
  const data = { schema: 2, weeks: {}, plan: [
    { day: "A", title: "A", exercises: [{ id: "x1", name: "Panca", superset: false }] },
  ] };
  backfillMuscles(data, seedWithMuscles());
  assert.equal(data.schema, 2);
  assert.equal(data.plan[0].exercises[0].muscle, undefined);
});
