import { PLAN } from "./plan.js";
import { migrate, backfillMuscles, patchPlanV4, patchPlanV5, addExercise, removeExercise, reorderExercise, updateExercise, keepLocalPlan, addDay, renameDay, removeDay } from "./editor.js";
import {
  isoWeekKey, nextFreeWeekKey, emptyData, ensureWeek, setEntry, getEntry,
  normalizeEntry, normalizeSupersetEntry, prefillSets, platesPerSide, parsePlateSet, exerciseBar,
  SupabaseStore, mergeBlobs, ConflictError, AuthError, planIsEmpty,
} from "./store.js";
import { supabase } from "./supabase-client.js";
import { bindAuthScreen, hideAuthScreen, signOut } from "./auth.js";
import { ProfileStorage } from "./profile-storage.js";
import {
  parseTarget, activeSetIndex, isEntryComplete, bestKg, isWeekRecord, isSetRecord, progressionDelta,
  withSet, withoutSet, withSupersetSet, withoutSupersetSet, withNote, previousNote,
  previousSetInSession, previousWeekSet,
  sessionVolume, volumeByMuscle, exerciseTrend, nextExercisePreview,
  topSetSeries, chartGeometry,
  sessionDates, monthGrid,
  lastWorkingSet,
  isDumbbell, volumeMeta, exerciseVolume, setVolume,
} from "./session.js";
import { RestTimer, formatTime, withoutSession } from "./timer.js";
import { ScreenWakeLock } from "./wakelock.js";
import { renderNutritionGuide } from "./nutrition.js";
import { createPusher } from "./sync.js";
import { getFx, setFx, applyFx } from "./fx.js";

const PENDING_KEY = "gymsched_pending"; // local buffer of unsynced edits
const SEED_URL = "https://xbacco.github.io/gym-schedule/data.json";

// ---- App state ----
let data = emptyData();
let sha = null;
let currentWeek = isoWeekKey(new Date());
let currentDay = "A";
let openIndex = null;        // esercizio aperto nel focus a schermo intero (null = nessuno)
let supersetTab = "a";       // sotto-tab attivo nel focus di un superset
let store = null;
let session = null;        // { user: {id, email}, ... } da Supabase
let profileStorage = null; // ProfileStorage per la sessione corrente
let dataVersion = 0;       // optimistic lock version (sostituisce 'sha')

// Stato del dialog progressione
let chartExId = null;   // id esercizio mostrato
let chartTrack = null;  // null | "a" | "b"
let chartAll = false;   // false = ultime 3 settimane, true = tutto lo storico
let pusher = null;

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
  const plan = Array.isArray(data.plan) ? data.plan : [];
  const dp = plan.find((d) => d.day === planEditDay) || plan[0] || null;
  if (dp) planEditDay = dp.day;

  // Tab dei giorni: generate da data.plan (non da planDays(), così una scheda
  // vuota mostra un editor vuoto, mai gli esercizi del proprietario).
  const tabs = document.getElementById("planTabs");
  tabs.textContent = "";
  for (const d of plan) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.day = d.day;
    b.textContent = d.title || d.day;
    if (d.day === planEditDay) b.classList.add("on");
    b.addEventListener("click", () => { planEditDay = d.day; renderPlanEditor(); });
    tabs.appendChild(b);
  }
  const addTab = document.createElement("button");
  addTab.type = "button";
  addTab.className = "pe-tab-add";
  addTab.setAttribute("aria-label", "Aggiungi giorno");
  addTab.textContent = "＋";
  addTab.addEventListener("click", addPlanDay);
  tabs.appendChild(addTab);

  document.getElementById("planSub").textContent = dp ? `giorno ${dp.title || dp.day}` : "nessun giorno";

  const body = document.getElementById("planBody");
  body.textContent = "";
  if (dp) {
    // Toolbar rinomina/elimina per il giorno corrente.
    const bar = document.createElement("div");
    bar.className = "pe-daybar";
    const ren = document.createElement("button");
    ren.type = "button"; ren.className = "pe-daybtn"; ren.textContent = "✎ Rinomina";
    ren.addEventListener("click", renamePlanDay);
    const del = document.createElement("button");
    del.type = "button"; del.className = "pe-daybtn pe-daybtn-del"; del.textContent = "🗑 Elimina";
    del.addEventListener("click", deletePlanDay);
    bar.appendChild(ren); bar.appendChild(del);
    body.appendChild(bar);

    dp.exercises.forEach((ex, i) => body.appendChild(buildPlanRow(ex, i, dp.exercises.length)));
    const add = document.createElement("button");
    add.type = "button"; add.className = "pe-add"; add.textContent = "＋ Aggiungi esercizio";
    add.addEventListener("click", () => openExDialog(dp.day, null));
    body.appendChild(add);
  } else {
    const hint = document.createElement("p");
    hint.className = "pe-empty-hint";
    hint.textContent = "Nessun giorno. Tocca ＋ per aggiungerne uno.";
    body.appendChild(hint);
  }
  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

// ---- Editor scheda: gestione giorni (aggiungi/rinomina/elimina). ----
function addPlanDay() {
  const title = prompt("Nome del giorno (es. Petto/Tricipiti)");
  if (title === null) return; // annullato
  data = { ...data, plan: addDay(data.plan, title) };
  planEditDay = data.plan[data.plan.length - 1].day; // seleziona il nuovo giorno
  scheduleSave();
  renderPlanEditor();
  render(); // aggiorna home/empty-state
}

function renamePlanDay() {
  const dp = (data.plan || []).find((d) => d.day === planEditDay);
  if (!dp) return;
  const t = prompt("Nuovo nome del giorno", dp.title || dp.day);
  if (t === null) return;
  data = { ...data, plan: renameDay(data.plan, planEditDay, t) };
  scheduleSave();
  renderPlanEditor();
  render();
}

