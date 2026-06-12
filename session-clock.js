// session-clock.js — cronometro della durata totale dell'allenamento, per
// (settimana, giorno). Parte al primo recupero avviato del giorno, si ferma
// quando il giorno è completo. Solo locale (un allenamento si fa su un
// dispositivo). Stato persistito in localStorage; la chiave per (settimana,
// giorno) deriva da ctx.currentWeek/ctx.currentDay. Lo slot home e la status bar
// del focus si aggiornano via tick 1s (setInterval nel boot di app.js).
import { ctx } from "./app-context.js";
import { withoutSession, sessionState, elapsedMs } from "./timer.js";
import { planIsEmpty } from "./store.js";

const SESSION_KEY = "gymsched_session";
export const getSessionMap = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "{}"); } catch (_) { return {}; } };
const setSessionMap = (m) => localStorage.setItem(SESSION_KEY, JSON.stringify(m));
export const sessClockKey = () => `${ctx.currentWeek}-${ctx.currentDay}`;
export function startSessionIfAbsent() {
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
export function endSessionClock() {
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
export function clockText(entry, now) {
  return sessionState(entry) === "PRONTO" ? "" : "⏱ " + fmtDuration(elapsedMs(entry, now) / 1000) + " · ";
}
// Annulla il cronometro del giorno corrente (es. sessione avviata per sbaglio).
// Rimuove SOLO la voce gymsched_session: le serie loggate (in `data`) restano intatte.
function cancelSessionClock() {
  setSessionMap(withoutSession(getSessionMap(), sessClockKey()));
  renderSessionControl();
}
export function renderSessionControl() {
  const el = document.getElementById("sessClock");
  if (!el) return;
  // Piano vuoto → nessuno slot (l'empty-state guida la creazione).
  if (planIsEmpty(ctx.data)) { el.replaceChildren(); el.classList.add("hidden"); el.dataset.state = "EMPTY"; return; }

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
export function tickSessionDisplays() {
  const el = document.getElementById("sessClock");
  const entry = getSessionMap()[sessClockKey()];
  const target = planIsEmpty(ctx.data) ? "EMPTY" : sessionState(entry);
  // Rebuild completo SOLO al cambio di stato (così il pallino .sc-dot non si
  // resetta a ogni secondo). A stato invariato aggiorna solo il testo del tempo.
  if (!el || el.dataset.state !== target) {
    renderSessionControl();
  } else if (target === "IN_CORSO" || target === "IN_PAUSA" || target === "FINITO") {
    const t = document.getElementById("sessClockText");
    if (t) t.textContent = fmtDuration(elapsedMs(entry, Date.now()) / 1000);
  }
  if (ctx.openIndex !== null) {
    const clk = document.getElementById("focusSbarClock");
    if (clk) clk.textContent = clockText(entry, Date.now());
  }
}
