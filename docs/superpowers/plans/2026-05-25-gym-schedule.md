# gym-schedule Web App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal, single-user workout web app served as a static site on GitHub Pages, that logs carico/reps per week, syncs across devices through a `data.json` file in the repo (written via the GitHub Contents API with a fine-grained token), and includes an auto-starting rest timer.

**Architecture:** Vanilla HTML/CSS/JS, no build step. Pure data/logic modules (`plan.js`, `store.js`, `timer.js`) are unit-tested in Node with the built-in test runner; the browser loads the same ES modules directly. `data.json` in the repo is the database; the browser reads/writes it via `https://api.github.com/repos/xBacco/gym-schedule/contents/data.json`. The token lives only in the browser's `localStorage`, never in the repo.

**Tech Stack:** HTML5, CSS3, JavaScript ES modules, Node's built-in `node:test` + `node:assert` for tests, GitHub Pages for hosting, GitHub Contents REST API for persistence.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json` | `"type":"module"` + `test` script. Node-only; ignored by the browser. |
| `.gitignore` | Ignore `node_modules`, OS junk. |
| `data.json` | The database: `{ updatedAt, weeks }`. Committed with empty initial state. |
| `plan.js` | Static workout plan: 3 days × 7 exercises, each with `restSeconds`. No logic. |
| `store.js` | Pure data helpers (`isoWeekKey`, `emptyData`, `ensureWeek`, `setEntry`, `getEntry`), base64 helpers (`toBase64`, `fromBase64`), and `GitHubStore` (network, injectable `fetchImpl`). |
| `timer.js` | `formatTime`, `remainingSeconds`, and the `RestTimer` class (countdown via end-timestamp). No DOM. |
| `index.html` | Page shell + mount points + `<script type="module" src="./app.js">`. |
| `style.css` | Warm editorial palette, mobile-first. |
| `app.js` | UI: render plan + week selector, wire inputs/blur/timer/save, status indicator, token settings. |
| `tests/store.test.js` | Unit tests for `store.js` pure + base64 + `GitHubStore` (fake fetch). |
| `tests/timer.test.js` | Unit tests for `timer.js` utilities. |

Module boundaries: `plan.js` is data-only; `timer.js` has no data/network deps; `store.js` isolates network behind an injectable `fetchImpl` so it is testable; `app.js` is the only module that touches the DOM and `localStorage`.

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `data.json`
- Create: `README.md`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "gym-schedule",
  "version": "1.0.0",
  "description": "Personal workout web app with cross-device sync and rest timer",
  "type": "module",
  "scripts": {
    "test": "node --test"
  },
  "private": true
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
.DS_Store
Thumbs.db
*.log
```

- [ ] **Step 3: Create `data.json` (initial empty database)**

```json
{
  "updatedAt": null,
  "weeks": {}
}
```

- [ ] **Step 4: Create `README.md` placeholder (filled in Task 9)**

```markdown
# gym-schedule

Personal workout web app. Setup instructions in Task 9 of the plan.
```

- [ ] **Step 5: Commit**

```bash
git add package.json .gitignore data.json README.md
git commit -m "chore: scaffold project structure"
```

---

## Task 2: Workout plan data (`plan.js`)

**Files:**
- Create: `plan.js`
- Test: `tests/plan.test.js`

- [ ] **Step 1: Write the failing test**

`tests/plan.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN } from "../plan.js";

test("PLAN has 3 days A/B/C", () => {
  assert.equal(PLAN.length, 3);
  assert.deepEqual(PLAN.map(d => d.day), ["A", "B", "C"]);
});

test("each day has 7 exercises with required fields", () => {
  for (const day of PLAN) {
    assert.equal(day.exercises.length, 7);
    for (const ex of day.exercises) {
      assert.equal(typeof ex.name, "string");
      assert.equal(typeof ex.setsReps, "string");
      assert.equal(typeof ex.recText, "string");
      assert.equal(typeof ex.restSeconds, "number");
      assert.ok(ex.restSeconds > 0);
      assert.equal(typeof ex.superset, "boolean");
    }
  }
});

