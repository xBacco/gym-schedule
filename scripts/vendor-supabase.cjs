// scripts/vendor-supabase.cjs — genera vendor/supabase.js: bundle ESM autonomo di
// @supabase/supabase-js per l'offline reale (niente import da CDN cross-origin).
// Uso: node scripts/vendor-supabase.cjs   (richiede le devDeps esbuild + @supabase/supabase-js)
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const OUT = path.join(__dirname, "..", "vendor", "supabase.js");
const pkgVersion = require("@supabase/supabase-js/package.json").version;

(async () => {
  const tmp = path.join(__dirname, "_supabase-entry.js");
  fs.writeFileSync(tmp, `export { createClient } from "@supabase/supabase-js";\n`);
  try {
    const result = await esbuild.build({
      entryPoints: [tmp],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2020",
      minify: true,
      write: false,
      legalComments: "none",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const code = result.outputFiles[0].text;

    // Assert anti-rete: nessun import/require remoto deve restare nel bundle.
    if (/from\s*["']https?:\/\//.test(code) || /import\s*\(\s*["']https?:\/\//.test(code)) {
      console.error("ERRORE: il bundle contiene ancora import remoti. Abort, niente scrittura.");
      process.exit(1);
    }

    const header =
`// vendor/supabase.js — bundle ESM autonomo di @supabase/supabase-js v${pkgVersion}.
// Generato da scripts/vendor-supabase.cjs (esbuild) per l'offline reale: NESSUN import da CDN.
// NON modificare a mano — rigenerare con: node scripts/vendor-supabase.cjs
`;
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, header + code);
    console.log("scritto vendor/supabase.js", (header + code).length, "bytes, supabase-js v" + pkgVersion);
  } finally {
    fs.unlinkSync(tmp);
  }
})();
