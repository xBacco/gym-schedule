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
      name: "Scheda 1",
      plan: Array.isArray(data.plan) ? structuredClone(data.plan) : [],
      weeks: data.weeks ? structuredClone(data.weeks) : {},
    }],
  };
}
