import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Regressione: lo splash di boot (#splash) DEVE stare sopra la schermata di login
// (#auth-screen). Entrambi sono position:fixed full-screen; se hanno lo stesso
// z-index, vince chi è dopo nel DOM (= #auth-screen), che così copre lo splash e
// l'animazione di apertura sparisce per gli utenti non loggati. Bug reale del 2026-06-11.
const css = readFileSync(fileURLToPath(new URL("../style.css", import.meta.url)), "utf8");

// z-index dichiarato nel blocco di regola di un selettore esatto (prima graffa).
function zIndexOf(selector) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}");
  const m = css.match(re);
  assert.ok(m, `regola CSS non trovata: ${selector}`);
  const z = m[1].match(/z-index\s*:\s*(\d+)/);
  assert.ok(z, `z-index assente in ${selector}`);
  return parseInt(z[1], 10);
}

test("#splash ha z-index maggiore di #auth-screen (altrimenti il login nasconde lo splash di boot)", () => {
  const splash = zIndexOf("#splash");
  const auth = zIndexOf("#auth-screen");
  assert.ok(splash > auth, `#splash (z=${splash}) deve stare sopra #auth-screen (z=${auth})`);
});
