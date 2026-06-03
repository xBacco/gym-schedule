// tests/sheets.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHEETS_SCHEMA, defaultSheetName } from "../sheets.js";

test("SHEETS_SCHEMA è 6", () => {
  assert.equal(SHEETS_SCHEMA, 6);
});

test("defaultSheetName: progressivo sul numero di schede", () => {
  assert.equal(defaultSheetName([]), "Scheda 1");
  assert.equal(defaultSheetName([{ id: "a", name: "X" }]), "Scheda 2");
  assert.equal(defaultSheetName([{ id: "a" }, { id: "b" }]), "Scheda 3");
});
