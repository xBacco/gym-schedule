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

// ---- Per-exercise rest overrides (browser only) ----
const REST_KEY = "gymsched_rest";
const getRestMap = () => JSON.parse(localStorage.getItem(REST_KEY) || "{}");
function getRest(day, idx, fallback) {
  const v = getRestMap()[`${day}-${idx}`];
  return Number.isFinite(v) ? v : fallback;
}
function setRest(day, idx, seconds) {
  const m = getRestMap();
  m[`${day}-${idx}`] = seconds;
  localStorage.setItem(REST_KEY, JSON.stringify(m));
}

// ---- Entry shape: { kg, reps }. Tolerates legacy string entries. ----
function normalizeEntry(v) {
  if (v && typeof v === "object") return { kg: v.kg ?? "", reps: v.reps ?? "" };
  if (typeof v === "string" && v) return { kg: "", reps: v };
  return { kg: "", reps: "" };
}
function entrySummary(v) {
  const e = normalizeEntry(v);
  if (!e.kg && !e.reps) return "";
  return [e.kg ? e.kg + " kg" : "", e.reps].filter(Boolean).join(" · ");
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
      meta.append(b, document.createTextNode("  ·  rec "));
      const restIn = document.createElement("input");
      restIn.type = "number"; restIn.className = "in-rest";
      restIn.min = "5"; restIn.step = "5";
      restIn.value = getRest(day.day, ei, ex.restSeconds);
      restIn.setAttribute("aria-label", "Secondi di recupero");
      restIn.addEventListener("change", () => {
        let v = parseInt(restIn.value, 10);
        if (!Number.isFinite(v) || v < 5) { v = ex.restSeconds; restIn.value = v; }
        setRest(day.day, ei, v);
      });
      meta.append(restIn, document.createTextNode(" s"));
      const prevSummary = prev ? entrySummary(getEntry(data, prev, day.day, ei)) : "";
      if (prevSummary) {
        const pv = document.createElement("span");
        pv.className = "prevv"; pv.textContent = "  ·  prec: " + prevSummary;
        meta.append(pv);
      }
      card.appendChild(meta);

      const cur = normalizeEntry(getEntry(data, currentWeek, day.day, ei));
      const row = document.createElement("div");
      row.className = "ex-row";

      const kg = document.createElement("input");
      kg.type = "text"; kg.inputMode = "decimal"; kg.className = "in-kg";
      kg.placeholder = "kg"; kg.value = cur.kg;
      kg.setAttribute("aria-label", "Carico in kg");

      const reps = document.createElement("input");
      reps.type = "text"; reps.inputMode = "numeric"; reps.className = "in-reps";
      reps.placeholder = "reps — es. 8/8/7"; reps.value = cur.reps;
      reps.setAttribute("aria-label", "Ripetizioni");

      const commit = () => onEdit(day.day, ei, { kg: kg.value.trim(), reps: reps.value.trim() });
      kg.addEventListener("input", commit);
      reps.addEventListener("input", commit);
      reps.addEventListener("blur", () => {
        if (kg.value.trim() || reps.value.trim()) startRest(getRest(day.day, ei, ex.restSeconds), ex.name);
      });

      const tBtn = document.createElement("button");
      tBtn.className = "timer-btn"; tBtn.type = "button"; tBtn.textContent = "⏱";
      tBtn.title = "Avvia recupero";
      tBtn.addEventListener("click", () => startRest(getRest(day.day, ei, ex.restSeconds), ex.name));
      row.append(kg, reps, tBtn);
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
  document.getElementById("tStop").addEventListener("click", () => {
    timer.stop();
    document.getElementById("timerBar").classList.add("hidden");
  });
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
