import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCatalogEntry, renameCatalogEntry, deleteCatalogEntry, setCatalogNote,
} from "../catalog.js";

const base = () => ({
  schema: 6, updatedAt: null, activeSheetId: "s1",
  sheets: [{ id: "s1", name: "A", plan: [], weeks: {} }],
  catalog: [{ id: "c1", name: "Panca piana bilanciere", muscle: "Petto", note: "" }],
});

test("addCatalogEntry: aggiunge una voce con id stabile", () => {
  const out = addCatalogEntry(base(), { name: "Croci ai cavi", muscle: "Petto" });
  const added = out.catalog.find((e) => e.name === "Croci ai cavi");
  assert.ok(added && added.id && added.muscle === "Petto" && added.note === "");
  assert.equal(out.catalog.length, 2);
});

test("addCatalogEntry: rifiuta duplicato case-insensitive nello stesso gruppo", () => {
  const out = addCatalogEntry(base(), { name: "panca PIANA bilanciere", muscle: "Petto" });
  assert.equal(out.catalog.length, 1); // invariato
});

test("addCatalogEntry: stesso nome in gruppo diverso è ammesso", () => {
  const out = addCatalogEntry(base(), { name: "Panca piana bilanciere", muscle: "Spalle" });
  assert.equal(out.catalog.length, 2);
});

test("renameCatalogEntry: preserva id e note, cambia nome e gruppo", () => {
  const out = renameCatalogEntry(
    { ...base(), catalog: [{ id: "c1", name: "Panca", muscle: "Petto", note: "cue" }] },
    "c1", { name: "Panca stretta", muscle: "Tricipiti" });
  const e = out.catalog.find((x) => x.id === "c1");
  assert.equal(e.name, "Panca stretta");
  assert.equal(e.muscle, "Tricipiti");
  assert.equal(e.note, "cue");
});

test("deleteCatalogEntry: rimuove per id", () => {
  const out = deleteCatalogEntry(base(), "c1");
  assert.equal(out.catalog.length, 0);
});

test("setCatalogNote: imposta e svuota la nota", () => {
  const set = setCatalogNote(base(), "c1", "  scapole addotte ");
  assert.equal(set.catalog[0].note, "scapole addotte");
  const cleared = setCatalogNote(set, "c1", "   ");
  assert.equal(cleared.catalog[0].note, "");
});
