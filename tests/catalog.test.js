import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCatalogEntry, renameCatalogEntry, deleteCatalogEntry, setCatalogNote,
  seedCatalog, seedCatalogIfAbsent,
  groupedCatalog, MUSCLE_GROUPS,
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

test("renameCatalogEntry: rifiuta rinomina su nome già presente nel gruppo target", () => {
  const blob = { ...base(), catalog: [
    { id: "c1", name: "Panca piana bilanciere", muscle: "Petto", note: "" },
    { id: "c2", name: "Croci ai cavi", muscle: "Petto", note: "" },
  ] };
  const out = renameCatalogEntry(blob, "c2", { name: "panca PIANA bilanciere", muscle: "Petto" });
  assert.equal(out.catalog.find((e) => e.id === "c2").name, "Croci ai cavi"); // invariato
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

test("seedCatalog: lista non vuota, voci ben formate, id univoci", () => {
  const seed = seedCatalog();
  assert.ok(seed.length >= 40);
  const ids = new Set(seed.map((e) => e.id));
  assert.equal(ids.size, seed.length);
  for (const e of seed) {
    assert.ok(e.id && e.name && e.muscle);
    assert.equal(e.note, "");
  }
});

test("seedCatalog: deterministico (stesse chiamate, stessi id)", () => {
  assert.deepEqual(seedCatalog(), seedCatalog());
});

test("seedCatalogIfAbsent: catalog assente → seed iniettato", () => {
  const blob = { schema: 6, updatedAt: null, activeSheetId: "s1",
    sheets: [{ id: "s1", name: "A", plan: [], weeks: {} }] }; // niente catalog
  const out = seedCatalogIfAbsent(blob);
  assert.ok(out.catalog.length > 0);
  assert.equal(blob.catalog, undefined); // input non mutato
});

test("seedCatalogIfAbsent: catalog [] esplicito resta vuoto (niente re-seed)", () => {
  const blob = { schema: 6, updatedAt: null, activeSheetId: "s1",
    sheets: [{ id: "s1", name: "A", plan: [], weeks: {} }], catalog: [] };
  assert.deepEqual(seedCatalogIfAbsent(blob).catalog, []);
});

test("seedCatalogIfAbsent: catalog popolato resta invariato", () => {
  const blob = { schema: 6, updatedAt: null, activeSheetId: "s1",
    sheets: [{ id: "s1", name: "A", plan: [], weeks: {} }],
    catalog: [{ id: "c1", name: "X", muscle: "Petto", note: "" }] };
  assert.deepEqual(seedCatalogIfAbsent(blob).catalog, blob.catalog);
});

test("MUSCLE_GROUPS: gli 8 gruppi fissi nell'ordine di index.html", () => {
  assert.deepEqual(MUSCLE_GROUPS,
    ["Petto", "Dorso", "Spalle", "Bicipiti", "Tricipiti", "Gambe", "Polpacci", "Core"]);
});

test("groupedCatalog: ordina alfabeticamente dentro il gruppo, salta gruppi vuoti", () => {
  const blob = { schema: 6, catalog: [
    { id: "a", name: "Zercher squat", muscle: "Gambe", note: "" },
    { id: "b", name: "affondi", muscle: "Gambe", note: "" },
    { id: "c", name: "Panca", muscle: "Petto", note: "" },
  ] };
  const g = groupedCatalog(blob);
  const gambe = g.find((x) => x.muscle === "Gambe");
  assert.deepEqual(gambe.items.map((e) => e.name), ["affondi", "Zercher squat"]);
  assert.ok(!g.some((x) => x.muscle === "Spalle")); // gruppo vuoto assente
});

import { catalogUsage } from "../catalog.js";

function blobWithHistory() {
  return {
    schema: 6, updatedAt: null, activeSheetId: "s1",
    sheets: [{
      id: "s1", name: "Push Pull Legs",
      plan: [{ day: "A", title: "Spinta", exercises: [{ id: "e1", name: "Panca piana bilanciere", muscle: "Petto" }] }],
      weeks: {
        "2026-W01": { entries: { A: { e1: { sets: [{ reps: "5", kg: "60", done: true }] } } } },
        "2026-W02": { entries: { A: { e1: { sets: [{ reps: "5", kg: "65", done: true }] } } } },
      },
    }],
    catalog: [{ id: "c1", name: "Panca piana bilanciere", muscle: "Petto", note: "" }],
  };
}

test("catalogUsage: trova usato-in e serie per nome", () => {
  const u = catalogUsage(blobWithHistory(), "Panca piana bilanciere");
  assert.deepEqual(u.usedIn, [{ sheet: "Push Pull Legs", day: "Spinta" }]);
  assert.equal(u.lastKg, 65);
  assert.ok(u.series.length >= 2);
});

test("catalogUsage: match per nome case-insensitive", () => {
  const u = catalogUsage(blobWithHistory(), "PANCA piana bilanciere");
  assert.equal(u.usedIn.length, 1);
});

test("catalogUsage: nessun match → fallback vuoto", () => {
  const u = catalogUsage(blobWithHistory(), "Esercizio inesistente");
  assert.deepEqual(u, { usedIn: [], series: [], lastKg: null });
});
