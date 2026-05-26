import { PLAN } from "./plan.js";
import {
  isoWeekKey, emptyData, ensureWeek, setEntry, getEntry,
  normalizeEntry, normalizeSupersetEntry, prefillSets, platesPerSide, parsePlateSet,
  GitHubStore, ConflictError, AuthError,
} from "./store.js";
import {
  parseTarget, activeExerciseIndex, activeSetIndex, isEntryComplete, bestKg, progressionDelta,
  withSet, withoutSet, withSupersetSet, withNote, previousNote,
  previousSetInSession, previousWeekSet,
} from "./session.js";
import { RestTimer, formatTime } from "./timer.js";
import { ScreenWakeLock } from "./wakelock.js";

const OWNER = "xBacco";
const REPO = "gym-schedule";
const TOKEN_KEY = "gymsched_token";
const PENDING_KEY = "gymsched_pending"; // local buffer of unsynced edits

// ---- App state ----
let data = emptyData();
let sha = null;
let currentWeek = isoWeekKey(new Date());
let currentDay = "A";
let focusIndex = 0;          // esercizio in focus nel giorno corrente
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

// ---- Impostazioni calcolatore dischi (browser only) ----
const BAR_KEY = "gymsched_bar";
const PLATES_KEY = "gymsched_plates";
const getBar = () => { const n = parseFloat(localStorage.getItem(BAR_KEY)); return Number.isFinite(n) && n > 0 ? n : 20; };
const getPlateSet = () => { const v = parsePlateSet(localStorage.getItem(PLATES_KEY) || ""); return v.length ? v : [20, 15, 10, 5, 2.5, 1.25]; };

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
const wakeLock = new ScreenWakeLock();
function startRest(seconds, label) {
  ensureAudio(); // unlock audio within the user gesture
  wakeLock.enable();
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

const dayPlan = () => PLAN.find((d) => d.day === currentDay) || PLAN[0];

function weekLabel(key) {
  const m = String(key).match(/W(\d+)/i);
  return m ? "SETT. " + m[1] : String(data.weeks[key]?.label || key);
}

function renderHeader() {
  const dp = dayPlan();
  document.getElementById("kickDay").textContent = currentDay;
  document.getElementById("kickWeek").textContent = weekLabel(currentWeek);
  document.getElementById("dayTitle").textContent = dp.title;
  for (const b of document.querySelectorAll("#dayTabs button")) {
    b.classList.toggle("on", b.dataset.day === currentDay);
  }
}

function isComplete(idx) {
  const ex = dayPlan().exercises[idx];
  return isEntryComplete(getEntry(data, currentWeek, currentDay, idx), ex);
}

function renderProgress() {
  const dp = dayPlan();
  const bar = document.getElementById("progBar");
  bar.textContent = "";
  dp.exercises.forEach((ex, i) => {
    const seg = document.createElement("span");
    seg.className = "seg";
    if (i === focusIndex) seg.classList.add("cur");
    else if (isComplete(i)) seg.classList.add("done");
    bar.appendChild(seg);
  });
  const lbl = document.createElement("span");
  lbl.className = "lbl";
  lbl.textContent = `${String(focusIndex + 1).padStart(2, "0")}/${String(dp.exercises.length).padStart(2, "0")}`;
  bar.appendChild(lbl);
}

function renderUpNext() {
  const dp = dayPlan();
  document.getElementById("upnextLabel").textContent =
    `— prossimi · ${dp.exercises.length - 1} esercizi —`;
  const root = document.getElementById("upnext");
  root.textContent = "";
  dp.exercises.forEach((ex, i) => {
    if (i === focusIndex) return;
    const row = document.createElement("div");
    row.className = "nrow" + (isComplete(i) ? " done" : "");
    row.addEventListener("click", () => { focusIndex = i; render(); window.scrollTo({ top: 0, behavior: "smooth" }); });

    const id = document.createElement("span");
    id.className = "id"; id.textContent = String(i + 1).padStart(2, "0");

    const mid = document.createElement("div");
    const nm = document.createElement("div");
    nm.className = "nm"; nm.textContent = ex.name;
    if (ex.superset) { const b = document.createElement("span"); b.className = "ssbadge"; b.textContent = "superset"; nm.appendChild(b); }
    const sub = document.createElement("div");
    sub.className = "sub"; sub.textContent = `${ex.setsReps} · rec ${getRest(currentDay, i, ex.restSeconds)}″`;
    mid.append(nm, sub);

    const right = document.createElement("div");
    right.className = "right";
    const best = document.createElement("div");
    best.className = "best";
    const bl = document.createElement("div");
    bl.className = "bl";
    if (ex.superset) { best.textContent = "A·B"; bl.textContent = "2 tracce"; }
    else { const bk = bestKg(data, currentDay, i); best.textContent = bk === null ? "—" : bk + " kg"; bl.textContent = "best"; }
    right.append(best, bl);

    row.append(id, mid, right);
    root.appendChild(row);
  });
}

// Tap = un passo; tenuto premuto = ripetizione che accelera. step() muta e ridipinge il valore.
function bindHold(el, step) {
  let toRepeat = null, repeat = null;
  const fire = () => step();
  const start = (e) => {
    e.preventDefault();
    fire();
    toRepeat = setTimeout(() => { repeat = setInterval(fire, 80); }, 350);
  };
  const stop = () => { clearTimeout(toRepeat); clearInterval(repeat); toRepeat = repeat = null; };
  el.addEventListener("pointerdown", start);
  el.addEventListener("pointerup", stop);
  el.addEventListener("pointerleave", stop);
  el.addEventListener("pointercancel", stop);
}

// Bozza della serie corrente (non salvata finché non si preme "Serie fatta").
let draft = { kg: "", reps: "" };

function repsLow(repsStr) {
  const m = String(repsStr).match(/\d+/);
  return m ? m[0] : "";
}

const RPE_OPTS = [["easy", "facile"], ["ok", "giusta"], ["hard", "dura"]];
const RPE_CYCLE = ["", "easy", "ok", "hard"];
function nextFeel(current) {
  return RPE_CYCLE[(RPE_CYCLE.indexOf(current) + 1) % RPE_CYCLE.length];
}
const RPE_LABEL = Object.fromEntries(RPE_OPTS); // {easy:"facile", ok:"giusta", hard:"dura"}

// Barra a 3 pulsanti per il "feel" della serie corrente. `current` = feel attuale ("" se nessuno).
// onPick(feel) riceve "" quando si ri-tocca il tag già attivo (toggle off).
function buildRpeBar(current, onPick) {
  const bar = document.createElement("div");
  bar.className = "rpebar";
  for (const [val, label] of RPE_OPTS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rb " + val + (current === val ? " on" : "");
    b.textContent = label;
    b.addEventListener("click", () => onPick(current === val ? "" : val));
    bar.appendChild(b);
  }
  return bar;
}

// Fino a due chip: "↑ serie sopra" (stessa sessione) e "↶ scorsa Wxx" (settimana precedente).
// inSession/prevWeek = {reps,kg[,week]} o null. onPick({reps,kg}) precompila lo stepper.
function buildRepeatChips(inSession, prevWeek, onPick) {
  if (!inSession && !prevWeek) return null;
  const row = document.createElement("div");
  row.className = "repeats";
  const make = (cls, label, val) => {
    const c = document.createElement("div");
    c.className = cls ? `rchip ${cls}` : "rchip";
    const l = document.createElement("div"); l.className = "rl"; l.textContent = label;
    const rv = document.createElement("div"); rv.className = "rv";
    rv.textContent = `${val.reps || "—"} × ${val.kg || "—"}`;
    c.append(l, rv);
    c.addEventListener("click", () => onPick({ reps: val.reps, kg: val.kg }));
    row.appendChild(c);
  };
  if (inSession) make("", "↑ serie sopra", inSession);
  if (prevWeek) {
    const wk = prevWeek.week ? prevWeek.week.split("-").pop() : "scorsa";
    make("scorsa", `↶ ${wk}`, prevWeek);
  }
  return row;
}

// Costruisce il blocco di editing per una serie. `state` = {kg, reps} mutato in place.
// prev = {reps, kg} della volta scorsa per quella serie (o null). Ritorna l'elemento.
function buildEditBlock(label, state, prev) {
  const block = document.createElement("div");
  block.className = "editblock";

  const lab = document.createElement("div");
  lab.className = "editlabel"; lab.textContent = label;
  block.appendChild(lab);

  const stepper = document.createElement("div");
  stepper.className = "stepper";
  const minus = document.createElement("span"); minus.className = "mb"; minus.textContent = "−0.5";
  const valWrap = document.createElement("span"); valWrap.className = "val";
  const num = document.createElement("span"); num.className = "num";
  const unit = document.createElement("span"); unit.className = "u"; unit.textContent = " kg";
  valWrap.append(num, unit);
  const plus = document.createElement("span"); plus.className = "mb"; plus.textContent = "+0.5";
  stepper.append(minus, valWrap, plus);
  block.appendChild(stepper);

  const platesLine = document.createElement("div");
  platesLine.className = "plates";
  block.appendChild(platesLine);
  const renderPlates = () => {
    const n = parseFloat(String(state.kg).replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) { platesLine.textContent = ""; return; }
    const { perSide, leftover } = platesPerSide(n, { bar: getBar(), plates: getPlateSet() });
    if (!perSide.length) { platesLine.textContent = `per lato: — (≤ bilanciere ${getBar()} kg)`; return; }
    platesLine.textContent = `per lato: ${perSide.join(" + ")}` + (leftover > 0 ? `  (+${leftover} scoperto)` : "");
  };

  const renderKg = () => {
    const n = parseFloat(String(state.kg).replace(",", "."));
    num.textContent = Number.isFinite(n) ? n.toFixed(1) : "—";
    renderPlates();
  };
  const stepKg = (delta) => {
    const n = parseFloat(String(state.kg).replace(",", "."));
    const base = Number.isFinite(n) ? n : 0;
    state.kg = String(Math.max(0, Math.round((base + delta) * 100) / 100));
    renderKg();
  };
  renderKg();
  bindHold(minus, () => stepKg(-0.5));
  bindHold(plus, () => stepKg(0.5));

  if (prev && (prev.kg || prev.reps)) {
    const pf = document.createElement("div");
    pf.className = "prefill"; pf.textContent = "↳ precompilato dalla volta scorsa · aggiusta col +/−";
    block.appendChild(pf);
  }

  const reprow = document.createElement("div");
  reprow.className = "reprow";
  const repstep = document.createElement("div");
  repstep.className = "repstep";
  const rdec = document.createElement("span"); rdec.className = "rmb"; rdec.textContent = "−";
  const rc = document.createElement("div"); rc.className = "rc";
  const rv = document.createElement("div"); rv.className = "rv";
  const rl = document.createElement("div"); rl.className = "l"; rl.textContent = "Ripetizioni";
  rc.append(rv, rl);
  const rinc = document.createElement("span"); rinc.className = "rmb"; rinc.textContent = "+";
  repstep.append(rdec, rc, rinc);
  reprow.appendChild(repstep);

  const renderReps = () => { rv.textContent = state.reps === "" ? "—" : String(state.reps); };
  const stepReps = (delta) => {
    const n = parseInt(state.reps, 10);
    const base = Number.isFinite(n) ? n : 0;
    state.reps = String(Math.max(0, base + delta));
    renderReps();
  };
  renderReps();
  bindHold(rdec, () => stepReps(-1));
  bindHold(rinc, () => stepReps(1));

  const chip = document.createElement("div");
  chip.className = "chip prevbest";
  const cv = document.createElement("div"); cv.className = "rv";
  cv.textContent = prev && (prev.reps || prev.kg) ? `${prev.reps || "—"}×${prev.kg || "—"}` : "—";
  const cl = document.createElement("div"); cl.className = "l"; cl.textContent = "la volta scorsa";
  chip.append(cv, cl);
  reprow.appendChild(chip);
  block.appendChild(reprow);

  return block;
}

// Campo nota per esercizio (persistente tra le settimane). Mostra la nota della
// settimana corrente; se vuota, suggerisce in placeholder quella precedente.
function buildNoteField(superset) {
  const v = getEntry(data, currentWeek, currentDay, focusIndex);
  const e = superset ? normalizeSupersetEntry(v) : normalizeEntry(v);
  const prev = previousNote(data, currentDay, focusIndex, currentWeek, superset);

  const wrap = document.createElement("div");
  wrap.className = "noteblock";
  const id = `note-${currentDay}-${focusIndex}`;
  const lab = document.createElement("label");
  lab.className = "notelabel"; lab.textContent = "Nota"; lab.htmlFor = id;
  const ta = document.createElement("textarea");
  ta.id = id; ta.className = "note"; ta.rows = 1;
  ta.placeholder = prev ? `↳ ${prev}` : "presa, set-up, sensazioni…";
  ta.value = e.note || "";
  ta.addEventListener("change", () => {
    const cur = getEntry(data, currentWeek, currentDay, focusIndex);
    data = setEntry(data, currentWeek, currentDay, focusIndex, withNote(cur, ta.value.trim(), superset), new Date().toISOString());
    persist();
  });
  wrap.append(lab, ta);
  return wrap;
}

function setRow(i, set, prev, isCurrent, onRemove, onEditSet, onFeel) {
  const row = document.createElement("div");
  row.className = "srow" + (isCurrent ? " cur" : "");
  const idx = document.createElement("span"); idx.className = "i"; idx.textContent = String(i + 1);
  const v = document.createElement("span"); v.className = "v";
  if (set.reps || set.kg) {
    v.append(document.createTextNode(set.reps || "—"));
    const x = document.createElement("span"); x.className = "x"; x.textContent = " × ";
    const u = document.createElement("span"); u.className = "u"; u.textContent = " kg";
    v.append(x, document.createTextNode(set.kg || "—"), u);
  } else {
    const x = document.createElement("span"); x.className = "x"; x.textContent = " × ";
    v.append(document.createTextNode("—"), x, document.createTextNode("—"));
  }
  row.append(idx, v);

  if (set.done && onEditSet) {
    v.addEventListener("click", () => {
      const reps = prompt("Ripetizioni:", set.reps);
      if (reps === null) return;
      const kg = prompt("Carico (kg):", set.kg);
      if (kg === null) return;
      onEditSet({ reps: reps.trim(), kg: kg.trim() });
    });
  }

  const delta = prev ? progressionDelta(set.kg, prev.kg) : null;
  if (set.done && delta !== null && delta > 0) {
    const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = `▲ +${delta}`;
    row.appendChild(tag);
  } else if (set.done && delta !== null && delta < 0) {
    const tag = document.createElement("span"); tag.className = "tag down"; tag.textContent = `▼ ${delta}`;
    row.appendChild(tag);
  } else if (set.done) {
    const chk = document.createElement("span"); chk.className = "chk"; chk.textContent = "✓";
    if (!set.feel) chk.style.marginLeft = "auto";
    row.appendChild(chk);
  } else if (isCurrent) {
    const tag = document.createElement("span"); tag.className = "tag"; tag.textContent = "in corso"; tag.style.marginLeft = "auto";
    row.appendChild(tag);
  }
  if (set.done && set.feel && onFeel) {
    const fl = document.createElement("span");
    fl.className = "rpe " + set.feel;
    fl.textContent = RPE_LABEL[set.feel] ?? "giusta";
    fl.title = "Tocca per cambiare";
    fl.addEventListener("click", (e) => { e.stopPropagation(); onFeel(); });
    row.appendChild(fl);
  }
  if (onRemove) {
    const rm = document.createElement("span"); rm.className = "rm"; rm.textContent = "✕";
    rm.addEventListener("click", (e) => { e.stopPropagation(); onRemove(); });
    row.appendChild(rm);
  }
  return row;
}

// Bufferizza l'entry corrente del focus e schedula il salvataggio cloud.
function persist() {
  const value = getEntry(data, currentWeek, currentDay, focusIndex);
  bufferEdit(currentWeek, currentDay, focusIndex, value);
  setStatus("in attesa ⧗", "pending");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToCloud, 1500);
}

