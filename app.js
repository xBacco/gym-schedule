import { PLAN } from "./plan.js";
import {
  isoWeekKey, emptyData, ensureWeek, setEntry, getEntry,
  normalizeEntry, normalizeSupersetEntry, prefillSets, platesPerSide, parsePlateSet,
  GitHubStore, ConflictError, AuthError, toggleComment,
} from "./store.js";
import {
  parseTarget, activeSetIndex, isEntryComplete, bestKg, progressionDelta,
  withSet, withoutSet, withSupersetSet, withoutSupersetSet, withNote, previousNote,
  previousSetInSession, previousWeekSet,
  sessionVolume, exerciseTrend,
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
let openIndex = null;        // esercizio aperto nel focus a schermo intero (null = nessuno)
let supersetTab = "a";       // sotto-tab attivo nel focus di un superset
let store = null;
let saveTimer = null;

// L'overlay dell'esercizio è registrato come voce di history, così la gesture
// "indietro" del telefono (swipe dal bordo / tasto back) chiude l'esercizio
// invece di uscire dall'app. open → pushState; chiusura in-app → history.back()
// (che fa scattare popstate, dove avviene la chiusura vera).
function openFocus(i) {
  openIndex = i;
  supersetTab = "a";
  history.pushState({ gymFocus: true }, "");
  render();
}
function closeFocus() {
  if (openIndex === null) return;
  hideFeelAsk();
  if (history.state && history.state.gymFocus) history.back(); // → popstate chiude
  else { openIndex = null; render(); }
}

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

// ---- Commenti veloci (preset, browser only) ----
const QC_KEY = "gymsched_quickcomments";
const QC_DEFAULT = ["alzare 1kg", "diminuire leggermente", "ultima reps forzata/sporca"];
function getQuickComments() {
  try { const v = JSON.parse(localStorage.getItem(QC_KEY)); if (Array.isArray(v)) return v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()); } catch (_) {}
  return QC_DEFAULT.slice();
}
function setQuickComments(arr) { localStorage.setItem(QC_KEY, JSON.stringify(arr)); }

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
    hideFeelAsk();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    beep();
    setTimeout(() => {
      document.getElementById("timerBar").classList.add("hidden");
      document.body.classList.remove("timer-on");
    }, 1500);
  },
});
const wakeLock = new ScreenWakeLock();
function startRest(seconds, label) {
  ensureAudio(); // unlock audio within the user gesture
  wakeLock.enable();
  document.body.classList.add("timer-on");
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
    if (i === openIndex) seg.classList.add("cur");
    else if (isComplete(i)) seg.classList.add("done");
    bar.appendChild(seg);
  });
  const lbl = document.createElement("span");
  lbl.className = "lbl";
  const total = String(dp.exercises.length).padStart(2, "0");
  const left = openIndex === null
    ? String(dp.exercises.filter((ex, i) => isComplete(i)).length).padStart(2, "0")
    : String(openIndex + 1).padStart(2, "0");
  lbl.textContent = `${left}/${total}`;
  bar.appendChild(lbl);
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

