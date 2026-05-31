import { test } from "node:test";
import assert from "node:assert/strict";
import { isoWeekKey, nextFreeWeekKey, emptyData, ensureWeek, setEntry, getEntry, parsePlateSet, normalizeSet, toggleComment, planIsEmpty } from "../store.js";

test("isoWeekKey returns ISO year-week", () => {
  assert.equal(isoWeekKey(new Date(2020, 0, 1)), "2020-W01"); // Wed 1 Jan 2020
  assert.equal(isoWeekKey(new Date(2021, 0, 1)), "2020-W53"); // Fri 1 Jan 2021 -> 2020 W53
  assert.equal(isoWeekKey(new Date(2026, 4, 25)), "2026-W22"); // Mon 25 May 2026
});

test("nextFreeWeekKey: settimana ISO di oggi se libera", () => {
  assert.equal(nextFreeWeekKey({}, new Date(2026, 4, 25)), "2026-W22");
});

test("nextFreeWeekKey: avanza alla settimana successiva se occupata", () => {
  const weeks = { "2026-W22": { label: "2026-W22", entries: {} } };
  assert.equal(nextFreeWeekKey(weeks, new Date(2026, 4, 25)), "2026-W23");
});

test("nextFreeWeekKey: salta tutte le settimane consecutive occupate", () => {
  const weeks = { "2026-W22": {}, "2026-W23": {}, "2026-W24": {} };
  assert.equal(nextFreeWeekKey(weeks, new Date(2026, 4, 25)), "2026-W25");
});

test("nextFreeWeekKey: attraversa il confine d'anno", () => {
  const weeks = { "2026-W53": {} };
  assert.equal(nextFreeWeekKey(weeks, new Date(2026, 11, 28)), "2027-W01"); // Mon 28 Dic 2026 = 2026-W53
});

test("emptyData is the initial database shape", () => {
  assert.deepEqual(emptyData(), { updatedAt: null, weeks: {}, plan: [], schema: 5 });
});

test("emptyData: parte con plan vuoto e schema corrente (5)", () => {
  const d = emptyData();
  assert.deepEqual(d.weeks, {});
  assert.deepEqual(d.plan, []);
  assert.equal(d.schema, 5);
});

test("planIsEmpty: true se manca plan o e vuoto", () => {
  assert.equal(planIsEmpty(emptyData()), true);
  assert.equal(planIsEmpty({ weeks: {} }), true);
  assert.equal(planIsEmpty({ plan: [] }), true);
  assert.equal(planIsEmpty(null), true);
});

test("planIsEmpty: false se c'e almeno un giorno", () => {
  assert.equal(planIsEmpty({ plan: [{ day: "A", title: "x", exercises: [] }] }), false);
});

test("ensureWeek adds a week without touching existing ones", () => {
  const d0 = emptyData();
  const d1 = ensureWeek(d0, "2026-W22", "Sett. 1");
  assert.deepEqual(d1.weeks["2026-W22"], { label: "Sett. 1", entries: {} });
  // immutability: original untouched
  assert.deepEqual(d0, { updatedAt: null, weeks: {}, plan: [], schema: 5 });
  // does not overwrite an existing week's entries
  const d2 = setEntry(d1, "2026-W22", "A", 0, "60kg 8/8", "2026-05-25T10:00:00Z");
  const d3 = ensureWeek(d2, "2026-W22", "Sett. 1");
  assert.equal(getEntry(d3, "2026-W22", "A", 0), "60kg 8/8");
});
// (immutability check below uses the full emptyData shape)

