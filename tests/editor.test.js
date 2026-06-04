import { test } from "node:test";
import assert from "node:assert/strict";
import { genId, addExercise, removeExercise, reorderExercise, updateExercise, migrate, backfillMuscles, patchPlanV4, patchPlanV5, keepLocalPlan, addDay, nextDayCode, renameDay, removeDay, tabMiniLabel } from "../editor.js";

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

const planV4Sample = () => ({ schema: 3, weeks: {}, plan: [
  { day: "B", title: "B", exercises: [
    { id: "b1", name: "Curl EZ + Skullcrusher", setsReps: "3 × 10 / 3 × 10", recText: "75 sec", restSeconds: 75, superset: true, bar: 10, muscle: "Bicipiti", muscleB: "Tricipiti" },
  ] },
  { day: "C", title: "C", exercises: [
    { id: "c1", name: "Alzate posteriori (reverse fly)", setsReps: "3 × 15-20", recText: "60 sec", restSeconds: 60, superset: false, muscle: "Spalle" },
    { id: "c2", name: "Curl concentrato + Pushdown", setsReps: "3 × 10 / 3 × 10", recText: "60 sec", restSeconds: 60, superset: true, muscle: "Bicipiti", muscleB: "Tricipiti" },
  ] },
] });

test("patchPlanV4: applica le 3 patch contenuto e porta schema a 4", () => {
  const out = patchPlanV4(planV4Sample());
  assert.equal(out.schema, 4);
  const b = out.plan.find((d) => d.day === "B").exercises[0];
  assert.equal(b.name, "Curl manubri + French press");
  assert.equal(b.bar, undefined); // bilanciere rimosso (manubri)
  assert.equal(b.id, "b1"); // id stabile → lo storico resta agganciato
  const c = out.plan.find((d) => d.day === "C").exercises;
  assert.equal(c[0].setsReps, "3 × 12");
  assert.equal(c[1].recText, "75 sec");
  assert.equal(c[1].restSeconds, 75);
});

test("patchPlanV4: idempotente (schema >= 4 -> no-op)", () => {
  const once = patchPlanV4(planV4Sample());
  const twice = patchPlanV4(once);
  assert.equal(twice.plan.find((d) => d.day === "C").exercises[0].setsReps, "3 × 12");
  // un nome già patchato non viene ri-toccato
  assert.equal(twice.plan.find((d) => d.day === "B").exercises[0].name, "Curl manubri + French press");
});

test("patchPlanV4: nome già modificato dall'utente non viene sovrascritto", () => {
  const data = { schema: 3, weeks: {}, plan: [
    { day: "C", title: "C", exercises: [{ id: "c1", name: "Alzate posteriori custom", setsReps: "4 × 20", superset: false }] },
  ] };
  const out = patchPlanV4(data);
  assert.equal(out.plan[0].exercises[0].setsReps, "4 × 20"); // invariato
});

test("patchPlanV4: non muta l'input", () => {
  const data = planV4Sample();
  patchPlanV4(data);
  assert.equal(data.schema, 3);
  assert.equal(data.plan[0].exercises[0].name, "Curl EZ + Skullcrusher");
});

// ── patchPlanV5: unità a tempo "sec" sui plank (traccia B dei superset) ──

const planV5Sample = () => ({ schema: 4, weeks: {}, plan: [
  { day: "A", title: "A", exercises: [
    { id: "a1", name: "Crunch a terra + Plank", setsReps: "3 × 15-20 / 3 × max", recText: "60 sec", restSeconds: 60, superset: true, muscle: "Core", muscleB: "Core" },
  ] },
  { day: "C", title: "C", exercises: [
    { id: "c1", name: "Crunch inverso + Plank laterale", setsReps: "3 × 15 / 3 × max/lato", recText: "60 sec", restSeconds: 60, superset: true, muscle: "Core", muscleB: "Core" },
  ] },
] });

test("patchPlanV5: imposta unitB:'sec' sui plank (traccia B) e porta schema a 5", () => {
  const out = patchPlanV5(planV5Sample());
  assert.equal(out.schema, 5);
  assert.equal(out.plan.find((d) => d.day === "A").exercises[0].unitB, "sec");
  assert.equal(out.plan.find((d) => d.day === "C").exercises[0].unitB, "sec");
  assert.equal(out.plan.find((d) => d.day === "A").exercises[0].id, "a1"); // id stabile
});

