import test from "node:test";
import assert from "node:assert/strict";
import { getFx, setFx, applyFx, FX } from "../fx.js";

function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}
function fakeRoot() {
  const set = new Set();
  return {
    classList: {
      toggle: (c, on) => { if (on) set.add(c); else set.delete(c); },
      contains: (c) => set.has(c),
    },
    _set: set,
  };
}

test("getFx default è false (sobrio) quando nulla è salvato", () => {
  const s = fakeStorage();
  assert.equal(getFx(s, "glow"), false);
  assert.equal(getFx(s, "scan"), false);
});

test("setFx persiste '1'/'0' e getFx lo rilegge", () => {
  const s = fakeStorage();
  setFx(s, "glow", true);
  assert.equal(s.getItem(FX.glow.key), "1");
  assert.equal(getFx(s, "glow"), true);
  setFx(s, "glow", false);
  assert.equal(s.getItem(FX.glow.key), "0");
  assert.equal(getFx(s, "glow"), false);
});

test("getFx con nome sconosciuto è false e setFx è no-op", () => {
  const s = fakeStorage();
  assert.equal(getFx(s, "bogus"), false);
  setFx(s, "bogus", true); // non deve lanciare
  assert.equal(s._map.size, 0);
});

test("applyFx aggiunge solo le classi delle pref attive", () => {
  const s = fakeStorage({ gymsched_fx_scan: "1" });
  const root = fakeRoot();
  applyFx(root, s);
  assert.equal(root.classList.contains("fx-scan"), true);
  assert.equal(root.classList.contains("fx-glow"), false);
});

test("applyFx rimuove le classi quando le pref tornano false", () => {
  const s = fakeStorage({ gymsched_fx_glow: "1" });
  const root = fakeRoot();
  applyFx(root, s);
  assert.equal(root.classList.contains("fx-glow"), true);
  setFx(s, "glow", false);
  applyFx(root, s);
  assert.equal(root.classList.contains("fx-glow"), false);
});
