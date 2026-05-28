import { PLAN } from "./plan.js";
import { migrate, backfillMuscles, addExercise, removeExercise, reorderExercise, updateExercise, keepLocalPlan } from "./editor.js";
import {
  isoWeekKey, nextFreeWeekKey, emptyData, ensureWeek, setEntry, getEntry,
  normalizeEntry, normalizeSupersetEntry, prefillSets, platesPerSide, parsePlateSet, exerciseBar,
  GitHubStore, ConflictError, AuthError,
} from "./store.js";
import {
  parseTarget, activeSetIndex, isEntryComplete, bestKg, progressionDelta,
  withSet, withoutSet, withSupersetSet, withoutSupersetSet, withNote, previousNote,
  previousSetInSession, previousWeekSet,
  sessionVolume, exerciseTrend, nextExercisePreview,
  topSetSeries, chartGeometry,
  sessionDates, monthGrid,
  lastWorkingSet,
} from "./session.js";
import { RestTimer, formatTime } from "./timer.js";
import { ScreenWakeLock } from "./wakelock.js";
import { renderNutritionGuide } from "./nutrition.js";

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

// Stato del dialog progressione
let chartExId = null;   // id esercizio mostrato
let chartTrack = null;  // null | "a" | "b"
let chartAll = false;   // false = ultime 3 settimane, true = tutto lo storico
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

