// nutrition-ui.js — overlay "Guida alimentazione": stessa logica history del
// focus esercizio, così il tasto "indietro" del telefono chiude la guida invece
// di uscire dall'app. nutritionOpen resta in app.js (esposto su ctx via bridge);
// il contenuto è renderizzato dal modulo puro nutrition.js.
import { ctx } from "./app-context.js";
import { renderNutritionGuide } from "./nutrition.js";

export function openNutrition() {
  ctx.nutritionOpen = true;
  history.pushState({ gymNutrition: true }, "");
  renderNutritionOverlay();
}
export function closeNutrition() {
  if (!ctx.nutritionOpen) return;
  if (history.state && history.state.gymNutrition) history.back(); // → popstate chiude
  else { ctx.nutritionOpen = false; renderNutritionOverlay(); }
}
export function renderNutritionOverlay() {
  const ov = document.getElementById("nutritionOverlay");
  if (!ctx.nutritionOpen) {
    ov.classList.add("hidden");
    ov.setAttribute("aria-hidden", "true");
    if (ctx.openIndex === null) document.body.style.overflow = "";
    return;
  }
  renderNutritionGuide(document.getElementById("nutritionBody"));
  ov.classList.remove("hidden");
  ov.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}
