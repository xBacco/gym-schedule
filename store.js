// ---- Pure data helpers (testable in Node, used in the browser) ----

// ISO 8601 week key, e.g. "2026-W22".
export function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;           // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);    // shift to Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// Prima chiave settimana ISO libera a partire da `from` (default: oggi), avanzando
// di 7 giorni finché non ne trova una assente in `weeks`. Ritorna sempre una chiave
// nuova nel formato "YYYY-Www" (es. la settimana corrente, o la prossima se occupata).
export function nextFreeWeekKey(weeks, from = new Date()) {
  const d = new Date(from);
  let key = isoWeekKey(d);
  while (weeks && weeks[key]) {
    d.setDate(d.getDate() + 7);
    key = isoWeekKey(d);
  }
  return key;
}

export function emptyData() {
  return { updatedAt: null, weeks: {} };
}

export function ensureWeek(data, weekKey, label) {
  const next = structuredClone(data);
  if (!next.weeks[weekKey]) {
    next.weeks[weekKey] = { label: label || weekKey, entries: {} };
  }
  return next;
}

export function setEntry(data, weekKey, day, exIndex, value, nowIso) {
  const next = structuredClone(data);
  if (!next.weeks[weekKey]) next.weeks[weekKey] = { label: weekKey, entries: {} };
  if (!next.weeks[weekKey].entries[day]) next.weeks[weekKey].entries[day] = {};
  next.weeks[weekKey].entries[day][String(exIndex)] = value;
  // Data reale della sessione (set-if-absent): resta quella della prima serie
  // loggata per quel giorno-scheda. Campo additivo per il calendario.
  if (nowIso) {
    if (!next.weeks[weekKey].dates) next.weeks[weekKey].dates = {};
    if (next.weeks[weekKey].dates[day] == null) {
      next.weeks[weekKey].dates[day] = nowIso.slice(0, 10);
    }
  }
  next.updatedAt = nowIso ?? new Date().toISOString();
  return next;
}

export function getEntry(data, weekKey, day, exIndex) {
  return data?.weeks?.[weekKey]?.entries?.[day]?.[String(exIndex)] ?? "";
}

// ---- Entry per-serie: { sets: [{reps, kg, done}], note }. Migra i formati legacy. ----

function splitVals(str) {
  return String(str ?? "").split("/").map((x) => x.trim()).filter((x) => x !== "");
}

function zipSets(repsStr, kgStr) {
  const reps = splitVals(repsStr);
  const kgs = splitVals(kgStr);
  const n = Math.max(reps.length, kgs.length);
  const sets = [];
  for (let i = 0; i < n; i++) {
    sets.push({
      reps: reps[i] ?? (reps.length > 0 ? reps[reps.length - 1] : ""),
      kg: kgs[i] ?? (kgs.length > 0 ? kgs[kgs.length - 1] : ""),
      done: false,
    });
  }
  return sets;
}

const FEELS = new Set(["easy", "ok", "hard"]);

export function normalizeSet(s) {
  const feel = FEELS.has(s?.feel) ? s.feel : "";
  const raw = Array.isArray(s?.comments) ? s.comments : [];
  const comments = [];
  for (const c of raw) {
    if (typeof c !== "string") continue;
    const t = c.trim();
    if (t && !comments.includes(t)) comments.push(t);
  }
  const failNote = typeof s?.failNote === "string" ? s.failNote : "";
  return { reps: String(s?.reps ?? ""), kg: String(s?.kg ?? ""), done: !!s?.done, feel, warmup: !!s?.warmup, failed: !!s?.failed, failNote, comments };
}

// Toggle immutabile di un commento in una lista: aggiunge se assente, rimuove se presente.
// Trim; ignora stringa vuota; nessun duplicato.
export function toggleComment(comments, text) {
  const arr = Array.isArray(comments) ? comments.slice() : [];
  const t = String(text ?? "").trim();
  if (!t) return arr;
  const i = arr.indexOf(t);
  if (i === -1) { arr.push(t); return arr; }
  arr.splice(i, 1);
  return arr;
}

export function normalizeEntry(v) {
  if (v && typeof v === "object" && Array.isArray(v.sets)) {
    return { sets: v.sets.map(normalizeSet), note: v.note ?? "" };
  }
  if (v && typeof v === "object") {
    return { sets: zipSets(v.reps, v.kg), note: v.note ?? "" };
  }
  if (typeof v === "string" && v.trim()) {
    return { sets: zipSets(v, ""), note: "" };
  }
  return { sets: [], note: "" };
}