function renderFocusNormal(ex) {
  const root = document.getElementById("focus");
  const v = getEntry(data, currentWeek, currentDay, focusIndex);
  const entry = normalizeEntry(v);
  const tgt = parseTarget(ex.setsReps, false);
  const prev = prefillSets(data, currentWeek, currentDay, focusIndex); // [{reps,kg,done:false}]
  const curIdx = activeSetIndex(entry.sets);

  draft = {
    kg: prev[curIdx]?.kg ?? "",
    reps: prev[curIdx]?.reps ?? repsLow(tgt.reps),
  };

  const card = document.createElement("div");
  card.className = "focus";

  const head = document.createElement("div");
  head.className = "exhead";
  const exn = document.createElement("div");
  exn.className = "exn";
  const id = document.createElement("span"); id.className = "id"; id.textContent = String(focusIndex + 1).padStart(2, "0");
  exn.append(id, document.createTextNode(ex.name));
  const tg = document.createElement("div");
  tg.className = "tgt"; tg.textContent = `obj ${tgt.sets}×${tgt.reps}`;
  head.append(exn, tg);
  card.appendChild(head);

  const setsBox = document.createElement("div");
  setsBox.className = "sets";
  const total = Math.max(entry.sets.length, tgt.sets, curIdx + 1);
  for (let i = 0; i < total; i++) {
    const set = entry.sets[i] || { reps: "", kg: "", done: false };
    const isCurrent = i === curIdx;
    const canRemove = i < entry.sets.length && entry.sets.length > 0;
    setsBox.appendChild(setRow(i, set, prev[i] || null, isCurrent, canRemove ? () => {
      data = setEntry(data, currentWeek, currentDay, focusIndex, withoutSet(v, i), new Date().toISOString());
      persist(); render();
    } : null, (patch) => {
      data = setEntry(data, currentWeek, currentDay, focusIndex, withSet(v, i, { ...patch, done: true }), new Date().toISOString());
      persist(); render();
    }, set.done ? () => {
      const next = nextFeel(set.feel);
      data = setEntry(data, currentWeek, currentDay, focusIndex, withSet(v, i, { feel: next }), new Date().toISOString());
      persist(); render();
    } : null));
  }
  card.appendChild(setsBox);

  card.appendChild(buildEditBlock(`Serie ${curIdx + 1} — carico · step 0.5 kg`, draft, prev[curIdx] || null));

  card.appendChild(buildRpeBar(entry.sets[curIdx]?.feel ?? "", (feel) => {
    data = setEntry(data, currentWeek, currentDay, focusIndex,
      withSet(v, curIdx, { ...draft, feel }), new Date().toISOString());
    persist(); render();
  }));

  const repInSession = previousSetInSession(v, curIdx);
  const repPrevWeek = previousWeekSet(data, currentDay, focusIndex, currentWeek, curIdx);
  const repChips = buildRepeatChips(repInSession, repPrevWeek, ({ reps, kg }) => {
    draft.reps = reps; draft.kg = kg;
    render();
  });
  if (repChips) card.appendChild(repChips);

  const dots = document.createElement("div");
  dots.className = "dots";
  for (let i = 0; i < total; i++) {
    const d = document.createElement("span");
    d.className = "dt" + (i < curIdx ? " on" : i === curIdx ? " cur" : "");
    dots.appendChild(d);
  }
  const add = document.createElement("button");
  add.className = "addset"; add.textContent = "+ serie";
  add.addEventListener("click", () => {
    data = setEntry(data, currentWeek, currentDay, focusIndex, withSet(v, entry.sets.length, { reps: "", kg: "", done: false }), new Date().toISOString());
    persist(); render();
  });
  dots.appendChild(add);
  card.appendChild(dots);

  const cta = document.createElement("button");
  cta.className = "cta"; cta.textContent = "Serie fatta · avvia recupero ▸";
  cta.addEventListener("click", () => {
    data = setEntry(data, currentWeek, currentDay, focusIndex,
      withSet(v, curIdx, { reps: draft.reps, kg: draft.kg, done: true, feel: entry.sets[curIdx]?.feel ?? "" }), new Date().toISOString());
    persist();
    startRest(getRest(currentDay, focusIndex, ex.restSeconds), ex.name);
    if (isComplete(focusIndex)) focusIndex = activeExerciseIndex(data, currentWeek, currentDay, dayPlan());
    render();
  });
  card.appendChild(cta);
  card.appendChild(buildNoteField(false));

  root.appendChild(card);
}