function deletePlanDay() {
  const dp = (data.plan || []).find((d) => d.day === planEditDay);
  if (!dp) return;
  if (!confirm(`Eliminare il giorno ${dp.title || dp.day}?`)) return;
  const remaining = removeDay(data.plan, planEditDay);
  data = { ...data, plan: remaining };
  scheduleSave();
  if (remaining.length === 0) {
    closePlanEditor(); // torna alla home → render() mostra l'empty-state
    render();          // il popstate handler non rende la home: lo forziamo qui
    return;
  }
  planEditDay = remaining[0].day;
  renderPlanEditor();
  render();
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
  sub.textContent = `${ex.setsReps} · ${ex.recText}`
    + (ex.bar ? ` · bilanciere ${ex.bar}kg` : "")
    + (isDumbbell(ex.name) ? " · vol ×2" : "")
    + (ex.unit === "sec" || ex.unitB === "sec" ? " · a tempo" : "");
  meta.append(nm, sub);
  const edit = document.createElement("button"); edit.type = "button"; edit.className = "pe-ic"; edit.textContent = "✎";
  edit.addEventListener("click", () => openExDialog(planEditDay, ex.id));
  const del = document.createElement("button"); del.type = "button"; del.className = "pe-ic del"; del.textContent = "🗑";
  del.addEventListener("click", () => deletePlanExercise(planEditDay, ex.id, ex.name));
  row.append(grip, meta, edit, del);
  attachDragHandle(row, grip, planEditDay);
  return row;
}

