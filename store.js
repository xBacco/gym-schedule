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
  next.updatedAt = nowIso ?? new Date().toISOString();
  return next;
}

export function getEntry(data, weekKey, day, exIndex) {
  return data?.weeks?.[weekKey]?.entries?.[day]?.[String(exIndex)] ?? "";
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
