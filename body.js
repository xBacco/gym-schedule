// body.js
// ---- Figura anatomica heatmap (puro, testabile in Node). I dati path vivono
//      in body-data.js (vendorati MIT); qui solo logica: mappatura gruppi→zone,
//      heat normalizzato, fasce freschezza, render SVG. ----
import {
  FRONT_PARTS, BACK_PARTS, BASE_FRONT, BASE_BACK, VIEWBOX_FRONT, VIEWBOX_BACK,
} from "./body-data.js";

// Mappatura degli 8 gruppi del catalogo sulle zone della figura. Le zone non
// elencate qui (testa, mani, avambracci…) restano sempre neutre.
export const GROUP_ZONES = {
  Petto: ["chest"],
  Dorso: ["upper-back", "lower-back", "trapezius"],
  Spalle: ["deltoids"],
  Bicipiti: ["biceps"],
  Tricipiti: ["triceps"],
  Gambe: ["quadriceps", "hamstring", "gluteal", "adductors"],
  Polpacci: ["calves"],
  Core: ["abs", "obliques"],
};

const norm = (s) => String(s ?? "").trim().toLowerCase();

// Heat per gruppo dai contributi per-traccia [{muscle, name, volume}]:
// primario pieno + 0.5× nei gruppi `secondary` della voce di catalogo con lo
// stesso nome (link-per-nome, come catalogUsage). Esercizi fuori catalogo →
// solo primario. Intensità normalizzate sul max della vista (il gruppo col
// volume più alto vale 1). Ritorna { groups: {Gruppo: 0..1}, zones: {zona: 0..1} }.
export function heatByGroup(contribs, catalog = []) {
  const byName = new Map();
  for (const e of catalog) byName.set(norm(e.name), e);
  const vol = new Map();
  const add = (g, v) => { if (g && GROUP_ZONES[g] && v > 0) vol.set(g, (vol.get(g) ?? 0) + v); };
  for (const c of contribs ?? []) {
    add(c.muscle, c.volume);
    for (const g of byName.get(norm(c.name))?.secondary ?? []) add(g, c.volume * 0.5);
  }
  const max = Math.max(0, ...vol.values());
  const groups = {}, zones = {};
  for (const [g, v] of vol) {
    const h = max > 0 ? v / max : 0;
    groups[g] = h;
    for (const z of GROUP_ZONES[g]) zones[z] = Math.max(zones[z] ?? 0, h);
  }
  return { groups, zones };
}

// Fasce freschezza dalla mappa gruppo→data ISO dell'ultima sessione:
// 0–1 giorni 0.95 · 2–3 0.6 · 4–5 0.25 · ≥6 spento (gruppo in warnGroups) ·
// assente = mai allenato (zone in `never` → tratteggio rosso nel render).
export function freshnessByGroup(lastByGroup, todayIso) {
  const days = (iso) => Math.round((Date.parse(todayIso) - Date.parse(iso)) / 86400000);
  const zones = {}, never = new Set(), warnGroups = [], neverGroups = [];
  for (const [g, zs] of Object.entries(GROUP_ZONES)) {
    const last = lastByGroup?.[g];
    if (!last) { neverGroups.push(g); zs.forEach((z) => never.add(z)); continue; }
    const d = days(last);
    const h = d <= 1 ? 0.95 : d <= 3 ? 0.6 : d <= 5 ? 0.25 : 0;
    if (h === 0) { warnGroups.push(g); continue; } // spento + ⚠ in legenda
    for (const z of zs) zones[z] = Math.max(zones[z] ?? 0, h);
  }
  return { zones, never, warnGroups, neverGroups };
}

// ---- Render SVG (stringhe; niente DOM, testabile in Node). Palette X-ray
//      FISSA fuori dai temi: il pannello è un "monitor incassato". ----
const X = {
  sil: "#0c0f12", neutral: "#161a1e", off: "#1c2127", offLine: "#2c343c",
  amber: "#f0a73c", blue: "#7FC8FF", down: "#e0705a", ink: "#3a4148",
};
// Zone senza gruppo muscolare: sempre neutre (più scure dei muscoli spenti).
const NEUTRAL_ZONES = new Set(["head", "hair", "neck", "hands", "feet",
  "ankles", "knees", "forearm", "tibialis"]);

let uid = 0; // contatore per id filtri univoci (più figure nella stessa pagina)

function fig(parts, baseD, viewBox, { zones = {}, secondaries = new Set(), cold = new Set(), w = 86 }) {
  const g = "bx" + (uid++);
  const defs = `<filter id="${g}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="20"/></filter>`;
  const base = `<path d="${baseD}" fill="${X.sil}" fill-opacity=".82" stroke="${X.ink}" stroke-width="2.5"/>`;
  let z = "";
  for (const p of parts) {
    const h = zones[p.slug] ?? 0;
    let attrs, halo = "";
    if (NEUTRAL_ZONES.has(p.slug)) attrs = `fill="${X.neutral}"`;
    else if (cold.has(p.slug)) attrs = `fill="${X.off}" stroke="${X.down}" stroke-width="4" stroke-dasharray="10 8"`;
    else if (secondaries.has(p.slug)) {
      for (const d of p.paths) halo += `<path d="${d}" fill="${X.blue}" fill-opacity=".6" filter="url(#${g})"/>`;
      attrs = `fill="${X.blue}" fill-opacity=".32" stroke="${X.blue}" stroke-width="1.5" stroke-opacity=".7"`;
    } else if (h > 0) {
      for (const d of p.paths) halo += `<path d="${d}" fill="${X.amber}" fill-opacity="${(0.35 + h * 0.6).toFixed(2)}" filter="url(#${g})"/>`;
      attrs = `fill="${X.amber}" fill-opacity="${(0.22 + h * 0.58).toFixed(2)}" stroke="${X.amber}" stroke-width="1.5" stroke-opacity="${(h * 0.9).toFixed(2)}"`;
    } else attrs = `fill="${X.off}" stroke="${X.offLine}" stroke-width="1.5"`;
    z += halo;
    for (const d of p.paths) z += `<path d="${d}" ${attrs}/>`;
  }
  return `<svg viewBox="${viewBox}" style="width:${w}px;height:auto;flex:none"><defs>${defs}</defs>${base}${z}</svg>`;
}

// Coppia fronte+retro. opts: { zones: {zona:0..1}, secondaries: Set<zona>,
// cold: Set<zona> (tratteggio rosso "mai"), w: px per figura }.
export function renderBody(opts = {}) {
  return `<div class="bd-pair">${fig(FRONT_PARTS, BASE_FRONT, VIEWBOX_FRONT, opts)}${fig(BACK_PARTS, BASE_BACK, VIEWBOX_BACK, opts)}</div>`;
}

// Copertura muscolare di un giorno di scheda (senza volumi, per l'editor):
// ogni esercizio vale 1 sul primario (+0.5 sui secondari via catalogo).
// Zone non coperte restano spente normali, MAI rosse.
export function dayCoverage(dayPlan, catalog = []) {
  const contribs = [];
  for (const ex of dayPlan?.exercises ?? []) {
    const name = String(ex?.name ?? "");
    if (ex?.superset) {
      const [nameA, nameB] = name.includes(" + ") ? name.split(" + ") : [name, name];
      contribs.push({ muscle: ex.muscle, name: nameA, volume: 1 },
        { muscle: ex.muscleB, name: nameB, volume: 1 });
    } else contribs.push({ muscle: ex?.muscle, name, volume: 1 });
  }
  return heatByGroup(contribs, catalog);
}
