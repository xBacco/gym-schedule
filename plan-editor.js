// plan-editor.js — overlay "Editor scheda" a schermo intero: tab giorni,
// barra giorno (rinomina/elimina), pannello copertura muscolare, righe esercizio
// con drag-to-reorder, e il dialog add/edit esercizio (campi + chip carico).
// Stessa logica history degli altri overlay. planOpen resta in app.js (esposto su
// ctx via bridge); lo stato proprio (giorno selezionato, stato del dialog) è privato.
import { ctx, planDays, CRT_CORNERS, dbEsc } from "./app-context.js";
import { addDay, renameDay, removeDay, addExercise, removeExercise, reorderExercise, updateExercise, tabMiniLabel } from "./editor.js";
import { dayCoverage, renderBody } from "./body.js";
import { dehydrate, sheetSlug } from "./sheets.js";
import { volumeMeta, platesOn } from "./session.js";
import { formatTime } from "./timer.js";

let planEditDay = "A";   // giorno selezionato nell'editor
export function openPlanEditor() {
  ctx.planOpen = true;
  planEditDay = ctx.currentDay;
  history.pushState({ gymPlan: true }, "");
  renderPlanEditor();
}
export function closePlanEditor() {
  if (!ctx.planOpen) return;
  if (history.state && history.state.gymPlan) history.back(); // → popstate chiude
  else { ctx.planOpen = false; renderPlanEditor(); }
}

