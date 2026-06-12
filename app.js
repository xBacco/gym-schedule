import { PLAN } from "./plan.js";
import { migrate, backfillMuscles, patchPlanV4, patchPlanV5, keepLocalPlan } from "./editor.js";
import {
  isoWeekKey, nextFreeWeekKey, emptyData, ensureWeek, setEntry, getEntry,
  normalizeEntry, normalizeSupersetEntry, prefillSets, platesPerSide, exerciseBar,
  SupabaseStore, mergeBlobs, ConflictError, AuthError, planIsEmpty,
} from "./store.js";
import { hydrate, dehydrate } from "./sheets.js";
import { seedCatalogIfAbsent, migrateExerciseName, backfillCatalogSecondaries } from "./catalog.js";
import { supabase } from "./supabase-client.js";
import { bindAuthScreen, hideAuthScreen, signOut } from "./auth.js";
import { ProfileStorage } from "./profile-storage.js";
import {
  parseTarget, activeSetIndex, isEntryComplete, bestKg, isWeekRecord, isSetRecord, progressionDelta,
  historyIsBodyweight, bestReps,
  withSet, withoutSet, withSupersetSet, withoutSupersetSet, withNote, previousNote,
  previousSetInSession, previousWeekSet,
  sessionVolume, volumeByMuscle, exerciseTrend, nextExercisePreview,
  topSetSeries, chartGeometry,
  sessionDates, monthGrid, sessionHasDoneSet,
  lastWorkingSet,
  volumeMeta, platesOn, exerciseVolume, setVolume, supersetTrackKeys, trackName,
} from "./session.js";
import { RestTimer, formatTime, withoutSession, goSlug, VisibleCountdown, normalizeSessionEntry, elapsedMs, sessionState } from "./timer.js";
import { ScreenWakeLock } from "./wakelock.js";
import { renderNutritionGuide } from "./nutrition.js";
import { createPusher } from "./sync.js";
import { getFx, setFx, applyFx } from "./fx.js";
import { getTheme, setTheme, applyTheme } from "./theme.js";
import { actionBarSpec } from "./focus-ui.js";
import { APP_VERSION, STORE_UPDATE_ENABLED, checkStoreUpdate } from "./release.js";
import {
  DECRYPT_GLYPHS, DECRYPT_TICK_MS, WORD_DELAY_MS, CAP_DELAY_MS,
  REDUCE_MIN_MS, FULL_MIN_MS, isLocked, decryptDone,
} from "./splash.js";
import { ctx } from "./app-context.js";
import { ensureAudio, beep, cueWarning, cueCountdown } from "./cues.js";
import {
  PENDING_KEY, BAR_KEY, PLATES_KEY, NOTIFY_KEY,
  bufferEdit, getRest, setRest, getBar, getPlateSet, notifyOn,
  getTimerVol, setTimerVol, getQuickComments, setQuickComments,
} from "./local-prefs.js";
import { openCalendar, closeCalendar, calShiftMonth, renderCalendar, closeCalDay, setCalMetric } from "./calendar.js";
import { openScan, closeScan, renderScan, setScanTab } from "./scan-ui.js";
import { openCatalog, closeCatalog, renderCatalog, openCatalogForm, setDbFilter, dbCloseModal } from "./catalog-ui.js";
import { openPlanEditor, closePlanEditor, renderPlanEditor, wireExerciseDialog } from "./plan-editor.js";
import { openSheets, closeSheets, renderSheets } from "./sheets-ui.js";

const SEED_URL = "https://xbacco.github.io/gym-schedule/data.json";

// ---- App state ----
let data = emptyData();
let sha = null;
let currentWeek = isoWeekKey(new Date());
let currentDay = "A";
let openIndex = null;        // esercizio aperto nel focus a schermo intero (null = nessuno)
let focusDrawerOpen = false; // cassetto "⋯ Altro" del focus esercizio (UI effimera, non persistita)
let store = null;
let session = null;        // { user: {id, email}, ... } da Supabase
let profileStorage = null; // ProfileStorage per la sessione corrente
let dataVersion = 0;       // optimistic lock version (sostituisce 'sha')
let planOpen = false;      // overlay editor scheda aperto: logica in plan-editor.js, stato qui per il bridge

// Stato del dialog progressione
let chartExId = null;   // id esercizio mostrato
let chartTrack = null;  // null | "a" | "b"
let chartAll = false;   // false = ultime 3 settimane, true = tutto lo storico
let pusher = null;

// Bridge: espone i local di app.js come proprietà vive di ctx, così i moduli
// estratti leggono/scrivono ctx.<x> senza che app.js cambi i propri riferimenti.
// I getter sono lazy (arrow): nutritionOpen è dichiarato più sotto (sezione
// nutrition), ma viene letto solo a runtime (a quel punto inizializzato).
Object.defineProperties(ctx, {
  data:           { get: () => data,           set: (v) => { data = v; },           configurable: true },
  currentWeek:    { get: () => currentWeek,    set: (v) => { currentWeek = v; },    configurable: true },
  currentDay:     { get: () => currentDay,     set: (v) => { currentDay = v; },     configurable: true },
  openIndex:      { get: () => openIndex,      set: (v) => { openIndex = v; },      configurable: true },
  nutritionOpen:  { get: () => nutritionOpen,  set: (v) => { nutritionOpen = v; },  configurable: true },
  planOpen:       { get: () => planOpen,       set: (v) => { planOpen = v; },       configurable: true },
  store:          { get: () => store,          set: (v) => { store = v; },          configurable: true },
  session:        { get: () => session,        set: (v) => { session = v; },        configurable: true },
  profileStorage: { get: () => profileStorage, set: (v) => { profileStorage = v; }, configurable: true },
  dataVersion:    { get: () => dataVersion,    set: (v) => { dataVersion = v; },    configurable: true },
  pusher:         { get: () => pusher,         set: (v) => { pusher = v; },         configurable: true },
});
ctx.render = render; // render è una function declaration (hoisted)
ctx.weekLabel = weekLabel;       // function hoisted, usata da calendar.js (pop-up sessione)
ctx.scheduleSave = scheduleSave; // function hoisted, usata da catalog-ui.js (mutateCatalog)
ctx.openCalendar = openCalendar; // import da calendar.js; lo userà il drawer (Ondata 2)
ctx.openScan = openScan;         // import da scan-ui.js; lo userà il drawer (Ondata 2)
ctx.openCatalog = openCatalog;   // import da catalog-ui.js; lo userà il drawer (Ondata 2)
ctx.openPlanEditor = openPlanEditor; // import da plan-editor.js; lo useranno drawer (Ondata 2) e sheets-ui
ctx.openSheets = openSheets;     // import da sheets-ui.js; lo userà il drawer (Ondata 2)

// L'overlay dell'esercizio è registrato come voce di history, così la gesture
// "indietro" del telefono (swipe dal bordo / tasto back) chiude l'esercizio
// invece di uscire dall'app. open → pushState; chiusura in-app → history.back()
// (che fa scattare popstate, dove avviene la chiusura vera).
function openFocus(i) {
  openIndex = i;
  focusDrawerOpen = false;
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

// ---- Calendario allenamenti: overlay estratto in calendar.js ----

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

// ---- Calendario (heatmap mese, grafico progressione, pop-up sessione)
//      estratto in calendar.js ----

// ---- Preferenze localStorage (pending buffer, rest override, calcolatore
//      dischi, volume timer, commenti veloci) estratte in local-prefs.js ----

// ---- Cronometro sessione: durata totale dell'allenamento, per (settimana, giorno).
// Parte al primo recupero avviato del giorno, si ferma quando il giorno è completo.
// Solo locale (un allenamento si fa su un dispositivo). ----
const SESSION_KEY = "gymsched_session";
const getSessionMap = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "{}"); } catch (_) { return {}; } };
const setSessionMap = (m) => localStorage.setItem(SESSION_KEY, JSON.stringify(m));
const sessClockKey = () => `${currentWeek}-${currentDay}`;
function startSessionIfAbsent() {
  const m = getSessionMap(); const k = sessClockKey();
  if (!m[k] || !m[k].start) { m[k] = { start: new Date().toISOString(), end: null, pausedAt: null, pausedMs: 0 }; setSessionMap(m); }
}

