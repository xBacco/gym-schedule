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
