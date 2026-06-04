import { PLAN } from "./plan.js";
import { migrate, backfillMuscles, patchPlanV4, patchPlanV5, addExercise, removeExercise, reorderExercise, updateExercise, keepLocalPlan, addDay, renameDay, removeDay, tabMiniLabel } from "./editor.js";
import {
  isoWeekKey, nextFreeWeekKey, emptyData, ensureWeek, setEntry, getEntry,
  normalizeEntry, normalizeSupersetEntry, prefillSets, platesPerSide, parsePlateSet, exerciseBar,
  SupabaseStore, mergeBlobs, ConflictError, AuthError, planIsEmpty, fromBase64,
} from "./store.js";
import {
  hydrate, dehydrate, addSheet, importSheet, renameSheet, deleteSheet, setActiveSheet, sheetSummaries,
  sortSheetSummaries, sheetSlug, fmtSheetDate,
} from "./sheets.js";
import {
  addCatalogEntry, renameCatalogEntry, deleteCatalogEntry, setCatalogNote,
  groupedCatalog, catalogUsage, MUSCLE_GROUPS, seedCatalogIfAbsent, migrateExerciseName,
} from "./catalog.js";
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
  isDumbbell, volumeMeta, exerciseVolume, setVolume,
} from "./session.js";
import { RestTimer, formatTime, withoutSession, goSlug } from "./timer.js";
import { ScreenWakeLock } from "./wakelock.js";
import { renderNutritionGuide } from "./nutrition.js";
import { createPusher } from "./sync.js";
import { getFx, setFx, applyFx } from "./fx.js";
import { getTheme, setTheme, applyTheme } from "./theme.js";
import { actionBarSpec } from "./focus-ui.js";

const PENDING_KEY = "gymsched_pending"; // local buffer of unsynced edits
const SEED_URL = "https://xbacco.github.io/gym-schedule/data.json";

