// drawer.js — menu drawer in fondo allo schermo: maniglia (tap o drag) che apre
// il pannello con le voci (alimentazione, calendario, schede, DB, impostazioni,
// scan), stessa logica history degli overlay. Stato proprio (apertura, azione
// pendente) privato; drawerOpen e drawerPending esposti su ctx per il
// back-handler (popstate) di app.js. Le voci del menu lanciano gli overlay via
// ctx.openX() (registrati in app.js).
import { ctx } from "./app-context.js";

let drawerOpen = false;
let drawerPending = null; // azione da eseguire dopo che il drawer si è chiuso

// drawerOpen e drawerPending esposti su ctx: il popstate handler di app.js
// finalizza la chiusura (e lancia l'azione pendente) in modo uniforme.
Object.defineProperty(ctx, "drawerOpen", {
  get: () => drawerOpen, set: (v) => { drawerOpen = v; }, configurable: true,
});
Object.defineProperty(ctx, "drawerPending", {
  get: () => drawerPending, set: (v) => { drawerPending = v; }, configurable: true,
});

export function renderDrawer() {
  const d = document.getElementById("menuDrawer");
  const scrim = document.getElementById("drawerScrim");
  d.classList.toggle("open", drawerOpen);
  d.setAttribute("aria-hidden", drawerOpen ? "false" : "true");
  document.getElementById("drawerHandle").setAttribute("aria-expanded", String(drawerOpen));
  scrim.classList.toggle("hidden", !drawerOpen);
}
export function openDrawer() {
  if (drawerOpen) return;
  drawerOpen = true;
  history.pushState({ gymMenu: true }, "");
  renderDrawer();
}
export function closeDrawer() {
  if (!drawerOpen) return;
  if (history.state && history.state.gymMenu) history.back(); // → popstate chiude
  else { drawerOpen = false; renderDrawer(); }
}
// Su touch un tap genera un click di compatibilità: aprendo, la maniglia sale
// (il pannello si espande) e quel click cadrebbe su scrim/voce sottostante
// richiudendo subito il drawer. preventDefault sul pointerdown non basta su
// tutti i browser (iOS Safari lo ignora), quindi inghiottiamo ogni click per la
// durata dell'animazione: il ghost click muore ovunque cada, i tap veri sulle
// voci arrivano dopo e restano attivi.
function swallowGhostClick() {
  const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
  document.addEventListener("click", swallow, true);
  setTimeout(() => document.removeEventListener("click", swallow, true), 400);
}
export function toggleDrawer() { swallowGhostClick(); drawerOpen ? closeDrawer() : openDrawer(); }
// Chiude il drawer e, una volta chiuso (history consumata), lancia l'azione scelta.
export function drawerLaunch(fn) { drawerPending = fn; closeDrawer(); }

export function wireDrawer() {
  const handle = document.getElementById("drawerHandle");
  let startY = null, moved = false;
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault(); // niente click di compatibilità: il tap apre il drawer,
    // il pannello si espande e la maniglia sale; il ghost click cadrebbe sullo
    // scrim/voce sottostante richiudendo subito il drawer appena aperto.
    startY = e.clientY; moved = false;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (startY === null) return;
    if (Math.abs(e.clientY - startY) > 8) moved = true;
  });
  handle.addEventListener("pointerup", (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    startY = null;
    if (!moved) { toggleDrawer(); return; }      // tap
    if (dy < -24 && !drawerOpen) openDrawer();    // trascina su → apre
    else if (dy > 24 && drawerOpen) closeDrawer(); // trascina giù → chiude
  });
  handle.addEventListener("pointercancel", () => { startY = null; moved = false; });
  document.getElementById("drawerScrim").addEventListener("click", closeDrawer);
  document.getElementById("drawerPanel").addEventListener("click", (e) => {
    const b = e.target.closest(".dr-item");
    if (!b) return;
    const map = { nutrition: ctx.openNutrition, calendar: ctx.openCalendar, sheets: ctx.openSheets, catalog: ctx.openCatalog, settings: ctx.openSettings, scan: ctx.openScan };
    const fn = map[b.dataset.act];
    if (fn) drawerLaunch(fn);
  });
}
