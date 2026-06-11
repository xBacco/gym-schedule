import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  lockFrame,
  decryptDone,
  decryptDurationMs,
  splashRevealEndMs,
  REDUCE_MIN_MS,
  DECRYPT_TICK_MS,
} from "../splash.js";

// La riga si "risolve" progressivamente da sinistra a destra: ogni carattere si
// blocca dopo il precedente (mai prima).
test("lockFrame cresce da sinistra a destra", () => {
  for (let i = 1; i < 12; i++) {
    assert.ok(lockFrame(i) > lockFrame(i - 1), `lockFrame(${i}) deve superare lockFrame(${i - 1})`);
  }
});

// Prima che l'ultimo carattere si blocchi la decrittazione non è finita; dopo sì.
test("decryptDone: falso durante il churn, vero a reveal completato", () => {
  const text = "system ready";
  assert.equal(decryptDone(text, 0), false);
  assert.equal(decryptDone(text, 5), false);
  const frames = Math.ceil(decryptDurationMs(text) / DECRYPT_TICK_MS);
  assert.equal(decryptDone(text, frames), true);
});

// IL BUG (2026-06-11): con "Riduci movimento" attivo la permanenza dello splash era
// 250ms → spariva PRIMA che la decrittazione (~2,08s) finisse, quindi l'utente non
// vedeva nulla. La permanenza reduced-motion DEVE superare la fine del reveal.
test("la permanenza reduced-motion supera la fine della decrittazione", () => {
  assert.ok(
    REDUCE_MIN_MS >= splashRevealEndMs(),
    `REDUCE_MIN_MS (${REDUCE_MIN_MS}) deve essere >= fine reveal (${splashRevealEndMs()}ms)`
  );
});

// app.js deve pilotare il decrypt e usare la costante condivisa, non un 250 hardcoded.
test("app.js usa startSplashDecrypt e la permanenza condivisa", () => {
  const app = readFileSync(fileURLToPath(new URL("../app.js", import.meta.url)), "utf8");
  assert.match(app, /startSplashDecrypt/, "app.js deve chiamare startSplashDecrypt");
  assert.match(app, /REDUCE_MIN_MS/, "app.js deve usare REDUCE_MIN_MS");
  assert.doesNotMatch(app, /reduce\s*\?\s*250/, "niente più permanenza 250ms hardcoded per reduce");
});
