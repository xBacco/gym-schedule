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
import { toBase64, fromBase64 } from "../store.js";

test("toBase64/fromBase64 round-trip UTF-8 text", () => {
  const original = JSON.stringify({ note: "60kg à è 8/8/7 ×" });
  const encoded = toBase64(original);
  assert.equal(typeof encoded, "string");
  assert.notEqual(encoded, original);
  assert.equal(fromBase64(encoded), original);
});
import { GitHubStore, ConflictError } from "../store.js";

// Build a fake fetch that records calls and returns scripted responses.
function fakeResponse({ ok = true, status = 200, body = {} }) {
  return {
    ok,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

test("GitHubStore.load returns parsed data and sha", async () => {
  const remote = { updatedAt: "t1", weeks: { "2026-W22": { label: "S1", entries: {} } } };
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return fakeResponse({ body: { content: toBase64(JSON.stringify(remote)), sha: "abc123" } });
  };
  const store = new GitHubStore({ owner: "x", repo: "r", token: "T", fetchImpl: fakeFetch });
  const { data, sha } = await store.load();
  assert.deepEqual(data, remote);
  assert.equal(sha, "abc123");
  assert.match(calls[0].url, /repos\/x\/r\/contents\/data\.json/);
  assert.equal(calls[0].opts.headers.Authorization, "Bearer T");
});

test("GitHubStore.load returns emptyData and null sha on 404", async () => {
  const fakeFetch = async () => fakeResponse({ ok: false, status: 404, body: { message: "Not Found" } });
  const store = new GitHubStore({ owner: "x", repo: "r", fetchImpl: fakeFetch });
  const { data, sha } = await store.load();
  assert.deepEqual(data, emptyData());
  assert.equal(sha, null);
});

test("GitHubStore.save PUTs base64 content with sha and returns new sha", async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return fakeResponse({ body: { content: { sha: "newsha" } } });
  };
  const store = new GitHubStore({ owner: "x", repo: "r", token: "T", fetchImpl: fakeFetch });
  const data = setEntry(emptyData(), "2026-W22", "A", 0, "60kg", "t1");
  const newSha = await store.save(data, "oldsha", "log: test");
  assert.equal(newSha, "newsha");
  const put = calls[0];
  assert.equal(put.opts.method, "PUT");
  const sent = JSON.parse(put.opts.body);
  assert.equal(sent.sha, "oldsha");
  assert.equal(sent.message, "log: test");
  assert.deepEqual(JSON.parse(fromBase64(sent.content)), data);
});

test("GitHubStore.save throws ConflictError on 409", async () => {
  const fakeFetch = async () => fakeResponse({ ok: false, status: 409, body: { message: "conflict" } });
  const store = new GitHubStore({ owner: "x", repo: "r", token: "T", fetchImpl: fakeFetch });
  await assert.rejects(
    () => store.save(emptyData(), "oldsha", "msg"),
    (err) => err instanceof ConflictError
  );
});
import { normalizeEntry } from "../store.js";

test("normalizeEntry: oggetto già strutturato resta tale (con default done/note)", () => {
  const v = { sets: [{ reps: "8", kg: "72.5", done: true }], note: "presa media" };
  assert.deepEqual(normalizeEntry(v), {
    sets: [{ reps: "8", kg: "72.5", done: true }],
    note: "presa media",
  });
});

test("normalizeEntry: legacy {kg,reps} con reps slash si espande in serie, kg ripetuto", () => {
  const v = { kg: "70", reps: "8/8/7" };
  assert.deepEqual(normalizeEntry(v), {
    sets: [
      { reps: "8", kg: "70", done: false },
      { reps: "8", kg: "70", done: false },
      { reps: "7", kg: "70", done: false },
    ],
    note: "",
  });
});

test("normalizeEntry: legacy {kg,reps} con kg multipli paralleli", () => {
  const v = { kg: "70/72.5", reps: "8/8" };
  assert.deepEqual(normalizeEntry(v).sets, [
    { reps: "8", kg: "70", done: false },
    { reps: "8", kg: "72.5", done: false },
  ]);
});

test("normalizeEntry: stringa legacy = sole ripetizioni", () => {
  assert.deepEqual(normalizeEntry("8/8/7").sets, [
    { reps: "8", kg: "", done: false },
    { reps: "8", kg: "", done: false },
    { reps: "7", kg: "", done: false },
  ]);
});

test("normalizeEntry: vuoto/assente -> nessuna serie", () => {
  assert.deepEqual(normalizeEntry(""), { sets: [], note: "" });
  assert.deepEqual(normalizeEntry(undefined), { sets: [], note: "" });
  assert.deepEqual(normalizeEntry({ kg: "", reps: "" }), { sets: [], note: "" });
});
import { normalizeSupersetEntry } from "../store.js";

test("normalizeSupersetEntry: forma {a,b,note} normalizza entrambe le tracce", () => {
  const v = { a: { sets: [{ reps: "15", kg: "25", done: true }] }, b: { reps: "15", kg: "12" }, note: "ok" };
  const out = normalizeSupersetEntry(v);
  assert.deepEqual(out.a.sets, [{ reps: "15", kg: "25", done: true }]);
  assert.deepEqual(out.b.sets, [{ reps: "15", kg: "12", done: false }]);
  assert.equal(out.note, "ok");
});

test("normalizeSupersetEntry: entry legacy singola finisce nella traccia A, B vuota", () => {
  const out = normalizeSupersetEntry({ kg: "", reps: "15/15" });
  assert.equal(out.a.sets.length, 2);
  assert.deepEqual(out.b, { sets: [], note: "" });
});

test("normalizeSupersetEntry: vuoto -> due tracce vuote", () => {
  assert.deepEqual(normalizeSupersetEntry(""), { a: { sets: [], note: "" }, b: { sets: [], note: "" }, note: "" });
});
