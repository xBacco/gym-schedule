// theme.js — tema dell'app (chiaro "Carta" di default, scuro "Graphite").
// Persistito su localStorage globale, stesso pattern di fx.js / le altre
// preferenze locali. Il tema è applicato come attributo `data-theme` sul
// root (<html>): assente o "carta" = chiaro; "graphite" = scuro.

export const THEMES = ["carta", "graphite"];
export const DEFAULT_THEME = "carta";
export const THEME_KEY = "gymsched_theme";

// Legge il tema salvato; default "carta" se assente o valore ignoto.
export function getTheme(storage) {
  const v = storage.getItem(THEME_KEY);
  return THEMES.includes(v) ? v : DEFAULT_THEME;
}

// Scrive il tema. No-op (resta invariato) su valore ignoto.
export function setTheme(storage, theme) {
  if (!THEMES.includes(theme)) return;
  storage.setItem(THEME_KEY, theme);
}

// Applica il tema sul root. "carta" (default) non mette attributo, così il
// blocco :root del CSS resta la sorgente di verità; gli altri temi usano
// [data-theme="..."].
export function applyTheme(root, storage) {
  const theme = getTheme(storage);
  if (theme === DEFAULT_THEME) root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  return theme;
}
