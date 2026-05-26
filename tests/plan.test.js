import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN } from "../plan.js";

test("PLAN has 3 days A/B/C", () => {
  assert.equal(PLAN.length, 3);
  assert.deepEqual(PLAN.map(d => d.day), ["A", "B", "C"]);
});

test("days A/B/C have 8/8/8 exercises with required fields", () => {
  assert.deepEqual(PLAN.map((d) => d.exercises.length), [8, 8, 8]);
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
