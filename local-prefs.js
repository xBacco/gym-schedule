// local-prefs.js — wrapper su localStorage per le preferenze "solo browser":
// buffer di edit non sincronizzati, override di recupero per esercizio,
// impostazioni del calcolatore dischi, volume timer, commenti veloci.
// Nessuno stato condiviso via ctx: getter/setter puri su localStorage.
import { parsePlateSet, setEntry } from "./store.js";

export const PENDING_KEY = "gymsched_pending"; // local buffer of unsynced edits

// ---- Pending buffer (browser only) ----
export const getPending = () => JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
export const setPending = (arr) => localStorage.setItem(PENDING_KEY, JSON.stringify(arr));
export function bufferEdit(weekKey, day, idx, value) {
  const p = getPending().filter((e) => !(e.weekKey === weekKey && e.day === day && e.idx === idx));
  p.push({ weekKey, day, idx, value });
  setPending(p);
}
export function applyPending(target) {
  let d = target;
  for (const e of getPending()) d = setEntry(d, e.weekKey, e.day, e.idx, e.value, new Date().toISOString());
  return d;
}

// ---- Per-exercise rest overrides (browser only) ----
const REST_KEY = "gymsched_rest";
const getRestMap = () => JSON.parse(localStorage.getItem(REST_KEY) || "{}");
export function getRest(day, idx, fallback) {
  const v = getRestMap()[`${day}-${idx}`];
  return Number.isFinite(v) ? v : fallback;
}
export function setRest(day, idx, seconds) {
  const m = getRestMap();
  m[`${day}-${idx}`] = seconds;
  localStorage.setItem(REST_KEY, JSON.stringify(m));
}

// ---- Impostazioni calcolatore dischi (browser only) ----
export const BAR_KEY = "gymsched_bar";
export const PLATES_KEY = "gymsched_plates";
export const getBar = () => { const n = parseFloat(localStorage.getItem(BAR_KEY)); return Number.isFinite(n) && n > 0 ? n : 20; };
export const getPlateSet = () => { const v = parsePlateSet(localStorage.getItem(PLATES_KEY) || ""); return v.length ? v : [20, 15, 10, 5, 2.5, 1.25]; };
export const NOTIFY_KEY = "gymsched_notify";
export function notifyOn() {
  return localStorage.getItem(NOTIFY_KEY) === "1"
    && "Notification" in window && Notification.permission === "granted";
}

// Volume dei suoni timer: 0–40 (%), default 10. 0 = muto (resta la vibrazione).
const TIMERVOL_KEY = "gymsched_timervol";
export function getTimerVol() {
  const n = parseInt(localStorage.getItem(TIMERVOL_KEY), 10);
  return Number.isFinite(n) && n >= 0 && n <= 40 ? n : 10;
}
export function setTimerVol(v) { localStorage.setItem(TIMERVOL_KEY, String(v)); }

// ---- Commenti veloci (preset, browser only) ----
const QC_KEY = "gymsched_quickcomments";
const QC_DEFAULT = ["alzare 1kg", "diminuire leggermente", "ultima reps forzata/sporca"];
export function getQuickComments() {
  try { const v = JSON.parse(localStorage.getItem(QC_KEY)); if (Array.isArray(v)) return v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()); } catch (_) {}
  return QC_DEFAULT.slice();
}
export function setQuickComments(arr) { localStorage.setItem(QC_KEY, JSON.stringify(arr)); }