// Overlay guida alimentazione: stessa logica history del focus esercizio, così
// il tasto "indietro" del telefono chiude la guida invece di uscire dall'app.
let nutritionOpen = false;
function openNutrition() {
  nutritionOpen = true;
  history.pushState({ gymNutrition: true }, "");
  renderNutritionOverlay();
}
function closeNutrition() {
  if (!nutritionOpen) return;
  if (history.state && history.state.gymNutrition) history.back(); // → popstate chiude
  else { nutritionOpen = false; renderNutritionOverlay(); }
}
function renderNutritionOverlay() {
  const ov = document.getElementById("nutritionOverlay");
  if (!nutritionOpen) {
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");
    if (openIndex === null) document.body.style.overflow = "";
    return;
  }
  renderNutritionGuide(document.getElementById("nutritionBody"));
  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

// ---- Editor scheda: overlay a schermo intero (stessa logica history degli altri). ----
let planOpen = false;
let planEditDay = "A";   // giorno selezionato nell'editor
function openPlanEditor() {
  planOpen = true;
  planEditDay = currentDay;
  history.pushState({ gymPlan: true }, "");
  renderPlanEditor();
}
function closePlanEditor() {
  if (!planOpen) return;
  if (history.state && history.state.gymPlan) history.back(); // → popstate chiude
  else { planOpen = false; renderPlanEditor(); }
}

function renderPlanEditor() {
  const ov = document.getElementById("planOverlay");
  if (!planOpen) {
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");
    if (openIndex === null && !nutritionOpen) document.body.style.overflow = "";
    return;
  }
  const day = planEditDay;
  document.getElementById("planSub").textContent = `giorno ${day}`;
  for (const b of document.querySelectorAll("#planTabs button")) b.classList.toggle("on", b.dataset.day === day);
  const body = document.getElementById("planBody");
  body.textContent = "";
  const dp = planDays().find((d) => d.day === day) || planDays()[0];
  dp.exercises.forEach((ex, i) => body.appendChild(buildPlanRow(ex, i, dp.exercises.length)));
  const add = document.createElement("button");
  add.type = "button"; add.className = "pe-add"; add.textContent = "＋ Aggiungi esercizio";
  add.addEventListener("click", () => openExDialog(day, null));
  body.appendChild(add);
  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

// ---- Calendario allenamenti: overlay a schermo intero (stessa logica history). ----
let calendarOpen = false;
let calYear = 0, calMonth = 0;   // mese visualizzato (month 0-based)
let calSelected = null;          // "YYYY-MM-DD" del giorno selezionato, o null

function openCalendar() {
  calendarOpen = true;
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  calSelected = null;
  history.pushState({ gymCalendar: true }, "");
  renderCalendar();
}
function closeCalendar() {
  if (!calendarOpen) return;
  if (history.state && history.state.gymCalendar) history.back(); // → popstate chiude
  else { calendarOpen = false; renderCalendar(); }
}
function calShiftMonth(delta) {
  const d = new Date(calYear, calMonth + delta, 1);
  calYear = d.getFullYear();
  calMonth = d.getMonth();
  calSelected = null;
  renderCalendar();
}

// ---- Menu drawer in fondo: stessa logica history degli overlay. ----
let drawerOpen = false;
let drawerPending = null; // azione da eseguire dopo che il drawer si è chiuso

function renderDrawer() {
  const d = document.getElementById("menuDrawer");
  const scrim = document.getElementById("drawerScrim");
  d.classList.toggle("open", drawerOpen);
  d.setAttribute("aria-hidden", drawerOpen ? "false" : "true");
  document.getElementById("drawerHandle").setAttribute("aria-expanded", String(drawerOpen));
  scrim.classList.toggle("hidden", !drawerOpen);
}
function openDrawer() {
  if (drawerOpen) return;
  drawerOpen = true;
  history.pushState({ gymMenu: true }, "");
  renderDrawer();
}
function closeDrawer() {
  if (!drawerOpen) return;
  if (history.state && history.state.gymMenu) history.back(); // → popstate chiude
  else { drawerOpen = false; renderDrawer(); }
}
// Su touch un tap genera un click di compatibilità: aprendo, la maniglia sale
// (il pannello si espande) e quel click cadrebbe su scrim/voce sottostante
// richiudendo subito il drawer. preventDefault sul pointerdown non basta su
// tutti i browser (iOS Safari lo ignora), quindi inghiottiamo ogni click per la
// durata dell'animazione: il ghost click muore ovunque cada, i tap veri sulle
// voci arrivano dopo e restano attivi.
function swallowGhostClick() {
  const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
  document.addEventListener("click", swallow, true);
  setTimeout(() => document.removeEventListener("click", swallow, true), 400);
}
function toggleDrawer() { swallowGhostClick(); drawerOpen ? closeDrawer() : openDrawer(); }
// Chiude il drawer e, una volta chiuso (history consumata), lancia l'azione scelta.
function drawerLaunch(fn) { drawerPending = fn; closeDrawer(); }

// Assegnata in wireSettings(): apre il dialog impostazioni. Vive a livello
// modulo per essere richiamata dal drawer, ma il corpo gira nello scope di
// wireSettings dove renderQcList è definita.
let openSettings = null;

const CAL_MONTHS = ["gennaio","febbraio","marzo","aprile","maggio","giugno",
  "luglio","agosto","settembre","ottobre","novembre","dicembre"];

function renderCalendar() {
  const ov = document.getElementById("calendarOverlay");
  if (!calendarOpen) {
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");
    if (openIndex === null && !nutritionOpen && !planOpen) document.body.style.overflow = "";
    return;
  }
  document.getElementById("calTitle").textContent = `${CAL_MONTHS[calMonth]} ${calYear}`;

  const sessions = sessionDates(data);
  const byDate = new Map();
  for (const s of sessions) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }

  const grid = document.getElementById("calGrid");
  grid.textContent = "";
  for (const dow of ["L","M","M","G","V","S","D"]) {
    const h = document.createElement("div");
    h.className = "cal-dow"; h.textContent = dow;
    grid.appendChild(h);
  }
  for (const week of monthGrid(calYear, calMonth)) {
    for (const date of week) {
      const cell = document.createElement("div");
      if (date === null) { cell.className = "cal-cell empty"; grid.appendChild(cell); continue; }
      cell.className = "cal-cell";
      cell.textContent = String(Number(date.slice(8, 10)));
      if (byDate.has(date)) {
        cell.classList.add("trained");
        if (date === calSelected) cell.classList.add("sel");
        cell.addEventListener("click", () => { calSelected = date; renderCalendar(); });
      }
      grid.appendChild(cell);
    }
  }
  renderCalendarDetail(byDate.get(calSelected) || null);

  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function renderCalendarDetail(sessions) {
  const box = document.getElementById("calDetail");
  box.textContent = "";
  if (!sessions || !sessions.length) {
    const p = document.createElement("div");
    p.className = "empty";
    p.textContent = "Tocca un giorno colorato per i dettagli.";
    box.appendChild(p);
    return;
  }
  for (const s of sessions) {
    const dayPlan = planDays().find((d) => d.day === s.day);
    const vol = Math.round(sessionVolume(data, s.weekKey, s.day, dayPlan));
    const row = document.createElement("div");
    row.textContent = `${s.date} — giorno ${s.day} · volume ${vol} kg`;
    box.appendChild(row);
  }
}

// Riga esercizio nell'editor: grip drag, nome+sub, modifica, elimina.
function buildPlanRow(ex, i, count) {
  const row = document.createElement("div");
  row.className = "pe-row";
  row.dataset.idx = String(i);
  const grip = document.createElement("span"); grip.className = "pe-grip"; grip.textContent = "⠿";
  const meta = document.createElement("div"); meta.className = "pe-meta";
  const nm = document.createElement("div"); nm.className = "pe-name"; nm.textContent = ex.name;
  if (ex.superset) { const b = document.createElement("span"); b.className = "pe-badge"; b.textContent = "SUPERSET"; nm.appendChild(b); }
  const sub = document.createElement("div"); sub.className = "pe-sub";
  sub.textContent = `${ex.setsReps} · ${ex.recText}` + (ex.bar ? ` · bilanciere ${ex.bar}kg` : "");
  meta.append(nm, sub);
  const edit = document.createElement("button"); edit.type = "button"; edit.className = "pe-ic"; edit.textContent = "✎";
  edit.addEventListener("click", () => openExDialog(planEditDay, ex.id));
  const del = document.createElement("button"); del.type = "button"; del.className = "pe-ic del"; del.textContent = "🗑";
  del.addEventListener("click", () => deletePlanExercise(planEditDay, ex.id, ex.name));
  row.append(grip, meta, edit, del);
  attachDragHandle(row, grip, planEditDay);
  return row;
}

// day: giorno; id: id esercizio da modificare, oppure null per aggiungerne uno nuovo.
let exDlgDay = "A";
let exDlgId = null;
function openExDialog(day, id) {
  exDlgDay = day; exDlgId = id;
  const dlg = document.getElementById("exDialog");
  const dp = planDays().find((d) => d.day === day);
  const ex = id && dp ? dp.exercises.find((e) => e.id === id) : null;
  document.getElementById("exDlgTitle").textContent = ex ? "Modifica esercizio" : "Nuovo esercizio";
  document.getElementById("exName").value = ex ? ex.name : "";
  document.getElementById("exSetsReps").value = ex ? ex.setsReps : "";
  document.getElementById("exRecText").value = ex ? ex.recText : "";
  document.getElementById("exRestSeconds").value = ex ? ex.restSeconds : "";
  document.getElementById("exBar").value = ex && ex.bar != null ? ex.bar : "";
  document.getElementById("exSuperset").checked = !!(ex && ex.superset);
  dlg.showModal();
}

function readExDialog() {
  const name = document.getElementById("exName").value.trim();
  const setsReps = document.getElementById("exSetsReps").value.trim();
  const recText = document.getElementById("exRecText").value.trim();
  const restSeconds = parseInt(document.getElementById("exRestSeconds").value, 10);
  const barRaw = document.getElementById("exBar").value.trim();
  const superset = document.getElementById("exSuperset").checked;
  const ex = {
    name, setsReps, recText,
    restSeconds: Number.isFinite(restSeconds) ? restSeconds : 60,
    superset,
  };
  if (barRaw !== "") { const b = parseFloat(barRaw.replace(",", ".")); if (Number.isFinite(b) && b > 0) ex.bar = b; }
  return ex;
}

function saveExDialog() {
  const patch = readExDialog();
  if (!patch.name) return; // nome obbligatorio
  if (exDlgId) data = { ...data, plan: updateExercise(data.plan, exDlgDay, exDlgId, patch) };
  else data = { ...data, plan: addExercise(data.plan, exDlgDay, patch) };
  scheduleSave();
  document.getElementById("exDialog").close();
  renderPlanEditor();
  render(); // la lista principale riflette i cambi
}

function deletePlanExercise(day, id, name) {
  if (!confirm(`Eliminare "${name}" dal giorno ${day}?\nLo storico resta salvato ma non sarà più mostrato.`)) return;
  data = { ...data, plan: removeExercise(data.plan, day, id) };
  scheduleSave();
  renderPlanEditor();
  render();
}

// Drag-to-reorder fluido col grip (pointer events, no HTML5 DnD). La riga segue il
// dito con transform e le altre si scostano per far spazio; commit al rilascio.
// La capture è su #planBody (elemento stabile): catturarla sul grip si perdeva su
// iOS appena il DOM cambiava, bloccando il drag dopo un passo.
function attachDragHandle(row, grip, day) {
  grip.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const body = document.getElementById("planBody");
    const rowsEls = [...body.querySelectorAll(".pe-row")];
    const fromIdx = rowsEls.indexOf(row);
    if (fromIdx < 0) return;
    const startY = e.clientY;
    const slot = row.getBoundingClientRect().height + 8; // altezza riga + margin-bottom
    let target = fromIdx;

    body.setPointerCapture(e.pointerId);
    row.classList.add("dragging");

    const onMove = (ev) => {
      const dy = ev.clientY - startY;
      row.style.transform = `translateY(${dy}px)`;
      const t = Math.max(0, Math.min(rowsEls.length - 1, fromIdx + Math.round(dy / slot)));
      if (t === target) return;
      target = t;
      rowsEls.forEach((r, i) => {
        if (r === row) return;
        let shift = 0;
        if (fromIdx < target && i > fromIdx && i <= target) shift = -slot;
        else if (fromIdx > target && i >= target && i < fromIdx) shift = slot;
        r.style.transform = shift ? `translateY(${shift}px)` : "";
      });
    };
    const cleanup = () => {
      body.removeEventListener("pointermove", onMove);
      body.removeEventListener("pointerup", onUp);
      body.removeEventListener("pointercancel", onCancel);
      try { body.releasePointerCapture(e.pointerId); } catch (_) { /* già rilasciata */ }
    };
    const onUp = () => {
      cleanup();
      if (target !== fromIdx) {
        data = { ...data, plan: reorderExercise(data.plan, day, fromIdx, target) };
        scheduleSave();
      }
      renderPlanEditor(); // ridisegna pulito (azzera i transform)
      render();
    };
    const onCancel = () => { cleanup(); renderPlanEditor(); }; // ripristina, niente commit
    body.addEventListener("pointermove", onMove);
    body.addEventListener("pointerup", onUp);
    body.addEventListener("pointercancel", onCancel);
  });
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
const NOTIFY_KEY = "gymsched_notify";
function notifyOn() {
  return localStorage.getItem(NOTIFY_KEY) === "1"
    && "Notification" in window && Notification.permission === "granted";
}

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

function showRestDoneBanner() {
  const b = document.getElementById("restDoneBanner");
  if (!b) return;
  b.classList.remove("hidden");
  clearTimeout(showRestDoneBanner._t);
  showRestDoneBanner._t = setTimeout(() => b.classList.add("hidden"), 2500);
}

function hideRestDoneBanner() {
  const b = document.getElementById("restDoneBanner");
  clearTimeout(showRestDoneBanner._t);
  if (b) b.classList.add("hidden");
}

// ---- Timer wiring ----
const timer = new RestTimer({
  onTick: (remaining, label) => {
    document.getElementById("timerTime").textContent = formatTime(remaining);
    document.getElementById("timerLabel").textContent = label;
  },
  onEnd: (label) => {
    hideFeelAsk();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    beep();
    if (document.hidden && notifyOn() && swReg) {
      swReg.showNotification("Recupero finito", {
        body: (label ? label + " · " : "") + "prossima serie",
        tag: "rest-done", renotify: true, vibrate: [200, 100, 200], icon: "./icon.svg",
      }).catch(() => {});
    } else if (!document.hidden) {
      showRestDoneBanner();
    }
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

// La scheda vive in data.plan dopo la migrazione; PLAN resta solo da seed.
const planDays = () => (Array.isArray(data.plan) && data.plan.length ? data.plan : PLAN);
const dayPlan = () => planDays().find((d) => d.day === currentDay) || planDays()[0];
// ID stabile dell'esercizio in posizione `i` di `day` (chiave dei log). Fallback
// a String(i) solo se manca (non dovrebbe: migrate garantisce l'id).
const exIdOf = (day, i) => {
  const dp = planDays().find((d) => d.day === day);
  const e = dp && dp.exercises[i];
  return e && e.id != null ? e.id : String(i);
};
const exIdAt = (i) => exIdOf(currentDay, i);

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
  return isEntryComplete(getEntry(data, currentWeek, currentDay, exIdAt(idx)), ex);
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
// Apre il popup tag. selected = array corrente; onChange(nuovoArray) chiamato a ogni tap (applica subito).
function openQcDialog(selected, onChange) {
  const dlg = document.getElementById("qcDialog");
  const opts = document.getElementById("qcOptions");
  const draftSel = selected.slice();
  const paint = () => {
    opts.textContent = "";
    getQuickComments().forEach((text) => {
      const o = document.createElement("button");
      o.type = "button";
      o.className = "qc-opt" + (draftSel.includes(text) ? " on" : "");
      o.textContent = text;
      o.addEventListener("click", () => {
        const i = draftSel.indexOf(text);
        if (i === -1) draftSel.push(text); else draftSel.splice(i, 1);
        onChange(draftSel.slice());   // applica subito
        paint();
      });
      opts.appendChild(o);
    });
    const w = document.createElement("button");
    w.type = "button"; w.className = "qc-opt write"; w.textContent = "＋ scrivi un commento…";
    w.addEventListener("click", () => {
      const t = prompt("Commento:");
      const val = t && t.trim();
      if (val && !draftSel.includes(val)) { draftSel.push(val); onChange(draftSel.slice()); paint(); }
    });
    opts.appendChild(w);
  };
  paint();
  if (!dlg.open) dlg.showModal();
}

// Bottone "commento veloce (n)" + riepilogo tag. onOpen() apre il popup.
function buildQuickCommentButton(selected, onOpen) {
  const wrap = document.createElement("div");
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "qc-btn";
  const lab = document.createElement("span"); lab.textContent = "💬 commento veloce";
  const cnt = document.createElement("span");
  cnt.className = "cnt" + (selected.length ? "" : " zero");
  cnt.textContent = String(selected.length);
  btn.append(lab, cnt);
  btn.addEventListener("click", onOpen);
  wrap.appendChild(btn);
  if (selected.length) {
    const sel = document.createElement("div"); sel.className = "qc-sel";
    selected.forEach((t) => { const s = document.createElement("span"); s.className = "tag"; s.textContent = t; sel.appendChild(s); });
    wrap.appendChild(sel);
  }
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
function buildEditBlock(label, state, prev, bar = getBar()) {
  const block = document.createElement("div");
  block.className = "editblock";

  const lab = document.createElement("div");
  lab.className = "editlabel"; lab.textContent = label;
  block.appendChild(lab);

  const stepper = document.createElement("div");
  stepper.className = "stepper";
  const minus = document.createElement("span"); minus.className = "mb"; minus.textContent = "−0.5";
  const valWrap = document.createElement("span"); valWrap.className = "val";
  const num = document.createElement("input"); num.className = "num";
  num.type = "text"; num.setAttribute("inputmode", "decimal"); num.size = 4;
  num.autocomplete = "off"; num.placeholder = "—"; num.setAttribute("aria-label", "Peso in kg");
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
    const { perSide, leftover } = platesPerSide(n, { bar, plates: getPlateSet() });
    if (!perSide.length) { platesLine.textContent = `per lato: — (≤ bilanciere ${bar} kg)`; return; }
    platesLine.textContent = `per lato: ${perSide.join(" + ")}` + (leftover > 0 ? `  (+${leftover} scoperto)` : "");
  };

  const renderKg = ({ writeInput = true } = {}) => {
    const n = parseFloat(String(state.kg).replace(",", "."));
    if (writeInput) num.value = Number.isFinite(n) ? String(n) : "";
    renderPlates();
  };
  const stepKg = (delta) => {
    const n = parseFloat(String(state.kg).replace(",", "."));
    const base = Number.isFinite(n) ? n : 0;
    state.kg = String(Math.max(0, Math.round((base + delta) * 100) / 100));
    renderKg();
  };
  num.addEventListener("focus", () => num.select());
  num.addEventListener("input", () => {
    const raw = num.value.replace(",", ".").trim();
    if (raw === "") { state.kg = ""; renderPlates(); return; }
    const n = parseFloat(raw);
    if (Number.isFinite(n) && n >= 0) { state.kg = String(Math.round(n * 100) / 100); renderPlates(); }
  });
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
  const rv = document.createElement("input"); rv.className = "rv";
  rv.type = "text"; rv.setAttribute("inputmode", "numeric"); rv.size = 3;
  rv.autocomplete = "off"; rv.placeholder = "—"; rv.setAttribute("aria-label", "Ripetizioni");
  const rl = document.createElement("div"); rl.className = "l"; rl.textContent = "Ripetizioni";
  rc.append(rv, rl);
  const rinc = document.createElement("span"); rinc.className = "rmb"; rinc.textContent = "+";
  repstep.append(rdec, rc, rinc);
  reprow.appendChild(repstep);

  const renderReps = ({ writeInput = true } = {}) => { if (writeInput) rv.value = state.reps === "" ? "" : String(state.reps); };
  const stepReps = (delta) => {
    const n = parseInt(state.reps, 10);
    const base = Number.isFinite(n) ? n : 0;
    state.reps = String(Math.max(0, base + delta));
    renderReps();
  };
  rv.addEventListener("focus", () => rv.select());
  rv.addEventListener("input", () => {
    const raw = rv.value.trim();
    if (raw === "") { state.reps = ""; return; }
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) state.reps = String(n);
  });
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
  const isKg = step < 1;
  const num = document.createElement("input"); num.className = "num";
  num.type = "text"; num.setAttribute("inputmode", isKg ? "decimal" : "numeric");
  num.size = isKg ? 4 : 3; num.autocomplete = "off"; num.placeholder = "—";
  num.setAttribute("aria-label", label);
  const inc = document.createElement("button"); inc.type = "button"; inc.className = "b"; inc.textContent = "+";
  const paint = ({ writeInput = true } = {}) => {
    if (!writeInput) return;
    const n = parseFloat(String(state[field]).replace(",", "."));
    num.value = Number.isFinite(n) ? (isKg ? String(n) : String(Math.round(n))) : "";
  };
  const stepBy = (d) => {
    const n = parseFloat(String(state[field]).replace(",", "."));
    const base = Number.isFinite(n) ? n : 0;
    state[field] = String(Math.max(0, Math.round((base + d) * 100) / 100));
    paint();
  };
  num.addEventListener("focus", () => num.select());
  num.addEventListener("input", () => {
    const raw = num.value.replace(",", ".").trim();
    if (raw === "") { state[field] = ""; return; }
    const n = isKg ? parseFloat(raw) : parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) state[field] = String(isKg ? Math.round(n * 100) / 100 : n);
  });
  bindHold(dec, () => stepBy(-step));
  bindHold(inc, () => stepBy(step));
  paint();
  row.append(lab, dec, num, inc);
  return row;
}

// ---- Grafico progressione ----
const SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}
function shortWeek(key) {
  // "2026-W22" -> "W22"; "2026-W22.1" -> "W22.1"
  const m = String(key).match(/W\d{2}(\.\d+)?/);
  return m ? m[0] : String(key);
}

// Costruisce l'SVG del grafico a linea da una serie [{week,kg}].
function renderChart(series) {
  const W = 260, H = 150;
  const g = chartGeometry(series, { width: W, height: H });
  const baseline = H - 26; // 26 = padBottom di default in chartGeometry
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, class: "chart-svg" });
  // gridlines + label asse Y
  for (const tick of g.yTicks) {
    svg.appendChild(svgEl("line", { x1: 34, y1: tick.y, x2: 252, y2: tick.y, stroke: "#241f16", "stroke-width": 1 }));
    const lbl = svgEl("text", { x: 28, y: tick.y + 3, fill: "#6f6857", "font-size": 10, "text-anchor": "end" });
    lbl.textContent = String(tick.value);
    svg.appendChild(lbl);
  }
  // area sfumata + linea
  if (g.points.length > 1) {
    const last = g.points[g.points.length - 1], first = g.points[0];
    svg.appendChild(svgEl("polyline", {
      points: `${g.polyline} ${last.x},${baseline} ${first.x},${baseline}`,
      fill: "#E8A93C", opacity: 0.08,
    }));
    svg.appendChild(svgEl("polyline", {
      points: g.polyline, fill: "none", stroke: "#E8A93C",
      "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round",
    }));
  }
  // diradamento label X: ~6 etichette max
  const n = g.points.length;
  const step = Math.max(1, Math.ceil(n / 6));
  g.points.forEach((p, i) => {
    const isLast = i === n - 1;
    svg.appendChild(svgEl("circle", {
      cx: p.x, cy: p.y, r: isLast ? 4.5 : 4,
      fill: isLast ? "#E8A93C" : "#100E0A",
      stroke: "#E8A93C", "stroke-width": isLast ? 0 : 2.5,
    }));
    if (i % step === 0 || isLast) {
      const val = svgEl("text", {
        x: p.x, y: p.y - 8, fill: isLast ? "#E8A93C" : "#EDE6D8",
        "font-size": isLast ? 11 : 10, "font-weight": isLast ? 700 : 600, "text-anchor": "middle",
      });
      val.textContent = String(p.kg);
      svg.appendChild(val);
      const xl = svgEl("text", {
        x: p.x, y: 142, fill: isLast ? "#EDE6D8" : "#9a9385",
        "font-size": 10, "font-weight": isLast ? 600 : 400, "text-anchor": "middle",
      });
      xl.textContent = shortWeek(p.week);
      svg.appendChild(xl);
    }
  });
  return svg;
}