// Avvio esplicito dal bottone "Avvia allenamento" (stato PRONTO).
function startSession() {
  const m = getSessionMap(); const k = sessClockKey();
  m[k] = { start: new Date().toISOString(), end: null, pausedAt: null, pausedMs: 0 };
  setSessionMap(m);
  renderSessionControl();
}

// Mette in pausa: marca pausedAt (solo se in corso).
function pauseSession() {
  const m = getSessionMap(); const k = sessClockKey();
  const c = m[k];
  if (c && c.start && !c.end && !c.pausedAt) { c.pausedAt = new Date().toISOString(); setSessionMap(m); renderSessionControl(); }
}

// Riprende: ripiega l'intervallo di pausa in pausedMs e azzera pausedAt.
function resumeSession() {
  const m = getSessionMap(); const k = sessClockKey();
  const c = m[k];
  if (c && c.pausedAt) {
    c.pausedMs = (Number(c.pausedMs) || 0) + (Date.now() - Date.parse(c.pausedAt));
    c.pausedAt = null;
    setSessionMap(m);
    renderSessionControl();
  }
}
function endSessionClock() {
  const m = getSessionMap(); const k = sessClockKey();
  const c = m[k];
  if (c && c.start && !c.end) {
    if (c.pausedAt) { c.pausedMs = (Number(c.pausedMs) || 0) + (Date.now() - Date.parse(c.pausedAt)); c.pausedAt = null; }
    c.end = new Date().toISOString();
    setSessionMap(m);
    renderSessionControl();
  }
}
function fmtDuration(totalSec) {
  let s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600); s %= 3600;
  const m = Math.floor(s / 60); s %= 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return (h ? `${h}:${mm}` : `${mm}`) + `:${String(s).padStart(2, "0")}`;
}
// Testo del cronometro per la status bar dell'overlay: "" se PRONTO, altrimenti
// "⏱ MM:SS · ". Centralizzato (usato da renderFocusOverlay e tickSessionDisplays).
function clockText(entry, now) {
  return sessionState(entry) === "PRONTO" ? "" : "⏱ " + fmtDuration(elapsedMs(entry, now) / 1000) + " · ";
}
// Annulla il cronometro del giorno corrente (es. sessione avviata per sbaglio).
// Rimuove SOLO la voce gymsched_session: le serie loggate (in `data`) restano intatte.
function cancelSessionClock() {
  setSessionMap(withoutSession(getSessionMap(), sessClockKey()));
  renderSessionControl();
}
function renderSessionControl() {
  const el = document.getElementById("sessClock");
  if (!el) return;
  // Piano vuoto → nessuno slot (l'empty-state guida la creazione).
  if (planIsEmpty(data)) { el.replaceChildren(); el.classList.add("hidden"); el.dataset.state = "EMPTY"; return; }

  const entry = getSessionMap()[sessClockKey()];
  const state = sessionState(entry);
  el.classList.remove("hidden");
  el.classList.toggle("ended", state === "FINITO");
  el.classList.toggle("ready", state === "PRONTO");
  el.classList.toggle("running", state === "IN_CORSO");
  el.classList.toggle("paused", state === "IN_PAUSA");
  el.dataset.state = state;

  if (state === "PRONTO") {
    const go = document.createElement("button");
    go.type = "button";
    go.className = "sc-start";
    go.textContent = "▶ Avvia allenamento";
    go.addEventListener("click", (e) => { e.stopPropagation(); startSession(); });
    el.replaceChildren(go);
    return;
  }

  const secs = elapsedMs(entry, Date.now()) / 1000;
  const txt = document.createElement("span");
  txt.className = "sc-t";
  txt.id = "sessClockText";
  txt.textContent = fmtDuration(secs); // SOLO il tempo: il tick aggiorna questo nodo
  // Gruppo sinistro: indicatore + label + tempo. Con `.sc-left{flex:1}` (CSS)
  // riempie la riga full-width e spinge i controlli al bordo destro.
  const scLeft = document.createElement("span");
  scLeft.className = "sc-left";
  if (state === "IN_CORSO") {
    const dot = document.createElement("span");
    dot.className = "sc-dot";
    scLeft.append(dot, document.createTextNode("in corso · "), txt);
  } else if (state === "IN_PAUSA") {
    const ico = document.createElement("span");
    ico.className = "sc-ico";
    ico.textContent = "⏸";
    scLeft.append(ico, document.createTextNode("in pausa · "), txt);
  } else { // FINITO
    scLeft.append(document.createTextNode("⏱ allenamento "), txt);
  }
  el.replaceChildren(scLeft);

  if (state === "FINITO") return; // congelato, nessun controllo

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "sc-toggle";
  toggle.textContent = state === "IN_PAUSA" ? "▶" : "⏸";
  toggle.setAttribute("aria-label", state === "IN_PAUSA" ? "Riprendi allenamento" : "Pausa allenamento");
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    if (sessionState(getSessionMap()[sessClockKey()]) === "IN_PAUSA") resumeSession();
    else pauseSession();
  });

  const x = document.createElement("button");
  x.type = "button";
  x.className = "sc-x";
  x.textContent = "✕";
  x.setAttribute("aria-label", "Annulla cronometro");
  x.addEventListener("click", (e) => {
    e.stopPropagation();
    if (confirm("Annullare il cronometro di questo allenamento? Le serie loggate restano salvate.")) cancelSessionClock();
  });

  el.append(toggle, x);
}

// Tick 1s: aggiorna lo slot home e, se l'overlay è aperto, solo il testo del
// tempo nella status bar (niente re-render dell'intero overlay ogni secondo).
function tickSessionDisplays() {
  const el = document.getElementById("sessClock");
  const entry = getSessionMap()[sessClockKey()];
  const target = planIsEmpty(data) ? "EMPTY" : sessionState(entry);
  // Rebuild completo SOLO al cambio di stato (così il pallino .sc-dot non si
  // resetta a ogni secondo). A stato invariato aggiorna solo il testo del tempo.
  if (!el || el.dataset.state !== target) {
    renderSessionControl();
  } else if (target === "IN_CORSO" || target === "IN_PAUSA" || target === "FINITO") {
    const t = document.getElementById("sessClockText");
    if (t) t.textContent = fmtDuration(elapsedMs(entry, Date.now()) / 1000);
  }
  if (openIndex !== null) {
    const clk = document.getElementById("focusSbarClock");
    if (clk) clk.textContent = clockText(entry, Date.now());
  }
}

