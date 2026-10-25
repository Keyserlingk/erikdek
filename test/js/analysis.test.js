import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CF_LAST_REPS,
  bestWindowMean,
  compressCurve,
  curvePoints,
  forceRetention,
  criticalForceSummary,
  maxPullSummary,
  measuredDtS,
  newSampleTiming,
  peakForce,
  rfdOfPull,
  timeSamples,
  rfdSummary,
  alignRepCurves,
  compressRepCurves,
  meanCurve,
  repOnset,
  representativeCurve,
  resample,
} from "../../data/analysis.js";

const DT = 1 / 80;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// Linear ramp from baseKg to peakKg over rampS after restS, then hold.
function pull({ restS = 0.5, rampS = 0.2, peakKg = 40, holdS = 2, baseKg = 0 } = {}) {
  const out = [];
  for (let t = 0; t < restS; t += DT) out.push(baseKg);
  const n = Math.round(rampS / DT);
  for (let i = 1; i <= n; i++) out.push(baseKg + ((peakKg - baseKg) * i) / n);
  for (let t = 0; t < holdS; t += DT) out.push(peakKg);
  return out;
}

test("forceRetention compares the last reps with the first", () => {
  assert.equal(forceRetention([30, 30, 30, 24, 24, 24]), 80);
  assert.equal(forceRetention([30, 20]), (100 * 20) / 30); // 1 vs 1
  assert.equal(forceRetention([30, 25, 20, 15, 10]), (100 * 12.5) / 27.5); // 2 vs 2
  assert.equal(forceRetention([30]), null);
  assert.equal(forceRetention([0, 0, 5, 5]), null);
});

test("bestWindowMean finds the best 1 s average", () => {
  const s = [...Array(80).fill(10), ...Array(80).fill(30), ...Array(40).fill(20)];
  close(bestWindowMean(s, DT, 1), 30);
  assert.equal(bestWindowMean([1, 2], DT, 1), null);
});

test("maxPullSummary takes the best 50 ms peak and best 1 s average across attempts", () => {
  const a = [...Array(100).fill(40), 45, 45, 45, 45];
  const b = Array(100).fill(42);
  const s = maxPullSummary([a, b], DT);
  assert.equal(s.peakKg, 45);
  close(s.best1sKg, 42);
  assert.deepEqual(s.attemptPeaksKg, [45, 42]);
});

test("peakForce averages over 50 ms, so a one-sample jerk counts a quarter at 80 Hz", () => {
  const s = Array(100).fill(40);
  s[50] = 48;
  close(peakForce(s, DT), 42);
  close(peakForce(s, 1 / 1000), 40 + 8 / 50);
  assert.equal(peakForce([3, 7], DT), 7); // shorter than the window
  assert.equal(peakForce([], DT), 0);
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
  assert.ok(Math.abs(r.rfd100KgS - 200) < 10, `rfd100 ${r.rfd100KgS}`);
  assert.ok(Math.abs(r.timeTo90S - 0.18) < 0.03, `t90 ${r.timeTo90S}`);
  assert.equal(r.peakKg, 40);
  assert.equal(r.still, true);
});

test("rfdOfPull measures from the force it starts at (a relaxed hang)", () => {
  // 15 kg hanging, then 15 → 55 kg in 0.2 s = 200 kg/s
  const r = rfdOfPull(pull({ baseKg: 15, peakKg: 55, rampS: 0.2 }), DT);
  assert.ok(Math.abs(r.rfdKgS - 200) < 10, `rfd ${r.rfdKgS}`);
  assert.ok(Math.abs(r.baselineKg - 15) < 1e-9);
  assert.ok(Math.abs(r.timeTo90S - 0.18) < 0.03, `t90 ${r.timeTo90S}`);
});

test("rfdOfPull flags a pull that didn't start from still", () => {
  // bouncing ±3 kg before the pull
  const bouncy = pull({ baseKg: 10, peakKg: 50 }).map((kg, i) => (i < 40 ? kg + 3 * Math.sin(i / 2) : kg));
  assert.equal(rfdOfPull(bouncy, DT).still, false);
  // pulling right from the first sample: no quiet time to measure the start from
  const early = pull({ restS: 0, rampS: 0.3 });
  assert.equal(rfdOfPull(early, DT).still, false);
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
  assert.equal(s.unsteadyAttempts, 0);
  assert.equal(s.baselineKg, undefined);
  assert.equal(rfdSummary([Array(200).fill(0)], DT), null);
});

test("rfdSummary leaves out pulls that didn't start from still, unless all are like that", () => {
  const early = pull({ restS: 0, rampS: 0.05, peakKg: 60 }); // fastest, but no still start
  const s = rfdSummary([pull({ rampS: 0.3 }), early], DT);
  assert.equal(s.unsteadyAttempts, 1);
  assert.equal(s.attemptRfdKgS[1], null);
  assert.equal(s.rfdKgS, s.attemptRfdKgS[0]);
  assert.equal(s.peakKg, 60); // the peak still counts
  const only = rfdSummary([early], DT);
  assert.equal(only.still, false);
  assert.ok(only.rfdKgS > 0);
});

