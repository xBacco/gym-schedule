import test from "node:test";
import assert from "node:assert/strict";
import { ScreenWakeLock } from "../wakelock.js";

function fakeNav() {
  const calls = { request: 0, release: 0 };
  const nav = {
    wakeLock: {
      request: async () => {
        calls.request++;
        return { release: async () => { calls.release++; }, addEventListener: () => {} };
      },
    },
  };
  return { nav, calls };
}

test("enable acquisisce un sentinel via wakeLock.request", async () => {
  const { nav, calls } = fakeNav();
  const wl = new ScreenWakeLock(nav);
  await wl.enable();
  assert.equal(calls.request, 1);
  assert.ok(wl.sentinel);
});

test("disable rilascia il sentinel e azzera lo stato", async () => {
  const { nav, calls } = fakeNav();
  const wl = new ScreenWakeLock(nav);
  await wl.enable();
  await wl.disable();
  assert.equal(calls.release, 1);
  assert.equal(wl.sentinel, null);
});

test("onVisible riacquisisce solo se voluto e senza sentinel", async () => {
  const { nav, calls } = fakeNav();
  const wl = new ScreenWakeLock(nav);
  await wl.enable();      // request -> 1
  wl.sentinel = null;     // simula il rilascio del browser quando la tab è nascosta
  await wl.onVisible();   // request -> 2
  assert.equal(calls.request, 2);
});

test("onVisible non fa nulla se il wake lock non è voluto", async () => {
  const { nav, calls } = fakeNav();
  const wl = new ScreenWakeLock(nav);
  await wl.onVisible();
  assert.equal(calls.request, 0);
});

test("API assente: supported() è false e enable() non lancia", async () => {
  const wl = new ScreenWakeLock({});
  assert.equal(wl.supported(), false);
  await wl.enable();
  assert.equal(wl.sentinel, null);
});

test("enable concorrenti non emettono due request (guard in-flight)", async () => {
  const calls = { request: 0 };
  const resolvers = [];
  const nav = {
    wakeLock: {
      request: () => {
        calls.request++;
        return new Promise((res) => resolvers.push(() => res({ release: async () => {}, addEventListener: () => {} })));
      },
    },
  };
  const wl = new ScreenWakeLock(nav);
  const p1 = wl.enable();
  const p2 = wl.enable(); // concorrente, prima che la prima request risolva
  resolvers.forEach((fn) => fn());
  await Promise.all([p1, p2]);
  assert.equal(calls.request, 1);
});
