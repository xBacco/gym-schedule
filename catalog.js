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
  Petto: ["Panca piana bilanciere", "Spinte inclinata manubri", "Croci ai cavi in piedi", "Dips", "Pectoral machine", "Chest press", "Panca declinata", "Push-up"],
  Dorso: ["Stacco da terra", "Stacco rumeno", "Rematore bilanciere", "Rematore manubrio", "Pulldown presa larga", "Lat machine presa stretta", "Pullover", "Pulley basso", "Trazioni", "Rematore al cavo", "Hyperextension"],
  Spalle: ["Lento avanti bilanciere", "Lento avanti manubri", "Alzate laterali", "Alzate posteriori", "Face pull", "Arnold press", "Tirate al mento", "Scrollate"],
  Bicipiti: ["Curl bilanciere", "Curl manubri", "Curl alla Scott", "Curl concentrato", "Hammer curl", "Curl ai cavi", "Curl EZ"],
  Tricipiti: ["Pushdown ai cavi", "French press", "Skullcrusher", "Pushdown corda", "Estensioni sopra la testa", "Kickback", "Dips alle parallele"],
  Gambe: ["Squat bilanciere", "Pressa", "Leg extension", "Leg curl", "Affondi manubri", "Hack squat", "Bulgarian split squat", "Goblet squat", "Stacco sumo", "Adductor machine"],
  Polpacci: ["Calf in piedi", "Calf da seduto", "Calf alla pressa", "Donkey calf"],
  Core: ["Crunch a terra", "Plank", "Russian twist", "Leg raise", "Crunch inverso", "Plank laterale", "Ab wheel", "Hanging leg raise", "Mountain climber"],
};

// Secondari del seed (solo le voci dove ha senso; assente = []). Gli avambracci
// non hanno gruppo → i curl restano senza secondari.
const SEED_SECONDARY = {
  "Panca piana bilanciere": ["Spalle", "Tricipiti"],
  "Spinte inclinata manubri": ["Spalle", "Tricipiti"],
  "Croci ai cavi in piedi": ["Spalle"],
  "Dips": ["Tricipiti", "Spalle"],
  "Chest press": ["Spalle", "Tricipiti"],
  "Panca declinata": ["Tricipiti"],
  "Push-up": ["Spalle", "Tricipiti", "Core"],
  "Stacco da terra": ["Gambe", "Core"],
  "Stacco rumeno": ["Gambe"],
  "Rematore bilanciere": ["Bicipiti"],
  "Rematore manubrio": ["Bicipiti"],
  "Pulldown presa larga": ["Bicipiti"],
  "Lat machine presa stretta": ["Bicipiti"],
  "Pullover": ["Petto", "Tricipiti"],
  "Pulley basso": ["Bicipiti"],
  "Trazioni": ["Bicipiti"],
  "Rematore al cavo": ["Bicipiti"],
  "Hyperextension": ["Gambe"],
  "Lento avanti bilanciere": ["Tricipiti"],
  "Lento avanti manubri": ["Tricipiti"],
  "Alzate posteriori": ["Dorso"],
  "Face pull": ["Dorso"],
  "Arnold press": ["Tricipiti"],
  "Tirate al mento": ["Dorso"],
  "Scrollate": ["Dorso"],
  "Dips alle parallele": ["Petto", "Spalle"],
  "Squat bilanciere": ["Core"],
  "Affondi manubri": ["Core"],
  "Bulgarian split squat": ["Core"],
  "Goblet squat": ["Core"],
  "Stacco sumo": ["Dorso"],
  "Plank": ["Spalle"],
  "Ab wheel": ["Dorso", "Spalle"],
  "Mountain climber": ["Spalle"],
};

// Lista seed deterministica: id `seed-${i}` con i contatore 0-based globale.
// Niente Date/random → stabile. Ogni chiamata costruisce voci nuove.
export function seedCatalog() {
  const out = [];
  let i = 0;
  for (const [muscle, names] of Object.entries(SEED_BY_GROUP)) {
    for (const name of names) {
      out.push({ id: `seed-${i}`, name, muscle, note: "",
        secondary: SEED_SECONDARY[name] ?? [] });
      i += 1;
    }
  }
  return out;
}