function chartTitle() {
  const ex = dayPlan().exercises.find((e) => e.id === chartExId);
  if (!ex) return "Progressione";
  return chartTrack ? `${ex.name} · ${chartTrack.toUpperCase()}` : ex.name;
}

// Ridisegna corpo + controllo intervallo del dialog in base allo stato.
function renderChartDialog() {
  const body = document.getElementById("chartBody");
  const range = document.getElementById("chartRange");
  document.getElementById("chartTitle").textContent = chartTitle();
  body.textContent = "";
  range.textContent = "";
  const full = topSetSeries(data, currentDay, chartExId, currentWeek, chartTrack);
  if (full.length === 0) {
    const p = document.createElement("div");
    p.className = "chart-empty";
    p.textContent = "Nessuno storico ancora";
    body.appendChild(p);
    return;
  }
  const series = chartAll ? full : full.slice(-3);
  body.appendChild(renderChart(series));
  if (series.length === 1) {
    const note = document.createElement("div");
    note.className = "chart-note";
    note.textContent = "Serve più di una settimana per vedere il trend";
    body.appendChild(note);
  }
  if (full.length > 3) {
    const mk = (label, all) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      if (chartAll === all) b.classList.add("on");
      b.addEventListener("click", () => { chartAll = all; renderChartDialog(); });
      return b;
    };
    range.appendChild(mk("3 sett.", false));
    range.appendChild(mk("tutto lo storico", true));
  }
}

