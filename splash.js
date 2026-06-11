// splash.js — logica pura dello splash di boot.
//
// Lo splash "decrypt" è la resa per chi ha "Riduci movimento" (prefers-reduced-motion)
// attivo: niente scaleY / typing-width / translate (movimento vietato), solo i caratteri
// che si DECIFRANO sul posto (churn di glifi che si bloccano da sinistra a destra).
// app.js usa questi helper per pilotare il DOM; qui non si tocca il DOM, così è
// testabile in node.

export const DECRYPT_GLYPHS = "ABCDEFGHKMNPRSTUVWXYZ0123456789#%&/<>*+=?";
export const DECRYPT_TICK_MS = 55; // intervallo tra un churn e l'altro
export const WORD_DELAY_MS = 420; // quando parte la decrittazione del wordmark
export const CAP_DELAY_MS = 980; //  ...e della riga "> system ready"

// Permanenza minima dello splash (ms) prima di poterlo dismettere.
//   reduce: deve durare abbastanza da vedere la decrittazione completarsi.
//   full:   l'accensione CRT finisce di "digitare" verso ~2,85s, più un beat di lettura.
export const REDUCE_MIN_MS = 2900; // copre la fine del reveal (~2,08s) + beat di lettura
export const FULL_MIN_MS = 3400;

// Frame al quale il carattere i-esimo smette di churnare e mostra il glifo finale.
// Sfalsato così la riga si risolve progressivamente da sinistra a destra.
export function lockFrame(i) {
  return 3 + i * 1.5;
}

// Il carattere i-esimo è bloccato (mostra il finale) al frame dato?
export function isLocked(i, frame) {
  return frame >= lockFrame(i);
}

// Tutti i caratteri di `text` sono bloccati? Gli spazi sono sempre fermi.
export function decryptDone(text, frame) {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== " " && !isLocked(i, frame)) return false;
  }
  return true;
}

// Durata (ms) per decifrare interamente `text` con tick `tickMs`.
export function decryptDurationMs(text, tickMs = DECRYPT_TICK_MS) {
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== " ") last = Math.max(last, lockFrame(i));
  }
  return Math.ceil(last) * tickMs;
}

// Istante (ms dall'avvio dello splash) in cui la riga "> system ready" ha finito di
// decifrarsi. La permanenza reduced-motion deve superarlo, o lo splash sparisce a metà.
export function splashRevealEndMs() {
  return CAP_DELAY_MS + decryptDurationMs("system ready");
}
