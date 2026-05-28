import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTime, remainingSeconds, withoutSession } from "../timer.js";

test("formatTime renders m:ss and clamps negatives to 0:00", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(5), "0:05");
  assert.equal(formatTime(60), "1:00");
  assert.equal(formatTime(75), "1:15");
  assert.equal(formatTime(150), "2:30");
  assert.equal(formatTime(-3), "0:00");
});

test("remainingSeconds rounds up and clamps to 0", () => {
  const now = 1_000_000;
  assert.equal(remainingSeconds(now + 90_000, now), 90);
  assert.equal(remainingSeconds(now + 1, now), 1);
  assert.equal(remainingSeconds(now - 5_000, now), 0);
});

test("withoutSession rimuove una chiave in modo immutabile", () => {
  const map = {
    "2026-W23-A": { start: "x", end: null },
    "2026-W23-B": { start: "y", end: null },
  };
  const out = withoutSession(map, "2026-W23-A");
  assert.deepEqual(out, { "2026-W23-B": { start: "y", end: null } });
  assert.ok("2026-W23-A" in map, "l'input non deve essere mutato");
});

test("withoutSession: chiave assente -> copia invariata", () => {
  const map = { "2026-W23-A": { start: "x", end: null } };
  assert.deepEqual(withoutSession(map, "nope"), { "2026-W23-A": { start: "x", end: null } });
});

test("withoutSession: input non-oggetto -> {}", () => {
  assert.deepEqual(withoutSession(null, "k"), {});
  assert.deepEqual(withoutSession(undefined, "k"), {});
});