// Riga di chip commenti per la serie corrente. `selected` = array commenti già scelti.
function buildQuickCommentChips(selected, onToggle, onWrite) {
  const wrap = document.createElement("div"); wrap.className = "chips";
  const presets = getQuickComments();
  const extras = selected.filter((s) => !presets.includes(s));
  for (const text of [...presets, ...extras]) {
    const c = document.createElement("span");
    c.className = "chip" + (selected.includes(text) ? " on" : "");
    c.textContent = text;
    c.addEventListener("click", () => onToggle(text));
    wrap.appendChild(c);
  }
  const w = document.createElement("span"); w.className = "chip write"; w.textContent = "+ scrivi";
  w.addEventListener("click", onWrite);
  wrap.appendChild(w);
  return wrap;
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

function fmtKg(n) { return Math.round(n).toLocaleString("it-IT"); }

// Riga volume di sessione con delta % vs stessa giornata della settimana precedente.
function buildVolumeRow(vol, prevVol) {
  const row = document.createElement("div");
  row.className = "volcard";
  const l = document.createElement("span"); l.className = "vl"; l.textContent = "Volume sessione";
  const right = document.createElement("div"); right.className = "vright";
  const v = document.createElement("span"); v.className = "vv"; v.textContent = `${fmtKg(vol)} kg`;
  right.appendChild(v);
  if (prevVol > 0) {
    const sub = document.createElement("span"); sub.className = "vsub";
    const pct = Math.round(((vol - prevVol) / prevVol) * 100);
    const p = document.createElement("span");
    p.className = pct >= 0 ? "acc" : "neg";
    p.textContent = `${pct >= 0 ? "+" : ""}${pct}%`;
    sub.appendChild(p);
    sub.appendChild(document.createTextNode(` · sett. scorsa ${fmtKg(prevVol)} kg`));
    right.appendChild(sub);
  }
  row.append(l, right);
  return row;
}

// Riga mini-trend: "W20 67.5 · W21 70 · W22 72.5" (ultima evidenziata). null se vuoto.
function buildTrendRow(trend, weekKey) {
  if (!trend.length) return null;
  const row = document.createElement("div");
  row.className = "trend";
  for (const { week, kg } of trend) {
    const cell = document.createElement("span");
    if (week === weekKey) cell.className = "cur";
    const w = document.createElement("span"); w.className = "tw"; w.textContent = week.split("-").pop();
    const k = document.createElement("span"); k.className = "tk"; k.textContent = String(kg);
    cell.append(w, k);
    row.appendChild(cell);
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

  return { block, refresh: () => { renderKg(); renderReps(); } };
}

// Stepper compatto per il popup serie: muta state[field] in place.
// step < 1 ⇒ campo kg (1 decimale, " kg"); altrimenti reps (intero).
function buildMiniStepper(label, state, field, step) {
  const row = document.createElement("div"); row.className = "mini";
  const lab = document.createElement("span"); lab.className = "lab"; lab.textContent = label;
  const dec = document.createElement("button"); dec.type = "button"; dec.className = "b"; dec.textContent = "−";
  const num = document.createElement("span"); num.className = "num";
  const inc = document.createElement("button"); inc.type = "button"; inc.className = "b"; inc.textContent = "+";
  const isKg = step < 1;
  const paint = () => {
    const n = parseFloat(String(state[field]).replace(",", "."));
    if (!Number.isFinite(n)) { num.textContent = "—"; return; }
    num.textContent = "";
    num.appendChild(document.createTextNode(isKg ? n.toFixed(1) : String(Math.round(n))));
    if (isKg) { const u = document.createElement("span"); u.className = "u"; u.textContent = " kg"; num.appendChild(u); }
  };
  const stepBy = (d) => {
    const n = parseFloat(String(state[field]).replace(",", "."));
    const base = Number.isFinite(n) ? n : 0;
    state[field] = String(Math.max(0, Math.round((base + d) * 100) / 100));
    paint();
  };
  bindHold(dec, () => stepBy(-step));
  bindHold(inc, () => stepBy(step));
  paint();
  row.append(lab, dec, num, inc);
  return row;
}

// Stato del popup serie (una sola istanza riusata). I callback sono cablati una
// volta in wireSetDialog; openSetDialog riempie stato + callback e mostra.
let setDlgState = null, setDlgCbs = null, setDlgAction = null;

// opts: { title, reps, kg, feel, onApply(reps,kg,feel), onUndo(), onDelete() }
function openSetDialog(opts) {
  const dlg = document.getElementById("setDialog");
  setDlgCbs = opts;
  setDlgState = { reps: String(opts.reps ?? ""), kg: String(opts.kg ?? ""), feel: opts.feel || "" };
  setDlgAction = null;
  document.getElementById("setDlgTitle").textContent = opts.title;

  const rpeBox = document.getElementById("setDlgRpe");
  const repaintRpe = () => {
    if (!setDlgState) return;
    rpeBox.replaceChildren(buildRpeBar(setDlgState.feel, (f) => { setDlgState.feel = f; repaintRpe(); }));
  };
  repaintRpe();

  document.getElementById("setDlgEdit").replaceChildren(
    buildMiniStepper("reps", setDlgState, "reps", 1),
    buildMiniStepper("kg", setDlgState, "kg", 0.5),
  );
  dlg.showModal();
}

function wireSetDialog() {
  const dlg = document.getElementById("setDialog");
  document.getElementById("setDlgUndo").addEventListener("click", () => { setDlgAction = "undo"; dlg.close(); });
  document.getElementById("setDlgDelete").addEventListener("click", () => { setDlgAction = "delete"; dlg.close(); });
  document.getElementById("setDlgClose").addEventListener("click", () => { setDlgAction = "cancel"; dlg.close(); });
  // tap sullo sfondo = chiudi applicando i valori correnti
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); setDlgAction = "cancel"; dlg.close(); });
  dlg.addEventListener("close", () => {
    if (!setDlgCbs) return;
    const { onApply = () => {}, onUndo = () => {}, onDelete = () => {} } = setDlgCbs;
    const a = setDlgAction; setDlgAction = null;
    if (a === "undo") onUndo();
    else if (a === "delete") onDelete();
    else if (a !== "cancel") onApply(setDlgState.reps, setDlgState.kg, setDlgState.feel);
    setDlgCbs = null; setDlgState = null;
  });
}

