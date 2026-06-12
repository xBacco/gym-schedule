// sheets-ui.js — overlay "Gestore schede" a schermo intero: accordion delle
// schede (attiva + archivio), azioni per scheda (modifica/attiva/rinomina/
// duplica/elimina) e creazione/import. Stessa logica history degli altri overlay.
// Stato proprio (apertura, azione pendente, voce espansa) privato; sheetsOpen e
// sheetsPending esposti su ctx per il back-handler (popstate) di app.js.
import { ctx } from "./app-context.js";
import { mkBtn, mkPrompt, mkNew, a11yToggle, a11yRestoreFocus } from "./a11y.js";
import {
  hydrate, dehydrate, addSheet, importSheet, renameSheet, deleteSheet, setActiveSheet,
  sheetSummaries, sortSheetSummaries, sheetSlug, fmtSheetDate,
} from "./sheets.js";
import { fromBase64 } from "./store.js";

let sheetsOpen = false;
let sheetsPending = null; // azione da eseguire dopo la chiusura del gestore schede
let sheetsExpandedId = null; // id scheda espansa nell'accordion (null → default: l'attiva)

// sheetsOpen e sheetsPending esposti su ctx: il popstate handler di app.js
// finalizza la chiusura (e lancia l'azione pendente) in modo uniforme.
Object.defineProperty(ctx, "sheetsOpen", {
  get: () => sheetsOpen, set: (v) => { sheetsOpen = v; }, configurable: true,
});
Object.defineProperty(ctx, "sheetsPending", {
  get: () => sheetsPending, set: (v) => { sheetsPending = v; }, configurable: true,
});

export function openSheets() {
  sheetsOpen = true;
  sheetsExpandedId = null; // a ogni apertura riparte con l'attiva espansa
  history.pushState({ gymSheets: true }, "");
  renderSheets();
}

export function closeSheets() {
  if (!sheetsOpen) return;
  if (history.state && history.state.gymSheets) history.back(); // → popstate chiude
  else { sheetsOpen = false; renderSheets(); const t = sheetsPending; sheetsPending = null; if (t) t(); }
}

// Applica una mutazione (blob→blob) alla scheda corrente, deidratando/idratando
// attorno, poi salva e ridisegna gestore + home.
function mutateSheets(fn) {
  ctx.data = hydrate(fn(dehydrate(ctx.data)));
  ctx.scheduleSave();
  renderSheets();
  ctx.render();
}