// Bozze separate per traccia A e B della serie corrente del superset.
let draftA = { kg: "", reps: "" };
let draftB = { kg: "", reps: "" };

function trackBlock(trackKey, trackName, trackEntry, tgtTrack, prevSets, state) {
  const wrap = document.createElement("div");
  wrap.className = "track";

  const h = document.createElement("div");
  h.className = "track-h";
  const tA = document.createElement("span"); tA.className = "tA"; tA.textContent = trackKey.toUpperCase();
  const nm = document.createElement("span"); nm.className = "tnm"; nm.textContent = trackName;
  const tt = document.createElement("span"); tt.className = "ttgt"; tt.textContent = tgtTrack.reps;
  h.append(tA, nm, tt);
  wrap.appendChild(h);

  const curIdx = activeSetIndex(trackEntry.sets);
  state.kg = prevSets[curIdx]?.kg ?? "";
  state.reps = prevSets[curIdx]?.reps ?? repsLow(tgtTrack.reps);

  const setsBox = document.createElement("div");
  setsBox.className = "sets";
  const total = Math.max(trackEntry.sets.length, tgtTrack.sets, curIdx + 1);
  for (let i = 0; i < total; i++) {
    const set = trackEntry.sets[i] || { reps: "", kg: "", done: false };
    setsBox.appendChild(setRow(i, set, prevSets[i] || null, i === curIdx, null, (patch) => {
      const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, focusIndex), trackKey, i, { ...patch, done: true });
      data = setEntry(data, currentWeek, currentDay, focusIndex, nv, new Date().toISOString());
      persist(); render();
    }, set.done ? () => {
      const next = nextFeel(set.feel);
      const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, focusIndex), trackKey, i, { feel: next });
      data = setEntry(data, currentWeek, currentDay, focusIndex, nv, new Date().toISOString());
      persist(); render();
    } : null));
  }
  wrap.appendChild(setsBox);

  wrap.appendChild(buildEditBlock(`Serie ${curIdx + 1} ${trackKey.toUpperCase()} — step 0.5 kg`, state, prevSets[curIdx] || null));

  wrap.appendChild(buildRpeBar(trackEntry.sets[curIdx]?.feel ?? "", (feel) => {
    const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, focusIndex), trackKey, curIdx, { ...state, feel });
    data = setEntry(data, currentWeek, currentDay, focusIndex, nv, new Date().toISOString());
    persist(); render();
  }));
  const inSess = previousSetInSession(trackEntry, curIdx);
  const prevWk = previousWeekSet(data, currentDay, focusIndex, currentWeek, curIdx, trackKey);
  const chips = buildRepeatChips(inSess, prevWk, ({ reps, kg }) => { state.reps = reps; state.kg = kg; render(); });
  if (chips) wrap.appendChild(chips);
  return { wrap, curIdx };
}

