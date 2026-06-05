import { test } from "node:test";
import assert from "node:assert/strict";
import { FRONT_PARTS, BACK_PARTS, BASE_FRONT, BASE_BACK } from "../body-data.js";
import { GROUP_ZONES, heatByGroup, freshnessByGroup, renderBody, dayCoverage, scanBootLog } from "../body.js";
import { MUSCLE_GROUPS } from "../catalog.js";

test("body-data: parti fronte/retro presenti e con path", () => {
  assert.ok(FRONT_PARTS.length >= 10);
  assert.ok(BACK_PARTS.length >= 10);
  for (const p of [...FRONT_PARTS, ...BACK_PARTS]) {
    assert.ok(p.slug && Array.isArray(p.paths) && p.paths.length >= 1);
  }
  assert.ok(BASE_FRONT.startsWith("M") || BASE_FRONT.startsWith("m"));
  assert.ok(BASE_BACK.startsWith("M") || BASE_BACK.startsWith("m"));
});

test("body-data: le zone chiave della figura esistono", () => {
  const slugs = new Set([...FRONT_PARTS, ...BACK_PARTS].map((p) => p.slug));
  for (const z of ["chest", "abs", "obliques", "biceps", "triceps", "deltoids",
    "trapezius", "upper-back", "lower-back", "quadriceps", "hamstring",
    "gluteal", "adductors", "calves"]) {
    assert.ok(slugs.has(z), `zona mancante: ${z}`);
  }
});

test("GROUP_ZONES: copre tutti gli 8 gruppi con zone valide della figura", () => {
  const slugs = new Set([...FRONT_PARTS, ...BACK_PARTS].map((p) => p.slug));
  assert.deepEqual(Object.keys(GROUP_ZONES).sort(), [...MUSCLE_GROUPS].sort());
  for (const zones of Object.values(GROUP_ZONES)) {
    assert.ok(zones.length >= 1);
    for (const z of zones) assert.ok(slugs.has(z), `zona inesistente: ${z}`);
  }
});

test("heatByGroup: primario pieno, secondario 0.5 via catalogo, normalizzato sul max", () => {
  const catalog = [{ id: "c1", name: "Panca piana bilanciere", muscle: "Petto",
    note: "", secondary: ["Spalle", "Tricipiti"], img: "" }];
  const contribs = [
    { muscle: "Petto", name: "Panca piana bilanciere", volume: 1000 },
    { muscle: "Bicipiti", name: "Curl manubri", volume: 250 },
  ];
  const { groups, zones } = heatByGroup(contribs, catalog);
  assert.equal(groups.Petto, 1);                 // 1000 → max
  assert.equal(groups.Spalle, 0.5);              // 500 da secondario
  assert.equal(groups.Tricipiti, 0.5);
  assert.equal(groups.Bicipiti, 0.25);           // 250/1000
  assert.equal(zones.chest, 1);
  assert.equal(zones.deltoids, 0.5);
  assert.equal(zones.biceps, 0.25);
  assert.equal(zones["upper-back"], undefined);  // mai allenato → assente
});

test("heatByGroup: esercizio fuori catalogo conta solo il primario", () => {
  const { groups } = heatByGroup([{ muscle: "Dorso", name: "Inventato", volume: 100 }], []);
  assert.deepEqual(groups, { Dorso: 1 });
});

test("heatByGroup: contributi vuoti → mappe vuote, nessun NaN", () => {
  const { groups, zones } = heatByGroup([], []);
  assert.deepEqual(groups, {});
  assert.deepEqual(zones, {});
});

test("heatByGroup: gruppo ignoto o volume 0 ignorati", () => {
  const { groups } = heatByGroup([
    { muscle: "Altro", name: "X", volume: 100 },
    { muscle: "", name: "Y", volume: 100 },
    { muscle: "Petto", name: "Z", volume: 0 },
    { muscle: "Petto", name: "W", volume: 50 },
  ], []);
  assert.deepEqual(groups, { Petto: 1 });
});

test("freshnessByGroup: fasce ieri/2-3g/4-5g/≥6g/mai", () => {
  const today = "2026-06-04";
  const last = {
    Petto: "2026-06-04",     // oggi → 0.95
    Dorso: "2026-06-03",     // ieri → 0.95
    Spalle: "2026-06-01",    // 3g → 0.6
    Bicipiti: "2026-05-31",  // 4g → 0.25
    Tricipiti: "2026-05-29", // 6g → spento + ⚠
    // Gambe/Polpacci/Core assenti → mai → tratteggio
  };
  const { zones, warnGroups, neverGroups } = freshnessByGroup(last, today);
  assert.equal(zones.chest, 0.95);
  assert.equal(zones["upper-back"], 0.95);
  assert.equal(zones.deltoids, 0.6);
  assert.equal(zones.biceps, 0.25);
  assert.equal(zones.triceps, undefined);            // spento
  assert.deepEqual(warnGroups, ["Tricipiti"]);
  assert.deepEqual([...neverGroups].sort(), ["Core", "Gambe", "Polpacci"]);
  assert.equal(zones.calves, undefined);
});

