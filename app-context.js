// app-context.js — stato condiviso fra app.js e i moduli estratti.
// I campi di stato (data, currentWeek, …) sono definiti come accessor da app.js
// (bridge in app.js via Object.defineProperties), così i moduli leggono/scrivono
// i `let` di app.js senza duplicare lo stato. `render` è sovrascritto da app.js.
import { PLAN } from "./plan.js";

export const ctx = {
  render: () => {}, // sovrascritto da app.js: ctx.render = render
};

export const planDays = () => (Array.isArray(ctx.data.plan) && ctx.data.plan.length ? ctx.data.plan : PLAN);
export const fmtKg = (n) => Math.round(n).toLocaleString("it-IT");
