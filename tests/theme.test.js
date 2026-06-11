import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

test("getTheme default è 'graphite' quando nulla è salvato", () => {
  assert.equal(getTheme(fakeStorage()), "graphite");
  assert.equal(DEFAULT_THEME, "graphite");
});

test("getTheme ignora valori sconosciuti e torna al default 'graphite'", () => {
  assert.equal(getTheme(fakeStorage({ [THEME_KEY]: "bogus" })), "graphite");
});

test("setTheme persiste un tema valido e getTheme lo rilegge", () => {
  const s = fakeStorage();
  setTheme(s, "carta");
  assert.equal(s.getItem(THEME_KEY), "carta");
  assert.equal(getTheme(s), "carta");
});

test("setTheme è no-op su tema sconosciuto", () => {
  const s = fakeStorage({ [THEME_KEY]: "carta" });
  setTheme(s, "bogus");
  assert.equal(getTheme(s), "carta"); // invariato
});

test("applyTheme su 'graphite' mette l'attributo data-theme", () => {
  const s = fakeStorage({ [THEME_KEY]: "graphite" });
  const root = fakeRoot();
  assert.equal(applyTheme(root, s), "graphite");
  assert.equal(root.getAttribute("data-theme"), "graphite");
});

test("applyTheme su storage vuoto applica il default graphite (niente flash chiaro per chi installa)", () => {
  const s = fakeStorage();
  const root = fakeRoot();
  assert.equal(applyTheme(root, s), "graphite");
  assert.equal(root.getAttribute("data-theme"), "graphite");
});

test("applyTheme su 'carta' rimuove l'attributo (il CSS :root È carta)", () => {
  const s = fakeStorage({ [THEME_KEY]: "graphite" });
  const root = fakeRoot();
  applyTheme(root, s);
  assert.equal(root.getAttribute("data-theme"), "graphite");
  setTheme(s, "carta");
  applyTheme(root, s);
  assert.equal(root.getAttribute("data-theme"), null);
});

// Lo script anti-flash inline in <head> deve applicare graphite di default (per chi
// non ha mai scelto, incluso il fresh-install), e NON applicarlo solo se il salvato è 'carta'.
test("lo script anti-flash in index.html è graphite-default (a meno di 'carta')", () => {
  const html = readFileSync(fileURLToPath(new URL("../index.html", import.meta.url)), "utf8");
  assert.match(html, /!==\s*["']carta["']/, "deve applicare graphite salvo quando il salvato è 'carta'");
  assert.match(html, /setAttribute\(\s*["']data-theme["']\s*,\s*["']graphite["']/, "deve settare data-theme=graphite");
});
