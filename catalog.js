// catalog.js
// ---- Catalogo esercizi (puro, testabile in Node). Opera sul blob schema 6:
//      blob.catalog = [{ id, name, muscle, note }]. Liste separate dalle schede,
//      collegate per NOME (vedi catalogUsage in task successivi). ----
import { genId } from "./editor.js";
import { topSetSeries } from "./session.js";

const norm = (s) => String(s ?? "").trim().toLowerCase();
const clone = (blob) => structuredClone(blob);
const cat = (blob) => (Array.isArray(blob.catalog) ? blob.catalog : []);

// Gli 8 gruppi fissi, stesso ordine della <select id="exMuscle"> in index.html.
export const MUSCLE_GROUPS = ["Petto", "Dorso", "Spalle", "Bicipiti", "Tricipiti", "Gambe", "Polpacci", "Core"];

// Seed iniziale: 8 gruppi fissi (stesso ordine di index.html) → esercizi.
const SEED_BY_GROUP = {
  Petto: ["Panca piana bilanciere", "Spinte inclinata manubri", "Croci ai cavi", "Dips", "Pectoral machine", "Chest press", "Panca declinata", "Push-up"],
  Dorso: ["Stacco da terra", "Stacco rumeno", "Rematore bilanciere", "Rematore manubrio", "Pulldown presa larga", "Lat machine presa stretta", "Pullover", "Pulley basso", "Trazioni", "Rematore al cavo", "Hyperextension"],
  Spalle: ["Lento avanti bilanciere", "Lento avanti manubri", "Alzate laterali", "Alzate posteriori", "Face pull", "Arnold press", "Tirate al mento", "Scrollate"],
  Bicipiti: ["Curl bilanciere", "Curl manubri", "Curl alla Scott", "Curl concentrato", "Hammer curl", "Curl ai cavi", "Curl EZ"],
  Tricipiti: ["Pushdown ai cavi", "French press", "Skullcrusher", "Pushdown corda", "Estensioni sopra la testa", "Kickback", "Dips alle parallele"],
  Gambe: ["Squat bilanciere", "Pressa", "Leg extension", "Leg curl", "Affondi manubri", "Hack squat", "Bulgarian split squat", "Goblet squat", "Stacco sumo", "Adductor machine"],
  Polpacci: ["Calf in piedi", "Calf da seduto", "Calf alla pressa", "Donkey calf"],
  Core: ["Crunch a terra", "Plank", "Russian twist", "Leg raise", "Crunch inverso", "Plank laterale", "Ab wheel", "Hanging leg raise", "Mountain climber"],
};

// Lista seed deterministica: id `seed-${i}` con i contatore 0-based globale.
// Niente Date/random → stabile. Ogni chiamata costruisce voci nuove.
export function seedCatalog() {
  const out = [];
  let i = 0;
  for (const [muscle, names] of Object.entries(SEED_BY_GROUP)) {
    for (const name of names) {
      out.push({ id: `seed-${i}`, name, muscle, note: "" });
      i += 1;
    }
  }
  return out;
}

// Seeding one-shot puro: inietta il seed SOLO se catalog è genuinamente assente
// (undefined). Un catalog esplicito (anche []) resta invariato. Non muta l'input.
export function seedCatalogIfAbsent(blob) {
  if (blob.catalog !== undefined) return blob;
  const out = clone(blob);
  out.catalog = seedCatalog();
  return out;
}

// true se esiste già una voce con lo stesso nome (case-insensitive) nello stesso
// gruppo. `exceptId` esclude una voce (per il rename su sé stessa).
export function catalogHasDup(blob, name, muscle, exceptId = null) {
  return cat(blob).some(
    (e) => e.id !== exceptId && e.muscle === muscle && norm(e.name) === norm(name));
}

export function addCatalogEntry(blob, { name, muscle, note = "" }) {
  const n = String(name ?? "").trim();
  if (!n) return blob;
  if (catalogHasDup(blob, n, muscle)) return blob;
  const out = clone(blob);
  const id = genId(cat(out).map((e) => e.id));
  out.catalog = [...cat(out), { id, name: n, muscle, note: String(note ?? "").trim() }];
  return out;
}

export function renameCatalogEntry(blob, id, { name, muscle }) {
  const n = String(name ?? "").trim();
  if (!n) return blob;
  if (catalogHasDup(blob, n, muscle, id)) return blob;
  const out = clone(blob);
  out.catalog = cat(out).map((e) => (e.id === id ? { ...e, name: n, muscle } : e));
  return out;
}

export function deleteCatalogEntry(blob, id) {
  const out = clone(blob);
  out.catalog = cat(out).filter((e) => e.id !== id);
  return out;
}

export function setCatalogNote(blob, id, note) {
  const out = clone(blob);
  const t = String(note ?? "").trim();
  out.catalog = cat(out).map((e) => (e.id === id ? { ...e, note: t } : e));
  return out;
}

// [{ muscle, items:[voce…] }] nei soli gruppi con voci, ordine gruppi fisso,
// voci ordinate alfabeticamente (it, case/accent-insensitive).
export function groupedCatalog(blob) {
  const list = cat(blob);
  const byGroup = new Map(MUSCLE_GROUPS.map((m) => [m, []]));
  for (const e of list) {
    if (byGroup.has(e.muscle)) byGroup.get(e.muscle).push(e);
  }
  const out = [];
  for (const muscle of MUSCLE_GROUPS) {
    const items = byGroup.get(muscle);
    if (!items.length) continue;
    items.sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }));
    out.push({ muscle, items });
  }
  return out;
}

// Ultima settimana valida presente nelle weeks (chiave max che matcha il formato).
function latestWeekKey(weeks) {
  const keys = Object.keys(weeks ?? {}).filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k)).sort();
  return keys.length ? keys[keys.length - 1] : null;
}

// Collega una voce di catalogo allo storico delle schede PER NOME.
// usedIn: dove compare; series/lastKg: andamento del top-set della miglior
// corrispondenza (storico più recente). Liste separate: se il nome non combacia
// con nessun esercizio nei plan, fallback vuoto.
export function catalogUsage(blob, name) {
  const target = norm(name);
  const sheets = Array.isArray(blob.sheets) ? blob.sheets : [];
  const usedIn = [];
  const matches = []; // { weeks, day, exId, superset, lastWeek }
  for (const s of sheets) {
    for (const d of (Array.isArray(s.plan) ? s.plan : [])) {
      for (const ex of (Array.isArray(d.exercises) ? d.exercises : [])) {
        if (norm(ex.name) !== target) continue;
        usedIn.push({ sheet: s.name, day: d.title || d.day });
        matches.push({ weeks: s.weeks ?? {}, day: d.day, exId: ex.id,
          superset: !!ex.superset, lastWeek: latestWeekKey(s.weeks) });
      }
    }
  }
  if (!matches.length) return { usedIn: [], series: [], lastKg: null };
  // miglior corrispondenza = quella con la settimana loggata più recente
  const best = matches
    .filter((m) => m.lastWeek)
    .sort((a, b) => (a.lastWeek < b.lastWeek ? 1 : -1))[0];
  if (!best) return { usedIn, series: [], lastKg: null };
  const series = topSetSeries({ weeks: best.weeks }, best.day, best.exId, best.lastWeek);
  const lastKg = series.length ? series[series.length - 1].kg : null;
  return { usedIn, series, lastKg };
}
