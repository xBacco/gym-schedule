import { test } from "node:test";
import assert from "node:assert/strict";
import { mediaFor } from "../media-map.js";

test("mediaFor: voce mappata → due frame wger", () => {
  const m = mediaFor({ name: "Panca piana bilanciere", img: "" });
  assert.equal(m.img1, "https://wger.de/media/exercise-images/192/Bench-press-1.png");
  assert.equal(m.img2, "https://wger.de/media/exercise-images/192/Bench-press-2.png");
});

test("mediaFor: match case-insensitive con spazi", () => {
  assert.ok(mediaFor({ name: "  CRUNCH a terra " }));
});

test("mediaFor: override img vince sulla mappa (frame singolo)", () => {
  const m = mediaFor({ name: "Panca piana bilanciere", img: "https://x/y.png" });
  assert.deepEqual(m, { img1: "https://x/y.png" });
});

test("mediaFor: voce non mappata → null (fallback: solo figura)", () => {
  assert.equal(mediaFor({ name: "Esercizio inventato", img: "" }), null);
  assert.equal(mediaFor(null), null);
});
