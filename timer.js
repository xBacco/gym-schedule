// ---- Pure timer utilities (testable) ----

export function formatTime(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function remainingSeconds(endTimeMs, nowMs) {
  return Math.max(0, Math.ceil((endTimeMs - nowMs) / 1000));
}

// ---- RestTimer: countdown based on an end timestamp (robust to screen lock).
//      DOM/audio side effects are injected via callbacks, so this stays portable. ----

export class RestTimer {
  // onTick(remaining, label), onEnd(label)
  constructor({ onTick = () => {}, onEnd = () => {} } = {}) {
    this.onTick = onTick;
    this.onEnd = onEnd;
    this.endTime = 0;
    this.label = "";
    this.paused = false;
    this.pausedRemaining = 0;
    this._interval = null;
  }

  start(seconds, label = "") {
    this.label = label;
    this.paused = false;
    this.endTime = Date.now() + seconds * 1000;
    this._run();
  }

  addSeconds(delta) {
    if (this.paused) {
      this.pausedRemaining = Math.max(0, this.pausedRemaining + delta);
      this.onTick(this.pausedRemaining, this.label);
    } else if (this._interval) {
      this.endTime = Math.max(Date.now(), this.endTime + delta * 1000);
      this._emit();
    }
  }

  pause() {
    if (!this._interval || this.paused) return;
    this.pausedRemaining = remainingSeconds(this.endTime, Date.now());
    this.paused = true;
    clearInterval(this._interval);
    this._interval = null;
    this.onTick(this.pausedRemaining, this.label);
  }

  resume() {
    if (!this.paused) return;
    this.endTime = Date.now() + this.pausedRemaining * 1000;
    this.paused = false;
    this._run();
  }

  stop() {
    if (this._interval) clearInterval(this._interval);
    this._interval = null;
    this.paused = false;
    this.endTime = 0;
    this.onTick(0, "");
  }

  // Recompute remaining (call on visibilitychange to correct drift).
  sync() {
    if (this._interval && !this.paused) this._emit();
  }

  _run() {
    if (this._interval) clearInterval(this._interval);
    this._emit();
    this._interval = setInterval(() => this._emit(), 250);
  }

  _emit() {
    const remaining = remainingSeconds(this.endTime, Date.now());
    this.onTick(remaining, this.label);
    if (remaining <= 0) {
      clearInterval(this._interval);
      this._interval = null;
      this.onEnd(this.label);
    }
  }
}

// Slug "da comando" per il boot-log della barra: minuscole, accenti rimossi,
// sequenze non alfanumeriche → "_", max 24 char. Fallback "esercizio".
export function goSlug(name) {
  const s = String(name ?? "")
    .normalize("NFD").replace(/[\u0300-\u036F]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24).replace(/_+$/, "");
  return s || "esercizio";
}

// Ritorna una nuova mappa-sessione (gymsched_session) senza `key`, senza mutare
// l'input. Robusta a `map` null/non-oggetto (ritorna {}).
export function withoutSession(map, key) {
  const out = {};
  if (map && typeof map === "object") {
    for (const k of Object.keys(map)) if (k !== key) out[k] = map[k];
  }
  return out;
}

// ---- Cronometro sessione (gymsched_session): voce { start, end, pausedAt, pausedMs }.
//      Funzioni pure (niente DOM/localStorage) così sono testabili in Node. ----

// Normalizza una voce (anche legacy {start,end}) alla forma canonica a 4 campi.
export function normalizeSessionEntry(entry) {
  if (!entry || typeof entry !== "object" || !entry.start) {
    return { start: null, end: null, pausedAt: null, pausedMs: 0 };
  }
  return {
    start: entry.start,
    end: entry.end ?? null,
    pausedAt: entry.pausedAt ?? null,
    pausedMs: Number(entry.pausedMs) || 0,
  };
}

// Millisecondi di allenamento effettivo: dal start a un "punto di riferimento"
// (end se finito, pausedAt se in pausa, altrimenti now), meno le pause accumulate.
export function elapsedMs(entry, nowMs) {
  const c = normalizeSessionEntry(entry);
  if (!c.start) return 0;
  let ref;
  if (c.end) ref = Date.parse(c.end);
  else if (c.pausedAt) ref = Date.parse(c.pausedAt);
  else ref = nowMs;
  return Math.max(0, ref - Date.parse(c.start) - c.pausedMs);
}

// Macchina a stati derivata dalla sola voce: "PRONTO" | "IN_CORSO" | "IN_PAUSA" | "FINITO".
export function sessionState(entry) {
  const c = normalizeSessionEntry(entry);
  if (!c.start) return "PRONTO";
  if (c.end) return "FINITO";
  if (c.pausedAt) return "IN_PAUSA";
  return "IN_CORSO";
}

// ---- Countdown "a tempo visibile": scade dopo durationMs di schermo acceso.
//      hide() congela il residuo (document.hidden), show() riparte. Side effect
//      e clock iniettabili per i test. Usato per l'auto-dismiss dello stato GO. ----
export class VisibleCountdown {
  constructor({ durationMs = 8000, onDone = () => {}, now = () => Date.now(),
    setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) } = {}) {
    this.durationMs = durationMs;
    this.onDone = onDone;
    this._now = now; this._setTimer = setTimer; this._clearTimer = clearTimer;
    this.remaining = durationMs;
    this.active = false;
    this._startedAt = null;
    this._id = null;
  }

  start(visible = true) {
    this.cancel();
    this.active = true;
    this.remaining = this.durationMs;
    if (visible) this._resume();
  }

  show() { if (this.active && this._startedAt === null) this._resume(); }

  hide() {
    if (!this.active || this._startedAt === null) return;
    this.remaining = Math.max(0, this.remaining - (this._now() - this._startedAt));
    this._startedAt = null;
    if (this._id !== null) { this._clearTimer(this._id); this._id = null; }
  }

  cancel() {
    if (this._id !== null) this._clearTimer(this._id);
    this._id = null; this._startedAt = null; this.active = false;
  }

  _resume() {
    this._startedAt = this._now();
    this._id = this._setTimer(() => {
      this._id = null; this._startedAt = null; this.active = false;
      this.onDone();
    }, this.remaining);
  }
}
