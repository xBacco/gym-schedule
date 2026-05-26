import { test } from "node:test";
import assert from "node:assert/strict";
import { isoWeekKey, emptyData, ensureWeek, setEntry, getEntry, parsePlateSet } from "../store.js";

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
import { prefillSets } from "../store.js";

test("prefillSets: copia le serie della settimana precedente con done=false", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "70", done: true }, { reps: "8", kg: "70", done: true }] }, "t1");
  const pre = prefillSets(d, "2026-W22", "A", 0);
  assert.deepEqual(pre, [
    { reps: "8", kg: "70", done: false },
    { reps: "8", kg: "70", done: false },
  ]);
});

test("prefillSets: usa la settimana loggata più recente fra le precedenti", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", 0, { sets: [{ reps: "8", kg: "60" }] }, "t1");
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "65" }] }, "t2");
  assert.deepEqual(prefillSets(d, "2026-W22", "A", 0), [{ reps: "8", kg: "65", done: false }]);
});

test("prefillSets: nessuno storico -> array vuoto", () => {
  assert.deepEqual(prefillSets(emptyData(), "2026-W22", "A", 0), []);
});

test("prefillSets: salta settimane con serie vuote e usa la più recente non vuota", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", 0, { sets: [{ reps: "10", kg: "50" }] }, "t1");
  d = setEntry(d, "2026-W21", "A", 0, { sets: [] }, "t2"); // loggata ma senza serie
  assert.deepEqual(prefillSets(d, "2026-W22", "A", 0), [{ reps: "10", kg: "50", done: false }]);
});

test("prefillSets: accetta chiavi con suffisso .N (settimane duplicate di newWeek)", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", 0, { sets: [{ reps: "8", kg: "60" }] }, "t1");
  d = setEntry(d, "2026-W22.2", "A", 0, { sets: [{ reps: "8", kg: "65" }] }, "t2");
  assert.deepEqual(prefillSets(d, "2026-W23", "A", 0), [{ reps: "8", kg: "65", done: false }]);
});
import { platesPerSide } from "../store.js";

test("platesPerSide: 72.5 kg con bilanciere 20 -> 20+5+1.25 per lato", () => {
  assert.deepEqual(platesPerSide(72.5), { perSide: [20, 5, 1.25], leftover: 0 });
});

test("platesPerSide: 60 kg -> 20 per lato", () => {
  assert.deepEqual(platesPerSide(60), { perSide: [20], leftover: 0 });
});

test("platesPerSide: carico <= bilanciere -> nessun disco", () => {
  assert.deepEqual(platesPerSide(20), { perSide: [], leftover: 0 });
  assert.deepEqual(platesPerSide(15), { perSide: [], leftover: 0 });
});

test("platesPerSide: set dischi personalizzato e resto non coperto", () => {
  const out = platesPerSide(63, { bar: 20, plates: [10, 5] }); // perSide target 21.5 -> 10+10+... resto
  assert.deepEqual(out.perSide, [10, 10]);
  assert.equal(out.leftover, 1.5);
});

test("platesPerSide: array dischi vuoto -> leftover = carico per lato", () => {
  assert.deepEqual(platesPerSide(60, { bar: 20, plates: [] }), { perSide: [], leftover: 20 });
});

test("platesPerSide: dischi 0/negativi ignorati, niente loop infinito", () => {
  assert.deepEqual(platesPerSide(60, { bar: 20, plates: [20, 0, -5] }), { perSide: [20], leftover: 0 });
});

test("setEntry/getEntry reggono il valore per-serie e il round-trip base64", () => {
  const val = { sets: [{ reps: "8", kg: "72.5", done: true }], note: "ok" };
  let d = setEntry(emptyData(), "2026-W22", "A", 0, val, "t1");
  assert.deepEqual(getEntry(d, "2026-W22", "A", 0), val);
  // round-trip come fa GitHubStore.save/load
  const round = JSON.parse(fromBase64(toBase64(JSON.stringify(d, null, 2))));
  assert.deepEqual(getEntry(round, "2026-W22", "A", 0), val);
});

test("parsePlateSet: parsa, ordina decrescente e scarta invalidi", () => {
  assert.deepEqual(parsePlateSet("20, 15, 10, 5, 2.5, 1.25"), [20, 15, 10, 5, 2.5, 1.25]);
  assert.deepEqual(parsePlateSet("10 5 2.5"), [10, 5, 2.5]);
  assert.deepEqual(parsePlateSet("20, abc, -5, 0, 15"), [20, 15]);
});

test("parsePlateSet: stringa vuota -> []", () => {
  assert.deepEqual(parsePlateSet(""), []);
});

test("parsePlateSet: virgola decimale all'italiana ('2,5') con item separati da spazio/virgola-spazio", () => {
  assert.deepEqual(parsePlateSet("20, 15, 2,5"), [20, 15, 2.5]);
  assert.deepEqual(parsePlateSet("10 2,5 1,25"), [10, 2.5, 1.25]);
});
