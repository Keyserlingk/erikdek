import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_COUNTS_PER_KG, SimSensor } from "../../data/simdevice.js";

// Deterministic random source so the tests don't flake.
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function run(sensor, n) {
  const events = [];
  const kg = [];
  for (let i = 0; i < n; i++) {
    const s = sensor.step();
    kg.push(s.kg);
    events.push(...s.events);
  }
  return { kg, events, mean: (from = 0) => kg.slice(from).reduce((a, b) => a + b, 0) / (kg.length - from) };
}

test("auto-tares on start and reads ~0 with no load", () => {
  const sensor = new SimSensor({ random: seeded() });
  sensor.setScenario("idle");
  const r = run(sensor, 120);
  assert.deepEqual(r.events, [{ t: "tared" }]);
  assert.ok(Math.abs(r.mean(40)) < 0.1, `mean ${r.mean(40)}`);
});

test("uncalibrated reads ~12 % high; calibrating with the weight fixes it", () => {
  const sensor = new SimSensor({ random: seeded(2) });
  sensor.setScenario("idle");
  run(sensor, 40); // tare
  sensor.setScenario("weight", 20);
  const before = run(sensor, 400).mean(240); // swing has settled
  assert.ok(before > 21.5 && before < 23, `uncalibrated ${before}`);

  sensor.handle({ cmd: "calibrate", kg: 20 });
  const cal = run(sensor, 80);
  assert.equal(cal.events.length, 1);
  assert.equal(cal.events[0].t, "calibrated");
  assert.ok(Math.abs(cal.events[0].cpk - 16000) < 200, `cpk ${cal.events[0].cpk}`);
  assert.ok(Math.abs(run(sensor, 80).mean() - 20) < 0.3);
});

test("calibration errors, reset and restore", () => {
  const sensor = new SimSensor({ random: seeded(3) });
  sensor.setScenario("idle");
  run(sensor, 40);
  sensor.handle({ cmd: "calibrate", kg: 20 });
  assert.deepEqual(run(sensor, 80).events, [{ t: "calError", reason: "tooSmall" }]);
  sensor.handle({ cmd: "calibrate", kg: 0 });
  assert.deepEqual(run(sensor, 80).events, [{ t: "calError", reason: "badWeight" }]);

  assert.deepEqual(sensor.handle({ cmd: "setCalibration", cpk: 15000 }), [{ t: "calibrated", calibrated: true, cpk: 15000 }]);
  assert.deepEqual(sensor.handle({ cmd: "setCalibration", cpk: 5 }), []); // implausible: ignored
  assert.deepEqual(sensor.handle({ cmd: "calReset" }), [{ t: "calibrated", calibrated: false, cpk: DEFAULT_COUNTS_PER_KG }]);
});

test("a saved calibration is used from the start", () => {
  const sensor = new SimSensor({ random: seeded(4), calibration: { countsPerKg: 16000, calibrated: true } });
  sensor.setScenario("idle");
  run(sensor, 40);
  sensor.setScenario("pull", 30);
  const r = run(sensor, 160);
  assert.ok(Math.abs(r.mean(80) - 30) < 1, `pull ${r.mean(80)}`);
  assert.equal(sensor.calibrated, true);
});
