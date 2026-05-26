import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN } from "../plan.js";

test("PLAN has 3 days A/B/C", () => {
  assert.equal(PLAN.length, 3);
  assert.deepEqual(PLAN.map(d => d.day), ["A", "B", "C"]);
});

test("days A/B/C have 8/7/7 exercises with required fields", () => {
  assert.deepEqual(PLAN.map((d) => d.exercises.length), [8, 7, 7]);
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

test("first exercise of day A is the bench press, 150s rest", () => {
  assert.match(PLAN[0].exercises[0].name, /Panca piana/);
  assert.equal(PLAN[0].exercises[0].restSeconds, 150);
});