// ---- App state ----
let data = emptyData();
let sha = null;
let currentWeek = isoWeekKey(new Date());
let currentDay = "A";
let openIndex = null;        // esercizio aperto nel focus a schermo intero (null = nessuno)
let supersetTab = "a";       // sotto-tab attivo nel focus di un superset
let focusDrawerOpen = false; // cassetto "⋯ Altro" del focus esercizio (UI effimera, non persistita)
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
    const L = document.createElement("span"); L.className = "pt-L"; L.textContent = d.day;
    b.appendChild(L);
    const mm = tabMiniLabel(d.title);
    if (mm && mm !== String(d.day).toLowerCase()) {
      const m = document.createElement("span"); m.className = "pt-mm"; m.textContent = mm;
      b.appendChild(m);
    }
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

  const totEx = plan.reduce((n, d) => n + (Array.isArray(d.exercises) ? d.exercises.length : 0), 0);
  const sheetName = ((data.sheets || []).find((s) => s.id === data.activeSheetId) || {}).name || "scheda";
  document.getElementById("planSub").textContent =
    `${sheetSlug(sheetName)} · ${plan.length} giorn${plan.length === 1 ? "o" : "i"} · ${totEx} es`;

  const body = document.getElementById("planBody");
  body.textContent = "";
  if (dp) {
    // Barra giorno: titolo intero + rinomina/elimina compatti.
    const bar = document.createElement("div");
    bar.className = "pe-daybar";
    const ttl = document.createElement("div");
    ttl.className = "pe-daytitle";
    const bL = document.createElement("b"); bL.textContent = dp.day;
    ttl.append(bL, document.createTextNode(` — ${dp.title || dp.day}`));
    const ren = document.createElement("button");
    ren.type = "button"; ren.className = "pe-daybtn"; ren.textContent = "✎";
    ren.setAttribute("aria-label", "Rinomina giorno");
    ren.addEventListener("click", renamePlanDay);
    const del = document.createElement("button");
    del.type = "button"; del.className = "pe-daybtn pe-daybtn-del"; del.textContent = "🗑";
    del.setAttribute("aria-label", "Elimina giorno");
    del.addEventListener("click", deletePlanDay);
    bar.append(ttl, ren, del);
    body.appendChild(bar);

    dp.exercises.forEach((ex, i) => body.appendChild(buildPlanRow(ex, i, dp.exercises.length)));
    const add = document.createElement("button");
    add.type = "button"; add.className = "pe-add"; add.textContent = "＋ Aggiungi esercizio";
    add.addEventListener("click", () => openExDialog(dp.day, null));
    body.appendChild(add);
  } else {
    const hint = document.createElement("p");
    hint.className = "pe-empty-hint";
    const d = document.createElement("span"); d.className = "d"; d.textContent = "$";
    hint.append(d, document.createTextNode(" nessun giorno — tocca ＋ per aggiungerne uno"));
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
let calMetric = "vol";           // "vol" | "kg": metrica del grafico progressione
let calByDate = new Map();       // "YYYY-MM-DD" -> [sessione...]; popolata da renderCalendar()

function openCalendar() {
  calendarOpen = true;
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
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
  renderCalendar();
}

// ---- Gestore schede: overlay a schermo intero (stessa logica history degli altri). ----
let sheetsOpen = false;
let sheetsPending = null; // azione da eseguire dopo la chiusura del gestore schede
let sheetsExpandedId = null; // id scheda espansa nell'accordion (null → default: l'attiva)

function openSheets() {
  sheetsOpen = true;
  sheetsExpandedId = null; // a ogni apertura riparte con l'attiva espansa
  history.pushState({ gymSheets: true }, "");
  renderSheets();
}

function closeSheets() {
  if (!sheetsOpen) return;
  if (history.state && history.state.gymSheets) history.back(); // → popstate chiude
  else { sheetsOpen = false; renderSheets(); const t = sheetsPending; sheetsPending = null; if (t) t(); }
}

// Applica una mutazione (blob→blob) alla scheda corrente, deidratando/idratando
// attorno, poi salva e ridisegna gestore + home.
function mutateSheets(fn) {
  data = hydrate(fn(dehydrate(data)));
  scheduleSave();
  renderSheets();
  render();
}

function renderSheets() {
  const ov = document.getElementById("sheetsOverlay");
  if (!sheetsOpen) { ov.classList.add("hidden"); ov.setAttribute("aria-hidden", "true"); return; }
  ov.classList.remove("hidden"); ov.setAttribute("aria-hidden", "false");
  const body = document.getElementById("sheetsBody");
  body.innerHTML = "";
  const sums = sortSheetSummaries(sheetSummaries(dehydrate(data)));
  document.getElementById("sheetsSub").textContent =
    `${sums.length} scheda${sums.length === 1 ? "" : "e"} · attiva + archivio`;
  const todayIso = new Date().toISOString().slice(0, 10);
  const ultTxt = (s) => (s.lastDate ? `ult ${fmtSheetDate(s.lastDate, todayIso)}` : fmtSheetDate(null, todayIso));
  // null → default (attiva espansa); "" → tutte chiuse; altrimenti id della scheda espansa.
  const expandedId = sheetsExpandedId ?? (sums.find((s) => s.active) || {}).id;

  const inner = document.createElement("div");
  inner.className = "sheets-inner";
  inner.appendChild(mkPrompt("$", "ls schede/ --sort=ultima"));

  for (const s of sums) {
    const open = s.id === expandedId;
    const blk = document.createElement("div");
    blk.className = "sh-blk" + (s.active ? " active" : "") + (open ? " open" : "");
    blk.addEventListener("click", () => { sheetsExpandedId = open ? "" : s.id; renderSheets(); });

    const h = document.createElement("div");
    h.className = "sh-h";
    const ar = document.createElement("span"); ar.className = "sh-ar"; ar.textContent = open ? "▸" : "▹";
    const nm = document.createElement("span"); nm.className = "sh-nm"; nm.textContent = sheetSlug(s.name) + "/";
    h.append(ar, nm);
    if (s.active) {
      const tag = document.createElement("span"); tag.className = "sh-tag"; tag.textContent = "attiva";
      h.appendChild(tag);
    } else if (!open) {
      const mt = document.createElement("span"); mt.className = "sh-mt";
      mt.textContent = `${s.days}g · ${s.exercises} es · ${ultTxt(s)}`;
      h.appendChild(mt);
    }
    blk.appendChild(h);

    if (open) {
      const x = document.createElement("div");
      x.className = "sh-x";

      const days = document.createElement("div");
      days.className = "sh-days";
      for (const dl of s.dayLines) {
        const ln = document.createElement("div");
        const L = document.createElement("span"); L.className = "L"; L.textContent = dl.day;
        const n = document.createElement("span"); n.className = "n"; n.textContent = ` ${dl.count} es`;
        ln.append(L, document.createTextNode(dl.title.toLowerCase()), n);
        days.appendChild(ln);
      }
      x.appendChild(days);

      const meta = document.createElement("div");
      meta.className = "sh-meta";
      meta.textContent =
        `${ultTxt(s)} · ${s.weeks} settiman${s.weeks === 1 ? "a" : "e"} loggat${s.weeks === 1 ? "a" : "e"}`;
      x.appendChild(meta);

      const acts = document.createElement("div");
      acts.className = "sh-acts";
      if (s.active) {
        acts.appendChild(mkBtn("✎ modifica", "p", () => { sheetsPending = openPlanEditor; closeSheets(); }));
      } else {
        acts.appendChild(mkBtn("↪ attiva", "p", () => mutateSheets((b) => setActiveSheet(b, s.id))));
      }
      acts.appendChild(mkBtn("rinomina", "", () => renameSheetPrompt(s)));
      acts.appendChild(mkBtn("⧉ duplica", "", () =>
        mutateSheets((b) => s.active
          ? addSheet(b, { duplicateActive: true })
          : addSheet(setActiveSheet(b, s.id), { duplicateActive: true }))));
      if (sums.length > 1) acts.appendChild(mkBtn("rm", "r", () => deleteSheetConfirm(s)));
      x.appendChild(acts);
      blk.appendChild(x);
    }
    inner.appendChild(blk);
  }

  inner.appendChild(mkPrompt("›", "tap su una scheda per aprirla"));

  const newrow = document.createElement("div");
  newrow.className = "sh-newrow";
  newrow.appendChild(mkNew("nuova", () => mutateSheets((b) => addSheet(b, { duplicateActive: false }))));
  newrow.appendChild(mkNew("duplica", () => mutateSheets((b) => addSheet(b, { duplicateActive: true }))));
  newrow.appendChild(mkNew("importa", importSheetPrompt));
  inner.appendChild(newrow);
  body.appendChild(inner);
}

// Bottone azione dei blocchi scheda. stopPropagation: il tap sul bottone non
// deve far collassare/espandere il blocco (il click-handler è sul blocco).
function mkBtn(label, cls, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "sh-bb" + (cls ? " " + cls : "");
  b.textContent = label;
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(e); });
  return b;
}

// Riga prompt stile terminale ("$ comando" / "› hint").
function mkPrompt(sym, text) {
  const p = document.createElement("div");
  p.className = "sh-prompt";
  const d = document.createElement("span"); d.className = "d"; d.textContent = sym;
  p.append(d, document.createTextNode(" " + text));
  return p;
}

// Bottone della riga nuova in fondo ("$ nuova" / "$ duplica" / "$ importa").
function mkNew(label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "sh-new";
  const d = document.createElement("span"); d.className = "d"; d.textContent = "$";
  b.append(d, document.createTextNode(" " + label));
  b.addEventListener("click", onClick);
  return b;
}

function renameSheetPrompt(s) {
  const name = window.prompt("Nome scheda:", s.name);
  if (name === null) return;            // annullato
  const t = name.trim();
  if (!t) return;                        // vuoto ignorato (coerente con renameSheet)
  mutateSheets((b) => renameSheet(b, s.id, t));
}

