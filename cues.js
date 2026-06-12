// cues.js — feedback audio/vibrazione per il timer (WebAudio + navigator.vibrate).
// Il volume viene dalla preferenza utente (getTimerVol da local-prefs.js).
import { getTimerVol } from "./local-prefs.js";

let audioCtx = null;
export function ensureAudio() {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
}
// Tono singolo WebAudio (sinusoide): freq Hz, durata s, ritardo s. Il volume
// viene dalla preferenza utente (getTimerVol, 0–40%): attacco dolce 50ms e
// coda esponenziale — pensato per non "sparare" in cuffia.
export function tone(freq, dur = 0.18, after = 0) {
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
export function beep() { tone(523, 0.22); tone(659, 0.22, 0.18); tone(784, 0.5, 0.36); }
export function cueWarning() { tone(523, 0.25); tone(523, 0.25, 0.35); if (navigator.vibrate) navigator.vibrate(120); }
export function cueCountdown() { tone(659, 0.18); }
