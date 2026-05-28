import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeBlobs } from "../store.js";

const baseBlob = () => ({ weeks: {}, plan: [], updatedAt: null });

function withWeek(blob, wk, entries = {}, dates = {}) {
  return {
    ...blob,
    weeks: { ...blob.weeks, [wk]: { label: wk, entries, dates } },
  };
}

test("mergeBlobs: plan locale vince se differisce dal remoto", () => {
  const local = { ...baseBlob(), plan: [{ day: "A", exercises: [{ id: "x1" }] }] };
  const remote = { ...baseBlob(), plan: [{ day: "A", exercises: [] }] };
  const merged = mergeBlobs(local, remote);
  assert.deepEqual(merged.plan, local.plan);
});

test("mergeBlobs: plan remoto vince se locale ha plan vuoto", () => {
  const local = { ...baseBlob(), plan: [] };
  const remote = { ...baseBlob(), plan: [{ day: "A", exercises: [{ id: "x1" }] }] };
  const merged = mergeBlobs(local, remote);
  assert.deepEqual(merged.plan, remote.plan);
});

test("mergeBlobs: sets — vince quello con più set non-vuoti", () => {
  const wk = "2026-W22";
  const local = withWeek(baseBlob(), wk, {
    A: { "0": { sets: [{ reps: "8", kg: "60", done: true }, { reps: "8", kg: "60", done: true }], note: "" } },
  });
  const remote = withWeek(baseBlob(), wk, {
    A: { "0": { sets: [{ reps: "8", kg: "60", done: true }], note: "" } },
  });
  const merged = mergeBlobs(local, remote);
  assert.equal(merged.weeks[wk].entries.A["0"].sets.length, 2);
});

test("mergeBlobs: sets pareggio → vince per updatedAt più recente top-level", () => {
  const wk = "2026-W22";
  const local = withWeek({ ...baseBlob(), updatedAt: "2026-05-25T10:00:00Z" }, wk, {
    A: { "0": { sets: [{ reps: "8", kg: "60", done: true }], note: "local" } },
  });
  const remote = withWeek({ ...baseBlob(), updatedAt: "2026-05-26T10:00:00Z" }, wk, {
    A: { "0": { sets: [{ reps: "8", kg: "65", done: true }], note: "remote" } },
  });
  const merged = mergeBlobs(local, remote);
  assert.equal(merged.weeks[wk].entries.A["0"].note, "remote");
});

test("mergeBlobs: dates fa union set-if-absent", () => {
  const wk = "2026-W22";
  const local = withWeek(baseBlob(), wk, {}, { A: "2026-05-25" });
  const remote = withWeek(baseBlob(), wk, {}, { B: "2026-05-26" });
  const merged = mergeBlobs(local, remote);
  assert.deepEqual(merged.weeks[wk].dates, { A: "2026-05-25", B: "2026-05-26" });
});

test("mergeBlobs: dates collisione → vince local (set-if-absent + local first)", () => {
  const wk = "2026-W22";
  const local = withWeek(baseBlob(), wk, {}, { A: "2026-05-25" });
  const remote = withWeek(baseBlob(), wk, {}, { A: "2026-05-27" });
  const merged = mergeBlobs(local, remote);
  assert.equal(merged.weeks[wk].dates.A, "2026-05-25");
});

test("mergeBlobs: weeks presenti solo in remote vengono mantenute", () => {
  const local = withWeek(baseBlob(), "2026-W22", { A: { "0": { sets: [], note: "" } } });
  const remote = withWeek(baseBlob(), "2026-W23", { A: { "0": { sets: [], note: "" } } });
  const merged = mergeBlobs(local, remote);
  assert.ok(merged.weeks["2026-W22"]);
  assert.ok(merged.weeks["2026-W23"]);
});

test("mergeBlobs: updatedAt top-level = max(local, remote)", () => {
  const local = { ...baseBlob(), updatedAt: "2026-05-25T10:00:00Z" };
  const remote = { ...baseBlob(), updatedAt: "2026-05-26T11:00:00Z" };
  assert.equal(mergeBlobs(local, remote).updatedAt, "2026-05-26T11:00:00Z");
  assert.equal(mergeBlobs(remote, local).updatedAt, "2026-05-26T11:00:00Z");
});

test("mergeBlobs: immutabile (non muta gli input)", () => {
  const local = withWeek(baseBlob(), "2026-W22", { A: { "0": { sets: [{ reps: "8", kg: "60" }], note: "" } } });
  const remote = withWeek(baseBlob(), "2026-W22", { A: { "0": { sets: [], note: "" } } });
  const localCopy = structuredClone(local);
  const remoteCopy = structuredClone(remote);
  mergeBlobs(local, remote);
  assert.deepEqual(local, localCopy);
  assert.deepEqual(remote, remoteCopy);
});
