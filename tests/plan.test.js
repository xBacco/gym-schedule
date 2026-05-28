import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN, seedPlan } from "../plan.js";

test("PLAN has 3 days A/B/C", () => {
  assert.equal(PLAN.length, 3);
  assert.deepEqual(PLAN.map(d => d.day), ["A", "B", "C"]);
});

test("days A/B/C have 8/8/9 exercises with required fields", () => {
  assert.deepEqual(PLAN.map((d) => d.exercises.length), [8, 8, 9]);
  for (const day of PLAN) {
    for (const ex of day.exercises) {
      assert.equal(typeof ex.name, "string");
      assert.equal(typeof ex.setsReps, "string");
      assert.equal(typeof ex.recText, "string");
      assert.equal(typeof ex.restSeconds, "number");
      assert.ok(ex.restSeconds > 0);
      assert.equal(typeof ex.superset, "boolean");
    }
  }
});

test("first exercise of day A is the bench press, 120s rest", () => {
  assert.match(PLAN[0].exercises[0].name, /Panca piana/);
  assert.equal(PLAN[0].exercises[0].restSeconds, 120);
});

test("rest times are calibrated to [60, 120] seconds", () => {
  for (const day of PLAN) {
    for (const ex of day.exercises) {
      assert.ok(ex.restSeconds >= 60 && ex.restSeconds <= 120,
        `${ex.name}: rest ${ex.restSeconds}s fuori da [60,120]`);
    }
  }
});

test("no exercise has more than 3 sets (also per superset track)", () => {
  for (const day of PLAN) {
    for (const ex of day.exercises) {
      for (const m of ex.setsReps.matchAll(/(\d+)\s*×/g)) {
        assert.ok(Number(m[1]) <= 3, `${ex.name}: ${ex.setsReps} ha più di 3 serie`);
      }
    }
  }
});

test("seedPlan({empty:true}) ritorna plan vuoto []", () => {
  assert.deepEqual(seedPlan({ empty: true }), []);
});

test("seedPlan() default ritorna la variante 'Consigliata+'", () => {
  const p = seedPlan();
  assert.equal(p.length, 3);
  assert.equal(p.find((d) => d.day === "C").exercises.length, 9);
});
