import test from "node:test";
import assert from "node:assert/strict";
import { APP_VERSION, STORE_UPDATE_ENABLED, VERSION_MANIFEST_URL, isNewer, getPlatform, pickStore, STORE } from "../release.js";

test("costanti: APP_VERSION è semver, flag OFF, manifest url relativo", () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(STORE_UPDATE_ENABLED, false);
  assert.equal(VERSION_MANIFEST_URL, "./version.json");
});
test("isNewer: remote maggiore → true", () => {
  assert.equal(isNewer("1.1.0", "1.0.0"), true);
  assert.equal(isNewer("1.0.1", "1.0.0"), true);
  assert.equal(isNewer("2.0.0", "1.9.9"), true);
});
test("isNewer: uguale o minore → false", () => {
  assert.equal(isNewer("1.0.0", "1.0.0"), false);
  assert.equal(isNewer("1.0.0", "1.1.0"), false);
});
test("isNewer: campi mancanti trattati come 0", () => {
  assert.equal(isNewer("1.1", "1.1.0"), false);
  assert.equal(isNewer("1.1.1", "1.1"), true);
});
test("isNewer: suffisso pre-release troncato", () => {
  assert.equal(isNewer("1.1.0-beta", "1.0.0"), true);
  assert.equal(isNewer("1.0.0-beta", "1.0.0"), false);
});
test("isNewer: input malformato → false", () => {
  assert.equal(isNewer("abc", "1.0.0"), false);
  assert.equal(isNewer("1.0.0", null), false);
  assert.equal(isNewer(undefined, "1.0.0"), false);
});

test("getPlatform: Capacitor ha priorità sull'UA", () => {
  assert.equal(getPlatform({ userAgent: "Mozilla iPhone" }, { getPlatform: () => "android" }), "android");
});
test("getPlatform: UA iPhone → ios", () => {
  assert.equal(getPlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" }, undefined), "ios");
});
test("getPlatform: UA Android → android", () => {
  assert.equal(getPlatform({ userAgent: "Mozilla/5.0 (Linux; Android 14)" }, undefined), "android");
});
test("getPlatform: desktop/sconosciuto → web", () => {
  assert.equal(getPlatform({ userAgent: "Mozilla/5.0 (Windows NT 10.0)" }, undefined), "web");
  assert.equal(getPlatform({}, undefined), "web");
});

test("pickStore: ios/android → url dello store", () => {
  assert.equal(pickStore("ios"), STORE.ios.url);
  assert.equal(pickStore("android"), STORE.android.url);
});
test("pickStore: web → null (resta sul Service Worker)", () => {
  assert.equal(pickStore("web"), null);
});
test("pickStore: store iniettato", () => {
  const s = { ios: { url: "X" }, android: { url: "Y" } };
  assert.equal(pickStore("ios", s), "X");
  assert.equal(pickStore("android", s), "Y");
});