test("first exercise of day A is the bench press, 150s rest", () => {
  assert.match(PLAN[0].exercises[0].name, /Panca piana/);
  assert.equal(PLAN[0].exercises[0].restSeconds, 150);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/plan.test.js`
Expected: FAIL — cannot find module `../plan.js`.

- [ ] **Step 3: Implement `plan.js`**

```js
// The workout plan. Static data only — no logic.
// Each exercise: { name, setsReps, recText, restSeconds, superset }
export const PLAN = [
  {
    day: "A",
    title: "Petto + Tricipiti",
    exercises: [
      { name: "Panca piana bilanciere", setsReps: "4 × 6-8", recText: "2-3 min", restSeconds: 150, superset: false },
      { name: "Lento avanti manubri", setsReps: "3 × 8-10", recText: "2 min", restSeconds: 120, superset: false },
      { name: "Croci ai cavi", setsReps: "3 × 12-15", recText: "75 sec", restSeconds: 75, superset: false },
      { name: "Pulldown al cavo alto, presa larga", setsReps: "3 × 10-12", recText: "90 sec", restSeconds: 90, superset: false },
      { name: "Pushdown tricipiti + Curl manubri", setsReps: "3 × 12-15 / 3 × 12-15", recText: "75 sec", restSeconds: 75, superset: true },
      { name: "Polpacci in piedi", setsReps: "3 × 12-15", recText: "60 sec", restSeconds: 60, superset: false },
      { name: "Crunch a terra + Plank", setsReps: "3 × 15-20 / 3 × max", recText: "45 sec", restSeconds: 45, superset: true },
    ],
  },
  {
    day: "B",
    title: "Dorso + Bicipiti + Gambe",
    exercises: [
      { name: "Stacco rumeno", setsReps: "3 × 8-10", recText: "2-3 min", restSeconds: 150, superset: false },
      { name: "Rematore bilanciere", setsReps: "4 × 8-10", recText: "2-3 min", restSeconds: 150, superset: false },
      { name: "Affondi camminata o Goblet squat", setsReps: "3 × 10-12", recText: "90-120 s", restSeconds: 120, superset: false },
      { name: "Panca inclinata manubri", setsReps: "3 × 8-10", recText: "90 sec", restSeconds: 90, superset: false },
      { name: "Curl EZ + Skullcrusher", setsReps: "3 × 8-10 / 3 × 10-12", recText: "75 sec", restSeconds: 75, superset: true },
      { name: "Face pull", setsReps: "3 × 15-20", recText: "60 sec", restSeconds: 60, superset: false },
      { name: "Leg raise + Russian twist", setsReps: "3 × 12-15 / 3 × 20", recText: "45 sec", restSeconds: 45, superset: true },
    ],
  },
  {
    day: "C",
    title: "Spalle + Braccia",
    exercises: [
      { name: "Lento avanti bilanciere", setsReps: "4 × 6-8", recText: "2 min", restSeconds: 120, superset: false },
      { name: "Alzate laterali (manubri o cavo)", setsReps: "3 × 12-15", recText: "60 sec", restSeconds: 60, superset: false },
      { name: "Spinte manubri panca piana (o chest press)", setsReps: "3 × 10-12", recText: "90 sec", restSeconds: 90, superset: false },
      { name: "Rematore al cavo, presa neutra", setsReps: "3 × 10-12", recText: "90 sec", restSeconds: 90, superset: false },
      { name: "Curl EZ + Skullcrusher", setsReps: "3 × 8-10 / 3 × 10-12", recText: "75 sec", restSeconds: 75, superset: true },
      { name: "Curl concentrato + Pushdown", setsReps: "2 × 15 / 2 × 15", recText: "60 sec", restSeconds: 60, superset: true },
      { name: "Crunch inverso + Plank laterale", setsReps: "3 × 15 / 3 × max/lato", recText: "45 sec", restSeconds: 45, superset: true },
    ],
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/plan.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add plan.js tests/plan.test.js
git commit -m "feat: add workout plan data with rest seconds"
```

---

## Task 3: Data helpers in `store.js` (pure functions)

**Files:**
- Create: `store.js`
- Test: `tests/store.test.js`

- [ ] **Step 1: Write the failing test**

`tests/store.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { isoWeekKey, emptyData, ensureWeek, setEntry, getEntry } from "../store.js";

test("isoWeekKey returns ISO year-week", () => {
  assert.equal(isoWeekKey(new Date(2020, 0, 1)), "2020-W01"); // Wed 1 Jan 2020
  assert.equal(isoWeekKey(new Date(2021, 0, 1)), "2020-W53"); // Fri 1 Jan 2021 -> 2020 W53
  assert.equal(isoWeekKey(new Date(2026, 4, 25)), "2026-W22"); // Mon 25 May 2026
});

test("emptyData is the initial database shape", () => {
  assert.deepEqual(emptyData(), { updatedAt: null, weeks: {} });
});

test("ensureWeek adds a week without touching existing ones", () => {
  const d0 = emptyData();
  const d1 = ensureWeek(d0, "2026-W22", "Sett. 1");
  assert.deepEqual(d1.weeks["2026-W22"], { label: "Sett. 1", entries: {} });
  // immutability: original untouched
  assert.deepEqual(d0, { updatedAt: null, weeks: {} });
  // does not overwrite an existing week's entries
  const d2 = setEntry(d1, "2026-W22", "A", 0, "60kg 8/8", "2026-05-25T10:00:00Z");
  const d3 = ensureWeek(d2, "2026-W22", "Sett. 1");
  assert.equal(getEntry(d3, "2026-W22", "A", 0), "60kg 8/8");
});

test("setEntry stores a value and updates updatedAt, immutably", () => {
  const d0 = emptyData();
  const d1 = setEntry(d0, "2026-W22", "A", 0, "60kg 8/8/7", "2026-05-25T10:00:00Z");
  assert.equal(getEntry(d1, "2026-W22", "A", 0), "60kg 8/8/7");
  assert.equal(d1.updatedAt, "2026-05-25T10:00:00Z");
  assert.deepEqual(d0, { updatedAt: null, weeks: {} }); // original untouched
});

test("setEntry merges without clobbering sibling entries", () => {
  let d = emptyData();
  d = setEntry(d, "2026-W22", "A", 0, "panca", "t1");
  d = setEntry(d, "2026-W22", "A", 3, "pulldown", "t2");
  d = setEntry(d, "2026-W22", "B", 0, "stacco", "t3");
  assert.equal(getEntry(d, "2026-W22", "A", 0), "panca");
  assert.equal(getEntry(d, "2026-W22", "A", 3), "pulldown");
  assert.equal(getEntry(d, "2026-W22", "B", 0), "stacco");
});

test("getEntry returns empty string when missing", () => {
  assert.equal(getEntry(emptyData(), "2026-W22", "A", 0), "");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/store.test.js`
Expected: FAIL — cannot find module `../store.js`.

- [ ] **Step 3: Implement the pure helpers in `store.js`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/store.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add store.js tests/store.test.js
git commit -m "feat: add pure data helpers (week key, entries)"
```

---

## Task 4: Base64 helpers in `store.js`

**Files:**
- Modify: `store.js` (append)
- Modify: `tests/store.test.js` (append)

- [ ] **Step 1: Add the failing test (append to `tests/store.test.js`)**

```js
import { toBase64, fromBase64 } from "../store.js";

test("toBase64/fromBase64 round-trip UTF-8 text", () => {
  const original = JSON.stringify({ note: "60kg à è 8/8/7 ×" });
  const encoded = toBase64(original);
  assert.equal(typeof encoded, "string");
  assert.notEqual(encoded, original);
  assert.equal(fromBase64(encoded), original);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/store.test.js`
Expected: FAIL — `toBase64` is not exported.

- [ ] **Step 3: Append base64 helpers to `store.js`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/store.test.js`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add store.js tests/store.test.js
git commit -m "feat: add UTF-8 safe base64 helpers"
```

---

## Task 5: `GitHubStore` network class in `store.js`

**Files:**
- Modify: `store.js` (append)
- Modify: `tests/store.test.js` (append)

- [ ] **Step 1: Add the failing tests (append to `tests/store.test.js`)**

```js
import { GitHubStore, ConflictError } from "../store.js";

// Build a fake fetch that records calls and returns scripted responses.
function fakeResponse({ ok = true, status = 200, body = {} }) {
  return {
    ok,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

test("GitHubStore.load returns parsed data and sha", async () => {
  const remote = { updatedAt: "t1", weeks: { "2026-W22": { label: "S1", entries: {} } } };
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return fakeResponse({ body: { content: toBase64(JSON.stringify(remote)), sha: "abc123" } });
  };
  const store = new GitHubStore({ owner: "x", repo: "r", token: "T", fetchImpl: fakeFetch });
  const { data, sha } = await store.load();
  assert.deepEqual(data, remote);
  assert.equal(sha, "abc123");
  assert.match(calls[0].url, /repos\/x\/r\/contents\/data\.json/);
  assert.equal(calls[0].opts.headers.Authorization, "Bearer T");
});

test("GitHubStore.load returns emptyData and null sha on 404", async () => {
  const fakeFetch = async () => fakeResponse({ ok: false, status: 404, body: { message: "Not Found" } });
  const store = new GitHubStore({ owner: "x", repo: "r", fetchImpl: fakeFetch });
  const { data, sha } = await store.load();
  assert.deepEqual(data, emptyData());
  assert.equal(sha, null);
});

test("GitHubStore.save PUTs base64 content with sha and returns new sha", async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, opts });
    return fakeResponse({ body: { content: { sha: "newsha" } } });
  };
  const store = new GitHubStore({ owner: "x", repo: "r", token: "T", fetchImpl: fakeFetch });
  const data = setEntry(emptyData(), "2026-W22", "A", 0, "60kg", "t1");
  const newSha = await store.save(data, "oldsha", "log: test");
  assert.equal(newSha, "newsha");
  const put = calls[0];
  assert.equal(put.opts.method, "PUT");
  const sent = JSON.parse(put.opts.body);
  assert.equal(sent.sha, "oldsha");
  assert.equal(sent.message, "log: test");
  assert.deepEqual(JSON.parse(fromBase64(sent.content)), data);
});

test("GitHubStore.save throws ConflictError on 409", async () => {
  const fakeFetch = async () => fakeResponse({ ok: false, status: 409, body: { message: "conflict" } });
  const store = new GitHubStore({ owner: "x", repo: "r", token: "T", fetchImpl: fakeFetch });
  await assert.rejects(
    () => store.save(emptyData(), "oldsha", "msg"),
    (err) => err instanceof ConflictError
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/store.test.js`
Expected: FAIL — `GitHubStore` is not exported.

- [ ] **Step 3: Append `GitHubStore` and error classes to `store.js`**

```js
// ---- GitHub Contents API persistence ----

export class ConflictError extends Error {
  constructor(message) { super(message); this.name = "ConflictError"; }
}

export class AuthError extends Error {
  constructor(message) { super(message); this.name = "AuthError"; }
}

export class GitHubStore {
  constructor({ owner, repo, path = "data.json", branch = "main", token = null, fetchImpl = fetch }) {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/store.test.js`
Expected: PASS (11 tests total).

- [ ] **Step 5: Commit**

```bash
git add store.js tests/store.test.js
git commit -m "feat: add GitHubStore for data.json persistence via Contents API"
```

---

## Task 6: Timer utilities + `RestTimer` (`timer.js`)

**Files:**
- Create: `timer.js`
- Test: `tests/timer.test.js`

- [ ] **Step 1: Write the failing test**

`tests/timer.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTime, remainingSeconds } from "../timer.js";

test("formatTime renders m:ss and clamps negatives to 0:00", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(5), "0:05");
  assert.equal(formatTime(60), "1:00");
  assert.equal(formatTime(75), "1:15");
  assert.equal(formatTime(150), "2:30");
  assert.equal(formatTime(-3), "0:00");
});

test("remainingSeconds rounds up and clamps to 0", () => {
  const now = 1_000_000;
  assert.equal(remainingSeconds(now + 90_000, now), 90);
  assert.equal(remainingSeconds(now + 1, now), 1);
  assert.equal(remainingSeconds(now - 5_000, now), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/timer.test.js`
Expected: FAIL — cannot find module `../timer.js`.

- [ ] **Step 3: Implement `timer.js`**

```js
// ---- Pure timer utilities (testable) ----

export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function remainingSeconds(endTimeMs, nowMs) {
  return Math.max(0, Math.ceil((endTimeMs - nowMs) / 1000));
}

// ---- RestTimer: countdown based on an end timestamp (robust to screen lock).
//      DOM/audio side effects are injected via callbacks, so this stays portable. ----

export class RestTimer {
  // onTick(remaining, label), onEnd(label)
  constructor({ onTick = () => {}, onEnd = () => {} } = {}) {
    this.onTick = onTick;
    this.onEnd = onEnd;
    this.endTime = 0;
    this.label = "";
    this.paused = false;
    this.pausedRemaining = 0;
    this._interval = null;
  }

  start(seconds, label = "") {
    this.label = label;
    this.paused = false;
    this.endTime = Date.now() + seconds * 1000;
    this._run();
  }

  addSeconds(delta) {
    if (this.paused) {
      this.pausedRemaining = Math.max(0, this.pausedRemaining + delta);
      this.onTick(this.pausedRemaining, this.label);
    } else if (this._interval) {
      this.endTime = Math.max(Date.now(), this.endTime + delta * 1000);
      this._emit();
    }
  }

  pause() {
    if (!this._interval || this.paused) return;
    this.pausedRemaining = remainingSeconds(this.endTime, Date.now());
    this.paused = true;
    clearInterval(this._interval);
    this._interval = null;
    this.onTick(this.pausedRemaining, this.label);
  }

  resume() {
    if (!this.paused) return;
    this.endTime = Date.now() + this.pausedRemaining * 1000;
    this.paused = false;
    this._run();
  }

  stop() {
    if (this._interval) clearInterval(this._interval);
    this._interval = null;
    this.paused = false;
    this.endTime = 0;
    this.onTick(0, "");
  }

  // Recompute remaining (call on visibilitychange to correct drift).
  sync() {
    if (this._interval && !this.paused) this._emit();
  }

  _run() {
    if (this._interval) clearInterval(this._interval);
    this._emit();
    this._interval = setInterval(() => this._emit(), 250);
  }

  _emit() {
    const remaining = remainingSeconds(this.endTime, Date.now());
    this.onTick(remaining, this.label);
    if (remaining <= 0) {
      clearInterval(this._interval);
      this._interval = null;
      this.onEnd(this.label);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/timer.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS — all tests across `plan`, `store`, `timer` green.

- [ ] **Step 6: Commit**

```bash
git add timer.js tests/timer.test.js
git commit -m "feat: add rest timer utilities and RestTimer class"
```

---

## Task 7: Page shell and styles (`index.html`, `style.css`)

**Files:**
- Create: `index.html`
- Create: `style.css`

- [ ] **Step 1: Create `index.html`**

```html
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta name="theme-color" content="#C45A3B">
  <title>Gym Schedule</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <p class="kicker">Allenamento · Definizione + massa lean</p>
      <h1>Full-body 3× settimana</h1>
      <div class="topbar">
        <select id="weekSelect" aria-label="Settimana"></select>
        <button id="newWeekBtn" class="btn-soft">+ Settimana</button>
        <span id="status" class="status">—</span>
        <button id="settingsBtn" class="btn-icon" aria-label="Impostazioni">⚙</button>
      </div>
    </header>

    <div id="days"></div>

    <dialog id="settingsDialog">
      <form method="dialog" class="settings">
        <h2>Impostazioni</h2>
        <label for="tokenInput">Token GitHub (fine-grained, solo questo repo)</label>
        <input id="tokenInput" type="password" placeholder="github_pat_…" autocomplete="off">
        <p class="hint">Il token resta solo in questo browser. Vedi il README per crearlo.</p>
        <menu>
          <button id="tokenSave" value="save">Salva token</button>
          <button id="tokenClear" value="clear" class="btn-soft">Rimuovi</button>
          <button value="cancel" class="btn-soft">Chiudi</button>
        </menu>
      </form>
    </dialog>
  </div>

  <!-- Rest timer widget -->
  <div id="timerBar" class="timerbar hidden">
    <div class="t-info">
      <span id="timerLabel" class="t-label"></span>
      <span id="timerTime" class="t-time">0:00</span>
    </div>
    <div class="t-controls">
      <button id="tMinus" class="t-btn">−15</button>
      <button id="tToggle" class="t-btn">⏸</button>
      <button id="tPlus" class="t-btn">+15</button>
      <button id="tStop" class="t-btn t-stop">✕</button>
    </div>
  </div>

  <script type="module" src="./app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `style.css`**

```css
:root{
  --cream:#FAF9F5; --paper:#FFFFFF; --ink:#1F1B16; --muted:#6B6358;
  --clay:#C45A3B; --clay-soft:#F3E4DD; --line:#E7E1D6; --chip:#F1EDE4;
  --field:#FFFDF8; --field-line:#D8CFBF; --ok:#2E7D52; --warn:#B5532F;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
html,body{margin:0;padding:0;}
body{font-family:"Segoe UI",-apple-system,"Helvetica Neue",Arial,sans-serif;color:var(--ink);background:var(--cream);font-size:16px;line-height:1.45;padding:0 0 96px;}
.wrap{max-width:600px;margin:0 auto;padding:18px 16px;}
.hero{border-bottom:2px solid var(--clay);padding-bottom:12px;margin-bottom:16px;}
.kicker{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--clay);font-weight:700;margin:0 0 4px;}
h1{font-family:Georgia,"Times New Roman",serif;font-size:24px;font-weight:600;margin:0 0 10px;}
.topbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
#weekSelect{flex:1;min-width:140px;border:1.5px solid var(--field-line);background:var(--field);border-radius:9px;padding:9px 10px;font-size:15px;font-family:inherit;color:var(--ink);}
.btn-soft{background:#fff;color:var(--clay);border:1.5px solid #E3C7BC;border-radius:9px;padding:9px 10px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;}
.btn-icon{background:transparent;border:none;font-size:20px;cursor:pointer;padding:4px;}
.status{font-size:12px;font-weight:700;padding:4px 8px;border-radius:20px;background:var(--chip);color:var(--muted);}
.status.ok{color:var(--ok);}
.status.pending{color:var(--warn);}
.status.error{color:#fff;background:var(--warn);}
.day{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:14px 14px 8px;margin-bottom:16px;}
.day-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;}
.day-tag{background:var(--clay);color:#fff;font-weight:700;font-size:12px;border-radius:7px;padding:4px 10px;letter-spacing:1px;}
.day-title{font-family:Georgia,serif;font-size:16px;font-weight:600;margin:0;}
.ex{border-top:1px solid #F0EBE1;padding:11px 0;}
.ex:first-of-type{border-top:none;}
.ex-top{display:flex;align-items:baseline;gap:8px;}
.ex-n{color:var(--clay);font-weight:700;font-size:14px;min-width:16px;}
.ex-name{font-weight:600;font-size:15px;flex:1;}
.ss{display:inline-block;font-size:10px;letter-spacing:.5px;text-transform:uppercase;color:var(--clay);border:1px solid #E3C7BC;border-radius:5px;padding:1px 6px;margin:0 2px;}
.ex-meta{color:var(--muted);font-size:13px;margin:3px 0 8px 24px;}
.ex-meta b{color:var(--ink);}
.ex-row{display:flex;gap:8px;margin-left:24px;align-items:center;}
.ex-row input{flex:1;border:1.5px solid var(--field-line);background:var(--field);border-radius:9px;padding:10px 12px;font-size:15px;font-family:inherit;color:var(--ink);outline:none;}
.ex-row input:focus{border-color:var(--clay);}
.timer-btn{background:var(--clay-soft);border:1px solid #E3C7BC;border-radius:9px;padding:9px 11px;font-size:15px;cursor:pointer;}
.hidden{display:none !important;}
.timerbar{position:fixed;left:0;right:0;bottom:0;max-width:600px;margin:0 auto;background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;border-radius:14px 14px 0 0;}
.t-info{display:flex;flex-direction:column;}
.t-label{font-size:12px;opacity:.8;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.t-time{font-size:26px;font-weight:700;font-variant-numeric:tabular-nums;}
.t-controls{display:flex;gap:6px;}
.t-btn{background:#fff;color:var(--ink);border:none;border-radius:8px;padding:8px 10px;font-size:14px;font-weight:700;cursor:pointer;}
.t-stop{background:var(--clay);color:#fff;}
dialog{border:none;border-radius:14px;padding:18px;max-width:340px;}
dialog::backdrop{background:rgba(31,27,22,.4);}
.settings h2{font-family:Georgia,serif;margin:0 0 10px;color:var(--clay);}
.settings label{display:block;font-size:13px;font-weight:700;margin-bottom:4px;}
.settings input{width:100%;border:1.5px solid var(--field-line);border-radius:9px;padding:10px;font-size:14px;font-family:inherit;}
.hint{font-size:12px;color:var(--muted);margin:6px 0 12px;}
.settings menu{display:flex;gap:8px;padding:0;margin:0;flex-wrap:wrap;}
.settings menu button{border-radius:9px;padding:9px 12px;font-weight:700;font-family:inherit;border:none;cursor:pointer;background:var(--clay);color:#fff;}
.settings menu button.btn-soft{background:#fff;color:var(--clay);border:1.5px solid #E3C7BC;}
```

- [ ] **Step 3: Commit**

```bash
git add index.html style.css
git commit -m "feat: add page shell and styles"
```

---

## Task 8: App wiring (`app.js`)

**Files:**
- Create: `app.js`

This module touches the DOM, `localStorage`, and the network. It is verified by the smoke test in Task 9 (not unit tests).

- [ ] **Step 1: Implement `app.js`**

```js
import { PLAN } from "./plan.js";
import {
  isoWeekKey, emptyData, ensureWeek, setEntry, getEntry,
  GitHubStore, ConflictError, AuthError,
} from "./store.js";
import { RestTimer, formatTime } from "./timer.js";

const OWNER = "xBacco";
const REPO = "gym-schedule";
const TOKEN_KEY = "gymsched_token";
const PENDING_KEY = "gymsched_pending"; // local buffer of unsynced edits

// ---- App state ----
let data = emptyData();
let sha = null;
let currentWeek = isoWeekKey(new Date());
let store = null;
let saveTimer = null;

// ---- Token + pending buffer (browser only) ----
const getToken = () => localStorage.getItem(TOKEN_KEY) || null;
const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY));
const getPending = () => JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
const setPending = (arr) => localStorage.setItem(PENDING_KEY, JSON.stringify(arr));
function bufferEdit(weekKey, day, idx, value) {
  const p = getPending().filter((e) => !(e.weekKey === weekKey && e.day === day && e.idx === idx));
  p.push({ weekKey, day, idx, value });
  setPending(p);
}
function applyPending(target) {
  let d = target;
  for (const e of getPending()) d = setEntry(d, e.weekKey, e.day, e.idx, e.value, new Date().toISOString());
  return d;
}

// ---- Status indicator ----
function setStatus(text, kind = "") {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

// ---- End-of-rest notification (vibration + WebAudio beep) ----
let audioCtx = null;
function ensureAudio() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}
function beep() {
  try {
    ensureAudio();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.5);
  } catch (_) { /* audio unavailable; ignore */ }
}

// ---- Timer wiring ----
const timer = new RestTimer({
  onTick: (remaining, label) => {
    document.getElementById("timerTime").textContent = formatTime(remaining);
    document.getElementById("timerLabel").textContent = label;
  },
  onEnd: () => {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    beep();
    setTimeout(() => document.getElementById("timerBar").classList.add("hidden"), 1500);
  },
});
function startRest(seconds, label) {
  ensureAudio(); // unlock audio within the user gesture
  document.getElementById("timerBar").classList.remove("hidden");
  document.getElementById("tToggle").textContent = "⏸";
  timer.start(seconds, label);
}

// ---- Rendering ----
function renderWeekSelect() {
  const sel = document.getElementById("weekSelect");
  const keys = Object.keys(data.weeks);
  if (!keys.includes(currentWeek)) keys.push(currentWeek);
  keys.sort();
  sel.replaceChildren();
  for (const k of keys) {
    const opt = document.createElement("option");
    opt.value = k;
    opt.textContent = data.weeks[k]?.label || k;
    if (k === currentWeek) opt.selected = true;
    sel.appendChild(opt);
  }
}

function prevWeekKey() {
  const keys = Object.keys(data.weeks).sort().filter((k) => k < currentWeek);
  return keys.length ? keys[keys.length - 1] : null;
}

function renderDays() {
  const root = document.getElementById("days");
  root.textContent = "";
  const prev = prevWeekKey();
  for (let di = 0; di < PLAN.length; di++) {
    const day = PLAN[di];
    const block = document.createElement("div");
    block.className = "day";

    const head = document.createElement("div");
    head.className = "day-head";
    const tag = document.createElement("span");
    tag.className = "day-tag"; tag.textContent = "GIORNO " + day.day;
    const title = document.createElement("h3");
    title.className = "day-title"; title.textContent = day.title;
    head.append(tag, title);
    block.appendChild(head);

    day.exercises.forEach((ex, ei) => {
      const card = document.createElement("div");
      card.className = "ex";

      const top = document.createElement("div");
      top.className = "ex-top";
      const n = document.createElement("span");
      n.className = "ex-n"; n.textContent = ei + 1;
      const name = document.createElement("span");
      name.className = "ex-name";
      if (ex.superset && ex.name.includes(" + ")) {
        const [a, ...rest] = ex.name.split(" + ");
        name.append(document.createTextNode(a + " "));
        const ss = document.createElement("span");
        ss.className = "ss"; ss.textContent = "superset";
        name.append(ss, document.createTextNode(" + " + rest.join(" + ")));
      } else {
        name.textContent = ex.name;
      }
      top.append(n, name);
      card.appendChild(top);

      const meta = document.createElement("div");
      meta.className = "ex-meta";
      const b = document.createElement("b"); b.textContent = ex.setsReps;
      meta.append(b, document.createTextNode("  ·  rec " + ex.recText));
      card.appendChild(meta);

      const row = document.createElement("div");
      row.className = "ex-row";
      const input = document.createElement("input");
      input.type = "text";
      const prevVal = prev ? getEntry(data, prev, day.day, ei) : "";
      input.placeholder = prevVal ? `prec: ${prevVal}` : "carico / reps — es. 60kg 8/8/7";
      input.value = getEntry(data, currentWeek, day.day, ei);
      input.addEventListener("input", () => onEdit(day.day, ei, input.value));
      input.addEventListener("blur", () => {
        if (input.value.trim()) startRest(ex.restSeconds, ex.name);
      });
      const tBtn = document.createElement("button");
      tBtn.className = "timer-btn"; tBtn.type = "button"; tBtn.textContent = "⏱";
      tBtn.title = "Avvia recupero";
      tBtn.addEventListener("click", () => startRest(ex.restSeconds, ex.name));
      row.append(input, tBtn);
      card.appendChild(row);

      block.appendChild(card);
    });
    root.appendChild(block);
  }
}

// ---- Editing + saving ----
function onEdit(day, idx, value) {
  data = setEntry(data, currentWeek, day, idx, value, new Date().toISOString());
  bufferEdit(currentWeek, day, idx, value);
  setStatus("in attesa ⧗", "pending");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToCloud, 1500);
}

function scheduleSave() {
  clearTimeout(saveTimer);
  setStatus("in attesa ⧗", "pending");
  saveTimer = setTimeout(saveToCloud, 800);
}

async function saveToCloud() {
  if (!store || !getToken()) { setStatus("nessun token ⧗", "pending"); return; }
  setStatus("salvataggio…");
  try {
    sha = await store.save(data, sha, `log: ${currentWeek}`);
    setPending([]);
    setStatus("salvato ✓", "ok");
  } catch (err) {
    if (err instanceof ConflictError) {
      try {
        const remote = await store.load();
        data = applyPending(remote.data);
        sha = remote.sha;
        sha = await store.save(data, sha, `log: ${currentWeek} (merge)`);
        setPending([]);
        setStatus("salvato ✓", "ok");
        renderDays();
      } catch (e2) {
        setStatus("errore ⚠ (riprova)", "error");
      }
    } else if (err instanceof AuthError) {
      setStatus("token non valido ⚠", "error");
    } else {
      setStatus("offline ⧗ (salvato in locale)", "pending");
    }
  }
}

// ---- Week management ----
function changeWeek(key) {
  currentWeek = key;
  data = ensureWeek(data, currentWeek, data.weeks[currentWeek]?.label);
  renderWeekSelect();
  renderDays();
}
function newWeek() {
  const label = prompt("Nome della nuova settimana:", "Settimana");
  if (label === null) return;
  const key = isoWeekKey(new Date());
  let k = key, n = 2;
  while (Object.keys(data.weeks).includes(k) && k !== currentWeek) k = `${key}.${n++}`;
  data = ensureWeek(data, k, label || k);
  changeWeek(k);
  scheduleSave();
}

// ---- Settings dialog ----
function wireSettings() {
  const dlg = document.getElementById("settingsDialog");
  document.getElementById("settingsBtn").addEventListener("click", () => {
    document.getElementById("tokenInput").value = getToken() || "";
    dlg.showModal();
  });
  dlg.addEventListener("close", () => {
    if (dlg.returnValue === "save") {
      setToken(document.getElementById("tokenInput").value.trim() || null);
      initStore();
      saveToCloud();
    } else if (dlg.returnValue === "clear") {
      setToken(null);
      initStore();
      setStatus("sola lettura", "pending");
    }
  });
}

// ---- Timer controls ----
function wireTimerControls() {
  document.getElementById("tMinus").addEventListener("click", () => timer.addSeconds(-15));
  document.getElementById("tPlus").addEventListener("click", () => timer.addSeconds(15));
  document.getElementById("tStop").addEventListener("click", () => timer.stop());
  document.getElementById("tToggle").addEventListener("click", (e) => {
    if (timer.paused) { timer.resume(); e.target.textContent = "⏸"; }
    else { timer.pause(); e.target.textContent = "▶"; }
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) timer.sync(); });
}

// ---- Boot ----
function initStore() {
  store = new GitHubStore({ owner: OWNER, repo: REPO, token: getToken() });
}

async function boot() {
  wireSettings();
  wireTimerControls();
  document.getElementById("weekSelect").addEventListener("change", (e) => changeWeek(e.target.value));
  document.getElementById("newWeekBtn").addEventListener("click", newWeek);
  initStore();
  setStatus("carico…");
  try {
    const loaded = await store.load();
    data = applyPending(loaded.data);
    sha = loaded.sha;
    setStatus(getToken() ? "salvato ✓" : "sola lettura", getToken() ? "ok" : "pending");
  } catch (err) {
    data = applyPending(emptyData());
    setStatus(err instanceof AuthError ? "token non valido ⚠" : "offline ⧗", err instanceof AuthError ? "error" : "pending");
  }
  data = ensureWeek(data, currentWeek);
  renderWeekSelect();
  renderDays();
  if (getPending().length && getToken()) saveToCloud();
}

boot();
```

- [ ] **Step 2: Commit**

```bash
git add app.js
git commit -m "feat: wire UI, editing, sync, week management and timer"
```

---

## Task 9: README with setup + local smoke test

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# gym-schedule

Web app personale per la scheda di allenamento: log carico/reps per settimana,
sincronizzazione PC↔telefono via `data.json` nel repo, timer di recupero automatico.

## Come funziona
- Sito statico su **GitHub Pages**.
- I dati vivono in `data.json`, scritti via **GitHub Contents API** con un token che
  resta solo nel tuo browser.

## Setup (una volta)

### 1. Repo pubblico
Il repo `xBacco/gym-schedule` deve essere **pubblico**.

### 2. Crea un token fine-grained
GitHub → Settings → Developer settings → **Fine-grained tokens** → *Generate new token*:
- **Repository access:** Only select repositories → `gym-schedule`
- **Permissions:** Repository permissions → **Contents: Read and write**
- Genera e copia il token (`github_pat_…`).

### 3. Attiva Pages
Repo → Settings → **Pages** → Source: *Deploy from a branch* → `main` / `/ (root)`.
L'URL sarà `https://xbacco.github.io/gym-schedule/`.

### 4. Inserisci il token
Apri l'app, tocca ⚙ e incolla il token. Resta salvato in quel browser. Ripeti su ogni
dispositivo (PC e telefono).

## Sviluppo locale

```bash
# Test
npm test

# Anteprima locale (serve un server perché usa ES modules)
python -m http.server 8000
# poi apri http://localhost:8000
```
````

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS — all `plan`, `store`, `timer` tests green.

- [ ] **Step 3: Local smoke test**

Run a local server (ES modules don't load over `file://`):

```bash
python -m http.server 8000
```

Open `http://localhost:8000` and verify:
- The 3 days render with 7 exercises each.
- Typing in a field then clicking away (`blur`) shows the timer bar counting down from the exercise's rest time.
- The `−15 / +15 / ⏸ / ✕` controls work.
- Status shows "sola lettura" (no token yet) — expected.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add setup and local development instructions"
```

---

## Task 10: Deploy to GitHub Pages (user-assisted)

These steps need the user's GitHub account; the assistant guides and runs git where possible.

- [ ] **Step 1: Ensure the GitHub repo exists and is public**

On github.com, create `xBacco/gym-schedule` (public) if it does not exist, or switch an existing repo to public (Settings → General → Danger Zone → Change visibility).

- [ ] **Step 2: Connect the local repo and push**

```bash
git remote add origin https://github.com/xBacco/gym-schedule.git
git branch -M main
git push -u origin main
```
(If push asks for credentials, use a GitHub username + a PAT as password, or `git`'s credential helper.)

- [ ] **Step 3: Enable Pages**

Repo → Settings → Pages → Source: `main` / root. Wait for the green build.

- [ ] **Step 4: Create the fine-grained token** (per README step 2).

- [ ] **Step 5: Phone smoke test**

Open `https://xbacco.github.io/gym-schedule/` on the phone, set the token via ⚙, log a value, then open the same URL on PC and confirm the value appears after a refresh. Verify a commit shows up in the repo's history.

---

## Self-Review

**Spec coverage:**
- Stack & static hosting → Tasks 1, 7, 10. ✓
- Sync model (repo as DB via Contents API, token in browser) → Tasks 5, 8, 9. ✓
- Repo structure → File Structure table + Tasks 1-8. ✓
- `data.json` model → Task 1 (initial) + Task 3 (`emptyData`/`setEntry`). ✓
- Plan with `restSeconds` → Task 2. ✓
- Load/save/merge + 409 conflict → Task 5 (`GitHubStore`) + Task 8 (`saveToCloud` retry). ✓
- Week management + prev-week placeholders → Task 8 (`changeWeek`, `newWeek`, `prevWeekKey`, placeholder in `renderDays`). ✓
- Timer auto + manual + vibrate + beep + timestamp robustness → Tasks 6, 8. ✓
- Error handling / status / local buffer → Task 8 (`setStatus`, pending buffer, AuthError/ConflictError paths). ✓
- Testing → Tasks 2-6 (unit) + Task 9 (smoke). ✓
- Security/privacy (public repo, token only in browser) → Task 9 README. ✓
- GitHub prerequisites → Tasks 9, 10. ✓

**Placeholder scan:** No "TBD/TODO/implement later". All code steps contain complete, runnable code.

**Type consistency:** `emptyData`, `ensureWeek`, `setEntry`, `getEntry`, `isoWeekKey`, `toBase64`, `fromBase64`, `GitHubStore` (`load`/`save`), `ConflictError`, `AuthError`, `RestTimer` (`start`/`addSeconds`/`pause`/`resume`/`stop`/`sync`), `formatTime`, `remainingSeconds` — names match across `store.js`, `timer.js`, and `app.js`. `saveToCloud` guards on `getToken()` consistently; `scheduleSave`/`onEdit` both route to `saveToCloud`. ✓
