// calendar.js — overlay calendario allenamenti: heatmap mensile, grafico di
// progressione (volume/carico) e pop-up della sessione completa.
// Stato proprio (calendarOpen, mese visualizzato, metrica, mappa per data) tenuto
// privato; calendarOpen è esposto su ctx per il back-handler (popstate) di app.js.
import { ctx, planDays, fmtKg } from "./app-context.js";
import { normalizeEntry, normalizeSupersetEntry, getEntry } from "./store.js";
import { sessionDates, sessionHasDoneSet, sessionVolume, monthGrid, isWeekRecord } from "./session.js";

let calendarOpen = false;
let calYear = 0, calMonth = 0;   // mese visualizzato (month 0-based)
let calMetric = "vol";           // "vol" | "kg": metrica del grafico progressione
let calByDate = new Map();       // "YYYY-MM-DD" -> [sessione...]; popolata da renderCalendar()

// calendarOpen esposto su ctx: il popstate handler di app.js lo legge/scrive in
// modo uniforme con gli altri overlay estratti.
Object.defineProperty(ctx, "calendarOpen", {
  get: () => calendarOpen, set: (v) => { calendarOpen = v; }, configurable: true,
});

export function openCalendar() {
  calendarOpen = true;
  const now = new Date();
  calYear = now.getFullYear();
  calMonth = now.getMonth();
  history.pushState({ gymCalendar: true }, "");
  renderCalendar();
}
export function closeCalendar() {
  if (!calendarOpen) return;
  if (history.state && history.state.gymCalendar) history.back(); // → popstate chiude
  else { calendarOpen = false; renderCalendar(); }
}
export function calShiftMonth(delta) {
  const d = new Date(calYear, calMonth + delta, 1);
  calYear = d.getFullYear();
  calMonth = d.getMonth();
  renderCalendar();
}

// Metrica del grafico progressione, settata dall'handler di wiring in app.js.
export function setCalMetric(m) { calMetric = m; renderCalProg(); }

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
    const v = getEntry(ctx.data, weekKey, day, ex.id);
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
  for (const s of sessionDates(ctx.data)) {
    const dp = planDays().find((d) => d.day === s.day) || null;
    // La data in weeks[].dates è uno stamp che non si rimuove svuotando le serie:
    // mostra il giorno solo se c'è almeno una serie davvero completata (no sessioni
    // di prova annullate, no celle "0 kg").
    if (!sessionHasDoneSet(ctx.data, s.weekKey, s.day, dp)) continue;
    const vol = dp ? Math.round(sessionVolume(ctx.data, s.weekKey, s.day, dp)) : 0;
    const top = dp ? calTopKg(s.weekKey, s.day, dp) : 0;
    if (!map.has(s.date)) map.set(s.date, []);
    map.get(s.date).push({ ...s, dp, vol, top });
  }
  return map;
}
const calDateVol = (list) => list.reduce((a, s) => a + s.vol, 0);
const calDateTop = (list) => list.reduce((a, s) => Math.max(a, s.top), 0);

export function renderCalendar() {
  const ov = document.getElementById("calendarOverlay");
  if (!calendarOpen) {
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");
    if (ctx.openIndex === null && !ctx.nutritionOpen && !ctx.planOpen) document.body.style.overflow = "";
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
      else if (st.feel) tg = `<span class="tg${st.feel === "hard" ? " hard" : ""}">${calEsc(ctx.RPE_LABEL[st.feel] || st.feel)}</span>`;
      out += `<div class="cl set"><span class="si">${si}</span>${val}${tg}</div>`;
    }
  }
  return any ? out : null;
}

function calIsPr(s, ex) {
  if (ex.superset) return isWeekRecord(ctx.data, s.day, ex.id, s.weekKey, "a") || isWeekRecord(ctx.data, s.day, ex.id, s.weekKey, "b");
  return isWeekRecord(ctx.data, s.day, ex.id, s.weekKey);
}

function buildCalDayBody(date) {
  const list = calByDate.get(date) || [];
  const dt = new Date(date + "T00:00");
  let h = `<div class="cl head">${CAL_DAYNAMES[dt.getDay()]} ${Number(date.slice(8, 10))} ${CAL_MONTHS[dt.getMonth()]} ${dt.getFullYear()}</div>`;
  list.forEach((s, si) => {
    if (si > 0) h += '<div class="cl rule"></div>';
    const title = (s.dp && s.dp.title) ? s.dp.title : `giorno ${s.day}`;
    h += `<div class="cl sub">${calEsc(ctx.weekLabel(s.weekKey).toLowerCase())} · giorno ${calEsc(s.day)} · ${calEsc(title.toLowerCase())}</div>`;
    h += `<div class="cl vol">volume sessione <b>${fmtKg(s.vol)} kg</b>${si === list.length - 1 ? '<span class="cal-caret"></span>' : ""}</div>`;
    h += '<div class="cl rule"></div>';
    let exNum = 0;
    (s.dp ? s.dp.exercises : []).forEach((ex) => {
      const rows = calExerciseRows(getEntry(ctx.data, s.weekKey, s.day, ex.id), ex);
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
export function closeCalDay() {
  const dlg = document.getElementById("calDayDialog");
  if (dlg.open) dlg.close();
}