// Importa una scheda da un codice incollato (utile su mobile, niente console).
// Accetta sia il codice base64 fornito, sia JSON grezzo; payload = {name, plan}
// oppure direttamente l'array `plan`. Crea la scheda, la attiva, salva.
function importSheetPrompt() {
  const raw = window.prompt("Incolla qui il codice della scheda:");
  if (raw == null) return;            // annullato
  const t = raw.trim();
  if (!t) return;
  let payload = null;
  for (const parse of [() => JSON.parse(fromBase64(t)), () => JSON.parse(t)]) {
    try { const v = parse(); if (v) { payload = v; break; } } catch (_) {}
  }
  if (!payload) { alert("Codice non valido: non riesco a leggerlo."); return; }
  const plan = Array.isArray(payload) ? payload : payload.plan;
  const name = Array.isArray(payload) ? "Scheda importata" : (payload.name || "Scheda importata");
  if (!Array.isArray(plan) || plan.length === 0) { alert("Codice non valido: nessun giorno trovato."); return; }
  mutateSheets((b) => importSheet(b, name, plan));
  alert(`Importata "${name}" (${plan.length} giorni). Ora è la scheda attiva.`);
}

function deleteSheetConfirm(s) {
  if (!window.confirm(`Eliminare "${s.name}"? Verrà cancellato anche lo storico di questa scheda.`)) return;
  mutateSheets((b) => deleteSheet(b, s.id));
}

// ---- Database esercizi: overlay a schermo intero (stessa logica history). ----
let catalogOpen = false;
let dbFilter = "";        // testo del filtro (handler in un task successivo)
let dbOpenGroups = {};    // gruppo → bool (default: aperti)
let dbOpenEx = null;      // id voce espansa (una per volta)

function openCatalog() {
  catalogOpen = true;
  history.pushState({ gymCatalog: true }, "");
  renderCatalog();
}

function closeCatalog() {
  if (!catalogOpen) return;
  if (history.state && history.state.gymCatalog) history.back(); // → popstate chiude
  else { catalogOpen = false; renderCatalog(); }
}

// Applica una mutazione (blob→blob) sul catalogo, deidratando/idratando attorno,
// poi salva e ridisegna. Rispetta l'invariante dehydrate-a-ogni-save.
function mutateCatalog(fn) {
  data = hydrate(fn(dehydrate(data)));
  scheduleSave();
  renderCatalog();
}

// Helper di rendering del catalogo (escape, normalizzazione, highlight, sparkline).
// Escape per body E attributi (copre anche le virgolette): così i valori
// interpolati in `value="..."` (es. modale Task 10) sono sicuri senza doppio-escape.
const dbEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const dbNorm = (s) => String(s ?? "").toLowerCase().trim();
function dbHL(name) {
  if (!dbFilter) return dbEsc(name);
  const nf = dbNorm(dbFilter); // lunghezza normalizzata: niente drift con spazi nel filtro
  const i = dbNorm(name).indexOf(nf);
  if (i < 0) return dbEsc(name);
  return dbEsc(name.slice(0, i)) + "<mark>" + dbEsc(name.slice(i, i + nf.length)) +
    "</mark>" + dbEsc(name.slice(i + nf.length));
}
function dbSparkSVG(series) {
  if (!series.length) return "";
  const a = series.map((p) => p.kg), w = 260, h = 42;
  const mn = Math.min(...a), mx = Math.max(...a), rg = (mx - mn) || 1;
  const pts = a.map((v, i) => [8 + i * (w - 16) / (Math.max(1, a.length - 1)), h - 6 - ((v - mn) / rg) * (h - 13)]);
  const ln = pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const lp = pts[pts.length - 1];
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">` +
    `<polygon points="8,${h - 6} ${ln} ${w - 8},${h - 6}" fill="var(--acc)" opacity=".18"/>` +
    `<polyline class="spk" points="${ln}" fill="none" stroke="var(--acc)" stroke-width="2" stroke-linejoin="round"/>` +
    `<circle class="spk-dot" cx="${lp[0].toFixed(1)}" cy="${lp[1].toFixed(1)}" r="3" fill="var(--acc)"/></svg>`;
}

// Dettaglio inline di una voce: usato-in / sparkline / nota (animazione CRT).
function dbDetHTML(entry) {
  const blob = dehydrate(data);
  const u = catalogUsage(blob, entry.name);
  let h = `<div class="db-det"><div class="scan"></div><div class="reveal">`;
  h += `<div class="cmd"><span class="c1">$</span> stat "${dbEsc(entry.name)}"</div>`;
  h += `<div><span class="sec">usato in</span></div>`;
  if (u.usedIn.length) {
    u.usedIn.forEach((x) => h += `<div class="uin"><span class="pf">›</span><span class="sc">${dbEsc(x.sheet)}</span><span class="dy">· giorno ${dbEsc(x.day)}</span></div>`);
  } else {
    h += `<div class="none">— non presente in nessuna scheda —</div>`;
  }
  h += `<div style="margin-top:9px"><span class="sec">andamento</span></div>`;
  if (u.series.length) {
    h += `<div class="spark"><div class="top"><span class="lastv">${u.lastKg}<span class="u"> kg ult.</span></span><span class="cap">${u.series.length} sessioni</span></div>${dbSparkSVG(u.series)}</div>`;
  } else {
    h += `<div class="none">— ancora nessuno storico —</div>`;
  }
  h += `<div style="margin-top:9px"><span class="sec">nota</span></div>`;
  h += `<textarea class="note" data-id="${entry.id}" placeholder="cue tecnico, presa, link…">${dbEsc(entry.note || "")}</textarea>`;
  h += `<div class="dacts"><button class="edit">✎ modifica</button><button class="del">× elimina</button></div>`;
  h += `</div></div>`;
  return h;
}