export function normalizeSupersetEntry(v) {
  if (v && typeof v === "object" && ("a" in v || "b" in v)) {
    return { a: normalizeEntry(v.a), b: normalizeEntry(v.b), note: v.note ?? "" };
  }
  // Legacy/single entry -> traccia A; la nota resta a livello superset (e dentro A via base).
  const base = normalizeEntry(v);
  return { a: base, b: { sets: [], note: "" }, note: base.note };
}

export function prefillSets(data, weekKey, day, exId) {
  const keys = Object.keys(data?.weeks ?? {})
    .filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k) && k < weekKey)
    .sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    const e = normalizeEntry(getEntry(data, keys[i], day, exId));
    if (e.sets.length) return e.sets.map(({ reps, kg, warmup }) => ({ reps, kg, done: false, warmup: !!warmup }));
  }
  return [];
}

export function platesPerSide(targetKg, { bar = 20, plates = [20, 15, 10, 5, 2.5, 1.25] } = {}) {
  let remaining = (Number(targetKg) - bar) / 2;
  if (!Number.isFinite(remaining) || remaining <= 0) return { perSide: [], leftover: 0 };
  const sorted = [...plates].filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => b - a);
  const perSide = [];
  for (const p of sorted) {
    while (remaining + 1e-9 >= p) { perSide.push(p); remaining -= p; }
  }
  return { perSide, leftover: Math.round(remaining * 100) / 100 };
}

// Peso del bilanciere da usare per un esercizio: exercise.bar se numero finito > 0,
// altrimenti defaultBar. Niente coercizione da stringa (i dati del PLAN sono numeri).
export function exerciseBar(exercise, defaultBar) {
  const b = exercise && exercise.bar;
  return typeof b === "number" && Number.isFinite(b) && b > 0 ? b : defaultBar;
}

// "20, 15, 10, 5, 2.5" -> [20,15,10,5,2.5]. Separatori: virgola o spazi.
// La virgola-decimale all'italiana ("2,5") è gestita: una virgola seguita da
// cifra diventa punto, mentre la virgola separatrice (seguita da spazio) resta.
// Scarta non numerici e valori <= 0; ordina decrescente.
export function parsePlateSet(str) {
  return String(str ?? "")
    .replace(/,(\d)/g, ".$1")
    .split(/[,\s]+/)
    .map((t) => parseFloat(t))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => b - a);
}

// ---- Base64 helpers (UTF-8 safe). btoa/atob + TextEncoder/Decoder exist
//      both in modern browsers and in Node >= 16. ----

export function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---- GitHub Contents API persistence ----

export class ConflictError extends Error {
  constructor(message) { super(message); this.name = "ConflictError"; }
}

export class AuthError extends Error {
  constructor(message) { super(message); this.name = "AuthError"; }
}

export class GitHubStore {
  constructor({ owner, repo, path = "data.json", branch = "main", token = null, fetchImpl = (...args) => fetch(...args) }) {
    this.owner = owner;
    this.repo = repo;
    this.path = path;
    this.branch = branch;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  _url() {
    return `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${this.path}`;
  }

  _headers() {
    const h = { Accept: "application/vnd.github+json" };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  // Returns { data, sha }. On 404, returns { data: emptyData(), sha: null }.
  async load() {
    const res = await this.fetchImpl(`${this._url()}?ref=${this.branch}&t=${Date.now()}`, {
      method: "GET",
      headers: this._headers(),
      cache: "no-store",
    });
    if (res.status === 404) return { data: emptyData(), sha: null };
    if (res.status === 401 || res.status === 403) throw new AuthError("Token non valido o permessi insufficienti");
    if (!res.ok) throw new Error(`GitHub load failed: ${res.status}`);
    const body = await res.json();
    const data = JSON.parse(fromBase64(body.content));
    return { data, sha: body.sha };
  }

  // PUTs the data. Returns the new file sha. Throws ConflictError on 409, AuthError on 401/403.
  async save(data, sha, message) {
    const payload = {
      message: message || `log: ${new Date().toISOString()}`,
      content: toBase64(JSON.stringify(data, null, 2)),
      branch: this.branch,
    };
    if (sha) payload.sha = sha;
    const res = await this.fetchImpl(this._url(), {
      method: "PUT",
      headers: { ...this._headers(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 409) throw new ConflictError("File cambiato sul server (conflitto)");
    if (res.status === 401 || res.status === 403) throw new AuthError("Token non valido o permessi insufficienti");
    if (!res.ok) throw new Error(`GitHub save failed: ${res.status}`);
    const body = await res.json();
    return body.content.sha;
  }
}
