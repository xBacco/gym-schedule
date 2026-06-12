import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sw = readFileSync(join(root, "sw.js"), "utf8");

// .js di root esclusi dall'app-shell: il SW stesso e il config di test.
const EXCLUDE = new Set(["sw.js", "playwright.config.js"]);

test("ogni modulo .js di root dell'app è in ASSETS del SW (offline)", () => {
  const modules = readdirSync(root).filter((f) => f.endsWith(".js") && !EXCLUDE.has(f));
  const missing = modules.filter(
    (f) => !new RegExp(`["']\\./${f.replace(/\./g, "\\.")}["']`).test(sw)
  );
  assert.deepEqual(missing, [], `moduli mancanti da ASSETS in sw.js: ${missing.join(", ")}`);
});