function renderCatalog() {
  const ov = document.getElementById("dbOverlay");
  if (!catalogOpen) { ov.classList.add("hidden"); ov.setAttribute("aria-hidden", "true"); return; }
  ov.classList.remove("hidden"); ov.setAttribute("aria-hidden", "false");
  const tree = document.getElementById("dbTree");
  const meta = document.getElementById("dbMeta");
  const blob = dehydrate(data);
  const groups = groupedCatalog(blob);
  meta.textContent = groups.reduce((n, g) => n + g.items.length, 0) + " rec";
  tree.innerHTML = "";
  const f = dbNorm(dbFilter);
  let any = false;

  groups.forEach(({ muscle, items }) => {
    const shown = items.filter((e) => !f || dbNorm(e.name).includes(f));
    if (f && !shown.length) return;
    any = any || shown.length > 0;
    const isOpen = f ? true : (dbOpenGroups[muscle] !== false);
    const node = document.createElement("div");
    node.className = "db-gnode" + (isOpen ? "" : " closed");
    const hd = document.createElement("div");
    hd.className = "db-ghd";
    hd.innerHTML = `<span class="car">${isOpen ? "▾" : "▸"}</span><span class="nm">${muscle.toLowerCase()}</span><span class="fill"></span><span class="ct">${String(items.length).padStart(2, "0")}</span>`;
    if (!f) hd.onclick = () => { dbOpenGroups[muscle] = !(dbOpenGroups[muscle] !== false); renderCatalog(); };
    node.appendChild(hd);
    const kids = document.createElement("div");
    kids.className = "db-kids";
    shown.forEach((entry, idx) => {
      const last = idx === shown.length - 1;
      const isExOpen = dbOpenEx === entry.id;
      const k = document.createElement("div");
      k.className = "db-k" + (isExOpen ? " open" : "");
      const noteDot = entry.note ? '<span class="nb" title="ha una nota"> ✎·</span>' : '';
      k.innerHTML = `<div class="db-krow"><span class="br">${last ? "└─" : "├─"}</span>` +
        `<span class="knm">${dbHL(entry.name)}${noteDot}</span><span class="car2">▸</span></div>` +
        (isExOpen ? dbDetHTML(entry) : "");
      k.querySelector(".db-krow").onclick = () => { dbOpenEx = isExOpen ? null : entry.id; renderCatalog(); };
      if (isExOpen) wireDetail(k, entry);
      kids.appendChild(k);
    });
    node.appendChild(kids);
    tree.appendChild(node);
  });

  if (f && !any) {
    tree.innerHTML = `<div class="db-nores">nessun match per "<b>${dbEsc(dbFilter)}</b>"<br>` +
      `<button class="mk" id="dbMkNew">+ aggiungi "${dbEsc(dbFilter)}"</button></div>`;
    document.getElementById("dbMkNew").onclick = () => openCatalogForm(null, dbFilter);
  }
}

// Aggancia gli handler del dettaglio inline (nota + azioni). La modale è il Task 10.
function wireDetail(k, entry) {
  const ta = k.querySelector(".note");
  ta.onclick = (e) => e.stopPropagation();
  ta.onblur = () => mutateCatalog((b) => setCatalogNote(b, entry.id, ta.value));
  k.querySelector(".edit").onclick = (e) => { e.stopPropagation(); openCatalogForm(entry); };
  k.querySelector(".del").onclick = (e) => { e.stopPropagation(); openCatalogDelete(entry); };
}
// Modale add / edit / delete del catalogo (Task 10). Dialog nativo #dbScrim:
// riusa lo stile .set-dialog (header .modal-h/.t/.x, .editlabel, input/select, .confirm).
function dbCloseModal() {
  const dlg = document.getElementById("dbScrim");
  if (dlg.open) dlg.close();
}
function openCatalogForm(entry, prefill = "") {
  const dlg = document.getElementById("dbScrim");
  const mttl = document.getElementById("dbMTtl");
  const mbody = document.getElementById("dbMBody");
  const isEdit = !!entry;
  mttl.textContent = isEdit ? "MODIFICA ESERCIZIO" : "NUOVO ESERCIZIO";
  const name0 = isEdit ? entry.name : prefill;
  const grp0 = isEdit ? entry.muscle : MUSCLE_GROUPS[0];
  mbody.innerHTML =
    `<label class="editlabel">nome esercizio</label>` +
    `<input id="dbFNm" value="${dbEsc(name0)}" placeholder="es. Panca piana bilanciere" autocomplete="off">` +
    `<div class="db-warn" id="dbFWarn"></div>` +
    `<label class="editlabel">gruppo muscolare</label><select id="dbFGrp">` +
    MUSCLE_GROUPS.map((m) => `<option ${m === grp0 ? "selected" : ""}>${m}</option>`).join("") +
    `</select>` +
    `<div class="db-mfoot"><button class="db-cancel" type="button" id="dbFCancel">annulla</button>` +
    `<button class="confirm" type="button" id="dbFOk">salva</button></div>`;
  const nm = document.getElementById("dbFNm");
  const grp = document.getElementById("dbFGrp");
  const ok = document.getElementById("dbFOk");
  const warn = document.getElementById("dbFWarn");
  const blob = dehydrate(data);
  function check() {
    const v = nm.value.trim();
    if (!v) { ok.disabled = true; warn.textContent = ""; return; }
    const dup = (blob.catalog || []).some((e) =>
      e.muscle === grp.value && dbNorm(e.name) === dbNorm(v) && (!isEdit || e.id !== entry.id));
    ok.disabled = dup; warn.textContent = dup ? "già presente in " + grp.value : "";
  }
  nm.oninput = check; grp.onchange = check; check();
  document.getElementById("dbFCancel").onclick = dbCloseModal;
  ok.onclick = () => {
    const name = nm.value.trim(), muscle = grp.value;
    // Stato vista PRIMA della mutazione: mutateCatalog ri-renderizza già, così
    // gruppo aperto + filtro azzerato sono riflessi senza un render extra.
    if (!isEdit) { dbOpenGroups[muscle] = true; dbFilter = ""; document.getElementById("dbQ").value = ""; }
    if (isEdit) mutateCatalog((b) => renameCatalogEntry(b, entry.id, { name, muscle }));
    else mutateCatalog((b) => addCatalogEntry(b, { name, muscle }));
    dbCloseModal();
  };
  if (!dlg.open) dlg.showModal();
  setTimeout(() => nm.focus(), 30);
}
function openCatalogDelete(entry) {
  const dlg = document.getElementById("dbScrim");
  document.getElementById("dbMTtl").textContent = "ELIMINA";
  document.getElementById("dbMBody").innerHTML =
    `<div class="db-delmsg">Eliminare <b>${dbEsc(entry.name)}</b> da <b>${dbEsc(entry.muscle)}</b>?` +
    `<br>Non tocca lo storico delle schede.</div>` +
    `<div class="db-mfoot"><button class="db-cancel" type="button" id="dbFCancel">annulla</button>` +
    `<button class="confirm db-danger" type="button" id="dbFOk">elimina</button></div>`;
  document.getElementById("dbFCancel").onclick = dbCloseModal;
  document.getElementById("dbFOk").onclick = () => {
    dbOpenEx = null; // prima della mutazione: il render di mutateCatalog lo riflette
    mutateCatalog((b) => deleteCatalogEntry(b, entry.id));
    dbCloseModal();
  };
  if (!dlg.open) dlg.showModal();
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

const CAL_MONS = ["gen","feb","mar","apr","mag","giu","lug","ago","set","ott","nov","dic"];
const CAL_DAYNAMES = ["dom","lun","mar","mer","gio","ven","sab"];
const calISO = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const calNum = (x) => { const v = parseFloat(String(x).replace(",", ".")); return Number.isFinite(v) ? v : null; };
const calEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));