export function renderPlanEditor() {
  const ov = document.getElementById("planOverlay");
  if (!ctx.planOpen) {
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");
    if (ctx.openIndex === null && !ctx.nutritionOpen) document.body.style.overflow = "";
    return;
  }
  const plan = Array.isArray(ctx.data.plan) ? ctx.data.plan : [];
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
  const sheetName = ((ctx.data.sheets || []).find((s) => s.id === ctx.data.activeSheetId) || {}).name || "scheda";
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

    // Pannello copertura muscolare del giorno: cosa copre questo giorno della
    // scheda (presenze, non volumi). Zone non coperte spente normali, mai rosse.
    const cov = dayCoverage(dp, dehydrate(ctx.data).catalog ?? []);
    if (Object.keys(cov.zones).length) {
      const pan = document.createElement("div");
      pan.className = "crt-panel pe-scan";
      pan.innerHTML = renderBody({ zones: cov.zones, w: 78 }) + CRT_CORNERS +
        `<span class="crt-tag">DAY·${dbEsc(String(dp.day))}</span>`;
      body.appendChild(pan);
    }

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
export function addPlanDay() {
  const title = prompt("Nome del giorno (es. Petto/Tricipiti)");
  if (title === null) return; // annullato
  ctx.data = { ...ctx.data, plan: addDay(ctx.data.plan, title) };
  planEditDay = ctx.data.plan[ctx.data.plan.length - 1].day; // seleziona il nuovo giorno
  ctx.scheduleSave();
  renderPlanEditor();
  ctx.render(); // aggiorna home/empty-state
}

export function renamePlanDay() {
  const dp = (ctx.data.plan || []).find((d) => d.day === planEditDay);
  if (!dp) return;
  const t = prompt("Nuovo nome del giorno", dp.title || dp.day);
  if (t === null) return;
  ctx.data = { ...ctx.data, plan: renameDay(ctx.data.plan, planEditDay, t) };
  ctx.scheduleSave();
  renderPlanEditor();
  ctx.render();
}

export function deletePlanDay() {
  const dp = (ctx.data.plan || []).find((d) => d.day === planEditDay);
  if (!dp) return;
  if (!confirm(`Eliminare il giorno ${dp.title || dp.day}?`)) return;
  const remaining = removeDay(ctx.data.plan, planEditDay);
  ctx.data = { ...ctx.data, plan: remaining };
  ctx.scheduleSave();
  if (remaining.length === 0) {
    closePlanEditor(); // torna alla home → render() mostra l'empty-state
    ctx.render();      // il popstate handler non rende la home: lo forziamo qui
    return;
  }
  planEditDay = remaining[0].day;
  renderPlanEditor();
  ctx.render();
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
    (volumeMeta(ex, null).factor === 2 || (ex.superset && (volumeMeta(ex, "b").factor === 2 || volumeMeta(ex, "c").factor === 2))) ? "vol ×2" : "",
    (ex.unit === "sec" || ex.unitB === "sec" || ex.unitC === "sec") ? "a tempo" : "",
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
  document.getElementById("exMuscleC").style.display = on ? "" : "none";
  document.getElementById("exMuscleCLabel").style.display = on ? "" : "none";
  document.getElementById("exUnitC").style.display = on ? "" : "none";
  document.getElementById("exUnitCLabel").style.display = on ? "" : "none";
}

// Chip-toggle "opzioni carico" del dialog esercizio. Finché l'utente non tocca
// una chip, i valori seguono la derivazione automatica dal form (nome/bar/SS).
let exChipsTouched = false;
const setChip = (id, on) => {
  const el = document.getElementById(id);
  el.classList.toggle("on", !!on);
  el.setAttribute("aria-pressed", on ? "true" : "false");
};
const chipOn = (id) => document.getElementById(id).classList.contains("on");
function exDialogProbe() {
  const barRaw = document.getElementById("exBar").value.trim();
  const b = parseFloat(barRaw.replace(",", "."));
  return {
    name: document.getElementById("exName").value.trim(),
    superset: document.getElementById("exSuperset").checked,
    ...(Number.isFinite(b) && b > 0 ? { bar: b } : {}),
  };
}
function applyChipDefaults() {
  if (exChipsTouched) return;
  const probe = exDialogProbe();
  setChip("exVol2", volumeMeta(probe, null).factor === 2);
  setChip("exPlates", platesOn(probe, null));
  setChip("exVol2B", volumeMeta(probe, "b").factor === 2);
  setChip("exPlatesB", platesOn(probe, "b"));
  setChip("exVol2C", volumeMeta(probe, "c").factor === 2);
  setChip("exPlatesC", platesOn(probe, "c"));
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
  document.getElementById("exMuscleC").value = ex && ex.muscleC != null ? ex.muscleC : "";
  document.getElementById("exUnitC").value = ex && ex.unitC === "sec" ? "sec" : "reps";
  toggleMuscleB(!!(ex && ex.superset));
  document.getElementById("exChipsB").style.display = (ex && ex.superset) ? "" : "none";
  document.getElementById("exChipsC").style.display = (ex && ex.superset) ? "" : "none";
  if (ex) {
    setChip("exVol2", typeof ex.vol2 === "boolean" ? ex.vol2 : volumeMeta(ex, null).factor === 2);
    setChip("exPlates", typeof ex.plates === "boolean" ? ex.plates : platesOn(ex, null));
    setChip("exVol2B", typeof ex.vol2B === "boolean" ? ex.vol2B : volumeMeta(ex, "b").factor === 2);
    setChip("exPlatesB", typeof ex.platesB === "boolean" ? ex.platesB : platesOn(ex, "b"));
    setChip("exVol2C", typeof ex.vol2C === "boolean" ? ex.vol2C : volumeMeta(ex, "c").factor === 2);
    setChip("exPlatesC", typeof ex.platesC === "boolean" ? ex.platesC : platesOn(ex, "c"));
    // Campi espliciti già salvati: la derivazione non li deve più toccare.
    exChipsTouched = [ex.vol2, ex.plates, ex.vol2B, ex.platesB, ex.vol2C, ex.platesC].some((v) => typeof v === "boolean");
  } else {
    exChipsTouched = false;
    applyChipDefaults();
  }
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
  const muscleC = document.getElementById("exMuscleC").value;
  if (superset && muscleC) ex.muscleC = muscleC;
  // Unità a tempo: "sec" salvato esplicito, "reps" -> undefined così updateExercise
  // (merge) ripulisce una eventuale unit precedente quando si torna a ripetizioni.
  ex.unit = document.getElementById("exUnit").value === "sec" ? "sec" : undefined;
  ex.unitB = (superset && document.getElementById("exUnitB").value === "sec") ? "sec" : undefined;
  ex.unitC = (superset && document.getElementById("exUnitC").value === "sec") ? "sec" : undefined;
  // Chip "opzioni carico": sempre esplicite al salvataggio (spec §1).
  ex.vol2 = chipOn("exVol2");
  ex.plates = chipOn("exPlates");
  ex.vol2B = superset ? chipOn("exVol2B") : undefined;
  ex.platesB = superset ? chipOn("exPlatesB") : undefined;
  ex.vol2C = superset ? chipOn("exVol2C") : undefined;
  ex.platesC = superset ? chipOn("exPlatesC") : undefined;
  return ex;
}

function saveExDialog() {
  const patch = readExDialog();
  if (!patch.name) return; // nome obbligatorio
  if (exDlgId) ctx.data = { ...ctx.data, plan: updateExercise(ctx.data.plan, exDlgDay, exDlgId, patch) };
  else ctx.data = { ...ctx.data, plan: addExercise(ctx.data.plan, exDlgDay, patch) };
  ctx.scheduleSave();
  document.getElementById("exDialog").close();
  renderPlanEditor();
  ctx.render(); // la lista principale riflette i cambi
}

function deletePlanExercise(day, id, name) {
  if (!confirm(`Eliminare "${name}" dal giorno ${day}?\nLo storico resta salvato ma non sarà più mostrato.`)) return;
  ctx.data = { ...ctx.data, plan: removeExercise(ctx.data.plan, day, id) };
  ctx.scheduleSave();
  renderPlanEditor();
  ctx.render();
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
        ctx.data = { ...ctx.data, plan: reorderExercise(ctx.data.plan, day, fromIdx, target) };
        ctx.scheduleSave();
      }
      renderPlanEditor(); // ridisegna pulito (azzera i transform)
      ctx.render();
    };
    const onCancel = () => { cleanup(); renderPlanEditor(); }; // ripristina, niente commit
    body.addEventListener("pointermove", onMove);
    body.addEventListener("pointerup", onUp);
    body.addEventListener("pointercancel", onCancel);
  });
}

// Wiring del dialog esercizio: salva, chip carico, derivazione automatica,
// toggle superset. Chiamato una volta nel boot di app.js (come wireDrawer/
// wireTimerControls). I close-handler del dialog restano in app.js.
export function wireExerciseDialog() {
  document.getElementById("exDlgSave").addEventListener("click", saveExDialog);
  for (const id of ["exVol2", "exPlates", "exVol2B", "exPlatesB", "exVol2C", "exPlatesC"]) {
    document.getElementById(id).addEventListener("click", () => {
      setChip(id, !chipOn(id));
      exChipsTouched = true;
    });
  }
  document.getElementById("exName").addEventListener("input", applyChipDefaults);
  document.getElementById("exBar").addEventListener("input", applyChipDefaults);
  document.getElementById("exSuperset").addEventListener("change", (e) => {
    toggleMuscleB(e.target.checked);
    document.getElementById("exChipsB").style.display =
      document.getElementById("exSuperset").checked ? "" : "none";
    document.getElementById("exChipsC").style.display =
      document.getElementById("exSuperset").checked ? "" : "none";
    applyChipDefaults();
  });
}