function renderFocusSuperset(ex) {
  const root = document.getElementById("focus");
  const v = getEntry(data, currentWeek, currentDay, focusIndex);
  const e = normalizeSupersetEntry(v);
  const tgt = parseTarget(ex.setsReps, true);
  const [nameA, nameB] = ex.name.includes(" + ") ? ex.name.split(" + ") : [ex.name, ex.name];

  const prev = previousSupersetSets(currentWeek, currentDay, focusIndex);

  const card = document.createElement("div");
  card.className = "focus";

  const head = document.createElement("div");
  head.className = "exhead";
  const exn = document.createElement("div");
  exn.className = "exn";
  const id = document.createElement("span"); id.className = "id"; id.textContent = String(focusIndex + 1).padStart(2, "0");
  exn.append(id, document.createTextNode(ex.name));
  const badge = document.createElement("span"); badge.className = "ssbadge"; badge.textContent = "superset";
  exn.appendChild(badge);
  head.appendChild(exn);
  card.appendChild(head);

  const a = trackBlock("a", nameA.trim(), e.a, tgt.a, prev.a, draftA);
  const b = trackBlock("b", nameB.trim(), e.b, tgt.b, prev.b, draftB);
  card.append(a.wrap, b.wrap);

  const cta = document.createElement("button");
  cta.className = "cta"; cta.textContent = "Serie fatta (A+B) · avvia recupero ▸";
  cta.addEventListener("click", () => {
    let nv = withSupersetSet(v, "a", a.curIdx, { reps: draftA.reps, kg: draftA.kg, done: true, feel: e.a.sets[a.curIdx]?.feel ?? "" });
    nv = withSupersetSet(nv, "b", b.curIdx, { reps: draftB.reps, kg: draftB.kg, done: true, feel: e.b.sets[b.curIdx]?.feel ?? "" });
    data = setEntry(data, currentWeek, currentDay, focusIndex, nv, new Date().toISOString());
    persist();
    startRest(getRest(currentDay, focusIndex, ex.restSeconds), ex.name);
    if (isComplete(focusIndex)) focusIndex = activeExerciseIndex(data, currentWeek, currentDay, dayPlan());
    render();
  });
  card.appendChild(cta);
  card.appendChild(buildNoteField(true));

  root.appendChild(card);
}

