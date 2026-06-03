// sheets.js
// ---- Modello multi-scheda (puro, testabile in Node). Opera su BLOB NORMALIZZATI:
//      { schema:6, updatedAt, activeSheetId, sheets:[{ id, name, plan, weeks }] }.
//      hydrate/dehydrate traducono da/verso la forma in-memory usata da app.js. ----
import { genId } from "./editor.js";

export const SHEETS_SCHEMA = 6;

// Nome di default "Scheda N", progressivo sul numero di schede esistenti.
// L'utente può rinominare in qualsiasi momento (renameSheet).
export function defaultSheetName(sheets) {
  return `Scheda ${(Array.isArray(sheets) ? sheets.length : 0) + 1}`;
}

// Coercizione a blob normalizzato schema 6. Idempotente. Gestisce:
// - legacy schema <6: avvolge { plan, weeks } in un'unica "Scheda 1";
// - già schema 6: clona, ripara activeSheetId orfano, garantisce sheets non vuoto;
// - null/undefined: una Scheda 1 vuota.
export function toSheetsBlob(input) {
  const data = input || {};
  // schema >= 6 (non ===): un eventuale schema futuro mantiene i suoi sheets,
  // ri-etichettato a 6, senza perdere dati. Niente downgrade distruttivo.
  if (data.schema >= SHEETS_SCHEMA && Array.isArray(data.sheets)) {
    const out = structuredClone(data);
    if (!out.sheets.length) {
      out.sheets = [{ id: genId([]), name: defaultSheetName([]), plan: [], weeks: {} }];
    }
    const ids = out.sheets.map((s) => s.id);
    if (!ids.includes(out.activeSheetId)) out.activeSheetId = out.sheets[0].id;
    out.schema = SHEETS_SCHEMA;
    return out;
  }
  const id = genId([]);
  return {
    schema: SHEETS_SCHEMA,
    updatedAt: data.updatedAt ?? null,
    activeSheetId: id,
    sheets: [{
      id,
      name: defaultSheetName([]),
      plan: Array.isArray(data.plan) ? structuredClone(data.plan) : [],
      weeks: data.weeks ? structuredClone(data.weeks) : {},
    }],
  };
}

// Scheda attiva di un blob normalizzato (fallback: prima scheda).
export function activeSheet(blob) {
  const sheets = blob?.sheets ?? [];
  return sheets.find((s) => s.id === blob.activeSheetId) ?? sheets[0] ?? null;
}

// Blob normalizzato → forma in-memory: plan/weeks della scheda attiva proiettati
// al top-level, così tutto il codice esistente che legge data.plan/data.weeks
// funziona invariato. sheets[]/activeSheetId restano disponibili per il gestore.
export function hydrate(input) {
  const blob = toSheetsBlob(input);
  const act = activeSheet(blob);
  const mem = {
    schema: blob.schema,
    updatedAt: blob.updatedAt ?? null,
    activeSheetId: blob.activeSheetId,
    sheets: blob.sheets,
    plan: structuredClone(act.plan ?? []),
    weeks: structuredClone(act.weeks ?? {}),
  };
  if (blob.catalog !== undefined) mem.catalog = structuredClone(blob.catalog);
  return mem;
}

// Forma in-memory → blob normalizzato: i plan/weeks top-level (la scheda attiva)
// vengono riscritti nella relativa entry di sheets[], poi plan/weeks top-level
// vengono rimossi. updatedAt propagato.
export function dehydrate(data) {
  const base = toSheetsBlob(data); // garantisce sheets[]/activeSheetId/schema
  const out = {
    schema: SHEETS_SCHEMA,
    updatedAt: data.updatedAt ?? base.updatedAt ?? null,
    activeSheetId: data.activeSheetId ?? base.activeSheetId,
    sheets: structuredClone(data.sheets ?? base.sheets),
  };
  const rawCatalog = data.catalog ?? base.catalog;
  if (rawCatalog !== undefined) out.catalog = structuredClone(rawCatalog);
  const ids = out.sheets.map((s) => s.id);
  if (!ids.includes(out.activeSheetId)) out.activeSheetId = out.sheets[0].id;
  const act = out.sheets.find((s) => s.id === out.activeSheetId);
  act.plan = structuredClone(data.plan ?? []);
  act.weeks = structuredClone(data.weeks ?? {});
  return out;
}

// Crea una nuova scheda e la rende attiva. duplicateActive=true copia il plan
// della scheda attiva (storico SEMPRE vuoto); altrimenti scheda completamente vuota.
export function addSheet(blob, { duplicateActive = false } = {}) {
  const out = toSheetsBlob(blob);
  const id = genId(out.sheets.map((s) => s.id));
  const src = duplicateActive ? activeSheet(out) : null;
  out.sheets.push({
    id,
    name: defaultSheetName(out.sheets),
    plan: src ? structuredClone(src.plan ?? []) : [],
    weeks: {},
  });
  out.activeSheetId = id;
  return out;
}

// Rinomina per id. Trim; nome vuoto → invariato.
export function renameSheet(blob, id, name) {
  const out = toSheetsBlob(blob);
  const t = String(name ?? "").trim();
  if (!t) return out;
  const s = out.sheets.find((x) => x.id === id);
  if (s) s.name = t;
  return out;
}

// Elimina per id. Rifiuta (no-op) se è l'ultima scheda. Se elimina l'attiva,
// attiva la prima rimasta.
export function deleteSheet(blob, id) {
  const out = toSheetsBlob(blob);
  if (out.sheets.length <= 1) return out;
  const idx = out.sheets.findIndex((s) => s.id === id);
  if (idx === -1) return out;
  out.sheets.splice(idx, 1);
  if (out.activeSheetId === id) out.activeSheetId = out.sheets[0].id;
  return out;
}

// Cambia la scheda attiva. id ignoto → no-op.
export function setActiveSheet(blob, id) {
  const out = toSheetsBlob(blob);
  if (out.sheets.some((s) => s.id === id)) out.activeSheetId = id;
  return out;
}

// Riepilogo per la UI del gestore: una riga per scheda con conteggi e ultima data
// loggata. lastDate = max tra tutte le weeks[*].dates[*] della scheda (o null).
export function sheetSummaries(blob) {
  const b = toSheetsBlob(blob);
  return b.sheets.map((s) => {
    const plan = Array.isArray(s.plan) ? s.plan : [];
    const exercises = plan.reduce((n, d) => n + (Array.isArray(d.exercises) ? d.exercises.length : 0), 0);
    const weekKeys = Object.keys(s.weeks ?? {});
    let lastDate = null;
    for (const wk of weekKeys) {
      const dates = s.weeks[wk]?.dates ?? {};
      for (const day of Object.keys(dates)) {
        const dt = dates[day];
        if (dt && (lastDate === null || dt > lastDate)) lastDate = dt;
      }
    }
    return {
      id: s.id,
      name: s.name,
      active: s.id === b.activeSheetId,
      days: plan.length,
      exercises,
      weeks: weekKeys.length,
      lastDate,
    };
  });
}