test("setEntry stores a value and updates updatedAt, immutably", () => {
  const d0 = emptyData();
  const d1 = setEntry(d0, "2026-W22", "A", 0, "60kg 8/8/7", "2026-05-25T10:00:00Z");
  assert.equal(getEntry(d1, "2026-W22", "A", 0), "60kg 8/8/7");
  assert.equal(d1.updatedAt, "2026-05-25T10:00:00Z");
  assert.deepEqual(d0, { updatedAt: null, weeks: {}, plan: [], schema: 5 }); // original untouched
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

test("setEntry registra la data della sessione (set-if-absent)", () => {
  let d = setEntry(emptyData(), "2026-W22", "A", 0, "60kg", "2026-05-25T10:00:00Z");
  assert.equal(d.weeks["2026-W22"].dates.A, "2026-05-25");
  // un secondo log lo stesso giorno-scheda NON sovrascrive la prima data
  d = setEntry(d, "2026-W22", "A", 1, "62kg", "2026-05-26T09:00:00Z");
  assert.equal(d.weeks["2026-W22"].dates.A, "2026-05-25");
  // giorno-scheda diverso -> data propria
  d = setEntry(d, "2026-W22", "B", 0, "stacco", "2026-05-27T09:00:00Z");
  assert.equal(d.weeks["2026-W22"].dates.B, "2026-05-27");
});
import { toBase64, fromBase64 } from "../store.js";

test("toBase64/fromBase64 round-trip UTF-8 text", () => {
  const original = JSON.stringify({ note: "60kg à è 8/8/7 ×" });
  const encoded = toBase64(original);
  assert.equal(typeof encoded, "string");
  assert.notEqual(encoded, original);
  assert.equal(fromBase64(encoded), original);
});
import { normalizeEntry } from "../store.js";

test("normalizeEntry: oggetto già strutturato resta tale (con default done/note)", () => {
  const v = { sets: [{ reps: "8", kg: "72.5", done: true }], note: "presa media" };
  assert.deepEqual(normalizeEntry(v), {
    sets: [{ reps: "8", kg: "72.5", done: true, feel: "", warmup: false, failed: false, failNote: "", comments: [] }],
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
  assert.deepEqual(out.a.sets, [{ reps: "15", kg: "25", done: true, feel: "", warmup: false, failed: false, failNote: "", comments: [] }]);
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
    { reps: "8", kg: "70", done: false, warmup: false },
    { reps: "8", kg: "70", done: false, warmup: false },
  ]);
});

test("prefillSets: usa la settimana loggata più recente fra le precedenti", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", 0, { sets: [{ reps: "8", kg: "60" }] }, "t1");
  d = setEntry(d, "2026-W21", "A", 0, { sets: [{ reps: "8", kg: "65" }] }, "t2");
  assert.deepEqual(prefillSets(d, "2026-W22", "A", 0), [{ reps: "8", kg: "65", done: false, warmup: false }]);
});

test("prefillSets: nessuno storico -> array vuoto", () => {
  assert.deepEqual(prefillSets(emptyData(), "2026-W22", "A", 0), []);
});

test("prefillSets: salta settimane con serie vuote e usa la più recente non vuota", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", 0, { sets: [{ reps: "10", kg: "50" }] }, "t1");
  d = setEntry(d, "2026-W21", "A", 0, { sets: [] }, "t2"); // loggata ma senza serie
  assert.deepEqual(prefillSets(d, "2026-W22", "A", 0), [{ reps: "10", kg: "50", done: false, warmup: false }]);
});

test("prefillSets: accetta chiavi con suffisso .N (settimane duplicate di newWeek)", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", 0, { sets: [{ reps: "8", kg: "60" }] }, "t1");
  d = setEntry(d, "2026-W22.2", "A", 0, { sets: [{ reps: "8", kg: "65" }] }, "t2");
  assert.deepEqual(prefillSets(d, "2026-W23", "A", 0), [{ reps: "8", kg: "65", done: false, warmup: false }]);
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
  // round-trip base64
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

test("normalizeSet: conserva un feel valido", () => {
  assert.equal(normalizeSet({ reps: 8, kg: 70, done: true, feel: "hard" }).feel, "hard");
  assert.equal(normalizeSet({ reps: 8, kg: 70, feel: "easy" }).feel, "easy");
  assert.equal(normalizeSet({ reps: 8, kg: 70, feel: "ok" }).feel, "ok");
});

test("normalizeSet: feel mancante o non valido -> stringa vuota", () => {
  assert.equal(normalizeSet({ reps: 8, kg: 70, done: true }).feel, "");
  assert.equal(normalizeSet({ reps: 8, kg: 70, feel: "boh" }).feel, "");
  assert.equal(normalizeSet({ reps: 8, kg: 70, feel: 5 }).feel, "");
});

test("normalizeSet: non altera reps/kg/done aggiungendo feel", () => {
  assert.deepEqual(normalizeSet({ reps: 8, kg: 72.5, done: true, feel: "ok" }),
    { reps: "8", kg: "72.5", done: true, feel: "ok", warmup: false, failed: false, failNote: "", comments: [] });
});

test("normalizeSet: warmup default false, preserva true", () => {
  assert.equal(normalizeSet({ reps: 8, kg: 50 }).warmup, false);
  assert.equal(normalizeSet({ reps: 8, kg: 50, warmup: true }).warmup, true);
  assert.equal(normalizeSet({ warmup: "x" }).warmup, true); // coercizione booleana
});

test("prefillSets: porta il flag warmup dalle serie precedenti", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W20", "A", 0, { sets: [
    { reps: 8, kg: 40, done: true, warmup: true },
    { reps: 8, kg: 72.5, done: true, warmup: false },
  ] });
  const pre = prefillSets(d, "2026-W21", "A", 0);
  assert.equal(pre[0].warmup, true);
  assert.equal(pre[1].warmup, false);
  assert.equal(pre[0].done, false);
});