// Sets della settimana loggata più recente, per entrambe le tracce ({a:[...], b:[...]}).
function previousSupersetSets(weekKey, day, idx) {
  const keys = Object.keys(data?.weeks ?? {})
    .filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k) && k < weekKey).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    const e = normalizeSupersetEntry(getEntry(data, keys[i], day, idx));
    if (e.a.sets.length || e.b.sets.length) {
      return {
        a: e.a.sets.map(({ reps, kg }) => ({ reps, kg })),
        b: e.b.sets.map(({ reps, kg }) => ({ reps, kg })),
      };
    }
  }
  return { a: [], b: [] };
}

function renderFocus() {
  const root = document.getElementById("focus");
  root.textContent = "";
  const ex = dayPlan().exercises[focusIndex];
  if (!ex) return;
  if (ex.superset) renderFocusSuperset(ex);
  else renderFocusNormal(ex);
}

function render() {
  renderHeader();
  renderProgress();
  renderFocus();
  renderUpNext();
}

// ---- Editing + saving ----
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
        render();
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

// Flush best-effort quando la sessione viene messa via (tab nascosta o pagina
// chiusa): salva subito i pending invece di aspettare il debounce. §9.2.
function flushPending() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (getPending().length && getToken() && store) saveToCloud().catch(() => {}); // best-effort; errori già gestiti dentro saveToCloud
}