// Sensazione chiesta dopo la conferma, durante il recupero. lastDone descrive la
// serie appena conclusa: { idx, superset:false, setIndex } oppure
// { idx, superset:true, aIdx, bIdx } (il superset rate entrambe le tracce).
let lastDone = null;

function showFeelAsk(info) {
  lastDone = info;
  const n = info.superset ? info.aIdx : info.setIndex;
  document.getElementById("feelAskN").textContent = String(n + 1);
  const bar = buildRpeBar("", (feel) => {
    if (!lastDone) return;
    if (!feel) { hideFeelAsk(); return; }
    let v = getEntry(data, currentWeek, currentDay, lastDone.idx);
    let nv;
    if (lastDone.superset) {
      nv = withSupersetSet(v, "a", lastDone.aIdx, { feel });
      nv = withSupersetSet(nv, "b", lastDone.bIdx, { feel });
    } else {
      nv = withSet(v, lastDone.setIndex, { feel });
    }
    data = setEntry(data, currentWeek, currentDay, lastDone.idx, nv, new Date().toISOString());
    persist(lastDone.idx);
    hideFeelAsk();
    render();
  });
  document.getElementById("feelAskBar").replaceChildren(bar);
  document.getElementById("feelAsk").classList.remove("hidden");
}

function hideFeelAsk() {
  document.getElementById("feelAsk").classList.add("hidden");
  lastDone = null;
}

// Campo nota per esercizio (persistente tra le settimane). Mostra la nota della
// settimana corrente; se vuota, suggerisce in placeholder quella precedente.
function buildNoteField(superset, idx) {
  const v = getEntry(data, currentWeek, currentDay, idx);
  const e = superset ? normalizeSupersetEntry(v) : normalizeEntry(v);
  const prev = previousNote(data, currentDay, idx, currentWeek, superset);

  const wrap = document.createElement("div");
  wrap.className = "noteblock";
  const id = `note-${currentDay}-${idx}`;
  const lab = document.createElement("label");
  lab.className = "notelabel"; lab.textContent = "Nota"; lab.htmlFor = id;
  const ta = document.createElement("textarea");
  ta.id = id; ta.className = "note"; ta.rows = 1;
  ta.placeholder = prev ? `↳ ${prev}` : "presa, set-up, sensazioni…";
  ta.value = e.note || "";
  ta.addEventListener("change", () => {
    const cur = getEntry(data, currentWeek, currentDay, idx);
    data = setEntry(data, currentWeek, currentDay, idx, withNote(cur, ta.value.trim(), superset), new Date().toISOString());
    persist(idx);
  });
  wrap.append(lab, ta);
  return wrap;
}

function setRow(i, set, prev, isCurrent, onRemove, onOpen) {
  const row = document.createElement("div");
  row.className = "srow" + (isCurrent ? " cur" : "") + (set.warmup ? " warm" : "");
  const idx = document.createElement("span"); idx.className = "i"; idx.textContent = set.warmup ? "W" : String(i + 1);
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

  if (set.done && onOpen) {
    v.addEventListener("click", () => onOpen());
  }

  if (set.warmup && set.done) {
    const b = document.createElement("span"); b.className = "wbadge"; b.textContent = "RISCALD.";
    row.appendChild(b);
  } else {
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
  }
  if (set.done && !set.warmup && set.feel) {
    const fl = document.createElement("span");
    fl.className = "rpe " + set.feel;
    fl.textContent = RPE_LABEL[set.feel] ?? "giusta";
    fl.title = "Tocca per modificare";
    if (onOpen) fl.addEventListener("click", (e) => { e.stopPropagation(); onOpen(); });
    row.appendChild(fl);
  }
  if (onRemove && !set.done) {
    const rm = document.createElement("span"); rm.className = "rm"; rm.textContent = "✕";
    rm.addEventListener("click", (e) => { e.stopPropagation(); onRemove(); });
    row.appendChild(rm);
  }
  if (set.done && Array.isArray(set.comments) && set.comments.length) {
    const c = document.createElement("div"); c.className = "cmt";
    c.textContent = set.comments.join(" · ");
    row.appendChild(c);
  }
  return row;
}