test("patchPlanV5: idempotente (schema >= 5 -> no-op)", () => {
  const once = patchPlanV5(planV5Sample());
  const twice = patchPlanV5(once);
  assert.equal(twice.plan.find((d) => d.day === "A").exercises[0].unitB, "sec");
});

test("patchPlanV5: un esercizio rinominato dall'utente non viene toccato", () => {
  const data = { schema: 4, weeks: {}, plan: [
    { day: "A", title: "A", exercises: [{ id: "a1", name: "Plank custom", setsReps: "3 × max", superset: false }] },
  ] };
  const out = patchPlanV5(data);
  assert.equal(out.plan[0].exercises[0].unitB, undefined);
  assert.equal(out.plan[0].exercises[0].unit, undefined);
});

test("patchPlanV5: non muta l'input", () => {
  const data = planV5Sample();
  patchPlanV5(data);
  assert.equal(data.schema, 4);
  assert.equal(data.plan.find((d) => d.day === "A").exercises[0].unitB, undefined);
});

test("nextDayCode: prima lettera maiuscola libera", () => {
  assert.equal(nextDayCode([]), "A");
  assert.equal(nextDayCode([{ day: "A", title: "x", exercises: [] }]), "B");
  assert.equal(
    nextDayCode([{ day: "A", exercises: [] }, { day: "C", exercises: [] }]),
    "B"
  );
});

test("addDay: aggiunge un giorno vuoto con code univoco e titolo dato", () => {
  const plan = [{ day: "A", title: "Petto", exercises: [] }];
  const out = addDay(plan, "Schiena");
  assert.equal(out.length, 2);
  assert.equal(out[1].day, "B");
  assert.equal(out[1].title, "Schiena");
  assert.deepEqual(out[1].exercises, []);
  assert.equal(plan.length, 1);
});

test("addDay: titolo vuoto -> fallback al code del giorno", () => {
  const out = addDay([], "");
  assert.equal(out[0].day, "A");
  assert.equal(out[0].title, "A");
});

test("renameDay: cambia solo il titolo, non il code ne le entries", () => {
  const plan = [{ day: "A", title: "Petto", exercises: [{ id: "x1", name: "Panca" }] }];
  const out = renameDay(plan, "A", "Petto/Tricipiti");
  assert.equal(out[0].day, "A");
  assert.equal(out[0].title, "Petto/Tricipiti");
  assert.equal(out[0].exercises[0].id, "x1");
  assert.equal(plan[0].title, "Petto");
});

test("renameDay: titolo vuoto -> resta il code come titolo", () => {
  const out = renameDay([{ day: "A", title: "Petto", exercises: [] }], "A", "  ");
  assert.equal(out[0].title, "A");
});

test("removeDay: elimina il giorno indicato, lascia gli altri", () => {
  const plan = [
    { day: "A", title: "Petto", exercises: [] },
    { day: "B", title: "Schiena", exercises: [] },
  ];
  const out = removeDay(plan, "A");
  assert.equal(out.length, 1);
  assert.equal(out[0].day, "B");
  assert.equal(plan.length, 2);
});

test("removeDay: day inesistente -> plan invariato (copia)", () => {
  const plan = [{ day: "A", title: "Petto", exercises: [] }];
  const out = removeDay(plan, "Z");
  assert.deepEqual(out, plan);
});

test("tabMiniLabel: split su separatori, tronca a 5, join '·'", () => {
  assert.equal(tabMiniLabel("Petto · Tricipiti · Laterali"), "petto·trici·later");
  assert.equal(tabMiniLabel("Dorso/Bicipiti"), "dorso·bicip");
  assert.equal(tabMiniLabel("Gambe"), "gambe");
});

test("tabMiniLabel: vuoto/assente → stringa vuota", () => {
  assert.equal(tabMiniLabel(""), "");
  assert.equal(tabMiniLabel(null), "");
  assert.equal(tabMiniLabel("  "), "");
});
