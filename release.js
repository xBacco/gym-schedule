// release.js — versione dell'app + rilevamento aggiornamento store (scaffolding a flag spento).
// Tutta la logica decidibile senza DOM/rete vive qui, in funzioni pure e testabili.
// A flag OFF (STORE_UPDATE_ENABLED=false) niente di tutto questo viene eseguito: l'update
// resta gestito dal Service Worker, esattamente come oggi.

export const APP_VERSION = "1.0.0";

// Flag build-time: OFF nella PWA/web su GitHub Pages, ON nella futura build nativa (Capacitor).
export const STORE_UPDATE_ENABLED = false;

export const VERSION_MANIFEST_URL = "./version.json";

export const STORE = {
  ios:     { appId: "PLACEHOLDER_IOS_ID",   url: "https://apps.apple.com/app/idPLACEHOLDER_IOS_ID" },
  android: { pkg:   "it.placeholder.setlog", url: "https://play.google.com/store/apps/details?id=it.placeholder.setlog" },
};

// URL dello store per la piattaforma; 'web' → null.
export function pickStore(platform, store = STORE) {
  if (platform === "ios") return store.ios?.url ?? null;
  if (platform === "android") return store.android?.url ?? null;
  return null;
}

// 'ios' | 'android' | 'web'. Capacitor (se presente) ha priorità; poi UA; fallback 'web'.
export function getPlatform(
  nav = (typeof navigator !== "undefined" ? navigator : {}),
  cap = (typeof globalThis !== "undefined" ? globalThis.Capacitor : undefined),
) {
  if (cap && typeof cap.getPlatform === "function") {
    const p = cap.getPlatform();
    if (p === "ios" || p === "android" || p === "web") return p;
  }
  const ua = (nav && nav.userAgent) || "";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "web";
}

// Confronto semver "x.y.z": true se remote è strettamente più nuovo di current.
// Input malformati → false (meglio non mostrare un banner spurio).
export function isNewer(remote, current) {
  const parse = (v) => {
    if (typeof v !== "string") return null;
    const core = v.trim().split("-")[0];                 // scarta eventuale pre-release (-beta…)
    const parts = core.split(".");
    const nums = [0, 1, 2].map((i) => parseInt(parts[i] ?? "0", 10));
    return nums.some((n) => Number.isNaN(n)) ? null : nums;
  };
  const a = parse(remote);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;                                          // uguali
}