test("compressCurve keeps only loaded stretches with padding and merges close ones", () => {
  const s = [0, 0, 0, 0, 5, 6, 7, 0, 0, 0, 0, 0, 0, 0, 8, 0, 9, 0, 0, 0];
  const c = compressCurve(s, 10, { minKg: 1, maxPoints: 1000, pad: 1 });
  assert.equal(c.hz, 10);
  assert.deepEqual(c.segments, [
    { t: 0.3, kg: [0, 5, 6, 7, 0] },
    { t: 1.3, kg: [0, 8, 0, 9, 0] }, // 8 and 9 merged through overlapping padding
  ]);
  assert.deepEqual(compressCurve([0, 0.5, 0.2], 80).segments, []);
});

test("compressCurve downsamples all segments by one factor to fit maxPoints", () => {
  const s = [...Array(100).fill(10), ...Array(500).fill(0), ...Array(100).fill(20)];
  const c = compressCurve(s, 80, { maxPoints: 50, pad: 0 });
  assert.equal(c.hz, 20); // 200 loaded samples / 50 -> factor 4
  assert.equal(c.segments.length, 2);
  assert.equal(c.segments[0].kg.length + c.segments[1].kg.length, 50);
  assert.equal(c.segments[1].t, 7.5);
});

test("curvePoints draws gaps as zero and reads the old single-array format", () => {
  const p = curvePoints({ hz: 10, segments: [{ t: 0, kg: [5, 5] }, { t: 2, kg: [7] }] });
  assert.deepEqual(p.x, [0, 0.1, 0.2, 1.9, 2]);
  assert.deepEqual(p.y, [5, 5, 0, 0, 7]);
  assert.deepEqual(curvePoints({ hz: 2, kg: [1, 2] }), { x: [0, 0.5], y: [1, 2] });
});

test("compressRepCurves keeps one curve per rep at ~40 Hz, fewer points when long", () => {
  const rep = Array.from({ length: 80 }, (_, i) => i / 10); // 1 s at 80 Hz
  const c = compressRepCurves([rep, rep], 80);
  assert.equal(c.hz, 40);
  assert.equal(c.reps.length, 2);
  assert.equal(c.reps[0].length, 40);
  assert.equal(c.reps[0][0], 0.05); // average of 0 and 0.1
  const long = compressRepCurves([rep, rep], 80, { maxPoints: 40 });
  assert.equal(long.hz, 20);
  assert.equal(long.reps[0].length, 20);
});

test("alignRepCurves lines reps up at their force onset; meanCurve where half have data", () => {
  const early = [0, 10, 20, 20, 20]; // onset index 0 (the sample before 10 kg)
  const late = [0, 0, 0, 10, 20, 20]; // onset index 2
  const { x, ys } = alignRepCurves([early, late], 10);
  assert.deepEqual(x, [-0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4]);
  assert.deepEqual(ys[0], [null, null, 0, 10, 20, 20, 20]);
  assert.deepEqual(ys[1], [0, 0, 0, 10, 20, 20, null]);
  assert.deepEqual(meanCurve(ys), [0, 0, 0, 10, 20, 20, 20]);
  assert.deepEqual(meanCurve([[1, null], [3, null], [5, 7]]), [3, null]); // 1 of 3 isn't half
  assert.equal(repOnset([0, 0, 0]), 0);
});

test("representativeCurve: average of the reps, or the best one", () => {
  const rc = { hz: 10, reps: [[0, 10, 20], [0, 0, 20, 30]] };
  const avg = representativeCurve(rc);
  assert.deepEqual(avg.x, [-0.1, 0, 0.1, 0.2]);
  assert.deepEqual(avg.y, [0, 0, 15, 25]);
  const best = representativeCurve(rc, "best");
  assert.deepEqual(best.y, [0, 0, 20, 30]);
  assert.equal(representativeCurve({ hz: 10, reps: [] }), null);
});

test("resample interpolates onto a common time grid", () => {
  assert.deepEqual(resample([0, 0.1, 0.2], [0, 10, 20], [-0.05, 0, 0.05, 0.2, 0.3]), [null, 0, 5, 20, null]);
  assert.deepEqual(resample([0, 0.1, 0.2], [0, null, 20], [0, 0.05, 0.2]), [0, null, 20]);
});

test("the sample rate is measured from timestamps; pauses don't count", () => {
  const t = newSampleTiming();
  // 89 Hz in batches of 8, then a 3 s pause, then more
  let ms = 0;
  const batch = () => {
    const ts = ms;
    ms += (8 * 1000) / 89;
    return { ts: Math.round(ts), te: Math.round(ts + (7 * 1000) / 89), kg: Array(8).fill(1) };
  };
  for (let i = 0; i < 10; i++) timeSamples(t, batch());
  assert.equal(measuredDtS(t), null); // under a second so far
  for (let i = 0; i < 10; i++) timeSamples(t, batch());
  ms += 3000;
  for (let i = 0; i < 20; i++) timeSamples(t, batch());
  assert.ok(Math.abs(1 / measuredDtS(t) - 89) < 0.5, `${1 / measuredDtS(t)} Hz`);
});
