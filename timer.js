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
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
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