// Mostra/nasconde i campi della traccia B (muscolo + unità): solo per i superset.
function toggleMuscleB(on) {
  document.getElementById("exMuscleB").style.display = on ? "" : "none";
  document.getElementById("exMuscleBLabel").style.display = on ? "" : "none";
  document.getElementById("exUnitB").style.display = on ? "" : "none";
  document.getElementById("exUnitBLabel").style.display = on ? "" : "none";
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
  document.getElementById("exMuscle").value = ex && ex.muscle != null ? ex.muscle : "";
  document.getElementById("exMuscleB").value = ex && ex.muscleB != null ? ex.muscleB : "";
  document.getElementById("exUnit").value = ex && ex.unit === "sec" ? "sec" : "reps";
  document.getElementById("exUnitB").value = ex && ex.unitB === "sec" ? "sec" : "reps";
  toggleMuscleB(!!(ex && ex.superset));
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
  const muscle = document.getElementById("exMuscle").value;
  if (muscle) ex.muscle = muscle;
  const muscleB = document.getElementById("exMuscleB").value;
  if (superset && muscleB) ex.muscleB = muscleB;
  // Unità a tempo: "sec" salvato esplicito, "reps" -> undefined così updateExercise
  // (merge) ripulisce una eventuale unit precedente quando si torna a ripetizioni.
  ex.unit = document.getElementById("exUnit").value === "sec" ? "sec" : undefined;
  ex.unitB = (superset && document.getElementById("exUnitB").value === "sec") ? "sec" : undefined;
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

// ---- Pending buffer (browser only) ----
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

// ---- Cronometro sessione: durata totale dell'allenamento, per (settimana, giorno).
// Parte al primo recupero avviato del giorno, si ferma quando il giorno è completo.
// Solo locale (un allenamento si fa su un dispositivo). ----
const SESSION_KEY = "gymsched_session";
const getSessionMap = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "{}"); } catch (_) { return {}; } };
const setSessionMap = (m) => localStorage.setItem(SESSION_KEY, JSON.stringify(m));
const sessClockKey = () => `${currentWeek}-${currentDay}`;
function startSessionIfAbsent() {
  const m = getSessionMap(); const k = sessClockKey();
  if (!m[k] || !m[k].start) { m[k] = { start: new Date().toISOString(), end: null }; setSessionMap(m); }
}
function endSessionClock() {
  const m = getSessionMap(); const k = sessClockKey();
  if (m[k] && m[k].start && !m[k].end) { m[k].end = new Date().toISOString(); setSessionMap(m); renderSessClock(); }
}
function fmtDuration(totalSec) {
  let s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); s %= 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return (h ? `${h}:${mm}` : `${mm}`) + `:${String(s).padStart(2, "0")}`;
}
// Annulla il cronometro del giorno corrente (es. sessione avviata per sbaglio).
// Rimuove SOLO la voce gymsched_session: le serie loggate (in `data`) restano intatte.
function cancelSessionClock() {
  setSessionMap(withoutSession(getSessionMap(), sessClockKey()));
  renderSessClock();
}
function renderSessClock() {
  const el = document.getElementById("sessClock");
  if (!el) return;
  const c = getSessionMap()[sessClockKey()];
  if (!c || !c.start) { el.classList.add("hidden"); return; }
  const startMs = Date.parse(c.start);
  const endMs = c.end ? Date.parse(c.end) : Date.now();
  const txt = document.createElement("span");
  txt.className = "sc-t";
  txt.textContent = (c.end ? "⏱ allenamento " : "⏱ in corso · ") + fmtDuration((endMs - startMs) / 1000);
  const x = document.createElement("button");
  x.type = "button";
  x.className = "sc-x";
  x.textContent = "✕";
  x.setAttribute("aria-label", "Annulla cronometro");
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm("Annullare il cronometro di questo allenamento? Le serie loggate restano salvate.")) {
      cancelSessionClock();
    }
  });
  el.replaceChildren(txt, x);
  el.classList.toggle("ended", !!c.end);
  el.classList.remove("hidden");
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
// Tono singolo WebAudio (freq Hz, durata s, volume di picco). after = ritardo s.
function tone(freq, dur = 0.18, peak = 0.3, after = 0) {
  try {
    ensureAudio();
    const t0 = audioCtx.currentTime + after;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch (_) { /* audio unavailable; ignore */ }
}
// Fine recupero: due toni ascendenti ben udibili. Preavviso (−10s): doppio tono
// basso. Countdown (3-2-1): tick acuto breve. Suoni distinti tra loro così si
// riconoscono a orecchio anche con la musica nelle cuffie.
function beep() { tone(880, 0.45, 0.32); tone(1180, 0.4, 0.3, 0.16); }
function cueWarning() { tone(440, 0.16, 0.24); tone(440, 0.16, 0.24, 0.2); if (navigator.vibrate) navigator.vibrate(120); }
function cueCountdown() { tone(700, 0.11, 0.26); }
let lastTickSecond = null;

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
    // Cue sonori una sola volta per secondo (onTick gira ogni 250ms): preavviso a
    // 10s, poi countdown 3-2-1. Il suono di fine è in onEnd.
    if (remaining !== lastTickSecond) {
      if (remaining === 10) cueWarning();
      else if (remaining >= 1 && remaining <= 3) cueCountdown();
      lastTickSecond = remaining;
    }
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
  startSessionIfAbsent(); // primo recupero del giorno → avvia il cronometro sessione
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

let volExpanded = false;

// Riga volume di sessione con delta % vs stessa giornata della settimana precedente.
// Tappabile: espande/chiude il breakdown per gruppo muscolare.
function buildVolumeRow(vol, prevVol, byMuscle) {
  const wrap = document.createElement("div");
  const row = document.createElement("div");
  row.className = "volcard";
  row.setAttribute("role", "button");
  row.tabIndex = 0;
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
  const car = document.createElement("span"); car.className = "vcaret"; car.textContent = volExpanded ? "▴" : "▾";
  right.appendChild(car);
  row.append(l, right);
  row.addEventListener("click", () => { volExpanded = !volExpanded; renderVolRow(); });
  wrap.appendChild(row);
  if (volExpanded) wrap.appendChild(buildMuscleBreakdown(byMuscle));
  return wrap;
}

// Pannello barre orizzontali per gruppo muscolare (settimana corrente).
function buildMuscleBreakdown(byMuscle) {
  const box = document.createElement("div");
  box.className = "muscbreak";
  if (!byMuscle || !byMuscle.length) {
    const e = document.createElement("div"); e.className = "empty"; e.textContent = "Nessun volume registrato.";
    box.appendChild(e);
    return box;
  }
  const max = byMuscle[0].volume || 1;
  for (const { muscle, volume } of byMuscle) {
    const r = document.createElement("div"); r.className = "mb-row";
    const nm = document.createElement("span"); nm.className = "mb-nm"; nm.textContent = muscle;
    const barwrap = document.createElement("div"); barwrap.className = "mb-barwrap";
    const bar = document.createElement("div"); bar.className = "mb-bar"; bar.style.width = `${Math.round((volume / max) * 100)}%`;
    barwrap.appendChild(bar);
    const kg = document.createElement("span"); kg.className = "mb-kg"; kg.textContent = `${fmtKg(volume)} kg`;
    r.append(nm, barwrap, kg);
    box.appendChild(r);
  }
  return box;
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
function buildEditBlock(label, state, prev, bar = getBar(), unit = "reps") {
  const isSec = unit === "sec"; // esercizio a tempo (plank): niente kg, si registrano i secondi
  const block = document.createElement("div");
  block.className = "editblock";

  const lab = document.createElement("div");
  lab.className = "editlabel"; lab.textContent = label;
  block.appendChild(lab);

  // Stepper carico (solo per esercizi a ripetizioni). Per quelli a tempo il kg
  // non ha senso e resterebbe escluso dal volume, quindi lo si nasconde.
  let renderKg = () => {};
  if (!isSec) {
    const stepper = document.createElement("div");
    stepper.className = "stepper";
    const minus = document.createElement("span"); minus.className = "mb"; minus.textContent = "−0.5";
    const valWrap = document.createElement("span"); valWrap.className = "val";
    const num = document.createElement("input"); num.className = "num";
    num.type = "text"; num.setAttribute("inputmode", "decimal"); num.size = 4;
    num.autocomplete = "off"; num.placeholder = "—"; num.setAttribute("aria-label", "Peso in kg");
    const unitEl = document.createElement("span"); unitEl.className = "u"; unitEl.textContent = " kg";
    valWrap.append(num, unitEl);
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

    renderKg = ({ writeInput = true } = {}) => {
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
  }

  const reprow = document.createElement("div");
  reprow.className = "reprow";
  const repstep = document.createElement("div");
  repstep.className = "repstep";
  const rdec = document.createElement("span"); rdec.className = "rmb"; rdec.textContent = "−";
  const rc = document.createElement("div"); rc.className = "rc";
  const rv = document.createElement("input"); rv.className = "rv";
  rv.type = "text"; rv.setAttribute("inputmode", "numeric"); rv.size = 3;
  rv.autocomplete = "off"; rv.placeholder = "—"; rv.setAttribute("aria-label", isSec ? "Secondi" : "Ripetizioni");
  const rl = document.createElement("div"); rl.className = "l"; rl.textContent = isSec ? "Secondi" : "Ripetizioni";
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
  const step = isSec ? 5 : 1; // i secondi salgono a passi di 5
  bindHold(rdec, () => stepReps(-step));
  bindHold(rinc, () => stepReps(step));

  const chip = document.createElement("div");
  chip.className = "chip prevbest";
  const cv = document.createElement("div"); cv.className = "rv";
  cv.textContent = isSec
    ? (prev && prev.reps ? `${prev.reps} sec` : "—")
    : (prev && (prev.reps || prev.kg) ? `${prev.reps || "—"}×${prev.kg || "—"}` : "—");
  const cl = document.createElement("div"); cl.className = "l"; cl.textContent = "la volta scorsa";
  chip.append(cv, cl);
  reprow.appendChild(chip);
  block.appendChild(reprow);

  return { block, refresh: () => { renderKg(); renderReps(); } };
}

// Riga compatta col volume di un esercizio/traccia/superset (punto 6).
function buildVolLine(label, kg) {
  const d = document.createElement("div");
  d.className = "exvol";
  const l = document.createElement("span"); l.className = "exvol-l"; l.textContent = label;
  const v = document.createElement("span"); v.className = "exvol-v"; v.textContent = `${fmtKg(kg)} kg`;
  d.append(l, v);
  return d;
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

  const editors = opts.unit === "sec"
    ? [buildMiniStepper("secondi", setDlgState, "reps", 5)]
    : [buildMiniStepper("reps", setDlgState, "reps", 1), buildMiniStepper("kg", setDlgState, "kg", 0.5)];
  document.getElementById("setDlgEdit").replaceChildren(...editors);

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

// Mostra la striscia "com'è andata?" per l'ultima serie conclusa. Resta visibile
// (anche sull'ultima serie dell'esercizio: NON si chiude più il focus prima di
// poter valutare). Sui superset mostra DUE barre separate A e B, così si può dare
// una sensazione diversa a ciascuna traccia. La selezione corrente è evidenziata.
function showFeelAsk(info) {
  lastDone = info;
  const exId = exIdAt(info.idx);
  const labelN = document.getElementById("feelAskN");
  const host = document.getElementById("feelAskBar");

  const paint = () => {
    if (!lastDone) return;
    const v = getEntry(data, currentWeek, currentDay, exId);
    host.replaceChildren();
    if (info.superset) {
      labelN.textContent = String(info.aIdx + 1);
      const e = normalizeSupersetEntry(v);
      const mkTrack = (track, sIdx, name) => {
        const wrap = document.createElement("div"); wrap.className = "fa-track";
        const tl = document.createElement("span"); tl.className = "fa-tl"; tl.textContent = name;
        const cur = (track === "a" ? e.a : e.b).sets[sIdx]?.feel ?? "";
        const bar = buildRpeBar(cur, (feel) => {
          const cv = getEntry(data, currentWeek, currentDay, exId);
          data = setEntry(data, currentWeek, currentDay, exId, withSupersetSet(cv, track, sIdx, { feel }), new Date().toISOString());
          persist(info.idx);
          paint();   // riflette la selezione sulla barra
          render();  // aggiorna i badge nella lista/overlay
        });
        wrap.append(tl, bar);
        return wrap;
      };
      host.append(mkTrack("a", info.aIdx, "A"), mkTrack("b", info.bIdx, "B"));
    } else {
      labelN.textContent = String(info.setIndex + 1);
      const cur = normalizeEntry(v).sets[info.setIndex]?.feel ?? "";
      const bar = buildRpeBar(cur, (feel) => {
        const cv = getEntry(data, currentWeek, currentDay, exId);
        data = setEntry(data, currentWeek, currentDay, exId, withSet(cv, info.setIndex, { feel }), new Date().toISOString());
        persist(info.idx);
        paint();
        render();
      });
      host.append(bar);
    }
  };
  paint();
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

function setRow(i, set, prev, isCurrent, onRemove, onOpen, meta = { factor: 1, unit: "reps" }) {
  const isSec = meta.unit === "sec";
  const row = document.createElement("div");
  row.className = "srow" + (isCurrent ? " cur" : "") + (set.warmup ? " warm" : "");
  const idx = document.createElement("span"); idx.className = "i"; idx.textContent = set.warmup ? "W" : String(i + 1);
  const v = document.createElement("span"); v.className = "v";
  if (isSec) {
    v.append(document.createTextNode(set.reps || "—"));
    const u = document.createElement("span"); u.className = "u"; u.textContent = " sec";
    v.append(u);
  } else if (set.reps || set.kg) {
    v.append(document.createTextNode(set.reps || "—"));
    const x = document.createElement("span"); x.className = "x"; x.textContent = " × ";
    const u = document.createElement("span"); u.className = "u"; u.textContent = " kg";
    v.append(x, document.createTextNode(set.kg || "—"), u);
  } else {
    const x = document.createElement("span"); x.className = "x"; x.textContent = " × ";
    v.append(document.createTextNode("—"), x, document.createTextNode("—"));
  }
  // Volume della singola serie (con ×2 manubri); escluso per le serie a tempo.
  const sv = setVolume(set, meta);
  if (sv > 0) {
    const vol = document.createElement("span"); vol.className = "svol"; vol.textContent = ` · ${fmtKg(sv)} kg`;
    v.appendChild(vol);
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
  profileStorage.set("data", data);
  profileStorage.set("dirty", true);
  pusher.schedule();
}

// Salva `data` in locale (marcandolo dirty) e schedula il push cloud. Usato dalle
// mutazioni dell'editor scheda (esercizi e giorni) per non duplicare il pattern.
function scheduleSave() {
  profileStorage.set("data", data);
  profileStorage.set("dirty", true);
  pusher.schedule();
}

function renderFocusNormal(ex, idx, container, footer) {
  const exId = exIdAt(idx);
  const v = getEntry(data, currentWeek, currentDay, exId);
  const entry = normalizeEntry(v);
  const tgt = parseTarget(ex.setsReps, false);
  const meta = volumeMeta(ex, null); // { factor (×2 manubri), unit (reps|sec) }
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
      title: meta.unit === "sec" ? `Serie ${i + 1} · ${set.reps || "—"} sec` : `Serie ${i + 1} · ${set.reps || "—"} × ${set.kg || "—"} kg`,
      reps: set.reps, kg: set.kg, feel: set.feel, unit: meta.unit,
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
    setsBox.appendChild(setRow(i, set, prev[i] || null, isCurrent, onRemove, onOpen, meta));
  }
  container.appendChild(setsBox);

  if (!allDone) {
    const editLabel = meta.unit === "sec" ? `Serie ${curIdx + 1} — secondi` : `Serie ${curIdx + 1} — carico · step 0.5 kg`;
    const edit = buildEditBlock(editLabel, draft, prev[curIdx] || null, exerciseBar(ex, getBar()), meta.unit);
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
        feel: curSet.feel || "", unit: meta.unit,
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
      const _prevBest = bestKg(data, currentDay, exId);
      if (isSetRecord(_prevBest, draft.kg)) showRecordToast();
      data = setEntry(data, currentWeek, currentDay, exId,
        withSet(v, curIdx, { reps: draft.reps, kg: draft.kg, done: true, feel: entry.sets[curIdx]?.feel ?? "", comments: draft.comments }), new Date().toISOString());
      persist(idx);
      startRest(getRest(currentDay, exId, ex.restSeconds), ex.name);
      render();
      // Anche sull'ultima serie: mostra "com'è andata?" (prima si chiudeva il
      // focus e non si poteva valutare). Si torna alla lista con il tasto ←.
      showFeelAsk({ idx, superset: false, setIndex: curIdx });
    });
    footer.appendChild(cta);
  }
  const exVol = exerciseVolume(v, ex);
  if (exVol > 0) container.appendChild(buildVolLine(meta.factor === 2 ? "Volume esercizio · ×2 manubri" : "Volume esercizio", exVol));
  container.appendChild(buildNoteField(false, idx));
}

// Bozze separate per traccia A e B della serie corrente del superset.
let draftA = { kg: "", reps: "", comments: [] };
let draftB = { kg: "", reps: "", comments: [] };

function trackBlock(trackKey, trackName, trackEntry, tgtTrack, prevSets, state, idx, bar = getBar(), meta = { factor: 1, unit: "reps" }) {
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
      title: meta.unit === "sec" ? `${trackKey.toUpperCase()} · Serie ${i + 1} · ${set.reps || "—"} sec` : `${trackKey.toUpperCase()} · Serie ${i + 1} · ${set.reps || "—"} × ${set.kg || "—"} kg`,
      reps: set.reps, kg: set.kg, feel: set.feel, unit: meta.unit,
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
    setsBox.appendChild(setRow(i, set, prevSets[i] || null, i === curIdx, onRemove, onOpen, meta));
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
    const editLabel = meta.unit === "sec" ? `Serie ${curIdx + 1} ${trackKey.toUpperCase()} — secondi` : `Serie ${curIdx + 1} ${trackKey.toUpperCase()} — step 0.5 kg`;
    const edit = buildEditBlock(editLabel, state, prevSets[curIdx] || null, bar, meta.unit);
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
        feel: curSet.feel || "", unit: meta.unit,
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
  const metaA = volumeMeta(ex, "a"), metaB = volumeMeta(ex, "b");
  const a = trackBlock("a", nameA.trim(), e.a, tgt.a, prev.a, draftA, idx, ssBar, metaA);
  const b = trackBlock("b", nameB.trim(), e.b, tgt.b, prev.b, draftB, idx, ssBar, metaB);
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
      const _pa = bestKg(data, currentDay, exId, "a");
      const _pb = bestKg(data, currentDay, exId, "b");
      if (isSetRecord(_pa, draftA.kg) || isSetRecord(_pb, draftB.kg)) showRecordToast();
      let nv = withSupersetSet(v, "a", a.curIdx, { reps: draftA.reps, kg: draftA.kg, done: true, feel: e.a.sets[a.curIdx]?.feel ?? "", comments: draftA.comments });
      nv = withSupersetSet(nv, "b", b.curIdx, { reps: draftB.reps, kg: draftB.kg, done: true, feel: e.b.sets[b.curIdx]?.feel ?? "", comments: draftB.comments });
      data = setEntry(data, currentWeek, currentDay, exId, nv, new Date().toISOString());
      persist(idx);
      startRest(getRest(currentDay, exId, ex.restSeconds), ex.name);
      render();
      // Due barre A/B separate (sensazione indipendente per traccia); resta
      // aperto anche sull'ultima serie. Si torna alla lista con il tasto ←.
      showFeelAsk({ idx, superset: true, aIdx: a.curIdx, bIdx: b.curIdx });
    });
    footer.appendChild(cta);
  }
  // Volume per traccia + totale superset (con ×2 manubri; tracce a tempo escluse).
  const volA = e.a.sets.reduce((s, x) => s + setVolume(x, metaA), 0);
  const volB = e.b.sets.reduce((s, x) => s + setVolume(x, metaB), 0);
  if (volA > 0) container.appendChild(buildVolLine(`Volume A${metaA.factor === 2 ? " · ×2 manubri" : ""}`, volA));
  if (volB > 0) container.appendChild(buildVolLine(`Volume B${metaB.factor === 2 ? " · ×2 manubri" : ""}`, volB));
  if (volA + volB > 0) container.appendChild(buildVolLine("Totale superset", volA + volB));
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
    const exIdL = exIdAt(i);
    const isRec = ex.superset
      ? (isWeekRecord(data, currentDay, exIdL, currentWeek, "a") || isWeekRecord(data, currentDay, exIdL, currentWeek, "b"))
      : isWeekRecord(data, currentDay, exIdL, currentWeek);
    if (isComplete(i)) { const c = document.createElement("span"); c.className = "chk"; c.textContent = "✓"; right.appendChild(c); }
    else if (ex.superset) { const best = document.createElement("div"); best.className = "best"; best.textContent = "A·B"; const bl = document.createElement("div"); bl.className = "bl"; bl.textContent = "2 tracce"; right.append(best, bl); }
    else { const bk = bestKg(data, currentDay, exIdL); const best = document.createElement("div"); best.className = "best"; best.textContent = bk === null ? "—" : bk + " kg"; const bl = document.createElement("div"); bl.className = "bl"; bl.textContent = "best"; right.append(best, bl); }
    if (isRec) { const t = document.createElement("span"); t.className = "rec-badge"; t.textContent = "🏆"; t.title = "Record personale questa settimana"; right.appendChild(t); }
    const caret = document.createElement("span"); caret.className = "caret"; caret.textContent = "▾";
    r.append(id, mid, right, caret);
    item.appendChild(r);
    // Piede riga: sparkline (storico top-set) + azione log esplicita.
    const foot = document.createElement("div");
    foot.className = "ex-foot";
    const trend = exerciseTrend(data, currentDay, exIdL, currentWeek, 4, !!ex.superset);
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "spark");
    svg.setAttribute("height", "18");
    svg.setAttribute("width", "100%");
    svg.setAttribute("viewBox", "0 0 120 18");
    svg.setAttribute("preserveAspectRatio", "none");
    if (trend.length >= 2) {
      const geo = chartGeometry(trend, { width: 120, height: 18, padX: 2, padTop: 3, padBottom: 3, padRight: 4 });
      const pl = document.createElementNS(SVGNS, "polyline");
      pl.setAttribute("points", geo.points.map((p) => `${p.x},${p.y}`).join(" "));
      pl.setAttribute("fill", "none");
      pl.setAttribute("stroke", "var(--ac2)");
      pl.setAttribute("stroke-width", "1.5");
      svg.appendChild(pl);
      const last = geo.points[geo.points.length - 1];
      const dot = document.createElementNS(SVGNS, "circle");
      dot.setAttribute("cx", String(last.x)); dot.setAttribute("cy", String(last.y));
      dot.setAttribute("r", "2.2"); dot.setAttribute("fill", "var(--acc)");
      svg.appendChild(dot);
    } else {
      const pl = document.createElementNS(SVGNS, "polyline");
      pl.setAttribute("points", "2,9 60,9 118,9");
      pl.setAttribute("fill", "none"); pl.setAttribute("stroke", "var(--ctc)"); pl.setAttribute("stroke-width", "1.5");
      svg.appendChild(pl);
    }
    const logbtn = document.createElement("button");
    logbtn.type = "button";
    const done = isComplete(i);
    logbtn.className = "logbtn" + (done ? " fulldone" : "");
    logbtn.textContent = done ? "✓ fatto" : "› log";
    logbtn.addEventListener("click", (e) => { e.stopPropagation(); openFocus(i); });
    foot.append(svg, logbtn);
    item.appendChild(foot);
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