// Top-set (kg working max) di una sessione; 0 se nessun kg working numerico.
function calTopKg(weekKey, day, dp) {
  let top = 0;
  for (const ex of dp.exercises) {
    const v = getEntry(data, weekKey, day, ex.id);
    const tracks = ex.superset
      ? [normalizeSupersetEntry(v).a, normalizeSupersetEntry(v).b]
      : [normalizeEntry(v)];
    for (const t of tracks) for (const st of t.sets) {
      if (st.warmup || st.failed) continue;
      const k = calNum(st.kg);
      if (k !== null && k > top) top = k;
    }
  }
  return top;
}

// Livello heatmap 0..4 dal volume relativo al massimo storico.
function calLvl(vol, max) {
  if (vol <= 0) return 0;
  const r = vol / max;
  if (r <= .45) return 1;
  if (r <= .66) return 2;
  if (r <= .86) return 3;
  return 4;
}

// Mappa "YYYY-MM-DD" -> [sessione...] con vol (Σ) e top (kg max) calcolati.
// Più sessioni nello stesso giorno restano nella lista (cella e pop-up le aggregano).
function calBuildByDate() {
  const map = new Map();
  for (const s of sessionDates(data)) {
    const dp = planDays().find((d) => d.day === s.day) || null;
    // La data in weeks[].dates è uno stamp che non si rimuove svuotando le serie:
    // mostra il giorno solo se c'è almeno una serie davvero completata (no sessioni
    // di prova annullate, no celle "0 kg").
    if (!sessionHasDoneSet(data, s.weekKey, s.day, dp)) continue;
    const vol = dp ? Math.round(sessionVolume(data, s.weekKey, s.day, dp)) : 0;
    const top = dp ? calTopKg(s.weekKey, s.day, dp) : 0;
    if (!map.has(s.date)) map.set(s.date, []);
    map.get(s.date).push({ ...s, dp, vol, top });
  }
  return map;
}
const calDateVol = (list) => list.reduce((a, s) => a + s.vol, 0);
const calDateTop = (list) => list.reduce((a, s) => Math.max(a, s.top), 0);

function renderCalendar() {
  const ov = document.getElementById("calendarOverlay");
  if (!calendarOpen) {
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");
    if (openIndex === null && !nutritionOpen && !planOpen) document.body.style.overflow = "";
    return;
  }
  document.getElementById("calTitle").textContent = `${CAL_MONTHS[calMonth]} ${calYear}`;

  calByDate = calBuildByDate();
  const maxVol = Math.max(1, ...[...calByDate.values()].map(calDateVol));
  const mm = String(calMonth + 1).padStart(2, "0");
  const todayISO = calISO(new Date());

  // Riga riassunto del mese.
  const monthSessions = [...calByDate.entries()]
    .filter(([d]) => d.startsWith(`${calYear}-${mm}-`))
    .flatMap(([, list]) => list);
  const monthVol = monthSessions.reduce((a, s) => a + s.vol, 0);
  document.getElementById("calMsum").innerHTML = monthSessions.length
    ? `<b>${monthSessions.length}</b> ${monthSessions.length === 1 ? "sessione" : "sessioni"} · `
      + `<b>${(monthVol / 1000).toFixed(1)}t</b> volume · media <b>${fmtKg(monthVol / monthSessions.length)} kg</b>`
    : "nessun allenamento questo mese";

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
      if (date === todayISO) cell.classList.add("today");
      const dEl = document.createElement("span");
      dEl.className = "cal-d"; dEl.textContent = String(Number(date.slice(8, 10)));
      cell.appendChild(dEl);
      const list = calByDate.get(date);
      if (list) {
        const vol = calDateVol(list);
        cell.classList.add("tr", "cal-lvl" + Math.max(1, calLvl(vol, maxVol)));
        const lt = document.createElement("span");
        lt.className = "cal-lt"; lt.textContent = list.map((s) => s.day).join("/");
        cell.appendChild(lt);
        if (vol > 0) {
          const kg = document.createElement("span");
          kg.className = "cal-kg"; kg.textContent = (vol / 1000).toFixed(1) + "t";
          cell.appendChild(kg);
        }
        cell.addEventListener("click", () => openCalDay(date));
      }
      grid.appendChild(cell);
    }
  }

  renderCalProg();

  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

