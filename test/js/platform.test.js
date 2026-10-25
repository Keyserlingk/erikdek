import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { buildInfo, canChooseSensor, sensorMode, sensorModes } from "../../data/platform.js";

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };

function run({ native, variant, chosen }) {
  globalThis.Capacitor = native ? { isNativePlatform: () => true } : undefined;
  globalThis.ERKDEK_BUILD = variant ? { version: "abc1234", variant } : undefined;
  store.clear();
  if (chosen) store.set("erkdek.sensorMode", chosen);
  return { mode: sensorMode(), choose: canChooseSensor(), modes: sensorModes().join() };
}

afterEach(() => {
  delete globalThis.Capacitor;
  delete globalThis.ERKDEK_BUILD;
});

test("browser always uses the simulated sensor", () => {
  assert.deepEqual(run({ native: false, variant: "dev" }), { mode: "sim", choose: false, modes: "sim" });
  assert.deepEqual(run({ native: false, variant: undefined, chosen: "ble" }), { mode: "sim", choose: false, modes: "sim" });
  assert.deepEqual(run({ native: false, variant: "dev", chosen: "tindeq" }), { mode: "sim", choose: false, modes: "sim" });
});

test("release app: Erkdek or Tindeq, Erkdek until chosen, no simulator", () => {
  assert.deepEqual(run({ native: true, variant: "release" }), { mode: "ble", choose: true, modes: "ble,tindeq" });
  assert.deepEqual(run({ native: true, variant: "release", chosen: "tindeq" }), { mode: "tindeq", choose: true, modes: "ble,tindeq" });
  assert.deepEqual(run({ native: true, variant: "release", chosen: "sim" }), { mode: "ble", choose: true, modes: "ble,tindeq" });
});

test("debug app starts simulated and remembers the choice", () => {
  assert.deepEqual(run({ native: true, variant: "debug" }), { mode: "sim", choose: true, modes: "sim,ble,tindeq" });
  assert.deepEqual(run({ native: true, variant: "debug", chosen: "ble" }), { mode: "ble", choose: true, modes: "sim,ble,tindeq" });
  assert.deepEqual(run({ native: true, variant: "debug", chosen: "tindeq" }), { mode: "tindeq", choose: true, modes: "sim,ble,tindeq" });
});

test("buildInfo falls back when buildinfo.js is missing", () => {
  run({ native: false });
  assert.deepEqual(buildInfo(), { version: "–", variant: "dev", firmware: null });
});