// Badge transitorio "record" sopra l'overlay esercizio. Si auto-rimuove.
function showRecordToast() {
  const host = document.getElementById("focusOverlay");
  if (!host || host.classList.contains("hidden")) return;
  let t = document.getElementById("recToast");
  if (!t) { t = document.createElement("div"); t.id = "recToast"; t.className = "rec-toast"; host.appendChild(t); }
  t.textContent = "🏆 record!";
  t.classList.remove("show"); void t.offsetWidth; t.classList.add("show");
  clearTimeout(showRecordToast._t);
  showRecordToast._t = setTimeout(() => t.classList.remove("show"), 1800);
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
    clearTimeout(showRecordToast._t);
    document.getElementById("recToast")?.remove();
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
  const byMuscle = volumeByMuscle(data, currentWeek, currentDay, dayPlan());
  root.appendChild(buildVolumeRow(vol, prevVol, byMuscle));
}

function render() {
  const empty = planIsEmpty(data);
  const es = document.getElementById("emptyState");
  const home = document.getElementById("homeMain");
  es.classList.toggle("hidden", !empty);
  es.setAttribute("aria-hidden", String(!empty));
  home.classList.toggle("hidden", empty);
  if (empty) return; // niente home (eviterebbe il fallback a PLAN); l'empty-state guida la creazione
  renderWeekSelect();
  renderHeader();
  renderProgress();
  renderList();
  renderVolRow();
  renderFocusOverlay();
  // Giorno completo → ferma il cronometro (congela la durata totale).
  const dp = dayPlan();
  if (dp.exercises.length && dp.exercises.every((_, i) => isComplete(i))) endSessionClock();
  renderSessClock();
}