test("normalizeSet: comments di default è array vuoto", () => {
  assert.deepEqual(normalizeSet({ reps: "8", kg: "50", done: true }).comments, []);
});
test("normalizeSet: preserva array di commenti, trim e scarta vuoti/non-stringhe", () => {
  const s = normalizeSet({ reps: "6", kg: "55", comments: [" alzare 1kg ", "", 5, "sporca"] });
  assert.deepEqual(s.comments, ["alzare 1kg", "sporca"]);
});
test("normalizeSet: deduplica i commenti mantenendo l'ordine", () => {
  const s = normalizeSet({ comments: ["a", "a", "b"] });
  assert.deepEqual(s.comments, ["a", "b"]);
});

test("toggleComment: aggiunge se assente", () => {
  assert.deepEqual(toggleComment([], "alzare 1kg"), ["alzare 1kg"]);
  assert.deepEqual(toggleComment(["a"], "b"), ["a", "b"]);
});
test("toggleComment: rimuove se presente", () => {
  assert.deepEqual(toggleComment(["a", "b"], "a"), ["b"]);
});
test("toggleComment: trim e niente duplicati", () => {
  assert.deepEqual(toggleComment(["a"], " a "), []);
  assert.deepEqual(toggleComment([], "  x  "), ["x"]);
});
test("toggleComment: input vuoto non cambia nulla", () => {
  assert.deepEqual(toggleComment(["a"], "   "), ["a"]);
});

test("normalizeSet: failed default false, preserva true", () => {
  assert.equal(normalizeSet({ reps: 8, kg: 50 }).failed, false);
  assert.equal(normalizeSet({ reps: 8, kg: 50, failed: true }).failed, true);
  assert.equal(normalizeSet({ failed: 1 }).failed, true); // coercizione booleana
});

test("normalizeSet: failNote default stringa vuota, preserva stringa", () => {
  assert.equal(normalizeSet({ reps: 8, kg: 50 }).failNote, "");
  assert.equal(normalizeSet({ reps: 8, kg: 50, failed: true, failNote: "niente forza" }).failNote, "niente forza");
});

test("normalizeSet: failNote non-stringa (numero/undefined/null) normalizza a stringa vuota", () => {
  assert.equal(normalizeSet({ failNote: 42 }).failNote, "");
  assert.equal(normalizeSet({ failNote: undefined }).failNote, "");
  assert.equal(normalizeSet({ failNote: null }).failNote, "");
});

import { exerciseBar } from "../store.js";

test("exerciseBar: usa exercise.bar quando è un numero finito > 0", () => {
  assert.equal(exerciseBar({ name: "Curl EZ", bar: 10 }, 20), 10);
  assert.equal(exerciseBar({ bar: 7.5 }, 20), 7.5);
});

test("exerciseBar: ricade sul default quando bar è assente/0/negativo/NaN", () => {
  assert.equal(exerciseBar({ name: "Panca" }, 20), 20);
  assert.equal(exerciseBar({ bar: 0 }, 20), 20);
  assert.equal(exerciseBar({ bar: -5 }, 20), 20);
  assert.equal(exerciseBar({ bar: NaN }, 20), 20);
  assert.equal(exerciseBar({ bar: "10" }, 20), 20); // stringa non accettata
});

test("exerciseBar: exercise null/undefined -> default", () => {
  assert.equal(exerciseBar(null, 20), 20);
  assert.equal(exerciseBar(undefined, 25), 25);
});
