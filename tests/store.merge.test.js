import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeBlobs } from "../store.js";
import { toSheetsBlob, activeSheet } from "../sheets.js";

const SID = "sheet-1";
const baseBlob = () => ({
  schema: 6,
  updatedAt: null,
  activeSheetId: SID,
  sheets: [{ id: SID, name: "Scheda 1", plan: [], weeks: {} }],
});

function withWeek(blob, wk, entries = {}, dates = {}) {
  const out = structuredClone(blob);
  out.sheets[0].weeks = {
    ...out.sheets[0].weeks,
    [wk]: { label: wk, entries, dates },
  };
  return out;
}

test("mergeBlobs: plan locale vince se differisce dal remoto", () => {
  const local = structuredClone(baseBlob());
  local.sheets[0].plan = [{ day: "A", exercises: [{ id: "x1" }] }];
  const remote = structuredClone(baseBlob());
  remote.sheets[0].plan = [{ day: "A", exercises: [] }];
  const merged = mergeBlobs(local, remote);
  assert.deepEqual(activeSheet(merged).plan, local.sheets[0].plan);
});

test("mergeBlobs: plan remoto vince se locale ha plan vuoto", () => {
  const local = structuredClone(baseBlob());
  const remote = structuredClone(baseBlob());
  remote.sheets[0].plan = [{ day: "A", exercises: [{ id: "x1" }] }];
  const merged = mergeBlobs(local, remote);
  assert.deepEqual(activeSheet(merged).plan, remote.sheets[0].plan);
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
  assert.equal(activeSheet(merged).weeks[wk].entries.A["0"].sets.length, 2);
});

test("mergeBlobs: sets pareggio → vince per updatedAt più recente top-level", () => {
  const wk = "2026-W22";
  const localBase = structuredClone(baseBlob());
  localBase.updatedAt = "2026-05-25T10:00:00Z";
  const local = withWeek(localBase, wk, {
    A: { "0": { sets: [{ reps: "8", kg: "60", done: true }], note: "local" } },
  });
  const remoteBase = structuredClone(baseBlob());
  remoteBase.updatedAt = "2026-05-26T10:00:00Z";
  const remote = withWeek(remoteBase, wk, {
    A: { "0": { sets: [{ reps: "8", kg: "65", done: true }], note: "remote" } },
  });
  const merged = mergeBlobs(local, remote);
  assert.equal(activeSheet(merged).weeks[wk].entries.A["0"].note, "remote");
});

test("mergeBlobs: dates fa union set-if-absent", () => {
  const wk = "2026-W22";
  const local = withWeek(baseBlob(), wk, {}, { A: "2026-05-25" });
  const remote = withWeek(baseBlob(), wk, {}, { B: "2026-05-26" });
  const merged = mergeBlobs(local, remote);
  assert.deepEqual(activeSheet(merged).weeks[wk].dates, { A: "2026-05-25", B: "2026-05-26" });
});

test("mergeBlobs: dates collisione → vince local (set-if-absent + local first)", () => {
  const wk = "2026-W22";
  const local = withWeek(baseBlob(), wk, {}, { A: "2026-05-25" });
  const remote = withWeek(baseBlob(), wk, {}, { A: "2026-05-27" });
  const merged = mergeBlobs(local, remote);
  assert.equal(activeSheet(merged).weeks[wk].dates.A, "2026-05-25");
});

test("mergeBlobs: weeks presenti solo in remote vengono mantenute", () => {
  const local = withWeek(baseBlob(), "2026-W22", { A: { "0": { sets: [], note: "" } } });
  const remote = withWeek(baseBlob(), "2026-W23", { A: { "0": { sets: [], note: "" } } });
  const merged = mergeBlobs(local, remote);
  assert.ok(activeSheet(merged).weeks["2026-W22"]);
  assert.ok(activeSheet(merged).weeks["2026-W23"]);
});

test("mergeBlobs: updatedAt top-level = max(local, remote)", () => {
  const local = structuredClone(baseBlob());
  local.updatedAt = "2026-05-25T10:00:00Z";
  const remote = structuredClone(baseBlob());
  remote.updatedAt = "2026-05-26T11:00:00Z";
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

test("mergeBlobs: fonde le weeks per scheda con id corrispondente", () => {
  const local = toSheetsBlob({ schema: 5, plan: [{ day: "A" }], weeks: { "2026-W01": { label: "w1", entries: { A: { "0": { sets: [{ reps: "5", kg: "100" }] } } }, dates: { A: "2026-01-05" } } }, updatedAt: "2026-01-05" });
  const id = local.sheets[0].id;
  const remote = structuredClone(local);
  remote.sheets[0].weeks = { "2026-W02": { label: "w2", entries: { A: { "0": { sets: [{ reps: "5", kg: "105" }] } } }, dates: { A: "2026-01-12" } } };
  remote.updatedAt = "2026-01-12";
  const merged = mergeBlobs(local, remote);
  const s = merged.sheets.find((x) => x.id === id);
  assert.deepEqual(Object.keys(s.weeks).sort(), ["2026-W01", "2026-W02"]);
});

test("mergeBlobs: union di schede presenti solo su un lato", () => {
  const local = toSheetsBlob({ schema: 5, plan: [], weeks: {}, updatedAt: "a" });
  const remote = structuredClone(local);
  remote.sheets.push({ id: "remote-only", name: "Remota", plan: [{ day: "Z" }], weeks: {} });
  const merged = mergeBlobs(local, remote);
  assert.equal(merged.sheets.length, 2);
  assert.ok(merged.sheets.some((s) => s.id === "remote-only"));
});

test("mergeBlobs: retro-compat — fonde un blob schema 5 con uno schema 6", () => {
  const legacy = { schema: 5, plan: [{ day: "A" }], weeks: { "2026-W01": { label: "w1", entries: {} } }, updatedAt: "2026-01-01" };
  const sheeted = toSheetsBlob({ schema: 5, plan: [{ day: "A" }], weeks: { "2026-W02": { label: "w2", entries: {} } }, updatedAt: "2026-01-02" });
  const merged = mergeBlobs(legacy, sheeted);
  assert.equal(merged.schema, 6);
  assert.ok(Array.isArray(merged.sheets));
  assert.equal(merged.sheets.length, 2); // id legacy diversi => due schede (comportamento atteso)
});