// ---- Editing + saving ----

// ---- Week management ----
function changeWeek(key) {
  currentWeek = key;
  data = ensureWeek(data, currentWeek, data.weeks[currentWeek]?.label);
  openIndex = null;
  volExpanded = false;
  renderWeekSelect();
  render();
}
function changeDay(day) {
  currentDay = day;
  openIndex = null;
  volExpanded = false;
  render();
}
function newWeek() {
  // Prima settimana ISO libera (corrente, o la prossima se già esiste): sempre nuova.
  const key = nextFreeWeekKey(data.weeks);
  const label = prompt("Nome della nuova settimana:", key);
  if (label === null) return;
  data = ensureWeek(data, key, label || key);
  changeWeek(key);
  profileStorage.set("data", data);
  profileStorage.set("dirty", true);
  pusher.schedule();
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
    document.getElementById("barInput").value = getBar();
    document.getElementById("platesInput").value = getPlateSet().join(", ");
    renderQcList();
    document.getElementById("notifyToggle").checked = notifyOn();
    document.getElementById("fxGlowToggle").checked = getFx(localStorage, "glow");
    document.getElementById("fxScanToggle").checked = getFx(localStorage, "scan");
    // Blocca lo scroll della pagina sotto mentre il dialog è aperto:
    // su mobile il <dialog> nativo non sempre impedisce il rubber-band.
    document.documentElement.classList.add("modal-open");
    document.body.classList.add("modal-open");
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

  document.getElementById("fxGlowToggle").addEventListener("change", (e) => {
    setFx(localStorage, "glow", e.target.checked);
    applyFx(document.body, localStorage);
  });
  document.getElementById("fxScanToggle").addEventListener("change", (e) => {
    setFx(localStorage, "scan", e.target.checked);
    applyFx(document.body, localStorage);
  });

  dlg.addEventListener("close", () => {
    // Cleanup eventuale transform residuo da swipe
    dlg.style.transform = "";
    dlg.style.opacity = "";
    dlg.classList.remove("swiping");
    // Sblocca scroll pagina (vedi openSettings).
    document.documentElement.classList.remove("modal-open");
    document.body.classList.remove("modal-open");
    if (dlg.returnValue === "save") {
      localStorage.setItem(BAR_KEY, String(parseFloat(document.getElementById("barInput").value) || 20));
      localStorage.setItem(PLATES_KEY, document.getElementById("platesInput").value);
      profileStorage.set("data", data);
      profileStorage.set("dirty", true);
      pusher.schedule();
      render(); // ridipinge il calcolatore col nuovo set
    }
  });

  // X in alto a destra: chiude come "Chiudi" (returnValue vuoto, niente save).
  document.getElementById("settingsClose").addEventListener("click", () => dlg.close());

  // Swipe laterale per chiudere: trascina orizzontalmente >100px sull'area
  // non-interattiva (no input/textarea/select/button/label). Segue il dito con
  // translateX + fade, snap-back se sotto soglia, chiusura animata se sopra.
  const SWIPE_PX = 100;
  let sx = null, sy = null, locked = false; // locked=true → gesto già qualificato horiz
  const isControl = (el) => el && el.closest("input,textarea,select,button,label");
  const resetSwipe = () => {
    sx = sy = null; locked = false;
    dlg.classList.remove("swiping");
    dlg.style.transform = "";
    dlg.style.opacity = "";
  };
  dlg.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (isControl(e.target)) { resetSwipe(); return; }
    sx = e.clientX; sy = e.clientY; locked = false;
  });
  dlg.addEventListener("pointermove", (e) => {
    if (sx === null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (!locked) {
      // qualifica gesto: serve un minimo di movimento orizzontale dominante
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) return;
      if (Math.abs(dx) <= Math.abs(dy)) { resetSwipe(); return; } // scroll verticale → abort
      locked = true;
      dlg.classList.add("swiping");
    }
    dlg.style.transform = `translateX(${dx}px)`;
    dlg.style.opacity = String(Math.max(0.4, 1 - Math.abs(dx) / 400));
  });
  const onRelease = () => {
    if (!locked) { resetSwipe(); return; }
    const m = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(dlg.style.transform);
    const dx = m ? parseFloat(m[1]) : 0;
    if (Math.abs(dx) > SWIPE_PX) {
      // Vola fuori e chiudi (transition CSS gestisce l'animazione).
      dlg.classList.remove("swiping");
      const sign = dx < 0 ? -1 : 1;
      dlg.style.transform = `translateX(${sign * (window.innerWidth || 400)}px)`;
      dlg.style.opacity = "0";
      setTimeout(() => { dlg.close(); }, 180);
      sx = sy = null; locked = false;
    } else {
      // snap-back: togli .swiping, lascia la transition riportare a 0.
      dlg.classList.remove("swiping");
      dlg.style.transform = "";
      dlg.style.opacity = "";
      sx = sy = null; locked = false;
    }
  };
  dlg.addEventListener("pointerup", onRelease);
  dlg.addEventListener("pointercancel", () => resetSwipe());
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
async function boot() {
  localStorage.removeItem("gymsched_token"); // migration cleanup: legacy GitHub PAT
  // 1. Verifica sessione.
  const { data: sessionData } = await supabase.auth.getSession();
  session = sessionData.session;

  // 2. Bind dell'auth screen (idempotente, basta una volta).
  bindAuthScreen(supabase, {
    redirectTo: location.origin + location.pathname,
    onLoggedIn: () => location.reload(),
  });

  if (!session) {
    document.getElementById("auth-screen").hidden = false;
    document.getElementById("app").hidden = true;
    return;
  }

  // 3. Sessione attiva → mostra app, inizializza store.
  hideAuthScreen();
  profileStorage = new ProfileStorage(localStorage, session.user.id);
  applyFx(document.body, localStorage);
  store = new SupabaseStore(supabase);

  pusher = createPusher({
    getData: () => data,
    getVersion: () => dataVersion,
    setVersion: (v) => { dataVersion = v; profileStorage.set("version", v); },
    setDirty: (d) => profileStorage.set("dirty", d),
    store,
    onConflict: async () => {
      const remote = await store.load();
      const merged = mergeBlobs(data, remote.data);
      dataVersion = await store.save(merged, remote.version);
      data = merged;
      profileStorage.set("data", data);
      profileStorage.set("version", dataVersion);
      profileStorage.set("dirty", false);
      render();
    },
    onAuthError: async () => { await signOut(supabase); location.reload(); },
    onStatus: (s) => setStatus({pending:"sincronizzo ⧗",ok:"ok ✓",error:"offline ⧗"}[s], s),
  });

  // Wire UI event listeners (richiedono DOM visibile).
  wireSettings();

  // Account section bindings (session è garantita non-null qui).
  document.getElementById("accountEmail").textContent = session.user.email;
  document.getElementById("btnLogout").addEventListener("click", async () => {
    if (!confirm("Esci dall'account? I dati locali verranno cancellati (restano salvati nel cloud).")) return;
    await pusher?.flush().catch(() => {});
    profileStorage?.clear();
    await signOut(supabase);
    location.reload();
  });
  document.getElementById("btnImportLegacy").addEventListener("click", rescueLegacyLocalStorage);
  document.getElementById("btnRecoverCloud").addEventListener("click", recoverLogsFromOldCloud);
  document.getElementById("btnForceUpdate").addEventListener("click", forceAppUpdate);

  wireTimerControls();
  wireSetDialog();
  document.getElementById("weekSelect").addEventListener("change", (e) => changeWeek(e.target.value));
  document.getElementById("newWeekBtn").addEventListener("click", newWeek);
  document.getElementById("btnCreatePlan").addEventListener("click", () => openPlanEditor());
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
  document.getElementById("exDlgSave").addEventListener("click", saveExDialog);
  document.getElementById("exSuperset").addEventListener("change", (e) => toggleMuscleB(e.target.checked));
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

  // 4. Carica dati: prima da localStorage (mostra subito), poi da remote.
  const cached = profileStorage.get("data");
  if (cached) {
    data = cached;
    dataVersion = profileStorage.get("version") || 0;
    render();
  }

  try {
    const remote = await store.load();
    if (cached && profileStorage.get("dirty")) {
      // Locale dirty → merge + push.
      const merged = mergeBlobs(cached, remote.data);
      dataVersion = await store.save(merged, remote.version);
      data = merged;
      profileStorage.set("data", data);
      profileStorage.set("version", dataVersion);
      profileStorage.set("dirty", false);
    } else if (!cached || remote.version > (profileStorage.get("version") || 0)) {
      data = { ...remote.data, plan: Array.isArray(remote.data.plan) ? remote.data.plan : [] };
      dataVersion = remote.version;
      profileStorage.set("data", data);
      profileStorage.set("version", dataVersion);
    }
    // Una riga creata dal trigger di signup è la default del DB ({weeks:{},updatedAt:null},
    // senza `schema`): senza questo guard `migrate` rientrerebbe nel ramo seed e
    // crasherebbe (seedPlan undefined). Normalizzandola con i default di emptyData()
    // (schema corrente, plan vuoto) le migrazioni sono no-op e l'utente nuovo parte
    // vuoto, senza la scheda del proprietario. I dati già migrati (schema presente)
    // restano invariati: i loro valori vincono sullo spread.
    if (data && data.schema == null) data = { ...emptyData(), ...data };
    // Backfill schema sui dati appena letti (riusa logica esistente).
    data = patchPlanV5(patchPlanV4(backfillMuscles(migrate(data), PLAN)));
    render();
    setStatus("ok ✓", "ok");
  } catch (err) {
    if (err instanceof AuthError) {
      // Sessione invalidata: logout pulito.
      await signOut(supabase);
      location.reload();
      return;
    }
    setStatus("offline ⧗", "pending");
  }

  // 5. Listener auth changes (es. logout da altra tab).
  supabase.auth.onAuthStateChange((_event, newSession) => {
    if (!newSession && session) {
      // Logout
      profileStorage?.clear();
      location.reload();
    }
  });

  // 6. Flush + reconcile on visibility change (telefono+PC).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      pusher?.flush().catch(() => {});
    } else {
      reconcileFromRemote().catch(() => {});
    }
  });
}