// Apre il dialog progressione per un esercizio/traccia.
function openChartDialog(exId, track) {
  chartExId = exId;
  chartTrack = track;
  chartAll = false;
  renderChartDialog();
  const dlg = document.getElementById("chartDialog");
  if (!dlg.open) dlg.showModal();
}

// Stato del popup serie (una sola istanza riusata). I callback sono cablati una
// volta in wireSetDialog; openSetDialog riempie stato + callback e mostra.
let setDlgState = null, setDlgCbs = null, setDlgAction = null;

// opts: { title, reps, kg, feel, failed, failNote, done, onApply(reps,kg,feel,failed,failNote), onUndo(), onDelete() }
function openSetDialog(opts) {
  const dlg = document.getElementById("setDialog");
  setDlgCbs = opts;
  setDlgState = {
    reps: String(opts.reps ?? ""),
    kg: String(opts.kg ?? ""),
    feel: opts.feel || "",
    failed: !!opts.failed,
    failNote: opts.failNote || "",
  };
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

  // Sync fail toggle UI
  const failBtn = document.getElementById("setDlgFail");
  const failNote = document.getElementById("setDlgFailNote");
  failBtn.classList.toggle("on", setDlgState.failed);
  failNote.value = setDlgState.failNote;
  failNote.classList.toggle("hidden", !setDlgState.failed);

  // Show/hide "Annulla conferma" based on whether set is already done
  const undoBtn = document.getElementById("setDlgUndo");
  undoBtn.classList.toggle("hidden", !opts.done);

  dlg.showModal();
}

