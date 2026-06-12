// rest-ui.js — timer di recupero fra le serie: barra a fondo schermo con conto
// alla rovescia, cue audio/vibrazione, stato GO ("boot log" persistente allo
// 0:00), collassamento nella chip "riprendi", e wakeLock per tenere lo schermo
// acceso. Possiede le istanze del recupero (RestTimer, ScreenWakeLock,
// VisibleCountdown) e tutta la loro UI. Il callback onEnd rientra nel cuore
// focus (giudizio serie + avanzamento) via ctx: ctx.scheduleFeelAskClose,
// ctx.hideFeelAsk, ctx.advanceAfterExercise; la notifica usa ctx.swReg.
import { ctx } from "./app-context.js";
import { RestTimer, formatTime, VisibleCountdown, goSlug } from "./timer.js";
import { ScreenWakeLock } from "./wakelock.js";
import { ensureAudio, beep, cueWarning, cueCountdown } from "./cues.js";
import { notifyOn } from "./local-prefs.js";
import { startSessionIfAbsent } from "./session-clock.js";

let lastTickSecond = null;

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
    const _adv = (ctx.scheduleFeelAskClose._t != null && ctx.scheduleFeelAskClose._info?.last)
      ? ctx.scheduleFeelAskClose._info.idx : null;
    ctx.hideFeelAsk();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    beep();
    if (document.hidden && notifyOn() && ctx.swReg) {
      ctx.swReg.showNotification("Recupero finito", {
        body: (label ? label + " · " : "") + "prossima serie",
        tag: "rest-done", renotify: true, vibrate: [200, 100, 200], icon: "./icon.svg",
      }).catch(() => {});
    }
    showTimerGo(label); // persistente: si chiude solo col tap (anche tornando dall'app in background)
    if (_adv !== null) ctx.advanceAfterExercise(_adv);
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
  ctx.hideFeelAsk();
  dismissTimerGo();
}

export function startRest(seconds, label, go = null) {
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

export function wireTimerControls() {
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