// Rescue dei dati pre-cut-over a Supabase. Il vecchio app.js NON salvava il blob
// `data` in localStorage (caricava dal cloud data.json ad ogni boot), salvava solo
// i log non ancora pushati in `gymsched_pending` + qualche preferenza (`gymsched_bar`,
// `gymsched_plates`, ecc.). Il rescue legge ogni potenziale fonte e fa merge.
// Le chiavi legacy NON vengono cancellate: restano come backup.
function dumpGymschedKeys() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("gymsched")) {
      const v = localStorage.getItem(k) ?? "";
      out.push({ key: k, size: v.length });
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}
async function rescueLegacyLocalStorage() {
  const rawData = localStorage.getItem("gymsched_data");
  const rawPending = localStorage.getItem(PENDING_KEY);
  let legacy = null;
  let pendingList = [];
  if (rawData) {
    try { legacy = JSON.parse(rawData); } catch {
      alert("Dati locali legacy presenti ma corrotti — impossibile importare.");
      return;
    }
  }
  if (rawPending) {
    try { pendingList = JSON.parse(rawPending) || []; } catch { pendingList = []; }
  }
  const wkKeys = Object.keys(legacy?.weeks || {}).sort();
  if (wkKeys.length === 0 && pendingList.length === 0) {
    // Diagnostic: elenca tutte le chiavi gymsched_* presenti, così capiamo
    // dove sono finiti i dati (o se non ci sono mai stati su questo device).
    const keys = dumpGymschedKeys();
    const list = keys.length === 0
      ? "  (nessuna chiave 'gymsched_*' nel localStorage di questo browser)"
      : keys.map((k) => `  • ${k.key} — ${k.size} byte`).join("\n");
    alert(
      "Nessun dato di scheda trovato in localStorage.\n\n" +
      "Chiavi 'gymsched_*' presenti in questo browser:\n" + list + "\n\n" +
      "Account attivo: " + (session?.user?.email ?? "—") + "\n" +
      "Origine: " + location.origin + location.pathname + "\n\n" +
      "Se avevi gli allenamenti su un altro device o profilo, aprilo lì."
    );
    return;
  }
  const wkRange = wkKeys.length === 0 ? "—" : (wkKeys.length === 1 ? wkKeys[0] : `${wkKeys[0]} → ${wkKeys[wkKeys.length-1]}`);
  const summary = `Trovati dati locali:\n  • ${wkKeys.length} settimane (${wkRange})\n  • ${pendingList.length} log in coda non sincronizzati\n\nImportarli e sincronizzarli sul tuo account?\nI dati legacy resteranno come backup nel browser.`;
  if (!confirm(summary)) return;
  // Merge: il legacy ha precedenza sui sets non-vuoti (mergeBlobs(local=legacy, remote=data)).
  const merged = mergeBlobs(legacy ?? emptyData(), data ?? emptyData());
  // Applica eventuali pending non ancora sincronizzati sopra il merged.
  let withPending = merged;
  for (const e of pendingList) {
    try { withPending = setEntry(withPending, e.weekKey, e.day, e.idx, e.value, new Date().toISOString()); } catch {}
  }
  data = patchPlanV5(patchPlanV4(backfillMuscles(migrate(withPending, PLAN), PLAN)));
  profileStorage.set("data", data);
  profileStorage.set("dirty", true);
  pusher.schedule();
  render();
  alert(`Importate ${wkKeys.length} settimane (${wkRange}) e ${pendingList.length} log in coda.\nSincronizzazione cloud in corso…`);
}