// ---- Week management ----
function changeWeek(key) {
  currentWeek = key;
  data = ensureWeek(data, currentWeek, data.weeks[currentWeek]?.label);
  focusIndex = activeExerciseIndex(data, currentWeek, currentDay, dayPlan());
  renderWeekSelect();
  render();
}
function changeDay(day) {
  currentDay = day;
  focusIndex = activeExerciseIndex(data, currentWeek, currentDay, dayPlan());
  render();
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
    document.getElementById("barInput").value = getBar();
    document.getElementById("platesInput").value = getPlateSet().join(", ");
    dlg.showModal();
  });
  dlg.addEventListener("close", () => {
    if (dlg.returnValue === "save") {
      setToken(document.getElementById("tokenInput").value.trim() || null);
      localStorage.setItem(BAR_KEY, String(parseFloat(document.getElementById("barInput").value) || 20));
      localStorage.setItem(PLATES_KEY, document.getElementById("platesInput").value);
      initStore();
      saveToCloud();
      render(); // ridipinge il calcolatore col nuovo set
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
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { timer.sync(); wakeLock.onVisible(); }
  });
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
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushPending(); });
  window.addEventListener("pagehide", flushPending);
  for (const b of document.querySelectorAll("#dayTabs button")) {
    b.addEventListener("click", () => changeDay(b.dataset.day));
  }
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
  focusIndex = activeExerciseIndex(data, currentWeek, currentDay, dayPlan());
  renderWeekSelect();
  render();
  wakeLock.enable();
  if (getPending().length && getToken()) saveToCloud();
}

boot();

// PWA: registra il service worker (best-effort, solo se supportato).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => { /* SW non disponibile */ });
  });
}
