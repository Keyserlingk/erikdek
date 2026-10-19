import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { buildInfo, canChooseSensor, sensorMode } from "../../data/platform.js";

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };

function run({ native, variant, chosen }) {
  globalThis.Capacitor = native ? { isNativePlatform: () => true } : undefined;
  globalThis.ERKDEK_BUILD = variant ? { version: "abc1234", variant } : undefined;
  store.clear();
  if (chosen) store.set("erkdek.sensorMode", chosen);
  return { mode: sensorMode(), choose: canChooseSensor() };
}

afterEach(() => {
  delete globalThis.Capacitor;
  delete globalThis.ERKDEK_BUILD;
});

test("browser always uses the simulated sensor", () => {
  assert.deepEqual(run({ native: false, variant: "dev" }), { mode: "sim", choose: false });
  assert.deepEqual(run({ native: false, variant: undefined, chosen: "ble" }), { mode: "sim", choose: false });
});

test("release app always uses Bluetooth, without a choice", () => {
  assert.deepEqual(run({ native: true, variant: "release" }), { mode: "ble", choose: false });
  assert.deepEqual(run({ native: true, variant: "release", chosen: "sim" }), { mode: "ble", choose: false });
});

test("debug app starts simulated and remembers the choice", () => {
  assert.deepEqual(run({ native: true, variant: "debug" }), { mode: "sim", choose: true });
  assert.deepEqual(run({ native: true, variant: "debug", chosen: "ble" }), { mode: "ble", choose: true });
});

test("buildInfo falls back when buildinfo.js is missing", () => {
  run({ native: false });
  assert.deepEqual(buildInfo(), { version: "–", variant: "dev" });
});
