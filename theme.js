// theme.js — tema dell'app (scuro "Graphite" di default, chiaro "Carta").
// Persistito su localStorage globale, stesso pattern di fx.js / le altre
// preferenze locali. Il tema è applicato come attributo `data-theme` sul
// root (<html>): assente = "carta" (chiaro, il blocco :root del CSS);
// "graphite" = scuro (default).

export const THEMES = ["carta", "graphite"];
export const DEFAULT_THEME = "graphite"; // default per device nuovo / nessuna scelta
// Il blocco :root del CSS rappresenta "carta": quel tema NON mette attributo, gli
// altri usano [data-theme="..."]. Distinto dal DEFAULT_THEME (sono concetti diversi).
const ROOT_THEME = "carta";
export const THEME_KEY = "gymsched_theme";

// Legge il tema salvato; default (graphite) se assente o valore ignoto.
export function getTheme(storage) {
  const v = storage.getItem(THEME_KEY);
  return THEMES.includes(v) ? v : DEFAULT_THEME;
}

// Scrive il tema. No-op (resta invariato) su valore ignoto.
export function setTheme(storage, theme) {
  if (!THEMES.includes(theme)) return;
  storage.setItem(THEME_KEY, theme);
}

// Applica il tema sul root. "carta" = blocco :root del CSS → niente attributo;
// ogni altro tema (graphite) via [data-theme="..."].
export function applyTheme(root, storage) {
  const theme = getTheme(storage);
  if (theme === ROOT_THEME) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  return theme;
}