// Bufferizza l'entry dell'esercizio `idx` e schedula il salvataggio cloud.
function persist(idx) {
  bufferEdit(currentWeek, currentDay, idx, getEntry(data, currentWeek, currentDay, idx));
  setStatus("in attesa ⧗", "pending");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToCloud, 1500);
}

function renderFocusNormal(ex, idx, container, footer) {
  const v = getEntry(data, currentWeek, currentDay, idx);
  const entry = normalizeEntry(v);
  const tgt = parseTarget(ex.setsReps, false);
  const prev = prefillSets(data, currentWeek, currentDay, idx); // [{reps,kg,done:false}]
  const curIdx = activeSetIndex(entry.sets);

  document.getElementById("focusSet").textContent =
    `serie ${Math.min(curIdx + 1, tgt.sets)} / ${tgt.sets}`;

  const draftKey = `${currentDay}-${idx}-${curIdx}-${entry.sets.length}`;
  if (draft._key !== draftKey) {
    draft = {
      kg: prev[curIdx]?.kg ?? "",
      reps: prev[curIdx]?.reps ?? repsLow(tgt.reps),
      comments: (entry.sets[curIdx]?.comments ?? []).slice(),
      _key: draftKey,
    };
  }

  const trendRow = buildTrendRow(exerciseTrend(data, currentDay, idx, currentWeek, 3), currentWeek);
  if (trendRow) container.appendChild(trendRow);

  const setsBox = document.createElement("div");
  setsBox.className = "sets";
  const total = Math.max(entry.sets.length, tgt.sets);
  const allDone = curIdx >= total;
  for (let i = 0; i < total; i++) {
    const set = entry.sets[i] || { reps: "", kg: "", done: false };
    const isCurrent = i === curIdx;
    const canRemove = i < entry.sets.length && entry.sets.length > 0;
    const onRemove = canRemove ? () => {
      data = setEntry(data, currentWeek, currentDay, idx, withoutSet(v, i), new Date().toISOString());
      persist(idx); render();
    } : null;
    const onOpen = set.done ? () => openSetDialog({
      title: `Serie ${i + 1} · ${set.reps || "—"} × ${set.kg || "—"} kg`,
      reps: set.reps, kg: set.kg, feel: set.feel,
      onApply: (reps, kg, feel) => {
        data = setEntry(data, currentWeek, currentDay, idx, withSet(v, i, { reps, kg, feel }), new Date().toISOString());
        persist(idx); render();
      },
      onUndo: () => {
        data = setEntry(data, currentWeek, currentDay, idx, withSet(v, i, { done: false }), new Date().toISOString());
        persist(idx); render();
      },
      onDelete: () => {
        data = setEntry(data, currentWeek, currentDay, idx, withoutSet(v, i), new Date().toISOString());
        persist(idx); render();
      },
    }) : null;
    setsBox.appendChild(setRow(i, set, prev[i] || null, isCurrent, onRemove, onOpen));
  }
  container.appendChild(setsBox);

  if (!allDone) {
    const edit = buildEditBlock(`Serie ${curIdx + 1} — carico · step 0.5 kg`, draft, prev[curIdx] || null);
    container.appendChild(edit.block);

    const qcLabel = document.createElement("div"); qcLabel.className = "editlabel"; qcLabel.textContent = "commento veloce";
    container.appendChild(qcLabel);
    let chipsEl;
    const refreshChips = () => {
      const fresh = buildQuickCommentChips(draft.comments,
        (text) => { draft.comments = toggleComment(draft.comments, text); refreshChips(); },
        () => { const t = prompt("Commento:"); const v = t && t.trim(); if (v && !draft.comments.includes(v)) { draft.comments = [...draft.comments, v]; refreshChips(); } });
      if (chipsEl) { chipsEl.replaceWith(fresh); } else { container.appendChild(fresh); }
      chipsEl = fresh;
    };
    refreshChips();

    const repInSession = previousSetInSession(v, curIdx);
    const repPrevWeek = previousWeekSet(data, currentDay, idx, currentWeek, curIdx);
    const repChips = buildRepeatChips(repInSession, repPrevWeek, ({ reps, kg }) => {
      draft.reps = reps; draft.kg = kg; edit.refresh();
    });
    if (repChips) container.appendChild(repChips);
  }

  const dots = document.createElement("div");
  dots.className = "dots";
  for (let i = 0; i < total; i++) {
    const s = entry.sets[i];
    const d = document.createElement("span");
    let cls = "dt";
    if (s && s.warmup) cls = "dt warm";
    else if (i < curIdx) cls = "dt on";
    else if (i === curIdx) cls = "dt cur";
    d.className = cls;
    dots.appendChild(d);
  }
  const addW = document.createElement("button");
  addW.className = "addset warm"; addW.textContent = "+ riscald.";
  addW.addEventListener("click", () => {
    data = setEntry(data, currentWeek, currentDay, idx, withSet(v, entry.sets.length, { reps: "", kg: "", done: false, warmup: true }), new Date().toISOString());
    persist(idx); render();
  });
  const add = document.createElement("button");
  add.className = "addset"; add.textContent = "+ serie";
  add.addEventListener("click", () => {
    data = setEntry(data, currentWeek, currentDay, idx, withSet(v, entry.sets.length, { reps: "", kg: "", done: false }), new Date().toISOString());
    persist(idx); render();
  });
  dots.appendChild(addW);
  dots.appendChild(add);
  container.appendChild(dots);

  if (!allDone) {
    const cta = document.createElement("button");
    cta.className = "cta"; cta.textContent = "Serie fatta · avvia recupero ▸";
    cta.addEventListener("click", () => {
      data = setEntry(data, currentWeek, currentDay, idx,
        withSet(v, curIdx, { reps: draft.reps, kg: draft.kg, done: true, feel: entry.sets[curIdx]?.feel ?? "", comments: draft.comments }), new Date().toISOString());
      persist(idx);
      startRest(getRest(currentDay, idx, ex.restSeconds), ex.name);
      render();
      if (isEntryComplete(getEntry(data, currentWeek, currentDay, idx), ex)) {
        closeFocus(); // esercizio finito → torna alla lista (e libera la voce di history)
      } else {
        showFeelAsk({ idx, superset: false, setIndex: curIdx });
      }
    });
    footer.appendChild(cta);
  }
  container.appendChild(buildNoteField(false, idx));
}

