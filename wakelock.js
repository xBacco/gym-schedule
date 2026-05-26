// ---- Wrapper Screen Wake Lock (navigator iniettabile -> testabile in Node) ----
// Tiene lo schermo acceso durante la sessione. Il browser rilascia il sentinel
// quando la tab è nascosta, quindi si riacquisisce con onVisible().

export class ScreenWakeLock {
  constructor(nav = (typeof navigator !== "undefined" ? navigator : undefined)) {
    this.nav = nav;
    this.sentinel = null;
    this.wanted = false;
  }

  supported() {
    return !!(this.nav && this.nav.wakeLock && typeof this.nav.wakeLock.request === "function");
  }

  async enable() {
    this.wanted = true;
    await this._acquire();
  }

  async disable() {
    this.wanted = false;
    if (this.sentinel) {
      try { await this.sentinel.release(); } catch (_) { /* già rilasciato */ }
      this.sentinel = null;
    }
  }

  // Da chiamare su visibilitychange: riacquisisce quando la pagina torna visibile.
  async onVisible() {
    if (this.wanted && !this.sentinel) await this._acquire();
  }

  async _acquire() {
    if (!this.supported() || this.sentinel) return;
    try {
      this.sentinel = await this.nav.wakeLock.request("screen");
      this.sentinel.addEventListener?.("release", () => { this.sentinel = null; });
    } catch (_) {
      this.sentinel = null; // request può rifiutare se non visibile / non permesso
    }
  }
}
