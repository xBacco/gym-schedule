import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTime, remainingSeconds, withoutSession, goSlug, VisibleCountdown } from "../timer.js";

test("formatTime renders m:ss and clamps negatives to 0:00", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(5), "0:05");
  assert.equal(formatTime(60), "1:00");
  assert.equal(formatTime(75), "1:15");
  assert.equal(formatTime(150), "2:30");
  assert.equal(formatTime(-3), "0:00");
});

test("remainingSeconds rounds up and clamps to 0", () => {
  const now = 1_000_000;
  assert.equal(remainingSeconds(now + 90_000, now), 90);
  assert.equal(remainingSeconds(now + 1, now), 1);
  assert.equal(remainingSeconds(now - 5_000, now), 0);
});

test("withoutSession rimuove una chiave in modo immutabile", () => {
  const map = {
    "2026-W23-A": { start: "x", end: null },
    "2026-W23-B": { start: "y", end: null },
  };
  const out = withoutSession(map, "2026-W23-A");
  assert.deepEqual(out, { "2026-W23-B": { start: "y", end: null } });
  assert.ok("2026-W23-A" in map, "l'input non deve essere mutato");
});

test("withoutSession: chiave assente -> copia invariata", () => {
  const map = { "2026-W23-A": { start: "x", end: null } };
  assert.deepEqual(withoutSession(map, "nope"), { "2026-W23-A": { start: "x", end: null } });
});

test("withoutSession: input non-oggetto -> {}", () => {
  assert.deepEqual(withoutSession(null, "k"), {});
  assert.deepEqual(withoutSession(undefined, "k"), {});
});

test("goSlug: minuscole, accenti normalizzati, non-alfanumerici → _", () => {
  assert.equal(goSlug("Pushdown + Curl panca"), "pushdown_curl_panca");
  assert.equal(goSlug("Più forza così"), "piu_forza_cosi");
});

test("goSlug: trim di _ ai bordi e taglio a 24 char", () => {
  assert.equal(goSlug("  Croci ai cavi in piedi (chiusura petto)  ").length <= 24, true);
  assert.equal(goSlug("---Dips---"), "dips");
});

test("goSlug: vuoto/garbage → fallback 'esercizio'", () => {
  assert.equal(goSlug(""), "esercizio");
  assert.equal(goSlug("→★"), "esercizio");
});

// ---- Batch sessione-ux: VisibleCountdown (auto-dismiss GO) ----
// Fake timer: cattura callback+delay, fire manuale.
function fakeTimers() {
  const pending = new Map();
  let seq = 0;
  return {
    setTimer: (fn, ms) => { const id = ++seq; pending.set(id, { fn, ms }); return id; },
    clearTimer: (id) => pending.delete(id),
    pending,
    fire(id) { const p = pending.get(id); pending.delete(id); p.fn(); },
  };
}

test("VisibleCountdown: scade dopo durationMs se visibile", () => {
  const ft = fakeTimers();
  let done = 0;
  const c = new VisibleCountdown({ durationMs: 8000, onDone: () => done++,
    now: () => 1000, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  c.start(true);
  assert.equal(ft.pending.size, 1);
  const [[id, p]] = ft.pending.entries();
  assert.equal(p.ms, 8000);
  ft.fire(id);
  assert.equal(done, 1);
  assert.equal(c.active, false);
});

test("VisibleCountdown: hide congela il tempo residuo, show riparte da lì", () => {
  const ft = fakeTimers();
  let t = 1000;
  let done = 0;
  const c = new VisibleCountdown({ durationMs: 8000, onDone: () => done++,
    now: () => t, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  c.start(true);
  t = 4000; // 3 s passati
  c.hide();
  assert.equal(ft.pending.size, 0); // timer cancellato
  assert.equal(c.remaining, 5000);
  assert.equal(done, 0);
  t = 99000; // il tempo nascosto NON conta
  c.show();
  assert.equal(ft.pending.size, 1);
  const [[, p]] = ft.pending.entries();
  assert.equal(p.ms, 5000);
});

test("VisibleCountdown: start(false) parte in pausa; cancel azzera", () => {
  const ft = fakeTimers();
  const c = new VisibleCountdown({ durationMs: 8000, onDone: () => {},
    now: () => 0, setTimer: ft.setTimer, clearTimer: ft.clearTimer });
  c.start(false); // schermo nascosto al via
  assert.equal(ft.pending.size, 0);
  assert.equal(c.active, true);
  c.show();
  assert.equal(ft.pending.size, 1);
  c.cancel();
  assert.equal(ft.pending.size, 0);
  assert.equal(c.active, false);
});