export function renderSheets() {
  const ov = document.getElementById("sheetsOverlay");
  if (!sheetsOpen) { ov.classList.add("hidden"); ov.setAttribute("aria-hidden", "true"); return; }
  ov.classList.remove("hidden"); ov.setAttribute("aria-hidden", "false");
  const body = document.getElementById("sheetsBody");
  body.innerHTML = "";
  const sums = sortSheetSummaries(sheetSummaries(dehydrate(ctx.data)));
  document.getElementById("sheetsSub").textContent =
    `${sums.length} sched${sums.length === 1 ? "a" : "e"} · attiva + archivio`;
  const todayIso = new Date().toISOString().slice(0, 10);
  const ultTxt = (s) => (s.lastDate ? `ult ${fmtSheetDate(s.lastDate, todayIso)}` : fmtSheetDate(null, todayIso));
  // null → default (attiva espansa); "" → tutte chiuse; altrimenti id della scheda espansa.
  const expandedId = sheetsExpandedId ?? (sums.find((s) => s.active) || {}).id;

  const inner = document.createElement("div");
  inner.className = "sheets-inner";
  inner.appendChild(mkPrompt("$", "ls schede/ --sort=ultima"));

  for (const s of sums) {
    const open = s.id === expandedId;
    const blk = document.createElement("div");
    blk.className = "sh-blk" + (s.active ? " active" : "") + (open ? " open" : "");
    blk.addEventListener("click", () => { sheetsExpandedId = open ? "" : s.id; renderSheets(); });

    const h = document.createElement("div");
    h.className = "sh-h";
    const ar = document.createElement("span"); ar.className = "sh-ar"; ar.textContent = open ? "▸" : "▹";
    const nm = document.createElement("span"); nm.className = "sh-nm"; nm.textContent = sheetSlug(s.name) + "/";
    h.append(ar, nm);
    h.dataset.id = s.id;
    a11yToggle(h, open, `#sheetsBody .sh-h[data-id="${s.id}"]`);
    if (s.active) {
      const tag = document.createElement("span"); tag.className = "sh-tag"; tag.textContent = "attiva";
      h.appendChild(tag);
    } else if (!open) {
      const mt = document.createElement("span"); mt.className = "sh-mt";
      mt.textContent = `${s.days}g · ${s.exercises} es · ${ultTxt(s)}`;
      h.appendChild(mt);
    }
    blk.appendChild(h);

    if (open) {
      const x = document.createElement("div");
      x.className = "sh-x";

      const days = document.createElement("div");
      days.className = "sh-days";
      for (const dl of s.dayLines) {
        const ln = document.createElement("div");
        const L = document.createElement("span"); L.className = "L"; L.textContent = dl.day;
        const n = document.createElement("span"); n.className = "n"; n.textContent = ` ${dl.count} es`;
        ln.append(L, document.createTextNode(dl.title.toLowerCase()), n);
        days.appendChild(ln);
      }
      x.appendChild(days);

      const meta = document.createElement("div");
      meta.className = "sh-meta";
      meta.textContent =
        `${ultTxt(s)} · ${s.weeks} settiman${s.weeks === 1 ? "a" : "e"} loggat${s.weeks === 1 ? "a" : "e"}`;
      x.appendChild(meta);

      const acts = document.createElement("div");
      acts.className = "sh-acts";
      if (s.active) {
        acts.appendChild(mkBtn("✎ modifica", "p", () => { sheetsPending = ctx.openPlanEditor; closeSheets(); }));
      } else {
        acts.appendChild(mkBtn("↪ attiva", "p", () => mutateSheets((b) => setActiveSheet(b, s.id))));
      }
      acts.appendChild(mkBtn("rinomina", "", () => renameSheetPrompt(s)));
      acts.appendChild(mkBtn("⧉ duplica", "", () =>
        mutateSheets((b) => s.active
          ? addSheet(b, { duplicateActive: true })
          : addSheet(setActiveSheet(b, s.id), { duplicateActive: true }))));
      if (sums.length > 1) acts.appendChild(mkBtn("rm", "r", () => deleteSheetConfirm(s)));
      x.appendChild(acts);
      blk.appendChild(x);
    }
    inner.appendChild(blk);
  }

  inner.appendChild(mkPrompt("›", "tap su una scheda per aprirla"));

  const newrow = document.createElement("div");
  newrow.className = "sh-newrow";
  newrow.appendChild(mkNew("nuova", () => mutateSheets((b) => addSheet(b, { duplicateActive: false }))));
  newrow.appendChild(mkNew("duplica", () => mutateSheets((b) => addSheet(b, { duplicateActive: true }))));
  newrow.appendChild(mkNew("importa", importSheetPrompt));
  inner.appendChild(newrow);
  body.appendChild(inner);
  a11yRestoreFocus();
}

function renameSheetPrompt(s) {
  const name = window.prompt("Nome scheda:", s.name);
  if (name === null) return;            // annullato
  const t = name.trim();
  if (!t) return;                        // vuoto ignorato (coerente con renameSheet)
  mutateSheets((b) => renameSheet(b, s.id, t));
}

// Importa una scheda da un codice incollato (utile su mobile, niente console).
// Accetta sia il codice base64 fornito, sia JSON grezzo; payload = {name, plan}
// oppure direttamente l'array `plan`. Crea la scheda, la attiva, salva.
function importSheetPrompt() {
  const raw = window.prompt("Incolla qui il codice della scheda:");
  if (raw == null) return;            // annullato
  const t = raw.trim();
  if (!t) return;
  let payload = null;
  for (const parse of [() => JSON.parse(fromBase64(t)), () => JSON.parse(t)]) {
    try { const v = parse(); if (v) { payload = v; break; } } catch (_) {}
  }
  if (!payload) { alert("Codice non valido: non riesco a leggerlo."); return; }
  const plan = Array.isArray(payload) ? payload : payload.plan;
  const name = Array.isArray(payload) ? "Scheda importata" : (payload.name || "Scheda importata");
  if (!Array.isArray(plan) || plan.length === 0) { alert("Codice non valido: nessun giorno trovato."); return; }
  mutateSheets((b) => importSheet(b, name, plan));
  alert(`Importata "${name}" (${plan.length} giorni). Ora è la scheda attiva.`);
}

function deleteSheetConfirm(s) {
  if (!window.confirm(`Eliminare "${s.name}"? Verrà cancellato anche lo storico di questa scheda.`)) return;
  mutateSheets((b) => deleteSheet(b, s.id));
}
