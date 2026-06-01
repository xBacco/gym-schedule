import test from "node:test";
import assert from "node:assert/strict";
import { getTheme, setTheme, applyTheme, THEME_KEY, DEFAULT_THEME } from "../theme.js";

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
  const attrs = new Map();
  return {
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    _attrs: attrs,
  };
}

test("getTheme default è 'carta' quando nulla è salvato", () => {
  assert.equal(getTheme(fakeStorage()), "carta");
  assert.equal(DEFAULT_THEME, "carta");
});

test("getTheme ignora valori sconosciuti e torna al default", () => {
  assert.equal(getTheme(fakeStorage({ [THEME_KEY]: "bogus" })), "carta");
});

test("setTheme persiste un tema valido e getTheme lo rilegge", () => {
  const s = fakeStorage();
  setTheme(s, "graphite");
  assert.equal(s.getItem(THEME_KEY), "graphite");
  assert.equal(getTheme(s), "graphite");
});

test("setTheme è no-op su tema sconosciuto", () => {
  const s = fakeStorage({ [THEME_KEY]: "graphite" });
  setTheme(s, "bogus");
  assert.equal(getTheme(s), "graphite"); // invariato
});

test("applyTheme su 'graphite' mette l'attributo data-theme", () => {
  const s = fakeStorage({ [THEME_KEY]: "graphite" });
  const root = fakeRoot();
  assert.equal(applyTheme(root, s), "graphite");
  assert.equal(root.getAttribute("data-theme"), "graphite");
});

test("applyTheme sul default 'carta' rimuove l'attributo (CSS :root)", () => {
  const s = fakeStorage({ [THEME_KEY]: "graphite" });
  const root = fakeRoot();
  applyTheme(root, s);
  assert.equal(root.getAttribute("data-theme"), "graphite");
  setTheme(s, "carta");
  applyTheme(root, s);
  assert.equal(root.getAttribute("data-theme"), null);
});