// ---- Status indicator ----
function setStatus(text, kind = "") {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

// ---- End-of-rest notification: audio/vibrazione estratti in cues.js ----
let lastTickSecond = null;

// ---- Timer wiring ----
// Contesto dell'ultimo recupero per lo stato GO: durata impostata + comando da
// mostrare allo 0:00 ({fine:true} | {slug, serie}). Settato da startRest.
let restCtx = null;
const timer = new RestTimer({
  onTick: (remaining, label) => {
    document.getElementById("timerTime").textContent = formatTime(remaining);
    document.getElementById("timerLabel").textContent = label;
    document.getElementById("timerTime").classList.toggle("final", remaining > 0 && remaining <= 3);
    // Cue sonori una sola volta per secondo (onTick gira ogni 250ms): preavviso a
    // 10s, poi countdown 3-2-1. Il suono di fine è in onEnd.
    if (remaining !== lastTickSecond) {
      if (remaining === 10) cueWarning();
      else if (remaining >= 1 && remaining <= 3) cueCountdown();
      lastTickSecond = remaining;
    }
  },
  onEnd: (label) => {
    // Giudizio ultima serie ancora in finestra 1.2s: l'avanzamento non va perso
    // quando la scadenza del recupero chiude il feel-ask al posto del timeout.
    const _adv = (scheduleFeelAskClose._t != null && scheduleFeelAskClose._info?.last)
      ? scheduleFeelAskClose._info.idx : null;
    hideFeelAsk();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    beep();
    if (document.hidden && notifyOn() && swReg) {
      swReg.showNotification("Recupero finito", {
        body: (label ? label + " · " : "") + "prossima serie",
        tag: "rest-done", renotify: true, vibrate: [200, 100, 200], icon: "./icon.svg",
      }).catch(() => {});
    }
    showTimerGo(label); // persistente: si chiude solo col tap (anche tornando dall'app in background)
    if (_adv !== null) advanceAfterExercise(_adv);
  },
});
const wakeLock = new ScreenWakeLock();

// Auto-dismiss dello stato GO: 8s di schermo visibile (spec §3, mockup go-dismiss B).
const goDismiss = new VisibleCountdown({ durationMs: 8000, onDone: () => dismissTimerGo() });
function goDrainRun() {
  const d = document.getElementById("goDrain");
  d.style.transition = "none";
  d.style.width = Math.round((goDismiss.remaining / goDismiss.durationMs) * 100) + "%";
  void d.offsetWidth; // reflow: parte dallo stato corrente
  d.style.transition = `width ${goDismiss.remaining}ms linear`;
  d.style.width = "0%";
}
function goDrainFreeze() {
  const d = document.getElementById("goDrain");
  d.style.width = getComputedStyle(d).width; // congela il valore animato
  d.style.transition = "none";
}

// Trasforma la barra nello stato GO "boot log". Resta finché non viene toccata.
function showTimerGo(label) {
  const go = restCtx?.go;
  document.getElementById("goRest").textContent = formatTime(restCtx?.seconds ?? 0);
  if (go?.fine) {
    document.getElementById("goVerb").textContent = "fine";
    document.getElementById("goPath").textContent = "./sessione --done";
  } else {
    document.getElementById("goVerb").textContent = "vai";
    document.getElementById("goPath").textContent =
      `./${go?.slug ?? goSlug(label)} --serie ${go?.serie ?? 1}`;
  }
  document.getElementById("timerTime").classList.remove("final");
  document.getElementById("timerRun").classList.add("hidden");
  document.getElementById("timerGo").classList.remove("hidden");
  document.getElementById("timerBar").classList.add("go-on");
  document.body.classList.remove("scroll-lock"); // GO = scroll di nuovo libero
  goDismiss.start(!document.hidden);
  if (!document.hidden) goDrainRun();
}

// Chiude lo stato GO e nasconde la barra (tap dell'utente).
function dismissTimerGo() {
  goDismiss.cancel();
  document.body.classList.remove("scroll-lock");
  document.getElementById("timerGo").classList.add("hidden");
  document.getElementById("timerRun").classList.remove("hidden");
  document.getElementById("timerBar").classList.add("hidden");
  document.getElementById("timerBar").classList.remove("go-on");
  document.body.classList.remove("timer-on");
  wakeLock.disable();
  document.getElementById("timerResume").classList.add("hidden");
}

// ✕ sul recupero: NON distrugge. Mette in pausa il timer e collassa la barra
// nella chip "riprendi" (resti in recupero: wakeLock attivo, barra visibile slim).
function collapseRest() {
  timer.pause(); // no-op se già in pausa (es. arrivati qui da ⏸)
  document.getElementById("timerRun").classList.add("hidden");
  document.getElementById("resumeTime").textContent = formatTime(timer.pausedRemaining);
  document.getElementById("timerResume").classList.remove("hidden");
  document.body.classList.remove("scroll-lock");
}

// Tap sulla chip: riapre il recupero e riprende il conto.
function expandRest() {
  document.getElementById("timerResume").classList.add("hidden");
  document.getElementById("timerRun").classList.remove("hidden");
  document.getElementById("tToggle").textContent = "⏸";
  document.body.classList.add("scroll-lock");
  timer.resume();
}

// × sulla chip: chiusura vera (vecchio comportamento di tStop).
function discardRest() {
  document.getElementById("timerResume").classList.add("hidden");
  timer.stop();
  hideFeelAsk();
  dismissTimerGo();
}

function startRest(seconds, label, go = null) {
  ensureAudio(); // unlock audio within the user gesture
  startSessionIfAbsent(); // primo recupero del giorno → avvia il cronometro sessione
  wakeLock.enable();
  restCtx = { seconds, go };
  document.getElementById("timerGo").classList.add("hidden");
  document.getElementById("timerRun").classList.remove("hidden");
  document.getElementById("timerResume").classList.add("hidden");
  document.getElementById("timerBar").classList.remove("go-on");
  document.body.classList.add("timer-on");
  goDismiss.cancel();
  document.body.classList.add("scroll-lock");
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
ctx.RPE_LABEL = RPE_LABEL; // usato da calendar.js (calExerciseRows)

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
function buildEditBlock(label, state, prev, bar = getBar(), unit = "reps", showPlates = true) {
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

    let renderPlates = () => {};
    if (showPlates) {
      const platesLine = document.createElement("div");
      platesLine.className = "plates";
      block.appendChild(platesLine);
      renderPlates = () => {
        const n = parseFloat(String(state.kg).replace(",", "."));
        if (!Number.isFinite(n) || n <= 0) { platesLine.textContent = ""; return; }
        const { perSide, leftover } = platesPerSide(n, { bar, plates: getPlateSet() });
        if (!perSide.length) { platesLine.textContent = `per lato: — (≤ bilanciere ${bar} kg)`; return; }
        platesLine.textContent = `per lato: ${perSide.join(" + ")}` + (leftover > 0 ? `  (+${leftover} scoperto)` : "");
      };
    }

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
// { idx, superset:true, tracks:[{track,idx},…], last } (una barra RPE per traccia).
let lastDone = null;

// Chiusura programmata del feel-ask (1.2s dopo il giudizio): si vede la
// conferma, poi il pannello sparisce da solo così il prossimo esercizio è
// visibile. Un secondo tap entro la finestra sostituisce il giudizio e
// riparte il timer. Sull'ultima serie chiude anche l'esercizio e avanza.
function scheduleFeelAskClose(info) {
  clearTimeout(scheduleFeelAskClose._t);
  scheduleFeelAskClose._info = info;
  scheduleFeelAskClose._t = setTimeout(() => {
    scheduleFeelAskClose._t = null;
    scheduleFeelAskClose._info = null;
    hideFeelAsk();
    if (info.last) advanceAfterExercise(info.idx);
  }, 1200);
}

// Esercizio finito e valutato: chiudi il focus corrente e apri il prossimo
// esercizio della sessione (se c'è; altrimenti torna alla lista).
function advanceAfterExercise(idx) {
  const exs = dayPlan().exercises;
  if (idx + 1 < exs.length) {
    openIndex = idx + 1;
    render();
  } else {
    closeFocus();
  }
}

// Mostra la striscia "com'è andata?" per l'ultima serie conclusa. Resta visibile
// (anche sull'ultima serie dell'esercizio: NON si chiude più il focus prima di
// poter valutare). Sui superset mostra una barra RPE per ogni traccia (N tracce).
// La selezione corrente è evidenziata.
function showFeelAsk(info) {
  clearTimeout(scheduleFeelAskClose._t); // riapertura: annulla l'auto-chiusura pendente del giudizio precedente
  scheduleFeelAskClose._t = null;
  scheduleFeelAskClose._info = null;
  lastDone = info;
  const exId = exIdAt(info.idx);
  const labelN = document.getElementById("feelAskN");
  const host = document.getElementById("feelAskBar");

  const paint = () => {
    if (!lastDone) return;
    const v = getEntry(data, currentWeek, currentDay, exId);
    host.replaceChildren();
    if (info.superset) {
      const tracks = info.tracks ?? [];
      labelN.textContent = String((tracks[0]?.idx ?? 0) + 1);
      const e = normalizeSupersetEntry(v);
      const mkTrack = (track, sIdx, name) => {
        const wrap = document.createElement("div"); wrap.className = "fa-track";
        const tl = document.createElement("span"); tl.className = "fa-tl"; tl.textContent = name;
        const cur = e[track].sets[sIdx]?.feel ?? "";
        const bar = buildRpeBar(cur, (feel) => {
          const cv = getEntry(data, currentWeek, currentDay, exId);
          data = setEntry(data, currentWeek, currentDay, exId, withSupersetSet(cv, track, sIdx, { feel }), new Date().toISOString());
          persist(info.idx);
          paint();   // riflette la selezione sulla barra
          render();  // aggiorna i badge nella lista/overlay
          const e2 = normalizeSupersetEntry(getEntry(data, currentWeek, currentDay, exId));
          if (tracks.every((t) => e2[t.track].sets[t.idx]?.feel)) scheduleFeelAskClose(info);
        });
        wrap.append(tl, bar);
        return wrap;
      };
      host.append(...tracks.map((t) => mkTrack(t.track, t.idx, t.track.toUpperCase())));
    } else {
      labelN.textContent = String(info.setIndex + 1);
      const cur = normalizeEntry(v).sets[info.setIndex]?.feel ?? "";
      const bar = buildRpeBar(cur, (feel) => {
        const cv = getEntry(data, currentWeek, currentDay, exId);
        data = setEntry(data, currentWeek, currentDay, exId, withSet(cv, info.setIndex, { feel }), new Date().toISOString());
        persist(info.idx);
        paint();
        render();
        scheduleFeelAskClose(info);
      });
      host.append(bar);
    }
  };
  paint();
  document.getElementById("feelAsk").classList.remove("hidden");
  document.body.classList.add("feel-on"); // padding extra nel focus: lo stack ora è più alto
}

function hideFeelAsk() {
  clearTimeout(scheduleFeelAskClose._t);
  scheduleFeelAskClose._t = null;
  scheduleFeelAskClose._info = null;
  document.getElementById("feelAsk").classList.add("hidden");
  document.body.classList.remove("feel-on");
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

function setRow(i, set, prev, isCurrent, onRemove, onOpen, meta = { factor: 1, unit: "reps" }, onComment = null) {
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
  if (set.done && !set.warmup && onComment) {
    const cb = document.createElement("span");
    cb.className = "cmt-btn" + ((set.comments && set.comments.length) ? " on" : "");
    cb.textContent = "💬";
    cb.title = "Commenti serie";
    cb.addEventListener("click", (e) => { e.stopPropagation(); onComment(); });
    row.appendChild(cb);
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
  profileStorage.set("data", dehydrate(data));
  profileStorage.set("dirty", true);
  pusher.schedule();
}

// Salva `data` in locale (marcandolo dirty) e schedula il push cloud. Usato dalle
// mutazioni dell'editor scheda (esercizi e giorni) per non duplicare il pattern.
function scheduleSave() {
  profileStorage.set("data", dehydrate(data));
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
    const onCommentSet = set.done && !set.warmup ? () => openQcDialog((set.comments ?? []).slice(), (next) => {
      data = setEntry(data, currentWeek, currentDay, exId, withSet(v, i, { comments: next }), new Date().toISOString());
      persist(idx); render();
    }) : null;
    setsBox.appendChild(setRow(i, set, prev[i] || null, isCurrent, onRemove, onOpen, meta, onCommentSet));
  }
  container.appendChild(setsBox);

  if (!allDone) {
    const editLabel = meta.unit === "sec" ? `Serie ${curIdx + 1} — secondi` : `Serie ${curIdx + 1} — carico · step 0.5 kg`;
    const edit = buildEditBlock(editLabel, draft, prev[curIdx] || null, exerciseBar(ex, getBar()), meta.unit, platesOn(ex, null));
    container.appendChild(edit.block);

    const repInSession = previousSetInSession(v, curIdx);
    const repPrevWeek = previousWeekSet(data, currentDay, exId, currentWeek, curIdx);
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
  container.appendChild(dots);

  if (!allDone) {
    const cta = document.createElement("button");
    cta.className = "cta"; cta.textContent = "Serie fatta · avvia recupero ▸";
    cta.addEventListener("click", () => {
      // Corpo libero (storico senza kg E serie corrente senza kg) → PR su reps.
      const _kgNum = parseFloat(String(draft.kg).replace(",", "."));
      const _bw = historyIsBodyweight(data, currentDay, exId) && !(_kgNum > 0);
      const _prevBest = _bw ? bestReps(data, currentDay, exId) : bestKg(data, currentDay, exId);
      if (isSetRecord(_prevBest, _bw ? draft.reps : draft.kg)) showRecordToast();
      data = setEntry(data, currentWeek, currentDay, exId,
        withSet(v, curIdx, { reps: draft.reps, kg: draft.kg, done: true, feel: entry.sets[curIdx]?.feel ?? "", comments: draft.comments }), new Date().toISOString());
      persist(idx);
      const _nx = nextExercisePreview(dayPlan().exercises, idx);
      const _go = (curIdx + 1 >= total)
        ? (_nx.last ? { fine: true } : { slug: goSlug(_nx.name), serie: 1 })
        : { slug: goSlug(ex.name), serie: curIdx + 2 };
      startRest(getRest(currentDay, exId, ex.restSeconds), ex.name, _go);
      render();
      // Anche sull'ultima serie: mostra "com'è andata?" (prima si chiudeva il
      // focus e non si poteva valutare). Si torna alla lista con il tasto ←.
      showFeelAsk({ idx, superset: false, setIndex: curIdx, last: curIdx + 1 >= total });
    });
    footer.appendChild(cta);
  }
  // --- Cassetto secondario: recupero · nota · volume · add ---
  const restEditor = buildRestEditor(idx, ex);
  const noteField = buildNoteField(false, idx);
  const exVol = exerciseVolume(v, ex);
  const volLine = exVol > 0
    ? buildVolLine(meta.factor === 2 ? "Volume esercizio · ×2 manubri" : "Volume esercizio", exVol)
    : null;

  const addRow = document.createElement("div");
  addRow.className = "addrow";
  const addW = document.createElement("button");
  addW.className = "addset warm"; addW.textContent = "+ riscald.";
  addW.addEventListener("click", () => {
    data = setEntry(data, currentWeek, currentDay, exId, withSet(v, entry.sets.length, { reps: "", kg: "", done: false, warmup: true }), new Date().toISOString());
    persist(idx); render();
  });
  const addS = document.createElement("button");
  addS.className = "addset"; addS.textContent = "+ serie";
  addS.addEventListener("click", () => {
    data = setEntry(data, currentWeek, currentDay, exId, withSet(v, entry.sets.length, { reps: "", kg: "", done: false }), new Date().toISOString());
    persist(idx); render();
  });
  addRow.append(addW, addS);

  // --- Handler barra azioni ---
  const onComment = allDone ? null : () => openQcDialog(draft.comments, (next) => { draft.comments = next; render(); });
  const onFail = allDone ? null : () => {
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
  };

  container.appendChild(buildFocusActions(
    [restEditor, noteField, volLine, addRow],
    {
      allDone,
      restValue: `${getRest(currentDay, exId, ex.restSeconds)}″`,
      handlers: { rest: openFocusDrawer, comment: onComment, fail: onFail, more: toggleFocusDrawer },
    }
  ));
}

// Bozze separate per traccia (A/B/C) della serie corrente del superset.
let draftTracks = { a: { kg: "", reps: "", comments: [] }, b: { kg: "", reps: "", comments: [] }, c: { kg: "", reps: "", comments: [] } };

function trackBlock(trackKey, trackName, trackEntry, tgtTrack, prevSets, state, idx, bar = getBar(), meta = { factor: 1, unit: "reps" }, showPlates = true) {
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
    const onCommentSet = set.done && !set.warmup ? () => openQcDialog((set.comments ?? []).slice(), (next) => {
      data = setEntry(data, currentWeek, currentDay, exId,
        withSupersetSet(getEntry(data, currentWeek, currentDay, exId), trackKey, i, { comments: next }),
        new Date().toISOString());
      persist(idx); render();
    }) : null;
    setsBox.appendChild(setRow(i, set, prevSets[i] || null, i === curIdx, onRemove, onOpen, meta, onCommentSet));
  }
  wrap.appendChild(setsBox);

  if (!allDone) {
    const editLabel = meta.unit === "sec" ? `Serie ${curIdx + 1} ${trackKey.toUpperCase()} — secondi` : `Serie ${curIdx + 1} ${trackKey.toUpperCase()} — step 0.5 kg`;
    const edit = buildEditBlock(editLabel, state, prevSets[curIdx] || null, bar, meta.unit, showPlates);
    wrap.appendChild(edit.block);

    const inSess = previousSetInSession(trackEntry, curIdx);
    const prevWk = previousWeekSet(data, currentDay, exId, currentWeek, curIdx, trackKey);
    const chips = buildRepeatChips(inSess, prevWk, ({ reps, kg }) => { state.reps = reps; state.kg = kg; edit.refresh(); });
    if (chips) wrap.appendChild(chips);
  }
  const onAddSet = () => {
    data = setEntry(data, currentWeek, currentDay, exId, withSupersetSet(getEntry(data, currentWeek, currentDay, exId), trackKey, trackEntry.sets.length, { reps: "", kg: "", done: false }), new Date().toISOString());
    persist(idx); render();
  };
  const onComment = allDone ? null : () => openQcDialog(state.comments, (next) => { state.comments = next; render(); });
  const onFail = allDone ? null : () => {
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
  };
  return { wrap, curIdx, allDone, onAddSet, onComment, onFail };
}

function renderFocusSuperset(ex, idx, container, footer) {
  const exId = exIdAt(idx);
  const v = getEntry(data, currentWeek, currentDay, exId);
  const e = normalizeSupersetEntry(v);
  const keys = supersetTrackKeys(ex);
  const tgt = parseTarget(ex.setsReps, true, keys.length);
  const prev = previousSupersetSets(currentWeek, currentDay, exId);

  const trendRow = buildTrendRow(exerciseTrend(data, currentDay, exId, currentWeek, 3, true), currentWeek);
  if (trendRow) container.appendChild(trendRow);

  const ssBar = exerciseBar(ex, getBar());
  const metas = keys.map((k) => volumeMeta(ex, k));
  // Tracce impilate (blocchi interi, niente sotto-tab): ognuna tiene stepper, dischi e storico.
  const blocks = keys.map((k, i) =>
    trackBlock(k, trackName(ex, k), e[k], tgt[k], prev[k] ?? [], draftTracks[k], idx, ssBar, metas[i], platesOn(ex, k)));
  blocks.forEach((b) => container.appendChild(b.wrap));

  // "Traccia attiva" = prima non completa (o la prima): guida header serie, drawer, +serie.
  const ai = Math.max(0, blocks.findIndex((b) => !b.allDone));
  const active = blocks[ai];
  const activeKey = keys[ai];
  const tgtT = tgt[activeKey];
  document.getElementById("focusSet").textContent =
    `serie ${Math.min(active.curIdx + 1, tgtT.sets)} / ${tgtT.sets}`;

  if (!isEntryComplete(getEntry(data, currentWeek, currentDay, exId), ex)) {
    const label = keys.filter((k, i) => !blocks[i].allDone).map((k) => k.toUpperCase()).join("+");
    const cta = document.createElement("button");
    cta.className = "cta"; cta.textContent = `Serie fatta (${label}) · avvia recupero ▸`;
    cta.addEventListener("click", () => {
      let nv = getEntry(data, currentWeek, currentDay, exId);
      const feelTracks = [];
      let anyRecord = false;
      keys.forEach((k, i) => {
        const blk = blocks[i];
        if (blk.allDone) return; // salta tracce gia complete
        const d = draftTracks[k];
        if (isSetRecord(bestKg(data, currentDay, exId, k), d.kg)) anyRecord = true;
        nv = withSupersetSet(nv, k, blk.curIdx, { reps: d.reps, kg: d.kg, done: true, feel: e[k].sets[blk.curIdx]?.feel ?? "", comments: d.comments });
        feelTracks.push({ track: k, idx: blk.curIdx });
      });
      if (anyRecord) showRecordToast();
      data = setEntry(data, currentWeek, currentDay, exId, nv, new Date().toISOString());
      persist(idx);
      const _doneAll = isEntryComplete(getEntry(data, currentWeek, currentDay, exId), ex);
      const _nx = nextExercisePreview(dayPlan().exercises, idx);
      const _go = _doneAll
        ? (_nx.last ? { fine: true } : { slug: goSlug(_nx.name), serie: 1 })
        : { slug: goSlug(ex.name), serie: active.curIdx + 2 };
      startRest(getRest(currentDay, exId, ex.restSeconds), ex.name, _go);
      render();
      showFeelAsk({ idx, superset: true, tracks: feelTracks, last: _doneAll });
    });
    footer.appendChild(cta);
  }

  // Volume per traccia + totale superset (con ×2 manubri; tracce a tempo escluse).
  const volNodes = [];
  let totVol = 0;
  keys.forEach((k, i) => {
    const vol = e[k].sets.reduce((s, x) => s + setVolume(x, metas[i]), 0);
    if (vol > 0) volNodes.push(buildVolLine(`Volume ${k.toUpperCase()}${metas[i].factor === 2 ? " · ×2 manubri" : ""}`, vol));
    totVol += vol;
  });
  if (totVol > 0) volNodes.push(buildVolLine("Totale superset", totVol));

  // "+ serie" della traccia attiva, dentro al cassetto.
  const addRow = document.createElement("div");
  addRow.className = "addrow";
  const addS = document.createElement("button");
  addS.className = "addset"; addS.textContent = `+ serie ${activeKey.toUpperCase()}`;
  addS.addEventListener("click", active.onAddSet);
  addRow.appendChild(addS);

  const drawerChildren = [buildRestEditor(idx, ex), buildNoteField(true, idx), ...volNodes, addRow];
  container.appendChild(buildFocusActions(drawerChildren, {
    allDone: active.allDone,
    restValue: `${getRest(currentDay, exId, ex.restSeconds)}″`,
    handlers: { rest: openFocusDrawer, comment: active.onComment, fail: active.onFail, more: toggleFocusDrawer },
  }));
}

// Sets della settimana loggata più recente, per ogni traccia ({a:[...], b:[...], c:[...]}).
function previousSupersetSets(weekKey, day, idx) {
  const keys = Object.keys(data?.weeks ?? {})
    .filter((k) => /^\d{4}-W\d{2}(\.\d+)?$/.test(k) && k < weekKey).sort();
  for (let i = keys.length - 1; i >= 0; i--) {
    const e = normalizeSupersetEntry(getEntry(data, keys[i], day, idx));
    if (e.a.sets.length || e.b.sets.length || e.c.sets.length) {
      return {
        a: e.a.sets.map(({ reps, kg }) => ({ reps, kg })),
        b: e.b.sets.map(({ reps, kg }) => ({ reps, kg })),
        c: e.c.sets.map(({ reps, kg }) => ({ reps, kg })),
      };
    }
  }
  return { a: [], b: [], c: [] };
}

// Mini sparkline inline (storico top-set): polyline + dot finale; piatta se <2 punti.
function buildSparkline(trend, w = 54, h = 20) {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("class", "spark");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("width", String(w)); svg.setAttribute("height", String(h));
  if (trend.length >= 2) {
    const geo = chartGeometry(trend, { width: w, height: h, padX: 2, padTop: 3, padBottom: 3, padRight: 4 });
    const pl = document.createElementNS(SVGNS, "polyline");
    pl.setAttribute("points", geo.points.map((p) => `${p.x},${p.y}`).join(" "));
    pl.setAttribute("fill", "none"); pl.setAttribute("stroke", "var(--ac2)"); pl.setAttribute("stroke-width", "1.5");
    svg.appendChild(pl);
    const last = geo.points[geo.points.length - 1];
    const dot = document.createElementNS(SVGNS, "circle");
    dot.setAttribute("cx", String(last.x)); dot.setAttribute("cy", String(last.y));
    dot.setAttribute("r", "2.2"); dot.setAttribute("fill", "var(--acc)");
    svg.appendChild(dot);
  } else {
    const pl = document.createElementNS(SVGNS, "polyline");
    pl.setAttribute("points", `2,${h / 2} ${w / 2},${h / 2} ${w - 2},${h / 2}`);
    pl.setAttribute("fill", "none"); pl.setAttribute("stroke", "var(--ctc)"); pl.setAttribute("stroke-width", "1.5");
    svg.appendChild(pl);
  }
  return svg;
}

// Lista esercizi — layout "Pipeline a Tag" + sparkline inline. Riga pulita
// (indice · nome · meta con "ult." in kg espliciti), mini sparkline storica e
// tag di stato DONE/NEXT/TODO a destra, con chip PR sul record settimanale.
// NEXT = primo esercizio non completato. Il tap apre il focus a schermo intero.
function renderList() {
  const root = document.getElementById("list");
  root.textContent = "";
  const dp = dayPlan();
  const nextIndex = dp.exercises.findIndex((_, i) => !isComplete(i));
  dp.exercises.forEach((ex, i) => {
    const exId = exIdAt(i);
    const status = isComplete(i) ? "done" : i === nextIndex ? "next" : "todo";

    const row = document.createElement("div");
    row.className = "row " + status;
    row.addEventListener("click", () => openFocus(i));

    const ix = document.createElement("span"); ix.className = "ix"; ix.textContent = String(i + 1).padStart(2, "0");

    const mid = document.createElement("div"); mid.className = "mid";
    const nm = document.createElement("div"); nm.className = "nm"; nm.textContent = ex.name;
    if (ex.superset) { const b = document.createElement("span"); b.className = "ssbadge"; b.textContent = "superset"; nm.appendChild(b); }
    const sub = document.createElement("div"); sub.className = "sub";
    // rec da restSeconds (m:ss); fallback recText per piani importati senza
    // restSeconds numerico; se mancano entrambi il segmento è omesso.
    const rec = Number.isFinite(ex.restSeconds) ? `rec ${formatTime(ex.restSeconds)}`
      : (ex.recText ? `rec ${ex.recText}` : "");
    sub.append(document.createTextNode(rec ? `${ex.setsReps} · ${rec}` : ex.setsReps));
    // "ult." in kg espliciti: normale -> "ult. 55 kg · 10 rip"; superset -> "ult. A 20 kg · B 7.5 kg".
    if (!isComplete(i)) {
      if (ex.superset) {
        const a = lastWorkingSet(data, currentDay, exId, currentWeek, "a");
        const b = lastWorkingSet(data, currentDay, exId, currentWeek, "b");
        const parts = [];
        if (a) parts.push(`A ${a.kg} kg`);
        if (b) parts.push(`B ${b.kg} kg`);
        if (parts.length) sub.append(document.createTextNode(` · ult. ${parts.join(" · ")}`));
      } else {
        const last = lastWorkingSet(data, currentDay, exId, currentWeek);
        if (last) {
          sub.append(document.createTextNode(" · ult. "));
          const b = document.createElement("b"); b.textContent = `${last.kg} kg`;
          sub.append(b, document.createTextNode(` · ${last.reps} rip`));
        }
      }
    }
    mid.append(nm, sub);

    const spark = buildSparkline(exerciseTrend(data, currentDay, exId, currentWeek, 4, !!ex.superset));

    const tags = document.createElement("div"); tags.className = "tags";
    const isRec = ex.superset
      ? (isWeekRecord(data, currentDay, exId, currentWeek, "a") || isWeekRecord(data, currentDay, exId, currentWeek, "b"))
      : isWeekRecord(data, currentDay, exId, currentWeek);
    if (isRec) { const pr = document.createElement("span"); pr.className = "tag pr"; pr.textContent = "PR 🏆"; pr.title = "Record personale questa settimana"; tags.appendChild(pr); }
    const st = document.createElement("span"); st.className = "tag " + status;
    st.textContent = status === "done" ? "DONE" : status === "next" ? "NEXT" : "TODO";
    tags.appendChild(st);

    row.append(ix, mid, spark, tags);
    root.appendChild(row);
  });
}

// Apre/chiude il cassetto "⋯ Altro" del focus. Passa da render() così lo stato
// (focusDrawerOpen) sopravvive alla ricostruzione del DOM.
function toggleFocusDrawer() { focusDrawerOpen = !focusDrawerOpen; render(); }
function openFocusDrawer() { focusDrawerOpen = true; render(); }

// Barra azioni in fondo al focus. `handlers` mappa key→funzione (rest/comment/
// fail/more); comment e fail possono mancare (esercizio completato). `restValue`
// è l'etichetta del pulsante recupero (es. "90s").
function buildActionBar({ allDone, restValue, handlers }) {
  const bar = document.createElement("div");
  bar.className = "actbar";
  actionBarSpec({ allDone, drawerOpen: focusDrawerOpen }).forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "actbtn"
      + (s.key === "fail" ? " fail" : "")
      + (s.key === "more" ? " more" + (s.active ? " open" : "") : "");
    const g = document.createElement("span"); g.className = "ab-g"; g.textContent = s.glyph;
    const l = document.createElement("span"); l.className = "lbl";
    l.textContent = s.key === "rest" && restValue ? restValue : s.label;
    b.append(g, l);
    const fn = handlers[s.key];
    if (fn) b.addEventListener("click", fn);
    bar.appendChild(b);
  });
  return bar;
}

// Gruppo ancorato in fondo: cassetto (chiuso di default) + barra azioni.
function buildFocusActions(drawerChildren, barOpts) {
  const group = document.createElement("div");
  group.className = "focus-actions";
  const drawer = document.createElement("div");
  drawer.className = "focus-drawer" + (focusDrawerOpen ? " open" : "");
  drawerChildren.filter(Boolean).forEach((c) => drawer.appendChild(c));
  group.append(drawer, buildActionBar(barOpts));
  return group;
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
  const exsForBar = dayPlan().exercises;
  const ctxEl = document.getElementById("focusSbarCtx");
  const cntEl = document.getElementById("focusSbarCount");
  if (ctxEl) ctxEl.textContent = `◈ LOG · ${currentDay}`;
  if (cntEl) {
    const entry = getSessionMap()[sessClockKey()];
    const clk = document.createElement("span");
    clk.id = "focusSbarClock";
    clk.textContent = clockText(entry, Date.now());
    const rest = document.createElement("span");
    rest.textContent = `ex ${String(openIndex + 1).padStart(2, "0")}/${exsForBar.length}`;
    cntEl.replaceChildren(clk, rest);
  }
  document.getElementById("focusName").textContent = ex.name;
  body.textContent = "";
  foot.textContent = "";
  foot.appendChild(buildNextStrip(dayPlan().exercises, openIndex));
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
  renderSessionControl();
}

// ---- Editing + saving ----

// ---- Week management ----
function changeWeek(key) {
  currentWeek = key;
  data = ensureWeek(data, currentWeek, data.weeks[currentWeek]?.label);
  openIndex = null;
  focusDrawerOpen = false;
  volExpanded = false;
  renderWeekSelect();
  render();
}
function changeDay(day) {
  currentDay = day;
  openIndex = null;
  focusDrawerOpen = false;
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
  profileStorage.set("data", dehydrate(data));
  profileStorage.set("dirty", true);
  pusher.schedule();
}

// ---- Settings dialog ----
function wireSettings() {
  const dlg = document.getElementById("settingsDialog");

  // Evidenzia la card del tema attivo (Carta/Graphite) e aggiorna aria-pressed.
  function syncThemeCards() {
    const cur = getTheme(localStorage);
    document.querySelectorAll(".sv-tc").forEach((c) => {
      const on = c.dataset.theme === cur;
      c.classList.toggle("is-on", on);
      c.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

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
    document.getElementById("timerVolSlider").value = getTimerVol();
    document.getElementById("timerVolPct").textContent = getTimerVol() + "%";
    syncThemeCards();
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

  document.getElementById("timerVolSlider").addEventListener("input", (e) => {
    setTimerVol(parseInt(e.target.value, 10));
    document.getElementById("timerVolPct").textContent = getTimerVol() + "%";
    cueCountdown(); // anteprima live del volume scelto
  });

  // Selettore tema a card (Carta / Graphite): scelta nominata, applicata live.
  document.querySelectorAll(".sv-tc").forEach((card) => {
    card.addEventListener("click", () => {
      setTheme(localStorage, card.dataset.theme);
      applyTheme(document.documentElement, localStorage);
      syncThemeCards();
    });
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
      profileStorage.set("data", dehydrate(data));
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
  document.getElementById("tStop").addEventListener("click", collapseRest);
  document.getElementById("resumeOpen").addEventListener("click", expandRest);
  document.getElementById("resumeDiscard").addEventListener("click", discardRest);
  document.getElementById("timerGo").addEventListener("click", dismissTimerGo);
  document.getElementById("tToggle").addEventListener("click", (e) => {
    // NB: tToggle è raggiungibile solo con #timerRun visibile (mai in stato GO).
    if (timer.paused) { timer.resume(); e.target.textContent = "⏸"; document.body.classList.add("scroll-lock"); }
    else { timer.pause(); e.target.textContent = "▶"; document.body.classList.remove("scroll-lock"); }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { timer.sync(); wakeLock.onVisible(); }
    if (document.hidden) { goDismiss.hide(); goDrainFreeze(); }
    else if (goDismiss.active) { goDismiss.show(); goDrainRun(); }
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
    const map = { nutrition: openNutrition, calendar: openCalendar, sheets: openSheets, catalog: openCatalog, settings: openSettings, scan: openScan };
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
    splashBootReady();
    return;
  }

  // 3. Sessione attiva → mostra app, inizializza store.
  hideAuthScreen();
  profileStorage = new ProfileStorage(localStorage, session.user.id);
  applyTheme(document.documentElement, localStorage);
  applyFx(document.body, localStorage);
  store = new SupabaseStore(supabase);

  pusher = createPusher({
    getData: () => dehydrate(data),
    getVersion: () => dataVersion,
    setVersion: (v) => { dataVersion = v; profileStorage.set("version", v); },
    setDirty: (d) => profileStorage.set("dirty", d),
    store,
    onConflict: async () => {
      const remote = await store.load();
      const merged = mergeBlobs(dehydrate(data), remote.data);
      dataVersion = await store.save(merged, remote.version);
      data = hydrate(merged);
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

  // Altezza reale dello stack fisso in basso → CSS var per i padding (fix overlap).
  // Observer mai disconnesso: bottomStack vive quanto l'app.
  const _bs = document.getElementById("bottomStack");
  new ResizeObserver(() => {
    document.documentElement.style.setProperty("--bottom-pad", _bs.offsetHeight + "px");
  }).observe(_bs);

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
    openChartDialog(ex.id, ex.superset ? "a" : null);
  });
  document.getElementById("chartClose").addEventListener("click", () => document.getElementById("chartDialog").close());
  document.getElementById("chartDialog").addEventListener("click", (e) => {
    if (e.target.id === "chartDialog") e.target.close(); // tap sul backdrop
  });
  document.getElementById("nutritionBack").addEventListener("click", () => closeNutrition());
  document.getElementById("planBack").addEventListener("click", () => closePlanEditor());
  document.getElementById("calendarBack").addEventListener("click", closeCalendar);
  document.getElementById("sheetsBack").addEventListener("click", closeSheets);
  document.getElementById("dbBack").addEventListener("click", closeCatalog);
  document.getElementById("scanBack").addEventListener("click", closeScan);
  document.getElementById("scanTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    setScanTab(b.dataset.tab);
  });
  document.getElementById("dbQ").oninput = (e) => setDbFilter(e.target.value);
  document.getElementById("dbAddInline").onclick = () => openCatalogForm(null, ctx.dbFilter);
  document.getElementById("dbMx").addEventListener("click", dbCloseModal);
  document.getElementById("dbScrim").addEventListener("click", (e) => { if (e.target.id === "dbScrim") dbCloseModal(); });
  wireDrawer();
  document.getElementById("calPrev").addEventListener("click", () => calShiftMonth(-1));
  document.getElementById("calNext").addEventListener("click", () => calShiftMonth(1));
  document.getElementById("calMetric").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    [...e.currentTarget.children].forEach((x) => x.classList.remove("on"));
    b.classList.add("on"); setCalMetric(b.dataset.m);
  });
  document.getElementById("calDayClose").addEventListener("click", closeCalDay);
  document.getElementById("calDayDialog").addEventListener("click", (e) => {
    if (e.target.id === "calDayDialog") e.target.close(); // tap sul backdrop
  });
  wireExerciseDialog(); // salva, chip carico, derivazione, toggle superset (plan-editor.js)
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
      if (ctx.planOpen) history.pushState({ gymPlan: true }, "");
      else if (nutritionOpen) history.pushState({ gymNutrition: true }, "");
      else if (ctx.calendarOpen) history.pushState({ gymCalendar: true }, "");
      else if (ctx.catalogOpen) history.pushState({ gymCatalog: true }, "");
      else if (ctx.scanOpen) history.pushState({ gymScan: true }, "");
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
    if (ctx.planOpen) { ctx.planOpen = false; renderPlanEditor(); }
    if (ctx.calendarOpen) { ctx.calendarOpen = false; renderCalendar(); }
    if (ctx.sheetsOpen) { ctx.sheetsOpen = false; renderSheets(); const t = ctx.sheetsPending; ctx.sheetsPending = null; if (t) t(); }
    if (ctx.catalogOpen) { ctx.catalogOpen = false; renderCatalog(); }
    if (ctx.scanOpen) { ctx.scanOpen = false; renderScan(); }
  });

  // 4. Carica dati: prima da localStorage (mostra subito), poi da remote.
  const cached = profileStorage.get("data");
  if (cached) {
    data = hydrate(cached);
    dataVersion = profileStorage.get("version") || 0;
    render();
  }

  try {
    const remote = await store.load();
    if (cached && profileStorage.get("dirty")) {
      // Locale dirty → merge + push.
      const merged = mergeBlobs(dehydrate(data), remote.data);
      dataVersion = await store.save(merged, remote.version);
      data = hydrate(merged);
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
    data = hydrate(patchPlanV5(patchPlanV4(backfillMuscles(migrate(data), PLAN))));
    // One-shot: al primo avvio (catalog mai inizializzato) inietta il seed e
    // persiste. seedCatalogIfAbsent ritorna lo STESSO riferimento se il catalog
    // c'è già, un blob NUOVO se ha seminato → confronto per riferimento per
    // evitare un save inutile a ogni boot.
    // DELIBERATO: il seed sta QUI, dopo il reconcile remoto — NON nel ramo cached
    // o nel catch offline. Se seminassimo offline su un device nuovo che POI
    // sincronizza con un remote che ha già un catalogo, mergeBlobs (union-by-id)
    // terrebbe sia gli id seed-* sia gli id reali → catalogo duplicato. Aspettare
    // il reconcile garantisce il seed una volta sola e mai sopra un remote esistente.
    // Trade-off accettato: un first-run OFFLINE vede "0 rec" finché non va online.
    const _blob = dehydrate(data);
    let _maybe = seedCatalogIfAbsent(_blob);
    // Migrazione nome one-shot (2026-06: variante eseguita in piedi). Idempotente:
    // dopo il primo run non matcha più nulla e ritorna lo stesso riferimento.
    _maybe = migrateExerciseName(_maybe, "Croci ai cavi", "Croci ai cavi in piedi");
    // Backfill one-shot dei secondari sui cataloghi seminati prima della heatmap
    // (solo voci con secondary undefined; idempotente, stesso ref se nulla da fare).
    _maybe = backfillCatalogSecondaries(_maybe);
    if (_maybe !== _blob) { data = hydrate(_maybe); scheduleSave(); }
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

  // App pronta (render fatto o offline gestito): lo splash può andarsene.
  splashBootReady();

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
  data = hydrate(patchPlanV5(patchPlanV4(backfillMuscles(migrate(withPending, PLAN), PLAN))));
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
  data = hydrate(patchPlanV5(patchPlanV4(backfillMuscles(migrate(merged), PLAN))));
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
    const merged = mergeBlobs(dehydrate(data), remote.data);
    dataVersion = await store.save(merged, remote.version);
    data = hydrate(merged);
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

// --- Splash d'apertura --------------------------------------------------
// L'overlay #splash è già visibile da HTML/CSS (parte senza JS). Lo rimuoviamo
// quando l'animazione minima è trascorsa E il boot è pronto; con un timeout di
// sicurezza se il boot si blocca. `splashBootReady()` è chiamata da boot().
let resolveSplashReady = () => {};
function splashBootReady() { resolveSplashReady(); }
let splashDismissed = false;
function dismissSplash() {
  if (splashDismissed) return;
  splashDismissed = true;
  const el = document.getElementById("splash");
  if (!el) return;
  el.classList.add("splash-out");
  setTimeout(() => el.remove(), 460);
}
// Resa reduced-motion: niente movimento, il testo si "decifra" sul posto. Ogni
// carattere parte come glifo casuale e si blocca sul finale, da sinistra a destra.
function startSplashDecrypt(splash) {
  const randGlyph = () => DECRYPT_GLYPHS[Math.floor(Math.random() * DECRYPT_GLYPHS.length)];
  const run = (el, text, accentFrom, delay) => {
    if (!el) return;
    el.textContent = "";
    const cells = [...text].map((ch, i) => {
      const s = document.createElement("span");
      if (accentFrom != null && i >= accentFrom) s.className = "a";
      s.style.opacity = "0";
      s.textContent = ch === " " ? " " : randGlyph();
      el.appendChild(s);
      return { s, ch };
    });
    setTimeout(() => {
      cells.forEach((c) => { c.s.style.opacity = "1"; });
      let frame = 0;
      const id = setInterval(() => {
        frame++;
        cells.forEach((c, i) => {
          if (c.ch === " ") return;
          c.s.textContent = isLocked(i, frame) ? c.ch : randGlyph();
        });
        if (decryptDone(text, frame)) clearInterval(id);
      }, DECRYPT_TICK_MS);
    }, delay);
  };
  run(splash.querySelector(".sp-word"), "set.log", 3, WORD_DELAY_MS);
  run(splash.querySelector(".cap .type"), "system ready", null, CAP_DELAY_MS);
}
{
  const splash = document.getElementById("splash");
  if (splash) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // reduce: niente accensione CRT (vietato il movimento), il testo si decifra sul
    // posto e lo splash resta finché il reveal non finisce. full: l'accensione CRT
    // finisce di "digitare" verso ~2.85s, più un beat di lettura.
    if (reduce) startSplashDecrypt(splash);
    const minMs = reduce ? REDUCE_MIN_MS : FULL_MIN_MS;
    const ready = new Promise((r) => { resolveSplashReady = r; });
    const minDelay = new Promise((r) => setTimeout(r, minMs));
    const safety = new Promise((r) => setTimeout(r, 7000));
    Promise.race([Promise.all([ready, minDelay]), safety]).then(dismissSplash);
    // Skip al tap/click, ma NON aggressivo: una finestra di grazia iniziale evita
    // che un tap accidentale nell'istante dell'apertura salti subito l'intro.
    // Lo skip si arma dopo `skipArmMs`; prima i tap sono ignorati. dismissSplash
    // è idempotente (splashDismissed), quindi nessun rischio di doppio dismiss.
    const skipArmMs = reduce ? 0 : 700;
    let skipArmed = false;
    setTimeout(() => { skipArmed = true; }, skipArmMs);
    splash.addEventListener("click", () => { if (skipArmed) dismissSplash(); });
  }
}

window.addEventListener("load", boot);

// Aggiorna la durata della sessione ogni secondo (no-op finché il cronometro è nascosto).
setInterval(tickSessionDisplays, 1000);

// PWA: registra il service worker e gestisce l'aggiornamento (best-effort).
// `swUpdating` distingue l'aggiornamento voluto dall'utente (tap sul banner)
// dal primo clients.claim alla prima installazione: ricarica solo nel primo caso.
let swUpdating = false;
// Toast aggiornamento rimandato col `✕`: di sola sessione (riparte a false al
// prossimo load, così se l'update è ancora pending il toast riappare).
let updateDismissed = false;
let swReg = null;

function showUpdateBanner(reg) {
  if (updateDismissed) return;                                 // rimandato in questa sessione
  if (document.getElementById("updateBanner")) return;         // già presente
  const b = document.createElement("div");
  b.id = "updateBanner";
  b.className = "update-toast";
  b.setAttribute("role", "status");

  const dot = document.createElement("span");
  dot.className = "ut-dot";

  const tx = document.createElement("span");
  tx.className = "ut-tx";
  tx.textContent = "Nuova versione disponibile";

  const go = document.createElement("button");
  go.type = "button";
  go.className = "ut-go";
  go.textContent = "› aggiorna";
  go.addEventListener("click", () => {
    swUpdating = true;
    if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
  });

  const x = document.createElement("button");
  x.type = "button";
  x.className = "ut-x";
  x.textContent = "✕";
  x.setAttribute("aria-label", "Rimanda");
  x.addEventListener("click", () => {
    updateDismissed = true;
    b.remove();
  });

  b.append(dot, tx, go, x);
  document.body.appendChild(b);
}

// --- Store update (scaffolding fase 3) ---------------------------------------
// Attivo SOLO se STORE_UPDATE_ENABLED è true (build nativa). A OFF non viene mai
// eseguito: nessun fetch di version.json, nessun banner store. L'update resta sul SW.

// Toast minimale "Aggiorna · vX.Y.Z" che apre lo store. Dismiss di sessione, idempotente.
let storeUpdateDismissed = false;
function showStoreUpdateBanner(latest, storeUrl) {
  if (storeUpdateDismissed) return;
  if (document.getElementById("storeUpdateBanner")) return;
  const b = document.createElement("div");
  b.id = "storeUpdateBanner";
  b.className = "update-toast";
  b.setAttribute("role", "status");

  const dot = document.createElement("span");
  dot.className = "ut-dot";

  const tx = document.createElement("span");
  tx.className = "ut-tx";
  tx.append("Aggiorna · ");
  const v = document.createElement("span");
  v.style.color = "var(--acc)";
  v.textContent = "v" + latest;
  tx.append(v);

  const go = document.createElement("button");
  go.type = "button";
  go.className = "ut-go";
  go.textContent = "›";
  go.setAttribute("aria-label", "Apri lo store");
  // TODO(native): in una build Capacitor, per il deep-link allo store nativo usare il
  // plugin Browser/App invece di window.open (ok per ora: flag spento, ID store segnaposto).
  go.addEventListener("click", () => window.open(storeUrl, "_blank", "noopener"));

  const x = document.createElement("button");
  x.type = "button";
  x.className = "ut-x";
  x.textContent = "✕";
  x.setAttribute("aria-label", "Rimanda");
  x.addEventListener("click", () => { storeUpdateDismissed = true; b.remove(); });

  b.append(dot, tx, go, x);
  document.body.appendChild(b);
}

// Popola la riga `app` di Impostazioni. Mostra sempre la versione; a flag ON con update
// disponibile aggiunge il tag "↑ vX.Y.Z" e nasconde il force-update manuale del SW.
function renderAppLine(update) {
  const vEl = document.getElementById("appVersion");
  if (vEl) vEl.textContent = "v" + APP_VERSION;

  const fu = document.getElementById("btnForceUpdate");
  if (fu) fu.style.display = STORE_UPDATE_ENABLED ? "none" : "";

  const tagEl = document.getElementById("appUpdateTag");
  if (!tagEl) return;
  tagEl.textContent = "";
  if (STORE_UPDATE_ENABLED && update && update.updateAvailable) {
    const t = document.createElement("button");
    t.type = "button";
    t.className = "sv-tag";
    t.textContent = "↑ v" + update.latest;
    t.addEventListener("click", () => window.open(update.storeUrl, "_blank", "noopener"));
    tagEl.appendChild(t);
  }
}

// La versione va mostrata sempre (anche a flag OFF) appena la UI è pronta.
window.addEventListener("load", () => renderAppLine());

// Il controllo store gira solo a flag acceso.
if (STORE_UPDATE_ENABLED) {
  const runStoreCheck = () => {
    checkStoreUpdate().then((u) => {
      if (u && u.updateAvailable) {
        showStoreUpdateBanner(u.latest, u.storeUrl);
        renderAppLine(u);
      }
    }).catch(() => {});   // checkStoreUpdate già inghiotte gli errori di rete; questo è solo
                          // un guard contro rejection impreviste, niente unhandled rejection.
  };
  window.addEventListener("load", runStoreCheck);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") runStoreCheck();
  });
}
// --- fine Store update -------------------------------------------------------

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
