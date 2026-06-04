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
