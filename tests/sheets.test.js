// tests/sheets.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHEETS_SCHEMA, defaultSheetName, toSheetsBlob, hydrate, dehydrate } from "../sheets.js";

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

test("hydrate: proietta plan/weeks della scheda attiva al top-level", () => {
  const blob = {
    schema: 6, updatedAt: "t", activeSheetId: "b",
    sheets: [
      { id: "a", name: "A", plan: [{ day: "A" }], weeks: { w1: {} } },
      { id: "b", name: "B", plan: [{ day: "B" }], weeks: { w2: {} } },
    ],
  };
  const d = hydrate(blob);
  assert.deepEqual(d.plan, [{ day: "B" }]);   // scheda attiva = b
  assert.deepEqual(d.weeks, { w2: {} });
  assert.equal(d.activeSheetId, "b");
  assert.equal(d.schema, 6);
  assert.equal(d.sheets.length, 2);
});

test("dehydrate: riscrive plan/weeks top-level nella scheda attiva, normalizza", () => {
  const data = hydrate({
    schema: 6, updatedAt: "t", activeSheetId: "b",
    sheets: [
      { id: "a", name: "A", plan: [{ day: "A" }], weeks: {} },
      { id: "b", name: "B", plan: [], weeks: {} },
    ],
  });
  data.plan = [{ day: "B", title: "nuovo" }];        // simula edit in-memory
  data.weeks = { wX: { label: "wX", entries: {} } };
  const blob = dehydrate(data);
  assert.equal("plan" in blob, false);
  assert.equal("weeks" in blob, false);
  const b = blob.sheets.find((s) => s.id === "b");
  assert.deepEqual(b.plan, [{ day: "B", title: "nuovo" }]);
  assert.deepEqual(b.weeks, { wX: { label: "wX", entries: {} } });
  const a = blob.sheets.find((s) => s.id === "a");
  assert.deepEqual(a.plan, [{ day: "A" }]);          // scheda inattiva intatta
});

test("hydrate∘dehydrate è round-trip stabile", () => {
  const blob = toSheetsBlob({ schema: 5, plan: [{ day: "A" }], weeks: { w: { label: "w", entries: {} } }, updatedAt: "t" });
  assert.deepEqual(dehydrate(hydrate(blob)), blob);
});

// Task 4 — CRUD: addSheet, renameSheet, deleteSheet, setActiveSheet
import { addSheet, renameSheet, deleteSheet, setActiveSheet } from "../sheets.js";

const base = () => toSheetsBlob({ schema: 5, plan: [{ day: "A" }], weeks: { w: { label: "w", entries: {} } }, updatedAt: "t" });

test("addSheet vuota: appende, attiva la nuova, plan/weeks vuoti", () => {
  const b = addSheet(base(), { duplicateActive: false });
  assert.equal(b.sheets.length, 2);
  assert.equal(b.sheets[1].name, "Scheda 2");
  assert.equal(b.activeSheetId, b.sheets[1].id);
  assert.deepEqual(b.sheets[1].plan, []);
  assert.deepEqual(b.sheets[1].weeks, {});
  assert.notEqual(b.sheets[1].id, b.sheets[0].id);
});

test("addSheet duplica attiva: copia plan, storico vuoto, attiva la copia", () => {
  const b = addSheet(base(), { duplicateActive: true });
  assert.equal(b.sheets.length, 2);
  assert.deepEqual(b.sheets[1].plan, b.sheets[0].plan); // stesso contenuto
  assert.notEqual(b.sheets[1].plan, b.sheets[0].plan);  // clone, non riferimento
  assert.deepEqual(b.sheets[1].weeks, {});              // storico NON copiato
  assert.equal(b.activeSheetId, b.sheets[1].id);
});

test("renameSheet: rinomina per id, trim, vuoto ignorato", () => {
  const b0 = base();
  const id = b0.sheets[0].id;
  assert.equal(renameSheet(b0, id, "  Push/Pull  ").sheets[0].name, "Push/Pull");
  assert.equal(renameSheet(b0, id, "   ").sheets[0].name, b0.sheets[0].name); // invariato
});

test("deleteSheet: rimuove; se era attiva attiva la prima rimasta", () => {
  const b = addSheet(base(), { duplicateActive: false }); // attiva = sheets[1]
  const activeId = b.activeSheetId;
  const after = deleteSheet(b, activeId);
  assert.equal(after.sheets.length, 1);
  assert.equal(after.sheets.find((s) => s.id === activeId), undefined);
  assert.equal(after.activeSheetId, after.sheets[0].id);
});

test("deleteSheet: l'ultima scheda non è eliminabile (no-op)", () => {
  const b0 = base();
  const after = deleteSheet(b0, b0.sheets[0].id);
  assert.deepEqual(after, b0);
});

test("setActiveSheet: cambia attiva; id ignoto è no-op", () => {
  const b = addSheet(base(), { duplicateActive: false });
  const firstId = b.sheets[0].id;
  assert.equal(setActiveSheet(b, firstId).activeSheetId, firstId);
  assert.equal(setActiveSheet(b, "ghost").activeSheetId, b.activeSheetId);
});

// Task 5 — sheetSummaries
import { sheetSummaries } from "../sheets.js";

test("sheetSummaries: conta giorni, esercizi, settimane, ultima data", () => {
  const blob = {
    schema: 6, updatedAt: "t", activeSheetId: "a",
    sheets: [
      { id: "a", name: "PPL", plan: [
          { day: "A", exercises: [{ id: "1" }, { id: "2" }] },
          { day: "B", exercises: [{ id: "3" }] },
        ],
        weeks: {
          "2026-W01": { label: "w1", entries: {}, dates: { A: "2026-01-05" } },
          "2026-W02": { label: "w2", entries: {}, dates: { B: "2026-01-12" } },
        } },
      { id: "b", name: "Vuota", plan: [], weeks: {} },
    ],
  };
  const sums = sheetSummaries(blob);
  assert.equal(sums.length, 2);
  assert.deepEqual(
    { ...sums[0], id: undefined },
    { id: undefined, name: "PPL", active: true, days: 2, exercises: 3, weeks: 2, lastDate: "2026-01-12" }
  );
  assert.equal(sums[0].id, "a");
  assert.deepEqual(
    { ...sums[1], id: undefined },
    { id: undefined, name: "Vuota", active: false, days: 0, exercises: 0, weeks: 0, lastDate: null }
  );
});
