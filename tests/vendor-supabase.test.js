import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url));

test("vendor/supabase.js esiste (eseguire `node scripts/vendor-supabase.cjs`)", () => {
  assert.ok(existsSync(at("../vendor/supabase.js")), "vendor/supabase.js mancante");
});

test("vendor/supabase.js è autonomo: nessun import remoto", () => {
  const src = readFileSync(at("../vendor/supabase.js"), "utf8");
  assert.ok(!/from\s*["']https?:\/\//.test(src), "import statico remoto nel bundle");
  assert.ok(!/import\s*\(\s*["']https?:\/\//.test(src), "dynamic import remoto nel bundle");
});

test("supabase-client.js importa il bundle locale, non un CDN", () => {
  const src = readFileSync(at("../supabase-client.js"), "utf8");
  assert.match(src, /from\s*["']\.\/vendor\/supabase\.js["']/, "deve importare ./vendor/supabase.js");
  assert.ok(!/from\s*["']https?:\/\//.test(src), "supabase-client.js importa ancora da un URL");
});

test("sw.js cacha il bundle vendorizzato e ha bumpato CACHE a v79", () => {
  const sw = readFileSync(at("../sw.js"), "utf8");
  assert.match(sw, /["']\.\/vendor\/supabase\.js["']/, "ASSETS deve includere ./vendor/supabase.js");
  assert.match(sw, /const CACHE\s*=\s*["']gymsched-v79["']/, "CACHE deve essere gymsched-v79");
});