// Forza aggiornamento app: cancella tutte le cache del SW, deregistra il SW e
// ricarica. Escape hatch per quando il banner "nuova versione" non compare
// (es. browser HTTP cache serve sw.js stale). Distruttivo solo per la app-shell:
// i dati utente vivono in localStorage namespacizzato + Supabase, intoccati.
async function forceAppUpdate() {
  if (!confirm("Forza l'aggiornamento dell'app?\n\nCancellerà la cache locale dell'app (NON i tuoi dati di allenamento, che sono su Supabase) e ricaricherà la pagina per scaricare la versione più recente.")) return;
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
    }
  } catch (err) {
    alert("Errore durante il reset cache: " + (err?.message ?? err) + "\nProvo a ricaricare comunque.");
  }
  // Ricarica forzando bypass cache HTTP (best-effort, dipende dal browser).
  location.reload();
}

// Recovery dei log storici dal vecchio cloud (data.json su GitHub Pages, sorgente
// di verità pre-cut-over a Supabase). Fa una merge non distruttiva: pickEntry tiene
// l'entry con più set non vuoti, quindi i set già loggati su Supabase NON vengono
// sovrascritti, mentre i log mancanti vengono ripristinati da data.json.
async function recoverLogsFromOldCloud() {
  let seed;
  try {
    const res = await fetch(SEED_URL, { cache: "no-store" });
    if (!res.ok) {
      alert(`Errore HTTP ${res.status} scaricando data.json.\nURL: ${SEED_URL}`);
      return;
    }
    seed = await res.json();
  } catch (err) {
    alert(`Errore di rete scaricando data.json:\n${err?.message ?? err}\n\nURL: ${SEED_URL}`);
    return;
  }
  const seedWeeks = Object.keys(seed?.weeks ?? {}).sort();
  if (seedWeeks.length === 0) {
    alert("data.json non contiene settimane. Nulla da recuperare.");
    return;
  }
  let seedSets = 0;
  for (const wk of seedWeeks) {
    const ent = seed.weeks[wk]?.entries ?? {};
    for (const day of Object.keys(ent)) {
      for (const ex of Object.keys(ent[day] ?? {})) {
        seedSets += (ent[day][ex].sets ?? []).length;
      }
    }
  }
  const curWeeks = Object.keys(data?.weeks ?? {}).length;
  const range = seedWeeks.length === 1 ? seedWeeks[0] : `${seedWeeks[0]} → ${seedWeeks[seedWeeks.length - 1]}`;
  const ok = confirm(
    `Trovati nel vecchio cloud (data.json):\n` +
    `  • ${seedWeeks.length} settimane (${range})\n` +
    `  • ${seedSets} set totali loggati\n\n` +
    `Verranno UNITI ai dati attuali (${curWeeks} settimane su Supabase). ` +
    `I set già presenti non vengono toccati; quelli mancanti vengono ripristinati.\n\n` +
    `Procedere?`
  );
  if (!ok) return;
  const merged = mergeBlobs(data ?? emptyData(), seed);
  data = patchPlanV5(patchPlanV4(backfillMuscles(migrate(merged), PLAN)));
  profileStorage.set("data", data);
  profileStorage.set("dirty", true);
  pusher.schedule();
  render();
  alert(
    `Recupero completato.\n` +
    `Settimane totali ora: ${Object.keys(data.weeks ?? {}).length}\n` +
    `Sincronizzazione cloud in corso…`
  );
}

