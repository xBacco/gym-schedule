// tests/sheets.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHEETS_SCHEMA, defaultSheetName, toSheetsBlob } from "../sheets.js";

test("SHEETS_SCHEMA è 6", () => {
  assert.equal(SHEETS_SCHEMA, 6);
});

test("defaultSheetName: progressivo sul numero di schede", () => {
  assert.equal(defaultSheetName([]), "Scheda 1");
  assert.equal(defaultSheetName([{ id: "a", name: "X" }]), "Scheda 2");
  assert.equal(defaultSheetName([{ id: "a" }, { id: "b" }]), "Scheda 3");
});

test("toSheetsBlob: avvolge plan/weeks legacy in Scheda 1", () => {
  const legacy = { schema: 5, updatedAt: "2026-01-01", plan: [{ day: "A", title: "A", exercises: [] }], weeks: { "2026-W01": { label: "W1", entries: {} } } };
  const b = toSheetsBlob(legacy);
  assert.equal(b.schema, 6);
  assert.equal(b.sheets.length, 1);
  assert.equal(b.sheets[0].name, "Scheda 1");
  assert.equal(b.activeSheetId, b.sheets[0].id);
  assert.deepEqual(b.sheets[0].plan, legacy.plan);
  assert.deepEqual(b.sheets[0].weeks, legacy.weeks);
  assert.equal(b.updatedAt, "2026-01-01");
  assert.equal("plan" in b, false);   // normalizzato: niente plan/weeks top-level
  assert.equal("weeks" in b, false);
});

test("toSheetsBlob: idempotente su blob già schema 6", () => {
  const b1 = toSheetsBlob({ schema: 5, plan: [], weeks: {}, updatedAt: null });
  const b2 = toSheetsBlob(b1);
  assert.deepEqual(b2, b1);
});

test("toSheetsBlob: dati vuoti/null → una Scheda 1 vuota", () => {
  const b = toSheetsBlob(null);
  assert.equal(b.sheets.length, 1);
  assert.deepEqual(b.sheets[0].plan, []);
  assert.deepEqual(b.sheets[0].weeks, {});
});

test("toSheetsBlob: activeSheetId orfano → ripiega sulla prima scheda", () => {
  const b = toSheetsBlob({ schema: 6, updatedAt: null, activeSheetId: "ghost", sheets: [{ id: "real", name: "X", plan: [], weeks: {} }] });
  assert.equal(b.activeSheetId, "real");
});
