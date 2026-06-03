// catalog.js
// ---- Catalogo esercizi (puro, testabile in Node). Opera sul blob schema 6:
//      blob.catalog = [{ id, name, muscle, note }]. Liste separate dalle schede,
//      collegate per NOME (vedi catalogUsage in task successivi). ----
import { genId } from "./editor.js";

const norm = (s) => String(s ?? "").trim().toLowerCase();
const clone = (blob) => structuredClone(blob);
const cat = (blob) => (Array.isArray(blob.catalog) ? blob.catalog : []);

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