// Bozze separate per traccia A e B della serie corrente del superset.
let draftA = { kg: "", reps: "", comments: [] };
let draftB = { kg: "", reps: "", comments: [] };

function trackBlock(trackKey, trackName, trackEntry, tgtTrack, prevSets, state, idx) {
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
  const stateKey = `${currentDay}-${idx}-${trackKey}-${curIdx}-${trackEntry.sets.length}`;
  if (state._key !== stateKey) {
    state.kg = prevSets[curIdx]?.kg ?? "";
    state.reps = prevSets[curIdx]?.reps ?? repsLow(tgtTrack.reps);
    state.comments = (trackEntry.sets[curIdx]?.comments ?? []).slice();
    state._key = stateKey;
  }

  const setsBox = document.createElement("div");
  setsBox.className = "sets";
  const total = Math.max(trackEntry.sets.length, tgtTrack.sets);
  const allDone = curIdx >= total;
  for (let i = 0; i < total; i++) {
    const set = trackEntry.sets[i] || { reps: "", kg: "", done: false };
    const onOpen = set.done ? () => openSetDialog({
      title: `${trackKey.toUpperCase()} · Serie ${i + 1} · ${set.reps || "—"} × ${set.kg || "—"} kg`,
      reps: set.reps, kg: set.kg, feel: set.feel,
      onApply: (reps, kg, feel) => {
        const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, idx), trackKey, i, { reps, kg, feel });
        data = setEntry(data, currentWeek, currentDay, idx, nv, new Date().toISOString());
        persist(idx); render();
      },
      onUndo: () => {
        const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, idx), trackKey, i, { done: false });
        data = setEntry(data, currentWeek, currentDay, idx, nv, new Date().toISOString());
        persist(idx); render();
      },
      onDelete: () => {
        const nv = withoutSupersetSet(getEntry(data, currentWeek, currentDay, idx), trackKey, i);
        data = setEntry(data, currentWeek, currentDay, idx, nv, new Date().toISOString());
        persist(idx); render();
      },
    }) : null;
    const onRemove = (!set.done && i < trackEntry.sets.length) ? () => {
      data = setEntry(data, currentWeek, currentDay, idx, withoutSupersetSet(getEntry(data, currentWeek, currentDay, idx), trackKey, i), new Date().toISOString());
      persist(idx); render();
    } : null;
    setsBox.appendChild(setRow(i, set, prevSets[i] || null, i === curIdx, onRemove, onOpen));
  }
  wrap.appendChild(setsBox);

  const dots = document.createElement("div");
  dots.className = "dots";
  const add = document.createElement("button");
  add.className = "addset"; add.textContent = "+ serie";
  add.addEventListener("click", () => {
    data = setEntry(data, currentWeek, currentDay, idx, withSupersetSet(getEntry(data, currentWeek, currentDay, idx), trackKey, trackEntry.sets.length, { reps: "", kg: "", done: false }), new Date().toISOString());
    persist(idx); render();
  });
  dots.appendChild(add);
  wrap.appendChild(dots);

  if (!allDone) {
    const edit = buildEditBlock(`Serie ${curIdx + 1} ${trackKey.toUpperCase()} — step 0.5 kg`, state, prevSets[curIdx] || null);
    wrap.appendChild(edit.block);

    const qcLabel = document.createElement("div"); qcLabel.className = "editlabel"; qcLabel.textContent = "commento veloce";
    wrap.appendChild(qcLabel);
    let chipsEl;
    const refreshChips = () => {
      const fresh = buildQuickCommentChips(state.comments,
        (text) => { state.comments = toggleComment(state.comments, text); refreshChips(); },
        () => { const t = prompt("Commento:"); const v = t && t.trim(); if (v && !state.comments.includes(v)) { state.comments = [...state.comments, v]; refreshChips(); } });
      if (chipsEl) { chipsEl.replaceWith(fresh); } else { wrap.appendChild(fresh); }
      chipsEl = fresh;
    };
    refreshChips();

    const inSess = previousSetInSession(trackEntry, curIdx);
    const prevWk = previousWeekSet(data, currentDay, idx, currentWeek, curIdx, trackKey);
    const chips = buildRepeatChips(inSess, prevWk, ({ reps, kg }) => { state.reps = reps; state.kg = kg; edit.refresh(); });
    if (chips) wrap.appendChild(chips);
  }
  return { wrap, curIdx, allDone };
}

