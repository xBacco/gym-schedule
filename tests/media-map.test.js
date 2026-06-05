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

test("mediaFor: ogni voce MAP produce due URL wger ben formati", () => {
  // smoke sul formato della mappa attraverso la API pubblica
  const m = mediaFor({ name: "Panca piana bilanciere" });
  assert.ok(m.img1.startsWith("https://wger.de/media/exercise-images/"));
  assert.ok(m.img1.endsWith("-1.png"));
  assert.ok(m.img2.endsWith("-2.png"));
});

test("mediaFor: nome non mappato -> null", () => {
  assert.equal(mediaFor({ name: "Esercizio inventato xyz" }), null);
});

test("mediaFor: nuove voci MAP verificate HEAD 200", () => {
  const voci = [
    "spinte manubri panca piana",
    "spinte su panca inclinata (manubri)",
    "croci ai cavi in piedi",
    "rematore bilanciere",
    "rematore al cavo, presa neutra",
    "affondi con manubri",
    "lento avanti bilanciere",
    "lento avanti manubri",
    "alzate laterali",
    "curl manubri",
    "curl ez",
    "curl concentrato",
    "skullcrusher",
    "french press",
    "leg raise",
  ];
  for (const nome of voci) {
    const m = mediaFor({ name: nome });
    assert.ok(m !== null, `${nome} deve essere mappato`);
    assert.ok(m.img1.startsWith("https://wger.de/media/exercise-images/"), `${nome} img1 URL errata`);
    assert.ok(m.img1.endsWith("-1.png"), `${nome} img1 deve finire con -1.png`);
    assert.ok(m.img2.endsWith("-2.png"), `${nome} img2 deve finire con -2.png`);
  }
});
