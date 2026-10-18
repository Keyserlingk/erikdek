import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CF_LAST_REPS,
  bestWindowMean,
  criticalForceSummary,
  decimate,
  maxPullSummary,
  rfdOfPull,
  rfdSummary,
} from "../../data/analysis.js";

const DT = 1 / 80;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// Linear ramp from 0 to peakKg over rampS after restS, then hold.
function pull({ restS = 0.5, rampS = 0.2, peakKg = 40, holdS = 2 } = {}) {
  const out = [];
  for (let t = 0; t < restS; t += DT) out.push(0);
  const n = Math.round(rampS / DT);
  for (let i = 1; i <= n; i++) out.push((peakKg * i) / n);
  for (let t = 0; t < holdS; t += DT) out.push(peakKg);
  return out;
}

test("bestWindowMean finds the best 1 s average", () => {
  const s = [...Array(80).fill(10), ...Array(80).fill(30), ...Array(40).fill(20)];
  close(bestWindowMean(s, DT, 1), 30);
  assert.equal(bestWindowMean([1, 2], DT, 1), null);
});

test("maxPullSummary takes the best peak and best 1 s average across attempts", () => {
  const a = [...Array(100).fill(40), 45];
  const b = Array(100).fill(42);
  const s = maxPullSummary([a, b], DT);
  assert.equal(s.peakKg, 45);
  close(s.best1sKg, 42);
  assert.deepEqual(s.attemptPeaksKg, [45, 42]);
});

test("criticalForceSummary averages the last reps and computes W'", () => {
  const means = [40, 38, 36, 34, 32, 30, 28, 26, 25, 25, 25, 25, 25, 25];
  const s = criticalForceSummary(means, [45, 40], 7);
  close(s.cfKg, 25);
  assert.equal(s.peakKg, 45);
  close(s.cfShareOfPeak, 25 / 45);
  // (15 + 13 + 11 + 9 + 7 + 5 + 3 + 1) kg × 7 s
  close(s.wPrimeKgS, 64 * 7);
  assert.equal(criticalForceSummary(means.slice(0, CF_LAST_REPS - 1), [40], 7), null);
});

test("rfdOfPull measures a linear ramp", () => {
  // 40 kg in 0.2 s = 200 kg/s
  const r = rfdOfPull(pull({ rampS: 0.2, peakKg: 40 }), DT);
  assert.ok(Math.abs(r.rfdKgS - 200) < 10, `rfd ${r.rfdKgS}`);
  assert.ok(Math.abs(r.peakRfdKgS - 200) < 10, `peak rfd ${r.peakRfdKgS}`);
  assert.ok(Math.abs(r.timeToPeakS - 0.2) < 0.03, `ttp ${r.timeToPeakS}`);
  assert.equal(r.peakKg, 40);
});

test("rfdOfPull ranks a faster pull higher and ignores an attempt without a pull", () => {
  const slow = rfdOfPull(pull({ rampS: 0.5 }), DT);
  const fast = rfdOfPull(pull({ rampS: 0.1 }), DT);
  assert.ok(fast.rfdKgS > slow.rfdKgS);
  assert.equal(rfdOfPull(Array(200).fill(0.3), DT), null);
});

test("rfdSummary picks the best attempt and keeps per-attempt values", () => {
  const s = rfdSummary([pull({ rampS: 0.5 }), Array(200).fill(0), pull({ rampS: 0.1 })], DT);
  assert.equal(s.attemptRfdKgS.length, 3);
  assert.equal(s.attemptRfdKgS[1], null);
  assert.equal(s.rfdKgS, s.attemptRfdKgS[2]);
  assert.equal(rfdSummary([Array(200).fill(0)], DT), null);
});

test("decimate averages blocks and reports the new rate", () => {
  const d = decimate([1, 3, 5, 7, 9], 80, 3);
  assert.deepEqual(d, { hz: 40, kg: [2, 6, 9] });
  assert.deepEqual(decimate([1, 2], 80, 10), { hz: 80, kg: [1, 2] });
});
