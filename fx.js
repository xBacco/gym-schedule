// fx.js — preferenze effetti visivi CRT (glow, scanline).
// Off di default (look "sobrio", deciso nei mockup v2-amber-crt/compare.html).
// Persistite su localStorage globale, stesso pattern delle altre impostazioni
// locali (gymsched_bar / gymsched_plates / gymsched_notify in app.js).

export const FX = {
  glow: { key: "gymsched_fx_glow", cls: "fx-glow" },
  scan: { key: "gymsched_fx_scan", cls: "fx-scan" },
};

// Legge una preferenza fx; default false (sobrio) se assente o nome ignoto.
export function getFx(storage, name) {
  const def = FX[name];
  if (!def) return false;
  return storage.getItem(def.key) === "1";
}

// Scrive una preferenza fx (bool). No-op su nome ignoto.
export function setFx(storage, name, on) {
  const def = FX[name];
  if (!def) return;
  storage.setItem(def.key, on ? "1" : "0");
}

// Applica/rimuove le classi fx sul root in base alle preferenze salvate.
export function applyFx(root, storage) {
  for (const name of Object.keys(FX)) {
    root.classList.toggle(FX[name].cls, getFx(storage, name));
  }
}