function wireSetDialog() {
  const dlg = document.getElementById("setDialog");
  document.getElementById("setDlgApply").addEventListener("click", () => { setDlgAction = "apply"; dlg.close(); });
  document.getElementById("setDlgUndo").addEventListener("click", () => { setDlgAction = "undo"; dlg.close(); });
  document.getElementById("setDlgDelete").addEventListener("click", () => { setDlgAction = "delete"; dlg.close(); });
  document.getElementById("setDlgClose").addEventListener("click", () => { setDlgAction = "cancel"; dlg.close(); });

  // Toggle "Non riuscita"
  document.getElementById("setDlgFail").addEventListener("click", () => {
    if (!setDlgState) return;
    setDlgState.failed = !setDlgState.failed;
    const failBtn = document.getElementById("setDlgFail");
    const failNote = document.getElementById("setDlgFailNote");
    failBtn.classList.toggle("on", setDlgState.failed);
    failNote.classList.toggle("hidden", !setDlgState.failed);
    if (setDlgState.failed) failNote.focus();
  });
  document.getElementById("setDlgFailNote").addEventListener("input", (e) => {
    if (setDlgState) setDlgState.failNote = e.target.value;
  });

  // tap sullo sfondo / Escape = annulla senza salvare (le modifiche si salvano
  // solo col pulsante "Conferma modifiche").
  dlg.addEventListener("click", (e) => { if (e.target === dlg) { setDlgAction = "cancel"; dlg.close(); } });
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); setDlgAction = "cancel"; dlg.close(); });
  dlg.addEventListener("close", () => {
    if (!setDlgCbs) return;
    const { onApply = () => {}, onUndo = () => {}, onDelete = () => {} } = setDlgCbs;
    const a = setDlgAction; setDlgAction = null;
    if (a === "undo") onUndo();
    else if (a === "delete") onDelete();
    else if (a === "apply") onApply(setDlgState.reps, setDlgState.kg, setDlgState.feel, setDlgState.failed, setDlgState.failNote);
    // qualsiasi altra chiusura (cancel/sfondo/Escape) = nessuna modifica
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
    const exId = exIdAt(lastDone.idx);
    let v = getEntry(data, currentWeek, currentDay, exId);
    let nv;
    if (lastDone.superset) {
      nv = withSupersetSet(v, "a", lastDone.aIdx, { feel });
      nv = withSupersetSet(nv, "b", lastDone.bIdx, { feel });
    } else {
      nv = withSet(v, lastDone.setIndex, { feel });
    }
    data = setEntry(data, currentWeek, currentDay, exId, nv, new Date().toISOString());
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
  const exId = exIdAt(idx);
  const v = getEntry(data, currentWeek, currentDay, exId);
  const e = superset ? normalizeSupersetEntry(v) : normalizeEntry(v);
  const prev = previousNote(data, currentDay, exId, currentWeek, superset);

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
    const cur = getEntry(data, currentWeek, currentDay, exId);
    data = setEntry(data, currentWeek, currentDay, exId, withNote(cur, ta.value.trim(), superset), new Date().toISOString());
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
  if (set.done && !set.warmup && set.failed) {
    const fl = document.createElement("span");
    fl.className = "rpe fail";
    fl.textContent = "✗ non riuscita";
    fl.title = "Tocca per modificare";
    if (onOpen) fl.addEventListener("click", (e) => { e.stopPropagation(); onOpen(); });
    row.appendChild(fl);
  } else if (set.done && !set.warmup && set.feel) {
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
  if (set.done && set.failed && set.failNote) {
    const fn = document.createElement("div"); fn.className = "cmt fail-note";
    fn.textContent = set.failNote;
    row.appendChild(fn);
  }
  if (set.done && !set.warmup && onOpen) {
    const ed = document.createElement("span");
    ed.className = "editset";
    ed.textContent = "✎";
    ed.title = "Modifica serie (reps, kg, sensazione, non riuscita, elimina)";
    ed.addEventListener("click", (e) => { e.stopPropagation(); onOpen(); });
    row.appendChild(ed);
  }
  return row;
}

// Bufferizza l'entry dell'esercizio in posizione `idx` e schedula il salvataggio cloud.
function persist(idx) {
  const exId = exIdAt(idx);
  bufferEdit(currentWeek, currentDay, exId, getEntry(data, currentWeek, currentDay, exId));
  setStatus("in attesa ⧗", "pending");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToCloud, 1500);
}

function renderFocusNormal(ex, idx, container, footer) {
  const exId = exIdAt(idx);
  const v = getEntry(data, currentWeek, currentDay, exId);
  const entry = normalizeEntry(v);
  const tgt = parseTarget(ex.setsReps, false);
  const prev = prefillSets(data, currentWeek, currentDay, exId); // [{reps,kg,done:false}]
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

  const trendRow = buildTrendRow(exerciseTrend(data, currentDay, exId, currentWeek, 3), currentWeek);
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
      data = setEntry(data, currentWeek, currentDay, exId, withoutSet(v, i), new Date().toISOString());
      persist(idx); render();
    } : null;
    const onOpen = set.done ? () => openSetDialog({
      title: `Serie ${i + 1} · ${set.reps || "—"} × ${set.kg || "—"} kg`,
      reps: set.reps, kg: set.kg, feel: set.feel,
      failed: set.failed, failNote: set.failNote, done: set.done,
      onApply: (reps, kg, feel, failed, failNote) => {
        data = setEntry(data, currentWeek, currentDay, exId, withSet(v, i, { reps, kg, feel, failed, failNote, ...(failed ? { done: true } : {}) }), new Date().toISOString());
        persist(idx); render();
      },
      onUndo: () => {
        data = setEntry(data, currentWeek, currentDay, exId, withSet(v, i, { done: false }), new Date().toISOString());
        persist(idx); render();
      },
      onDelete: () => {
        data = setEntry(data, currentWeek, currentDay, exId, withoutSet(v, i), new Date().toISOString());
        persist(idx); render();
      },
    }) : null;
    setsBox.appendChild(setRow(i, set, prev[i] || null, isCurrent, onRemove, onOpen));
  }
  container.appendChild(setsBox);

  if (!allDone) {
    const edit = buildEditBlock(`Serie ${curIdx + 1} — carico · step 0.5 kg`, draft, prev[curIdx] || null, exerciseBar(ex, getBar()));
    container.appendChild(edit.block);

    let qcEl;
    const refreshQc = () => {
      const fresh = buildQuickCommentButton(draft.comments, () => {
        openQcDialog(draft.comments, (next) => { draft.comments = next; refreshQc(); });
      });
      if (qcEl) { qcEl.replaceWith(fresh); } else { container.appendChild(fresh); }
      qcEl = fresh;
    };
    refreshQc();

    const repInSession = previousSetInSession(v, curIdx);
    const repPrevWeek = previousWeekSet(data, currentDay, exId, currentWeek, curIdx);
    const repChips = buildRepeatChips(repInSession, repPrevWeek, ({ reps, kg }) => {
      draft.reps = reps; draft.kg = kg; edit.refresh();
    });
    if (repChips) container.appendChild(repChips);

    // "Serie non riuscita" entry for the current (not-done) set
    const failLink = document.createElement("button");
    failLink.type = "button";
    failLink.className = "fail-link";
    failLink.textContent = "✗ Serie non riuscita";
    failLink.addEventListener("click", () => {
      const curSet = entry.sets[curIdx] || {};
      openSetDialog({
        title: `Serie ${curIdx + 1} — non riuscita`,
        reps: draft.reps || curSet.reps || "",
        kg: draft.kg || curSet.kg || "",
        feel: curSet.feel || "",
        failed: curSet.failed || false,
        failNote: curSet.failNote || "",
        done: false,
        onApply: (reps, kg, feel, failed, failNote) => {
          data = setEntry(data, currentWeek, currentDay, exId, withSet(v, curIdx, { reps, kg, feel, failed, failNote, ...(failed ? { done: true } : {}) }), new Date().toISOString());
          persist(idx); render();
        },
        onUndo: () => {},
        onDelete: () => {
          data = setEntry(data, currentWeek, currentDay, exId, withoutSet(v, curIdx), new Date().toISOString());
          persist(idx); render();
        },
      });
    });
    container.appendChild(failLink);
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
    data = setEntry(data, currentWeek, currentDay, exId, withSet(v, entry.sets.length, { reps: "", kg: "", done: false, warmup: true }), new Date().toISOString());
    persist(idx); render();
  });
  const add = document.createElement("button");
  add.className = "addset"; add.textContent = "+ serie";
  add.addEventListener("click", () => {
    data = setEntry(data, currentWeek, currentDay, exId, withSet(v, entry.sets.length, { reps: "", kg: "", done: false }), new Date().toISOString());
    persist(idx); render();
  });
  dots.appendChild(addW);
  dots.appendChild(add);
  container.appendChild(dots);

  if (!allDone) {
    const cta = document.createElement("button");
    cta.className = "cta"; cta.textContent = "Serie fatta · avvia recupero ▸";
    cta.addEventListener("click", () => {
      data = setEntry(data, currentWeek, currentDay, exId,
        withSet(v, curIdx, { reps: draft.reps, kg: draft.kg, done: true, feel: entry.sets[curIdx]?.feel ?? "", comments: draft.comments }), new Date().toISOString());
      persist(idx);
      startRest(getRest(currentDay, exId, ex.restSeconds), ex.name);
      render();
      if (isEntryComplete(getEntry(data, currentWeek, currentDay, exId), ex)) {
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

function trackBlock(trackKey, trackName, trackEntry, tgtTrack, prevSets, state, idx, bar = getBar()) {
  const exId = exIdAt(idx);
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
      failed: set.failed, failNote: set.failNote, done: set.done,
      onApply: (reps, kg, feel, failed, failNote) => {
        const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, exId), trackKey, i, { reps, kg, feel, failed, failNote, ...(failed ? { done: true } : {}) });
        data = setEntry(data, currentWeek, currentDay, exId, nv, new Date().toISOString());
        persist(idx); render();
      },
      onUndo: () => {
        const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, exId), trackKey, i, { done: false });
        data = setEntry(data, currentWeek, currentDay, exId, nv, new Date().toISOString());
        persist(idx); render();
      },
      onDelete: () => {
        const nv = withoutSupersetSet(getEntry(data, currentWeek, currentDay, exId), trackKey, i);
        data = setEntry(data, currentWeek, currentDay, exId, nv, new Date().toISOString());
        persist(idx); render();
      },
    }) : null;
    const onRemove = (!set.done && i < trackEntry.sets.length) ? () => {
      data = setEntry(data, currentWeek, currentDay, exId, withoutSupersetSet(getEntry(data, currentWeek, currentDay, exId), trackKey, i), new Date().toISOString());
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
    data = setEntry(data, currentWeek, currentDay, exId, withSupersetSet(getEntry(data, currentWeek, currentDay, exId), trackKey, trackEntry.sets.length, { reps: "", kg: "", done: false }), new Date().toISOString());
    persist(idx); render();
  });
  dots.appendChild(add);
  wrap.appendChild(dots);

  if (!allDone) {
    const edit = buildEditBlock(`Serie ${curIdx + 1} ${trackKey.toUpperCase()} — step 0.5 kg`, state, prevSets[curIdx] || null, bar);
    wrap.appendChild(edit.block);

    let qcEl;
    const refreshQc = () => {
      const fresh = buildQuickCommentButton(state.comments, () => {
        openQcDialog(state.comments, (next) => { state.comments = next; refreshQc(); });
      });
      if (qcEl) { qcEl.replaceWith(fresh); } else { wrap.appendChild(fresh); }
      qcEl = fresh;
    };
    refreshQc();

    const inSess = previousSetInSession(trackEntry, curIdx);
    const prevWk = previousWeekSet(data, currentDay, exId, currentWeek, curIdx, trackKey);
    const chips = buildRepeatChips(inSess, prevWk, ({ reps, kg }) => { state.reps = reps; state.kg = kg; edit.refresh(); });
    if (chips) wrap.appendChild(chips);

    // "Serie non riuscita" entry for the current (not-done) superset set
    const failLink = document.createElement("button");
    failLink.type = "button";
    failLink.className = "fail-link";
    failLink.textContent = "✗ Serie non riuscita";
    failLink.addEventListener("click", () => {
      const curSet = trackEntry.sets[curIdx] || {};
      openSetDialog({
        title: `${trackKey.toUpperCase()} · Serie ${curIdx + 1} — non riuscita`,
        reps: state.reps || curSet.reps || "",
        kg: state.kg || curSet.kg || "",
        feel: curSet.feel || "",
        failed: curSet.failed || false,
        failNote: curSet.failNote || "",
        done: false,
        onApply: (reps, kg, feel, failed, failNote) => {
          const nv = withSupersetSet(getEntry(data, currentWeek, currentDay, exId), trackKey, curIdx, { reps, kg, feel, failed, failNote, ...(failed ? { done: true } : {}) });
          data = setEntry(data, currentWeek, currentDay, exId, nv, new Date().toISOString());
          persist(idx); render();
        },
        onUndo: () => {},
        onDelete: () => {
          const nv = withoutSupersetSet(getEntry(data, currentWeek, currentDay, exId), trackKey, curIdx);
          data = setEntry(data, currentWeek, currentDay, exId, nv, new Date().toISOString());
          persist(idx); render();
        },
      });
    });
    wrap.appendChild(failLink);
  }
  return { wrap, curIdx, allDone };
}