async function reconcileFromRemote() {
  if (!store || !session) return;
  try {
    const remote = await store.load();
    if (remote.version === dataVersion) return; // nessun cambio
    const merged = mergeBlobs(data, remote.data);
    dataVersion = await store.save(merged, remote.version);
    data = merged;
    profileStorage.set("data", data);
    profileStorage.set("version", dataVersion);
    render();
  } catch (err) {
    if (err instanceof ConflictError) {
      // Race: ritenta una volta.
      return reconcileFromRemote();
    }
  }
}

window.addEventListener("load", boot);

// Aggiorna la durata della sessione ogni secondo (no-op finché il cronometro è nascosto).
setInterval(renderSessClock, 1000);

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
    // updateViaCache:'none' → fetch del file sw.js NON usa il cache HTTP del
    // browser. Senza questo, GitHub Pages può servire un sw.js stale (Cache-
    // Control: max-age) e reg.update() non rileva mai la nuova versione → il
    // banner di aggiornamento non appare. Il fetch degli asset (in install)
    // resta separato: usa il proprio `cache:'reload'` (vedi sw.js).
    navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).then((reg) => {
      swReg = reg;
      reg.update().catch(() => {});
      // Poll ogni 60s mentre la tab è visibile: così se l'utente tiene aperta
      // l'app durante il giorno il banner spunta senza dover ricaricare.
      setInterval(() => {
        if (document.visibilityState === "visible") reg.update().catch(() => {});
      }, 60_000);
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
      // Se c'è già un SW "waiting" alla registrazione (es. installato prima,
      // ma updatefound già scattato in una run precedente del tab), mostra
      // subito il banner: senza questo, l'utente non ne vede mai notizia.
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBanner(reg);
    }).catch(() => { /* SW non disponibile */ });
  });
}