// Backfill one-shot per i cataloghi esistenti (seminati PRIMA dei secondari):
// riempie `secondary` SOLO dove è undefined (mai sopra una scelta utente),
// usando la tabella del seed per nome (case-insensitive); non-seed → [].
// Stesso riferimento se nulla da fare → niente save inutile (pattern seed).
export function backfillCatalogSecondaries(blob) {
  const list = cat(blob);
  if (!list.length || list.every((e) => e.secondary !== undefined)) return blob;
  const byName = new Map(Object.entries(SEED_SECONDARY).map(([k, v]) => [norm(k), v]));
  const out = clone(blob);
  out.catalog = cat(out).map((e) => e.secondary !== undefined ? e :
    { ...e, secondary: cleanSecondary(byName.get(norm(e.name)) ?? [], e.muscle) });
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

// Secondari validi: dedup, solo gruppi noti, mai il primario.
const cleanSecondary = (secondary, muscle) =>
  [...new Set((Array.isArray(secondary) ? secondary : [])
    .filter((g) => MUSCLE_GROUPS.includes(g) && g !== muscle))];

export function addCatalogEntry(blob, { name, muscle, note = "", secondary = [] }) {
  const n = String(name ?? "").trim();
  if (!n) return blob;
  if (catalogHasDup(blob, n, muscle)) return blob;
  const out = clone(blob);
  const id = genId(cat(out).map((e) => e.id));
  out.catalog = [...cat(out), { id, name: n, muscle, note: String(note ?? "").trim(),
    secondary: cleanSecondary(secondary, muscle) }];
  return out;
}

export function renameCatalogEntry(blob, id, { name, muscle, secondary }) {
  const n = String(name ?? "").trim();
  if (!n) return blob;
  if (catalogHasDup(blob, n, muscle, id)) return blob;
  const out = clone(blob);
  out.catalog = cat(out).map((e) => {
    if (e.id !== id) return e;
    const next = { ...e, name: n, muscle };
    // secondary esplicito → aggiornato; implicito → conservato ma ripulito
    // (il nuovo primario non può restare tra i secondari).
    next.secondary = cleanSecondary(secondary !== undefined ? secondary : e.secondary, muscle);
    return next;
  });
  return out;
}

export function deleteCatalogEntry(blob, id) {
  const out = clone(blob);
  out.catalog = cat(out).filter((e) => e.id !== id);
  return out;
}

// Migrazione one-shot di un nome esercizio: rinomina nel catalogo E in tutte le
// schede (match case-insensitive + trim). Gli id restano intatti → lo storico
// log resta agganciato. Ritorna lo STESSO riferimento se non c'è nulla da
// rinominare (confronto per riferimento a monte → niente save inutile).
export function migrateExerciseName(blob, from, to) {
  const f = norm(from);
  const hitCat = cat(blob).some((e) => norm(e.name) === f);
  const sheets = Array.isArray(blob.sheets) ? blob.sheets : [];
  const hitPlan = sheets.some((s) => (Array.isArray(s.plan) ? s.plan : []).some(
    (d) => (Array.isArray(d.exercises) ? d.exercises : []).some((ex) => norm(ex.name) === f)));
  if (!hitCat && !hitPlan) return blob;
  const out = clone(blob);
  out.catalog = cat(out).map((e) => (norm(e.name) === f ? { ...e, name: to } : e));
  for (const s of (Array.isArray(out.sheets) ? out.sheets : [])) {
    for (const d of (Array.isArray(s.plan) ? s.plan : [])) {
      for (const ex of (Array.isArray(d.exercises) ? d.exercises : [])) {
        if (norm(ex.name) === f) ex.name = to;
      }
    }
  }
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
  const matches = []; // { weeks, day, exId, lastWeek }
  for (const s of sheets) {
    for (const d of (Array.isArray(s.plan) ? s.plan : [])) {
      for (const ex of (Array.isArray(d.exercises) ? d.exercises : [])) {
        if (norm(ex.name) !== target) continue;
        usedIn.push({ sheet: s.name, day: d.title || d.day });
        matches.push({ weeks: s.weeks ?? {}, day: d.day, exId: ex.id,
          lastWeek: latestWeekKey(s.weeks) });
      }
    }
  }
  if (!matches.length) return { usedIn: [], series: [], lastKg: null };
  // miglior corrispondenza = quella con la settimana loggata più recente;
  // a parità di lastWeek vince la prima incontrata (O(n) stabile, deterministico).
  const best = matches
    .filter((m) => m.lastWeek)
    .reduce((acc, m) => (acc && acc.lastWeek >= m.lastWeek ? acc : m), null);
  if (!best) return { usedIn, series: [], lastKg: null };
  // v1: anche per esercizi superset usiamo la traccia normale (track null).
  const series = topSetSeries({ weeks: best.weeks }, best.day, best.exId, best.lastWeek);
  const lastKg = series.length ? series[series.length - 1].kg : null;
  return { usedIn, series, lastKg };
}
