// Genera body-data.js dai sorgenti di react-native-body-highlighter (MIT).
// Sorgenti NON versionati (scaricati a mano dal repo HichamELBSI/react-native-body-highlighter):
//   bh-front.ts (assets/bodyFront.ts) · bh-back.ts (assets/bodyBack.ts)
//   bh-wrapper.tsx (index.tsx) · bh-LICENSE (LICENSE)
// Uso: node scripts/vendor-body-data.cjs <dir-sorgenti>
const fs = require("fs");
const path = require("path");

const src = process.argv[2];
if (!src) { console.error("uso: node scripts/vendor-body-data.cjs <dir con bh-front.ts bh-back.ts bh-wrapper.tsx bh-LICENSE>"); process.exit(1); }

// Estrae [{slug, paths[]}] dal sorgente TS: blocchi `slug: "..."` seguiti da stringhe-path SVG.
function parseParts(ts) {
  const parts = [];
  const chunks = ts.split(/slug:\s*"/).slice(1);
  for (const ch of chunks) {
    const slug = ch.slice(0, ch.indexOf('"'));
    const stop = ch.indexOf("slug:");
    const body = stop === -1 ? ch : ch.slice(0, stop);
    const paths = [...body.matchAll(/"((?:M|m)[^"]+)"/g)].map((m) => m[1]);
    parts.push({ slug, paths });
  }
  return parts;
}

const front = parseParts(fs.readFileSync(path.join(src, "bh-front.ts"), "utf8"));
const back = parseParts(fs.readFileSync(path.join(src, "bh-back.ts"), "utf8"));
const wrapper = fs.readFileSync(path.join(src, "bh-wrapper.tsx"), "utf8");
// Le prime due path d="..." del wrapper sono le silhouette fronte e retro.
const dPaths = [...wrapper.matchAll(/d="([^"]+)"/g)].map((m) => m[1]);
if (dPaths.length < 2) { console.error("wrapper: attesi >= 2 path d=, trovati", dPaths.length); process.exit(1); }
const [baseFront, baseBack] = dPaths;
const license = fs.readFileSync(path.join(src, "bh-LICENSE"), "utf8").trim()
  .split(/\r?\n/).map((l) => "// " + l).join("\n");

if (!front.length || !back.length || !baseFront || !baseBack) {
  console.error("parsing fallito: front", front.length, "back", back.length);
  process.exit(1);
}

const out = `// body-data.js — path SVG della figura anatomica fronte/retro (SOLO dati).
// Vendorato da react-native-body-highlighter (https://github.com/HichamELBSI/react-native-body-highlighter)
// con scripts/vendor-body-data.cjs — NON modificare a mano, rigenerare.
// Licenza originale (MIT):
${license}

export const FRONT_PARTS = ${JSON.stringify(front)};

export const BACK_PARTS = ${JSON.stringify(back)};

export const BASE_FRONT = ${JSON.stringify(baseFront)};

export const BASE_BACK = ${JSON.stringify(baseBack)};

export const VIEWBOX_FRONT = "0 0 724 1448";

export const VIEWBOX_BACK = "724 0 724 1448";
`;
fs.writeFileSync(path.join(__dirname, "..", "body-data.js"), out);
console.log("scritto body-data.js", out.length, "bytes,", front.length, "+", back.length, "zone");
