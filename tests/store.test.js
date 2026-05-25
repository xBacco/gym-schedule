import { test } from "node:test";
import assert from "node:assert/strict";
import { isoWeekKey, emptyData, ensureWeek, setEntry, getEntry } from "../store.js";

test("isoWeekKey returns ISO year-week", () => {
  assert.equal(isoWeekKey(new Date(2020, 0, 1)), "2020-W01"); // Wed 1 Jan 2020
  assert.equal(isoWeekKey(new Date(2021, 0, 1)), "2020-W53"); // Fri 1 Jan 2021 -> 2020 W53
  assert.equal(isoWeekKey(new Date(2026, 4, 25)), "2026-W22"); // Mon 25 May 2026
});

test("emptyData is the initial database shape", () => {
  assert.deepEqual(emptyData(), { updatedAt: null, weeks: {} });
});

test("ensureWeek adds a week without touching existing ones", () => {
  const d0 = emptyData();
  const d1 = ensureWeek(d0, "2026-W22", "Sett. 1");
  assert.deepEqual(d1.weeks["2026-W22"], { label: "Sett. 1", entries: {} });
  // immutability: original untouched
  assert.deepEqual(d0, { updatedAt: null, weeks: {} });
  // does not overwrite an existing week's entries
  const d2 = setEntry(d1, "2026-W22", "A", 0, "60kg 8/8", "2026-05-25T10:00:00Z");
  const d3 = ensureWeek(d2, "2026-W22", "Sett. 1");
  assert.equal(getEntry(d3, "2026-W22", "A", 0), "60kg 8/8");
});

test("setEntry stores a value and updates updatedAt, immutably", () => {
  const d0 = emptyData();
  const d1 = setEntry(d0, "2026-W22", "A", 0, "60kg 8/8/7", "2026-05-25T10:00:00Z");
  assert.equal(getEntry(d1, "2026-W22", "A", 0), "60kg 8/8/7");
  assert.equal(d1.updatedAt, "2026-05-25T10:00:00Z");
  assert.deepEqual(d0, { updatedAt: null, weeks: {} }); // original untouched
});

test("setEntry merges without clobbering sibling entries", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", 0, "panca", "t1");
  d = setEntry(d, "2026-W22", "A", 3, "pulldown", "t2");
  d = setEntry(d, "2026-W22", "B", 0, "stacco", "t3");
  assert.equal(getEntry(d, "2026-W22", "A", 0), "panca");
  assert.equal(getEntry(d, "2026-W22", "A", 3), "pulldown");
  assert.equal(getEntry(d, "2026-W22", "B", 0), "stacco");
});

test("getEntry returns empty string when missing", () => {
  assert.equal(getEntry(emptyData(), "2026-W22", "A", 0), "");
});