// Grafico area+linea della progressione: un punto per giornata allenata, metrica
// Volume o Carico. I punti del mese visualizzato sono evidenziati e tappabili.
function renderCalProg() {
  const box = document.getElementById("calChart");
  const delta = document.getElementById("calDelta");
  const all = [...calByDate.entries()]
    .map(([date, list]) => ({ date, vol: calDateVol(list), top: calDateTop(list) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const series = all.filter((p) => (calMetric === "vol" ? p.vol : p.top) > 0);
  if (series.length < 2) {
    box.innerHTML = "";
    delta.textContent = "servono almeno due giornate con dati per la progressione";
    return;
  }
  const vals = series.map((p) => (calMetric === "vol" ? p.vol : p.top));
  const W = 300, H = 120, padX = 8, padT = 14, padB = 16;
  const max = Math.max(...vals), min = Math.min(...vals) * .9, rng = (max - min) || 1;
  const X = (i) => padX + i / (vals.length - 1) * (W - 2 * padX);
  const Y = (v) => padT + (1 - (v - min) / rng) * (H - padT - padB);
  const line = vals.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const fill = `${X(0)},${H - padB} ${line} ${X(vals.length - 1)},${H - padB}`;
  const mmPre = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-`;
  let dots = "", labels = "", lastM = -1;
  series.forEach((p, i) => {
    const cur = p.date.startsWith(mmPre);
    dots += `<circle cx="${X(i).toFixed(1)}" cy="${Y(vals[i]).toFixed(1)}" r="${cur ? 4.5 : 2.4}" `
      + `fill="${cur ? "var(--acc)" : "var(--bg)"}" stroke="var(--acc)" stroke-width="1.4" style="cursor:pointer" data-date="${p.date}"/>`;
    const m = Number(p.date.slice(5, 7)) - 1;
    if (m !== lastM) { labels += `<text x="${X(i).toFixed(1)}" y="${H - 3}" font-size="8" fill="var(--faint)" text-anchor="middle">${CAL_MONS[m]}</text>`; lastM = m; }
  });
  const last = vals[vals.length - 1], lab = calMetric === "vol" ? (last / 1000).toFixed(1) + "t" : last + "kg";
  const lastDot = `<text x="${X(vals.length - 1).toFixed(1)}" y="${(Y(last) - 8).toFixed(1)}" font-size="9" fill="var(--ac2)" text-anchor="end" font-weight="700">${lab}</text>`;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="calG" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--acc-soft)" stop-opacity=".85"/><stop offset="1" stop-color="var(--acc-soft)" stop-opacity="0"/></linearGradient></defs>
    <polygon points="${fill}" fill="url(#calG)"/>
    <polyline points="${line}" fill="none" stroke="var(--acc)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${labels}${lastDot}</svg>`;
  box.querySelectorAll("circle").forEach((ci) => ci.addEventListener("click", () => openCalDay(ci.dataset.date)));
  const dlt = vals[vals.length - 1] - vals[0], pct = vals[0] ? Math.round(dlt / vals[0] * 100) : 0;
  const unit = calMetric === "vol" ? "volume / sessione" : "carico top-set";
  delta.innerHTML = `${unit} · <span class="${dlt >= 0 ? "up" : "dn"}">${dlt >= 0 ? "↗ +" : "↘ "}${pct}%</span> <b>nello storico</b>`;
}

// Righe serie di un esercizio per il pop-up (HTML). null se nessuna serie loggata.
function calExerciseRows(v, ex) {
  const [nameA, nameB] = String(ex.name).includes(" + ") ? ex.name.split(" + ") : [ex.name, ex.name];
  const tracks = ex.superset
    ? [{ key: "a", e: normalizeSupersetEntry(v).a, sec: ex.unit === "sec", nm: nameA },
       { key: "b", e: normalizeSupersetEntry(v).b, sec: ex.unitB === "sec", nm: nameB }]
    : [{ key: null, e: normalizeEntry(v), sec: ex.unit === "sec", nm: ex.name }];
  let out = "", any = false;
  for (const tr of tracks) {
    const done = tr.e.sets.filter((st) => st.done);
    if (!done.length) continue;
    any = true;
    if (ex.superset) out += `<div class="cl set"><span class="si"></span><span class="tg">${tr.key.toUpperCase()} · ${calEsc(String(tr.nm).trim())}</span></div>`;
    let work = 0;
    for (const st of done) {
      const si = st.warmup ? "·" : String(++work);
      const kg = st.kg !== "" ? `<b>${calEsc(st.kg)}</b>` : "";
      const reps = st.reps !== "" ? `<span class="w">${kg ? "×" : ""}${calEsc(st.reps)}${tr.sec ? "s" : ""}</span>` : "";
      const val = `<span class="val">${kg}${reps || (kg ? "" : "—")}</span>`;
      let tg = "";
      if (st.warmup) tg = '<span class="tg warm">ris.</span>';
      else if (st.failed) tg = '<span class="tg fail">fail</span>';
      else if (st.feel) tg = `<span class="tg${st.feel === "hard" ? " hard" : ""}">${calEsc(RPE_LABEL[st.feel] || st.feel)}</span>`;
      out += `<div class="cl set"><span class="si">${si}</span>${val}${tg}</div>`;
    }
  }
  return any ? out : null;
}

function calIsPr(s, ex) {
  if (ex.superset) return isWeekRecord(data, s.day, ex.id, s.weekKey, "a") || isWeekRecord(data, s.day, ex.id, s.weekKey, "b");
  return isWeekRecord(data, s.day, ex.id, s.weekKey);
}

function buildCalDayBody(date) {
  const list = calByDate.get(date) || [];
  const dt = new Date(date + "T00:00");
  let h = `<div class="cl head">${CAL_DAYNAMES[dt.getDay()]} ${Number(date.slice(8, 10))} ${CAL_MONTHS[dt.getMonth()]} ${dt.getFullYear()}</div>`;
  list.forEach((s, si) => {
    if (si > 0) h += '<div class="cl rule"></div>';
    const title = (s.dp && s.dp.title) ? s.dp.title : `giorno ${s.day}`;
    h += `<div class="cl sub">${calEsc(weekLabel(s.weekKey).toLowerCase())} · giorno ${calEsc(s.day)} · ${calEsc(title.toLowerCase())}</div>`;
    h += `<div class="cl vol">volume sessione <b>${fmtKg(s.vol)} kg</b>${si === list.length - 1 ? '<span class="cal-caret"></span>' : ""}</div>`;
    h += '<div class="cl rule"></div>';
    let exNum = 0;
    (s.dp ? s.dp.exercises : []).forEach((ex) => {
      const rows = calExerciseRows(getEntry(data, s.weekKey, s.day, ex.id), ex);
      if (!rows) return;
      exNum++;
      h += `<div class="cl ex"><span class="exi">${String(exNum).padStart(2, "0")}</span> ${calEsc(ex.name)}${calIsPr(s, ex) ? '<span class="pr">PR</span>' : ""}</div>`;
      h += rows;
    });
  });
  if (!list.some((s) => s.dp && s.dp.exercises.length)) h += '<div class="cl sub">nessuna serie registrata</div>';
  document.getElementById("calDayBody").innerHTML = h;
}

// Apre il pop-up con la sessione completa e anima le righe in sequenza (boot).
function openCalDay(date) {
  if (!calByDate.has(date)) return;
  document.getElementById("calDayTtl").textContent = "SESSIONE · " + date;
  buildCalDayBody(date);
  const dlg = document.getElementById("calDayDialog");
  const body = document.getElementById("calDayBody");
  body.classList.add("cal-boot");
  if (!dlg.open) dlg.showModal();
  const lines = [...body.querySelectorAll(".cl")];
  lines.forEach((l) => l.classList.remove("in"));
  void body.offsetWidth; // reflow: lo stato iniziale (opacity 0) viene dipinto prima del fade
  lines.forEach((l, i) => { l.style.transitionDelay = (i * 30) + "ms"; l.classList.add("in"); });
}
function closeCalDay() {
  const dlg = document.getElementById("calDayDialog");
  if (dlg.open) dlg.close();
}

// Riga esercizio nell'editor: numero, grip drag, nome+sub, modifica, elimina.
function buildPlanRow(ex, i, count) {
  const row = document.createElement("div");
  row.className = "pe-row" + (ex.superset ? " ss" : "");
  row.dataset.idx = String(i);
  const ix = document.createElement("span"); ix.className = "pe-ix";
  ix.textContent = String(i + 1).padStart(2, "0");
  const grip = document.createElement("span"); grip.className = "pe-grip"; grip.textContent = "⠿";
  const meta = document.createElement("div"); meta.className = "pe-meta";
  const nm = document.createElement("div"); nm.className = "pe-name";
  // Superset: il "+" nel nome è renderizzato in accent ("Pushdown ＋ Curl").
  if (ex.superset && String(ex.name).includes("+")) {
    String(ex.name).split("+").map((p) => p.trim()).forEach((p, k) => {
      if (k > 0) { const sep = document.createElement("span"); sep.className = "pe-ssb"; sep.textContent = " ＋ "; nm.appendChild(sep); }
      nm.appendChild(document.createTextNode(p));
    });
  } else {
    nm.textContent = ex.name;
  }
  if (ex.superset) { const b = document.createElement("span"); b.className = "pe-badge"; b.textContent = "SS"; nm.appendChild(b); }
  const sub = document.createElement("div"); sub.className = "pe-sub";
  // rec sempre da restSeconds (m:ss); fallback recText per piani importati senza
  // restSeconds numerico; se mancano entrambi il segmento è omesso.
  const rec = Number.isFinite(ex.restSeconds) ? `rec ${formatTime(ex.restSeconds)}`
    : (ex.recText ? `rec ${ex.recText}` : "");
  sub.textContent = [
    ex.setsReps, rec,
    ex.bar ? `bilanciere ${ex.bar}kg` : "",
    isDumbbell(ex.name) ? "vol ×2" : "",
    (ex.unit === "sec" || ex.unitB === "sec") ? "a tempo" : "",
  ].filter(Boolean).join(" · ");
  meta.append(nm, sub);
  const edit = document.createElement("button"); edit.type = "button"; edit.className = "pe-ic"; edit.textContent = "✎";
  edit.addEventListener("click", () => openExDialog(planEditDay, ex.id));
  const del = document.createElement("button"); del.type = "button"; del.className = "pe-ic del"; del.textContent = "🗑";
  del.addEventListener("click", () => deletePlanExercise(planEditDay, ex.id, ex.name));
  row.append(ix, grip, meta, edit, del);
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

// Volume dei suoni timer: 0–40 (%), default 10. 0 = muto (resta la vibrazione).
const TIMERVOL_KEY = "gymsched_timervol";
function getTimerVol() {
  const n = parseInt(localStorage.getItem(TIMERVOL_KEY), 10);
  return Number.isFinite(n) && n >= 0 && n <= 40 ? n : 10;
}
function setTimerVol(v) { localStorage.setItem(TIMERVOL_KEY, String(v)); }

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
// Tono singolo WebAudio (sinusoide): freq Hz, durata s, ritardo s. Il volume
// viene dalla preferenza utente (getTimerVol, 0–40%): attacco dolce 50ms e
// coda esponenziale — pensato per non "sparare" in cuffia.
function tone(freq, dur = 0.18, after = 0) {
  const vol = getTimerVol() / 100;
  if (vol <= 0) return;
  try {
    ensureAudio();
    const t0 = audioCtx.currentTime + after;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  } catch (_) { /* audio unavailable; ignore */ }
}
// Fine recupero: arpeggio do-mi-sol. Preavviso (−10s): doppio do5 morbido.
// Countdown (3-2-1): singolo mi5. Sinusoidi brevi e distinte, riconoscibili
// a orecchio anche con la musica nelle cuffie senza risultare stridule.
function beep() { tone(523, 0.22); tone(659, 0.22, 0.18); tone(784, 0.5, 0.36); }
function cueWarning() { tone(523, 0.25); tone(523, 0.25, 0.35); if (navigator.vibrate) navigator.vibrate(120); }
function cueCountdown() { tone(659, 0.18); }
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
}

// Chiude lo stato GO e nasconde la barra (tap dell'utente).
function dismissTimerGo() {
  document.getElementById("timerGo").classList.add("hidden");
  document.getElementById("timerRun").classList.remove("hidden");
  document.getElementById("timerBar").classList.add("hidden");
  document.getElementById("timerBar").classList.remove("go-on");
  document.body.classList.remove("timer-on");
  wakeLock.disable();
}

function startRest(seconds, label, go = null) {
  ensureAudio(); // unlock audio within the user gesture
  startSessionIfAbsent(); // primo recupero del giorno → avvia il cronometro sessione
  wakeLock.enable();
  restCtx = { seconds, go };
  document.getElementById("timerGo").classList.add("hidden");
  document.getElementById("timerRun").classList.remove("hidden");
  document.getElementById("timerBar").classList.remove("go-on");
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
    supersetTab = "a";
    render();
  } else {
    closeFocus();
  }
}

// Mostra la striscia "com'è andata?" per l'ultima serie conclusa. Resta visibile
// (anche sull'ultima serie dell'esercizio: NON si chiude più il focus prima di
// poter valutare). Sui superset mostra DUE barre separate A e B, così si può dare
// una sensazione diversa a ciascuna traccia. La selezione corrente è evidenziata.
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
          const e2 = normalizeSupersetEntry(getEntry(data, currentWeek, currentDay, exId));
          if (e2.a.sets[info.aIdx]?.feel && e2.b.sets[info.bIdx]?.feel) scheduleFeelAskClose(info);
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
    setsBox.appendChild(setRow(i, set, prev[i] || null, isCurrent, onRemove, onOpen, meta));
  }
  container.appendChild(setsBox);

  if (!allDone) {
    const editLabel = meta.unit === "sec" ? `Serie ${curIdx + 1} — secondi` : `Serie ${curIdx + 1} — carico · step 0.5 kg`;
    const edit = buildEditBlock(editLabel, draft, prev[curIdx] || null, exerciseBar(ex, getBar()), meta.unit);
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

  if (!allDone) {
    const editLabel = meta.unit === "sec" ? `Serie ${curIdx + 1} ${trackKey.toUpperCase()} — secondi` : `Serie ${curIdx + 1} ${trackKey.toUpperCase()} — step 0.5 kg`;
    const edit = buildEditBlock(editLabel, state, prevSets[curIdx] || null, bar, meta.unit);
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
      const _doneAll = isEntryComplete(getEntry(data, currentWeek, currentDay, exId), ex);
      const _nx = nextExercisePreview(dayPlan().exercises, idx);
      const _go = _doneAll
        ? (_nx.last ? { fine: true } : { slug: goSlug(_nx.name), serie: 1 })
        : { slug: goSlug(ex.name), serie: a.curIdx + 2 };
      startRest(getRest(currentDay, exId, ex.restSeconds), ex.name, _go);
      render();
      // Due barre A/B separate (sensazione indipendente per traccia); resta
      // aperto anche sull'ultima serie. Si torna alla lista con il tasto ←.
      showFeelAsk({ idx, superset: true, aIdx: a.curIdx, bIdx: b.curIdx, last: _doneAll });
    });
    footer.appendChild(cta);
  }
  // Volume per traccia + totale superset (con ×2 manubri; tracce a tempo escluse).
  const volA = e.a.sets.reduce((s, x) => s + setVolume(x, metaA), 0);
  const volB = e.b.sets.reduce((s, x) => s + setVolume(x, metaB), 0);
  const volNodes = [];
  if (volA > 0) volNodes.push(buildVolLine(`Volume A${metaA.factor === 2 ? " · ×2 manubri" : ""}`, volA));
  if (volB > 0) volNodes.push(buildVolLine(`Volume B${metaB.factor === 2 ? " · ×2 manubri" : ""}`, volB));
  if (volA + volB > 0) volNodes.push(buildVolLine("Totale superset", volA + volB));

  // "+ serie" della traccia attiva, dentro al cassetto.
  const addRow = document.createElement("div");
  addRow.className = "addrow";
  const addS = document.createElement("button");
  addS.className = "addset"; addS.textContent = `+ serie ${supersetTab.toUpperCase()}`;
  addS.addEventListener("click", active.onAddSet);
  addRow.appendChild(addS);

  const drawerChildren = [buildRestEditor(idx, ex), buildNoteField(true, idx), ...volNodes, addRow];
  container.appendChild(buildFocusActions(drawerChildren, {
    allDone: active.allDone,
    restValue: `${getRest(currentDay, exId, ex.restSeconds)}″`,
    handlers: { rest: openFocusDrawer, comment: active.onComment, fail: active.onFail, more: toggleFocusDrawer },
  }));
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
    sub.append(document.createTextNode(ex.setsReps));
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
  if (cntEl) cntEl.textContent = `ex ${String(openIndex + 1).padStart(2, "0")}/${exsForBar.length} · ${currentWeek.split("-").pop()}`;
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
  renderSessClock();
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
  document.getElementById("tStop").addEventListener("click", () => {
    timer.stop();
    hideFeelAsk();
    dismissTimerGo();
  });
  document.getElementById("timerGo").addEventListener("click", dismissTimerGo);
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
    const map = { nutrition: openNutrition, calendar: openCalendar, sheets: openSheets, catalog: openCatalog, settings: openSettings };
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
  document.getElementById("sheetsBack").addEventListener("click", closeSheets);
  document.getElementById("dbBack").addEventListener("click", closeCatalog);
  document.getElementById("dbQ").oninput = (e) => { dbFilter = e.target.value; renderCatalog(); };
  document.getElementById("dbAddInline").onclick = () => openCatalogForm(null, dbFilter);
  document.getElementById("dbMx").addEventListener("click", dbCloseModal);
  document.getElementById("dbScrim").addEventListener("click", (e) => { if (e.target.id === "dbScrim") dbCloseModal(); });
  wireDrawer();
  document.getElementById("calPrev").addEventListener("click", () => calShiftMonth(-1));
  document.getElementById("calNext").addEventListener("click", () => calShiftMonth(1));
  document.getElementById("calMetric").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    [...e.currentTarget.children].forEach((x) => x.classList.remove("on"));
    b.classList.add("on"); calMetric = b.dataset.m; renderCalProg();
  });
  document.getElementById("calDayClose").addEventListener("click", closeCalDay);
  document.getElementById("calDayDialog").addEventListener("click", (e) => {
    if (e.target.id === "calDayDialog") e.target.close(); // tap sul backdrop
  });
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
      else if (catalogOpen) history.pushState({ gymCatalog: true }, "");
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
    if (sheetsOpen) { sheetsOpen = false; renderSheets(); const t = sheetsPending; sheetsPending = null; if (t) t(); }
    if (catalogOpen) { catalogOpen = false; renderCatalog(); }
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
{
  const splash = document.getElementById("splash");
  if (splash) {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // La riga "> system ready" finisce di digitarsi a ~2.85s; lasciamo un beat
    // per leggerla prima di dismettere lo splash (era 2400 → spariva a metà).
    const minMs = reduce ? 250 : 3400;
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