test("freshnessByGroup: never → set di zone cold per il render", () => {
  const { never } = freshnessByGroup({}, "2026-06-04");
  assert.ok(never.has("chest") && never.has("calves") && never.has("abs"));
});

test("freshnessByGroup: confini esatti d=2 (→0.6) e d=5 (→0.25)", () => {
  const r2 = freshnessByGroup({ Petto: "2026-06-02" }, "2026-06-04");
  assert.equal(r2.zones.chest, 0.6);   // 2 giorni: prima fascia finita
  const r5 = freshnessByGroup({ Petto: "2026-05-30" }, "2026-06-04");
  assert.equal(r5.zones.chest, 0.25);  // 5 giorni: ultima fascia accesa
});

test("renderBody: SVG fronte+retro con silhouette e zone attive", () => {
  const html = renderBody({ zones: { chest: 1, biceps: 0.5 } });
  assert.ok(html.includes("<svg"));
  assert.equal((html.match(/<svg/g) || []).length, 2); // fronte + retro
  assert.ok(html.includes('viewBox="0 0 724 1448"'));
  assert.ok(html.includes('viewBox="724 0 724 1448"'));
  assert.ok(html.includes("#f0a73c"));     // ambra attiva
  assert.ok(html.includes("feGaussianBlur")); // alone
});

test("renderBody: secondari blu e cold tratteggiato", () => {
  const html = renderBody({ zones: {}, secondaries: new Set(["deltoids"]), cold: new Set(["calves"]) });
  assert.ok(html.includes("#7FC8FF"));
  assert.ok(html.includes("stroke-dasharray"));
});

test("renderBody: id filtri univoci tra due render nella stessa pagina", () => {
  const ids = (h) => [...h.matchAll(/filter id="([^"]+)"/g)].map((m) => m[1]);
  const a = ids(renderBody({ zones: { chest: 1 } }));
  const b = ids(renderBody({ zones: { chest: 1 } }));
  assert.ok(a.length >= 2 && b.length >= 2);
  for (const id of a) assert.ok(!b.includes(id), `id duplicato: ${id}`);
});

test("dayCoverage: presenze → primario 1, secondario 0.5, fuori catalogo solo primario", () => {
  const catalog = [{ id: "c1", name: "Panca piana bilanciere", muscle: "Petto",
    note: "", secondary: ["Tricipiti"], img: "" }];
  const dp = { day: "A", exercises: [
    { id: "e1", name: "Panca piana bilanciere", muscle: "Petto" },
    { id: "e2", name: "Squat al volo", muscle: "Gambe" },
  ] };
  const { groups } = dayCoverage(dp, catalog);
  assert.equal(groups.Petto, 1);
  assert.equal(groups.Gambe, 1);
  assert.equal(groups.Tricipiti, 0.5);
});

test("dayCoverage: superset spalmato su muscle e muscleB", () => {
  const dp = { day: "A", exercises: [
    { id: "e1", name: "Plank + Crunch a terra", muscle: "Core", muscleB: "Core", superset: true },
  ] };
  const { groups } = dayCoverage(dp, []);
  assert.deepEqual(groups, { Core: 1 });
});

// ---- Batch sessione-ux: boot-log esplicativo per Scan vuoto ----
test("scanBootLog week: comando, stato e spiegazione reset lunedì", () => {
  const html = scanBootLog("week", { wTag: "W23" });
  assert.ok(html.includes("$ scan --week W23"));
  assert.ok(html.includes("0 serie loggate"));
  assert.ok(html.includes("lunedì"));
  assert.ok(html.includes("scan-boot")); // classe contenitore
});

test("scanBootLog fresh: spiega acceso/spento e tratteggio mai allenato", () => {
  const html = scanBootLog("fresh", {});
  assert.ok(html.includes("$ scan --fresh"));
  assert.ok(html.includes("mai allenato"));
  assert.ok(html.includes("tratteggio"));
});

test("scanBootLog: include la mini legenda primario/secondario", () => {
  const html = scanBootLog("week", { wTag: "W01" });
  assert.ok(html.includes("primario"));
  assert.ok(html.includes("secondario"));
});