function renderFocusSuperset(ex, idx, container, footer) {
  const v = getEntry(data, currentWeek, currentDay, idx);
  const e = normalizeSupersetEntry(v);
  const tgt = parseTarget(ex.setsReps, true);
  const [nameA, nameB] = ex.name.includes(" + ") ? ex.name.split(" + ") : [ex.name, ex.name];
  const prev = previousSupersetSets(currentWeek, currentDay, idx);

  // sotto-tab A / B
  const tabs = document.createElement("div");
  tabs.className = "ss-tabs";
  [["a", nameA.trim()], ["b", nameB.trim()]].forEach(([key, name]) => {
    const b = document.createElement("button");
    b.textContent = `${key.toUpperCase()} · ${name}`;
    if (supersetTab === key) b.classList.add("on");
    b.addEventListener("click", () => { supersetTab = key; render(); });
    tabs.appendChild(b);
  });
  container.appendChild(tabs);

  const trendRow = buildTrendRow(exerciseTrend(data, currentDay, idx, currentWeek, 3, true), currentWeek);
  if (trendRow) container.appendChild(trendRow);

  const a = trackBlock("a", nameA.trim(), e.a, tgt.a, prev.a, draftA, idx);
  const b = trackBlock("b", nameB.trim(), e.b, tgt.b, prev.b, draftB, idx);
  // si mostra solo la traccia del tab attivo (blocco totale: una per volta)
  container.appendChild(supersetTab === "a" ? a.wrap : b.wrap);

  // header serie X/Y riferito alla traccia attiva
  const active = supersetTab === "a" ? a : b;
  const tgtT = supersetTab === "a" ? tgt.a : tgt.b;
  document.getElementById("focusSet").textContent =
    `serie ${Math.min(active.curIdx + 1, tgtT.sets)} / ${tgtT.sets} · ${supersetTab.toUpperCase()}`;

  if (!isEntryComplete(getEntry(data, currentWeek, currentDay, idx), ex)) {
    const cta = document.createElement("button");
    cta.className = "cta"; cta.textContent = "Serie fatta (A+B) · avvia recupero ▸";
    cta.addEventListener("click", () => {
      let nv = withSupersetSet(v, "a", a.curIdx, { reps: draftA.reps, kg: draftA.kg, done: true, feel: e.a.sets[a.curIdx]?.feel ?? "", comments: draftA.comments });
      nv = withSupersetSet(nv, "b", b.curIdx, { reps: draftB.reps, kg: draftB.kg, done: true, feel: e.b.sets[b.curIdx]?.feel ?? "", comments: draftB.comments });
      data = setEntry(data, currentWeek, currentDay, idx, nv, new Date().toISOString());
      persist(idx);
      startRest(getRest(currentDay, idx, ex.restSeconds), ex.name);
      render();
      if (isEntryComplete(getEntry(data, currentWeek, currentDay, idx), ex)) {
        closeFocus(); // superset finito → torna alla lista (e libera la voce di history)
      } else {
        showFeelAsk({ idx, superset: true, aIdx: a.curIdx, bIdx: b.curIdx });
      }
    });
    footer.appendChild(cta);
  }
  container.appendChild(buildNoteField(true, idx));
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

function renderList() {
  const root = document.getElementById("list");
  root.textContent = "";
  const dp = dayPlan();
  dp.exercises.forEach((ex, i) => {
    const item = document.createElement("div");
    item.className = "item" + (isComplete(i) ? " done" : "") + (i === openIndex ? " open" : "");
    const r = document.createElement("div");
    r.className = "r";
    r.addEventListener("click", () => openFocus(i));
    const id = document.createElement("span"); id.className = "id"; id.textContent = String(i + 1).padStart(2, "0");
    const mid = document.createElement("div"); mid.className = "mid";
    const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = ex.name;
    if (ex.superset) { const b = document.createElement("span"); b.className = "ssbadge"; b.textContent = "superset"; nm.appendChild(b); }
    const sub = document.createElement("div"); sub.className = "sub";
    sub.textContent = `${ex.setsReps} · rec ${getRest(currentDay, i, ex.restSeconds)}″`;
    mid.append(nm, sub);
    const right = document.createElement("div"); right.className = "right";
    if (isComplete(i)) { const c = document.createElement("span"); c.className = "chk"; c.textContent = "✓"; right.appendChild(c); }
    else if (ex.superset) { const best = document.createElement("div"); best.className = "best"; best.textContent = "A·B"; const bl = document.createElement("div"); bl.className = "bl"; bl.textContent = "2 tracce"; right.append(best, bl); }
    else { const bk = bestKg(data, currentDay, i); const best = document.createElement("div"); best.className = "best"; best.textContent = bk === null ? "—" : bk + " kg"; const bl = document.createElement("div"); bl.className = "bl"; bl.textContent = "best"; right.append(best, bl); }
    const caret = document.createElement("span"); caret.className = "caret"; caret.textContent = "▾";
    r.append(id, mid, right, caret);
    item.appendChild(r);
    root.appendChild(item);
  });
}

// Editor del tempo di recupero per esercizio, sempre visibile dentro l'overlay:
// modifica l'override per-esercizio (setRest) e aggiorna subito il valore mostrato.
// Step ±15s, minimo 15s; il valore vale anche per il timer e per la riga in lista.
function buildRestEditor(idx, ex) {
  const wrap = document.createElement("div");
  wrap.className = "restedit";
  const lab = document.createElement("span"); lab.className = "rl"; lab.textContent = "recupero";
  const minus = document.createElement("button"); minus.type = "button"; minus.className = "rstep"; minus.textContent = "−10";
  const val = document.createElement("span"); val.className = "rval";
  const plus = document.createElement("button"); plus.type = "button"; plus.className = "rstep"; plus.textContent = "+10";
  const paint = () => { val.textContent = `${getRest(currentDay, idx, ex.restSeconds)}″`; };
  const step = (d) => { setRest(currentDay, idx, Math.max(10, getRest(currentDay, idx, ex.restSeconds) + d)); paint(); renderList(); };
  minus.addEventListener("click", step.bind(null, -10));
  plus.addEventListener("click", step.bind(null, 10));
  paint();
  wrap.append(lab, minus, val, plus);
  return wrap;
}

// Renderizza (o nasconde) l'overlay a schermo intero dell'esercizio aperto.
function renderFocusOverlay() {
  const ov = document.getElementById("focusOverlay");
  const body = document.getElementById("focusBody");
  const foot = document.getElementById("focusFoot");
  if (openIndex === null) {
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    return;
  }
  const ex = dayPlan().exercises[openIndex];
  if (!ex) { openIndex = null; renderFocusOverlay(); return; }
  document.getElementById("focusName").textContent = ex.name;
  body.textContent = "";
  foot.textContent = "";
  body.appendChild(buildRestEditor(openIndex, ex));
  if (ex.superset) renderFocusSuperset(ex, openIndex, body, foot);
  else renderFocusNormal(ex, openIndex, body, foot);
  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function renderVolRow() {
  const root = document.getElementById("volRow");
  root.textContent = "";
  const vol = sessionVolume(data, currentWeek, currentDay, dayPlan());
  const prevVol = sessionVolume(data, prevWeekKey(), currentDay, dayPlan());
  root.appendChild(buildVolumeRow(vol, prevVol));
}

function render() {
  renderHeader();
  renderProgress();
  renderList();
  renderVolRow();
  renderFocusOverlay();
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
  openIndex = null;
  renderWeekSelect();
  render();
}
function changeDay(day) {
  currentDay = day;
  openIndex = null;
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

  function renderQcList() {
    const root = document.getElementById("qcList"); root.textContent = "";
    getQuickComments().forEach((text, i) => {
      const row = document.createElement("div"); row.className = "qc";
      const t = document.createElement("span"); t.className = "txt"; t.textContent = text;
      const del = document.createElement("span"); del.className = "del"; del.textContent = "✕";
      del.addEventListener("click", () => { const arr = getQuickComments(); arr.splice(i, 1); setQuickComments(arr); renderQcList(); });
      row.append(t, del); root.appendChild(row);
    });
  }

  document.getElementById("qcAdd").addEventListener("click", () => {
    const inp = document.getElementById("qcInput"); const t = inp.value.trim();
    if (!t) return;
    const arr = getQuickComments(); if (!arr.includes(t)) arr.push(t);
    setQuickComments(arr); inp.value = ""; renderQcList();
  });

  document.getElementById("settingsBtn").addEventListener("click", () => {
    document.getElementById("tokenInput").value = getToken() || "";
    document.getElementById("barInput").value = getBar();
    document.getElementById("platesInput").value = getPlateSet().join(", ");
    renderQcList();
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
  document.getElementById("tMinus").addEventListener("click", () => timer.addSeconds(-10));
  document.getElementById("tPlus").addEventListener("click", () => timer.addSeconds(10));
  document.getElementById("tStop").addEventListener("click", () => {
    timer.stop();
    hideFeelAsk();
    document.getElementById("timerBar").classList.add("hidden");
    document.body.classList.remove("timer-on");
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
  wireSetDialog();
  document.getElementById("weekSelect").addEventListener("change", (e) => changeWeek(e.target.value));
  document.getElementById("newWeekBtn").addEventListener("click", newWeek);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flushPending(); });
  window.addEventListener("pagehide", flushPending);
  for (const b of document.querySelectorAll("#dayTabs button")) {
    b.addEventListener("click", () => changeDay(b.dataset.day));
  }
  document.getElementById("focusBack").addEventListener("click", () => closeFocus());
  window.addEventListener("popstate", () => { if (openIndex !== null) { hideFeelAsk(); openIndex = null; render(); } });
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
  openIndex = null;
  renderWeekSelect();
  render();
  wakeLock.enable();
  if (getPending().length && getToken()) saveToCloud();
}

boot();

// PWA: registra il service worker e gestisce l'aggiornamento (best-effort).
// `swUpdating` distingue l'aggiornamento voluto dall'utente (tap sul banner)
// dal primo clients.claim alla prima installazione: ricarica solo nel primo caso.
let swUpdating = false;

function showUpdateBanner(reg) {
  if (document.getElementById("updateBanner")) return;
  const b = document.createElement("button");
  b.id = "updateBanner";
  b.type = "button";
  b.textContent = "Nuova versione · tocca per aggiornare";
  b.addEventListener("click", () => {
    swUpdating = true;
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
  });
  document.body.appendChild(b);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!swUpdating) return;
    swUpdating = false;
    window.location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").then((reg) => {
      reg.update().catch(() => {});
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      });
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) showUpdateBanner(reg);
        });
      });
    }).catch(() => { /* SW non disponibile */ });
  });
}