function renderFocusSuperset(ex, idx, container, footer) {
  const exId = exIdAt(idx);
  const v = getEntry(data, currentWeek, currentDay, exId);
  const e = normalizeSupersetEntry(v);
  const tgt = parseTarget(ex.setsReps, true);
  const [nameA, nameB] = ex.name.includes(" + ") ? ex.name.split(" + ") : [ex.name, ex.name];
  const prev = previousSupersetSets(currentWeek, currentDay, exId);

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

  const trendRow = buildTrendRow(exerciseTrend(data, currentDay, exId, currentWeek, 3, true), currentWeek);
  if (trendRow) container.appendChild(trendRow);

  const ssBar = exerciseBar(ex, getBar());
  const a = trackBlock("a", nameA.trim(), e.a, tgt.a, prev.a, draftA, idx, ssBar);
  const b = trackBlock("b", nameB.trim(), e.b, tgt.b, prev.b, draftB, idx, ssBar);
  // si mostra solo la traccia del tab attivo (blocco totale: una per volta)
  container.appendChild(supersetTab === "a" ? a.wrap : b.wrap);

  // header serie X/Y riferito alla traccia attiva
  const active = supersetTab === "a" ? a : b;
  const tgtT = supersetTab === "a" ? tgt.a : tgt.b;
  document.getElementById("focusSet").textContent =
    `serie ${Math.min(active.curIdx + 1, tgtT.sets)} / ${tgtT.sets} · ${supersetTab.toUpperCase()}`;

  if (!isEntryComplete(getEntry(data, currentWeek, currentDay, exId), ex)) {
    const cta = document.createElement("button");
    cta.className = "cta"; cta.textContent = "Serie fatta (A+B) · avvia recupero ▸";
    cta.addEventListener("click", () => {
      let nv = withSupersetSet(v, "a", a.curIdx, { reps: draftA.reps, kg: draftA.kg, done: true, feel: e.a.sets[a.curIdx]?.feel ?? "", comments: draftA.comments });
      nv = withSupersetSet(nv, "b", b.curIdx, { reps: draftB.reps, kg: draftB.kg, done: true, feel: e.b.sets[b.curIdx]?.feel ?? "", comments: draftB.comments });
      data = setEntry(data, currentWeek, currentDay, exId, nv, new Date().toISOString());
      persist(idx);
      startRest(getRest(currentDay, exId, ex.restSeconds), ex.name);
      render();
      if (isEntryComplete(getEntry(data, currentWeek, currentDay, exId), ex)) {
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
    sub.textContent = `${ex.setsReps} · rec ${getRest(currentDay, exIdAt(i), ex.restSeconds)}″`;
    if (!isComplete(i)) {
      const exId = exIdAt(i);
      let lastLabel = "";
      if (ex.superset) {
        const a = lastWorkingSet(data, currentDay, exId, currentWeek, "a");
        const b = lastWorkingSet(data, currentDay, exId, currentWeek, "b");
        const parts = [];
        if (a) parts.push(`A${a.kg}`);
        if (b) parts.push(`B${b.kg}`);
        if (parts.length) lastLabel = parts.join(" ");
      } else {
        const last = lastWorkingSet(data, currentDay, exId, currentWeek);
        if (last) lastLabel = `${last.reps}×${last.kg}`;
      }
      if (lastLabel) {
        const u = document.createElement("span"); u.className = "ult";
        u.textContent = ` · ult. ${lastLabel}`;
        sub.appendChild(u);
      }
    }
    mid.append(nm, sub);
    const right = document.createElement("div"); right.className = "right";
    if (isComplete(i)) { const c = document.createElement("span"); c.className = "chk"; c.textContent = "✓"; right.appendChild(c); }
    else if (ex.superset) { const best = document.createElement("div"); best.className = "best"; best.textContent = "A·B"; const bl = document.createElement("div"); bl.className = "bl"; bl.textContent = "2 tracce"; right.append(best, bl); }
    else { const bk = bestKg(data, currentDay, exIdAt(i)); const best = document.createElement("div"); best.className = "best"; best.textContent = bk === null ? "—" : bk + " kg"; const bl = document.createElement("div"); bl.className = "bl"; bl.textContent = "best"; right.append(best, bl); }
    const caret = document.createElement("span"); caret.className = "caret"; caret.textContent = "▾";
    r.append(id, mid, right, caret);
    item.appendChild(r);
    root.appendChild(item);
  });
}

// Editor del tempo di recupero per esercizio, sempre visibile dentro l'overlay:
// modifica l'override per-esercizio (setRest) e aggiorna subito il valore mostrato.
// Step ±10s, minimo 10s; il valore vale anche per il timer e per la riga in lista.
function buildRestEditor(idx, ex) {
  const exId = exIdAt(idx);
  const wrap = document.createElement("div");
  wrap.className = "restedit";
  const lab = document.createElement("span"); lab.className = "rl"; lab.textContent = "recupero";
  const minus = document.createElement("button"); minus.type = "button"; minus.className = "rstep"; minus.textContent = "−10";
  const val = document.createElement("span"); val.className = "rval";
  const plus = document.createElement("button"); plus.type = "button"; plus.className = "rstep"; plus.textContent = "+10";
  const paint = () => { val.textContent = `${getRest(currentDay, exId, ex.restSeconds)}″`; };
  const step = (d) => { setRest(currentDay, exId, Math.max(10, getRest(currentDay, exId, ex.restSeconds) + d)); paint(); renderList(); };
  minus.addEventListener("click", step.bind(null, -10));
  plus.addEventListener("click", step.bind(null, 10));
  paint();
  wrap.append(lab, minus, val, plus);
  return wrap;
}

// Striscia informativa in fondo all'overlay: prossimo esercizio o "ultimo".
function buildNextStrip(exercises, idx) {
  const info = nextExercisePreview(exercises, idx);
  const strip = document.createElement("div");
  strip.className = "nextstrip";
  if (info.last) {
    strip.classList.add("end");
    const t = document.createElement("span");
    t.className = "nx-end";
    t.textContent = "Ultimo esercizio della sessione";
    strip.appendChild(t);
  } else {
    const tag = document.createElement("span");
    tag.className = "nx-tag"; tag.textContent = "Prossimo";
    const arrow = document.createElement("span");
    arrow.className = "nx-arrow"; arrow.textContent = "→";
    const nm = document.createElement("span");
    nm.className = "nx-name"; nm.textContent = info.name;
    const tg = document.createElement("span");
    tg.className = "nx-target"; tg.textContent = info.target;
    strip.append(tag, arrow, nm, tg);
  }
  return strip;
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
  foot.appendChild(buildNextStrip(dayPlan().exercises, openIndex));
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
        const localPlan = data.plan; // edit strutturali della scheda: non sono nel buffer pending
        const remote = await store.load();
        data = keepLocalPlan(backfillMuscles(migrate(applyPending(remote.data), PLAN), PLAN), localPlan);
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
  // Prima settimana ISO libera (corrente, o la prossima se già esiste): sempre nuova.
  const key = nextFreeWeekKey(data.weeks);
  const label = prompt("Nome della nuova settimana:", key);
  if (label === null) return;
  data = ensureWeek(data, key, label || key);
  changeWeek(key);
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

  openSettings = () => {
    document.getElementById("tokenInput").value = getToken() || "";
    document.getElementById("barInput").value = getBar();
    document.getElementById("platesInput").value = getPlateSet().join(", ");
    renderQcList();
    document.getElementById("notifyToggle").checked = notifyOn();
    dlg.showModal();
  };

  document.getElementById("qcAdd").addEventListener("click", () => {
    const inp = document.getElementById("qcInput"); const t = inp.value.trim();
    if (!t) return;
    const arr = getQuickComments(); if (!arr.includes(t)) arr.push(t);
    setQuickComments(arr); inp.value = ""; renderQcList();
  });

  document.getElementById("notifyToggle").addEventListener("change", async (e) => {
    if (!e.target.checked) { localStorage.setItem(NOTIFY_KEY, "0"); return; }
    if (!("Notification" in window)) {
      e.target.checked = false;
      alert("Notifiche non supportate da questo browser.");
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === "granted") {
      localStorage.setItem(NOTIFY_KEY, "1");
    } else {
      e.target.checked = false;
      localStorage.setItem(NOTIFY_KEY, "0");
      alert("Permesso notifiche negato dal browser/sistema.");
    }
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
    hideRestDoneBanner();
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

function wireDrawer() {
  const handle = document.getElementById("drawerHandle");
  let startY = null, moved = false;
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault(); // niente click di compatibilità: il tap apre il drawer,
    // il pannello si espande e la maniglia sale; il ghost click cadrebbe sullo
    // scrim/voce sottostante richiudendo subito il drawer appena aperto.
    startY = e.clientY; moved = false;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (startY === null) return;
    if (Math.abs(e.clientY - startY) > 8) moved = true;
  });
  handle.addEventListener("pointerup", (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    startY = null;
    if (!moved) { toggleDrawer(); return; }      // tap
    if (dy < -24 && !drawerOpen) openDrawer();    // trascina su → apre
    else if (dy > 24 && drawerOpen) closeDrawer(); // trascina giù → chiude
  });
  handle.addEventListener("pointercancel", () => { startY = null; moved = false; });
  document.getElementById("drawerScrim").addEventListener("click", closeDrawer);
  document.getElementById("drawerPanel").addEventListener("click", (e) => {
    const b = e.target.closest(".dr-item");
    if (!b) return;
    const map = { nutrition: openNutrition, calendar: openCalendar, plan: openPlanEditor, settings: openSettings };
    const fn = map[b.dataset.act];
    if (fn) drawerLaunch(fn);
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
  document.getElementById("chartBtn").addEventListener("click", () => {
    if (openIndex === null) return;
    const ex = dayPlan().exercises[openIndex];
    if (!ex) return;
    openChartDialog(ex.id, ex.superset ? supersetTab : null);
  });
  document.getElementById("chartClose").addEventListener("click", () => document.getElementById("chartDialog").close());
  document.getElementById("chartDialog").addEventListener("click", (e) => {
    if (e.target.id === "chartDialog") e.target.close(); // tap sul backdrop
  });
  document.getElementById("nutritionBack").addEventListener("click", () => closeNutrition());
  document.getElementById("planBack").addEventListener("click", () => closePlanEditor());
  document.getElementById("calendarBack").addEventListener("click", closeCalendar);
  wireDrawer();
  document.getElementById("calPrev").addEventListener("click", () => calShiftMonth(-1));
  document.getElementById("calNext").addEventListener("click", () => calShiftMonth(1));
  for (const b of document.querySelectorAll("#planTabs button")) {
    b.addEventListener("click", () => { planEditDay = b.dataset.day; renderPlanEditor(); });
  }
  document.getElementById("exDlgSave").addEventListener("click", saveExDialog);
  document.getElementById("exDlgClose").addEventListener("click", () => document.getElementById("exDialog").close());
  document.getElementById("exDialog").addEventListener("click", (e) => { if (e.target.id === "exDialog") e.target.close(); });
  document.getElementById("qcClose").addEventListener("click", () => document.getElementById("qcDialog").close());
  document.getElementById("qcDialog").addEventListener("click", (e) => {
    if (e.target.id === "qcDialog") e.target.close(); // tap sul backdrop
  });
  window.addEventListener("popstate", () => {
    // Un dialog modale è il layer in cima: il tasto indietro chiude quello, non
    // l'overlay sotto. Lo richiudiamo e ripristiniamo la voce di history
    // dell'overlay sottostante (consumata dal back), così resta aperto e un
    // secondo "indietro" lo chiuderà. I dialog non sono registrati nella history,
    // quindi le loro chiusure normali (bottone/backdrop/Esc) non passano di qui.
    const openDlg = [...document.querySelectorAll("dialog[open]")].pop();
    if (openDlg) {
      openDlg.close();
      if (planOpen) history.pushState({ gymPlan: true }, "");
      else if (nutritionOpen) history.pushState({ gymNutrition: true }, "");
      else if (calendarOpen) history.pushState({ gymCalendar: true }, "");
      else if (openIndex !== null) history.pushState({ gymFocus: true }, "");
      return;
    }
    if (drawerOpen) {
      drawerOpen = false;
      renderDrawer();
      const t = drawerPending; drawerPending = null;
      if (t) t();
      return;
    }
    if (openIndex !== null) { hideFeelAsk(); openIndex = null; render(); }
    if (nutritionOpen) { nutritionOpen = false; renderNutritionOverlay(); }
    if (planOpen) { planOpen = false; renderPlanEditor(); }
    if (calendarOpen) { calendarOpen = false; renderCalendar(); }
  });
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
  // Migrazione schema 1->2 (indice->id) dopo applyPending, su entrambi i rami.
  data = migrate(data, PLAN);
  // Migrazione schema 2->3: backfill dei gruppi muscolari sul plan esistente.
  data = backfillMuscles(data, PLAN);
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
let swReg = null;

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
      swReg = reg;
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
