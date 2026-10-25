// Force-curve analysis for the tests. No DOM access, so it runs under node --test too.

// Number of final reps averaged for critical force (Giles et al. 24 × 7:3 protocol).
export const CF_LAST_REPS = 6;
// Peak force is the highest average over this window, not the single highest sample:
// a jerk at the top of a pull doesn't count in full, so every sensor (HX711, ADS1220,
// Tindeq) gives about the same peak for the same pull.
export const PEAK_WINDOW_S = 0.05;
// Rate of force development: the rise over these windows from pull onset (the headline
// is 0–200 ms), and the steepest rise over PEAK_RFD_WINDOW_S.
export const RFD_WINDOW_S = 0.2;
export const RFD_SHORT_WINDOW_S = 0.1;
const PEAK_RFD_WINDOW_S = 0.05;
// Onset: the force leaves its starting level (the baseline: the average over up to
// BASELINE_S before the pull) by more than max(ONSET_MIN_KG, ONSET_NOISE × its noise);
// then traced back to where the rise began. A baseline that moves more than
// max(STILL_MIN_KG, STILL_SHARE × the pull) isn't still: that attempt's RFD isn't used.
const BASELINE_S = 0.25;
const BASELINE_MIN_S = 0.1;
const BASELINE_GUARD_S = 0.05;
const ONSET_MIN_KG = 1;
const ONSET_NOISE = 3;
const STILL_MIN_KG = 0.5;
const STILL_SHARE = 0.03;

// Force retention: average of the last reps as % of the average of the first reps
// (up to 3 each, never overlapping). Null with fewer than 2 reps.
export function forceRetention(repMeansKg, count = 3) {
  const n = repMeansKg.length;
  if (n < 2) return null;
  const k = Math.min(count, Math.floor(n / 2));
  const avg = (list) => list.reduce((a, b) => a + b, 0) / list.length;
  const first = avg(repMeansKg.slice(0, k));
  return first > 0 ? (100 * avg(repMeansKg.slice(n - k))) / first : null;
}

// Highest average over any window of `windowS` seconds.
export function bestWindowMean(samples, dtS, windowS) {
  const n = Math.max(1, Math.round(windowS / dtS));
  if (samples.length < n) return null;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += samples[i];
  let best = sum;
  for (let i = n; i < samples.length; i++) {
    sum += samples[i] - samples[i - n];
    if (sum > best) best = sum;
  }
  return best / n;
}

// The sample rate measured from the sensor's timestamps ({ts, te} in ms of each batch of
// samples). Gaps longer than MAX_GAP_MS (the sensor paused) don't count.
const MAX_GAP_MS = 500;
export const newSampleTiming = () => ({ spanMs: 0, intervals: 0, lastMs: null });

export function timeSamples(t, { ts, te = ts, kg }) {
  const n = kg.length;
  const gap = ts - t.lastMs;
  if (t.lastMs !== null && gap > 0 && gap <= MAX_GAP_MS) {
    t.spanMs += te - t.lastMs;
    t.intervals += n;
  } else if (n > 1) {
    t.spanMs += te - ts;
    t.intervals += n - 1;
  }
  t.lastMs = te;
}

// Seconds between samples, once at least a second has been measured; else null.
export const measuredDtS = (t) => (t && t.spanMs >= 1000 ? t.spanMs / 1000 / t.intervals : null);

// Each sample averaged with `half` samples on either side (fewer at the ends).
function centredMean(samples, half) {
  if (half < 1) return samples;
  return samples.map((_, i) => {
    const from = Math.max(0, i - half);
    const to = Math.min(samples.length, i + half + 1);
    let sum = 0;
    for (let k = from; k < to; k++) sum += samples[k];
    return sum / (to - from);
  });
}

// Peak force: the highest PEAK_WINDOW_S average (the highest sample if there are fewer).
export function peakForce(samples, dtS) {
  if (!samples.length) return 0;
  return Math.max(0, bestWindowMean(samples, dtS, PEAK_WINDOW_S) ?? Math.max(...samples));
}

// Max pull: best peak and best 1 s average over all attempts.
export function maxPullSummary(attempts, dtS) {
  const peaks = attempts.map((a) => peakForce(a, dtS));
  const best1s = attempts.map((a) => bestWindowMean(a, dtS, 1) ?? 0);
  return {
    peakKg: Math.max(0, ...peaks),
    best1sKg: Math.max(0, ...best1s),
    attemptPeaksKg: peaks,
  };
}

// Critical force from the per-rep mean forces of an all-out 7:3 test.
// W' is the work above critical force, as kg·s (impulse) over the work phases.
export function criticalForceSummary(repMeansKg, repPeaksKg, workS) {
  if (repMeansKg.length < CF_LAST_REPS) return null;
  const last = repMeansKg.slice(-CF_LAST_REPS);
  const cfKg = last.reduce((a, b) => a + b, 0) / last.length;
  const peakKg = Math.max(0, ...repPeaksKg);
  const wPrimeKgS = repMeansKg.reduce((sum, m) => sum + Math.max(0, m - cfKg) * workS, 0);
  return { cfKg, peakKg, cfShareOfPeak: peakKg > 0 ? cfKg / peakKg : 0, wPrimeKgS };
}

// Rate of force development of one explosive pull, from where the force leaves its
// starting level (it doesn't have to start at 0 kg: a relaxed hang is fine).
//   rfdKgS:       rise over the first 200 ms after onset, per second (null: too short)
//   rfd100KgS:    the same over the first 100 ms
//   peakRfdKgS:   steepest rise over any 50 ms
//   timeTo90S:    onset to 90 % of the way from the baseline to the peak
//   peakKg:       peak force (PEAK_WINDOW_S average)
//   baselineKg:   the force before the pull
//   still:        false when the force wasn't steady before the pull (RFD unreliable)
// null when there is no real pull.
export function rfdOfPull(samples, dtS) {
  const n = samples.length;
  if (n < 2) return null;
  const peakKg = peakForce(samples, dtS);
  const start = samples[0];
  // Where the pull clearly gets going, to find the quiet part before it.
  const clear = samples.findIndex((kg) => kg >= start + Math.max(ONSET_MIN_KG, 0.2 * (peakKg - start)));
  if (clear < 0) return null;
  const guard = Math.round(BASELINE_GUARD_S / dtS);
  let quietEnd = clear;
  while (quietEnd > 0 && samples[quietEnd - 1] > start + ONSET_MIN_KG / 2) quietEnd--; // before the rise
  quietEnd = Math.max(1, Math.min(quietEnd, clear - guard));
  const quiet = samples.slice(Math.max(0, quietEnd - Math.round(BASELINE_S / dtS)), quietEnd);
  const baselineKg = quiet.reduce((a, b) => a + b, 0) / quiet.length;
  const sd = Math.sqrt(quiet.reduce((a, b) => a + (b - baselineKg) ** 2, 0) / quiet.length);
  const pull = peakKg - baselineKg;
  if (pull < 2 * ONSET_MIN_KG) return null; // no real pull
  const still = quiet.length * dtS >= BASELINE_MIN_S - 1e-9 && sd <= Math.max(STILL_MIN_KG, STILL_SHARE * pull);

  // Onset: the first crossing of baseline + threshold, traced back down the rise.
  const threshold = baselineKg + Math.max(ONSET_MIN_KG, ONSET_NOISE * sd);
  let onset = samples.findIndex((kg, i) => i >= quietEnd - 1 && kg >= threshold);
  if (onset < 0) return null;
  // Traced back on a 20 ms average, so noise at fast rates doesn't stop it early.
  const smooth = centredMean(samples, Math.round(0.01 / dtS));
  const level = baselineKg + Math.max(2 * sd, 0.005 * pull);
  while (onset > 0 && smooth[onset - 1] > level && smooth[onset - 1] < smooth[onset]) onset--;
  if (onset > 0) onset--; // the last sample at the starting level
  while (onset + 1 < n && samples[onset + 1] <= level) onset++; // (the average rises a little early)

  const rise = (windowS) => {
    const end = onset + Math.round(windowS / dtS);
    return end < n ? (samples[end] - samples[onset]) / windowS : null;
  };
  const half = Math.max(1, Math.round(PEAK_RFD_WINDOW_S / 2 / dtS));
  let peakIdx = onset;
  for (let i = onset; i < n; i++) if (samples[i] > samples[peakIdx]) peakIdx = i;
  let peakRfd = 0;
  for (let i = Math.max(half, onset); i + half < n && i <= peakIdx; i++) {
    const slope = (samples[i + half] - samples[i - half]) / (2 * half * dtS);
    if (slope > peakRfd) peakRfd = slope;
  }
  const at90 = samples.findIndex((kg, i) => i > onset && kg >= baselineKg + 0.9 * pull);
  return {
    rfdKgS: rise(RFD_WINDOW_S),
    rfd100KgS: rise(RFD_SHORT_WINDOW_S),
    peakRfdKgS: peakRfd,
    timeTo90S: at90 >= 0 ? (at90 - onset) * dtS : null,
    peakKg,
    baselineKg,
    still,
  };
}

// Best attempt (by 0–200 ms RFD) plus all attempts' RFD. Attempts that didn't start from
// still are left out (null), unless none did: then the best of them, with still: false.
// The peak force is the best of all attempts.
export function rfdSummary(attempts, dtS) {
  const results = attempts.map((a) => rfdOfPull(a, dtS));
  const measured = results.filter((r) => r && r.rfdKgS !== null);
  if (!measured.length) return null;
  const steady = measured.filter((r) => r.still);
  const pool = steady.length ? steady : measured;
  const best = pool.reduce((a, b) => (b.rfdKgS > a.rfdKgS ? b : a));
  const { baselineKg, ...rest } = best;
  return {
    ...rest,
    peakKg: Math.max(...measured.map((r) => r.peakKg)),
    attemptRfdKgS: results.map((r) => (r && r.rfdKgS !== null && (r.still || !steady.length) ? r.rfdKgS : null)),
    unsteadyAttempts: measured.length - steady.length,
  };
}

// Averages consecutive blocks of `factor` samples (rounded to 10 g).
function averageBlocks(samples, factor) {
  const out = [];
  for (let i = 0; i < samples.length; i += factor) {
    const block = samples.slice(i, i + factor);
    out.push(Math.round((block.reduce((a, b) => a + b, 0) / block.length) * 100) / 100);
  }
  return out;
}

// Curve for storage: only the stretches where force is at least minKg (plus `pad`
// samples on each side to keep the rise and fall), each downsampled by the same
// factor so all segments together have at most maxPoints.
//   { hz, segments: [{ t: start time in s, kg: [...] }] }
export function compressCurve(samples, hz, { minKg = 1, maxPoints = 1000, pad = 2 } = {}) {
  const ranges = [];
  let start = -1;
  for (let i = 0; i <= samples.length; i++) {
    const loaded = i < samples.length && samples[i] >= minKg;
    if (loaded && start < 0) start = i;
    if (!loaded && start >= 0) {
      const from = Math.max(0, start - pad);
      const to = Math.min(samples.length, i + pad);
      const prev = ranges.at(-1);
      if (prev && from <= prev[1]) prev[1] = to; // overlapping padding: merge
      else ranges.push([from, to]);
      start = -1;
    }
  }
  const total = ranges.reduce((n, [a, b]) => n + (b - a), 0);
  const factor = Math.max(1, Math.ceil(total / maxPoints));
  return {
    hz: hz / factor,
    segments: ranges.map(([a, b]) => ({ t: Math.round((a / hz) * 1000) / 1000, kg: averageBlocks(samples.slice(a, b), factor) })),
  };
}

// Stored curve -> plot points. Gaps between segments are drawn as zero force.
// Also accepts the older single-array format { hz, kg }.
export function curvePoints(curve) {
  const segments = curve.segments ?? [{ t: 0, kg: curve.kg }];
  const dt = 1 / curve.hz;
  const x = [];
  const y = [];
  for (const seg of segments) {
    if (x.length && seg.t - x.at(-1) > 2 * dt) {
      x.push(x.at(-1) + dt, seg.t - dt);
      y.push(0, 0);
    }
    seg.kg.forEach((kg, i) => {
      x.push(Math.round((seg.t + i * dt) * 1000) / 1000);
      y.push(kg);
    });
  }
  return { x, y };
}

// ---------------------------------------------------------------- rep curves

// Each rep's own samples, for comparing reps (History). Downsampled to about targetHz
// by block averages (rounded to 10 g); lower if all reps together exceed maxPoints.
//   { hz, reps: [[kg...], ...] }  one array per rep, in the order of session.reps
export function compressRepCurves(attempts, hz, { targetHz = 40, maxPoints = 6000 } = {}) {
  const total = attempts.reduce((n, a) => n + a.length, 0);
  const factor = Math.max(1, Math.round(hz / targetHz), Math.ceil(total / maxPoints));
  return { hz: hz / factor, reps: attempts.map((a) => averageBlocks(a, factor)) };
}

// Index where a rep's force starts: the sample before it first reaches 30 % of the rep's
// peak (at least minKg). 0 when it never does.
export function repOnset(kg, minKg = 2) {
  const peak = Math.max(0, ...kg);
  const threshold = Math.max(minKg, 0.3 * peak);
  const i = kg.findIndex((v) => v >= threshold);
  return i > 0 ? i - 1 : 0;
}

// Rep curves on one time axis, each shifted so its force onset is at 0 s.
//   { x: [s...], ys: [[kg or null...] per rep] }
export function alignRepCurves(curves, hz) {
  const onsets = curves.map((kg) => repOnset(kg));
  const before = Math.max(0, ...onsets);
  const after = Math.max(0, ...curves.map((kg, i) => kg.length - onsets[i]));
  const n = before + after;
  const x = Array.from({ length: n }, (_, i) => Math.round(((i - before) / hz) * 1000) / 1000);
  const ys = curves.map((kg, r) => {
    const shift = before - onsets[r];
    return Array.from({ length: n }, (_, i) => (i - shift >= 0 && i - shift < kg.length ? kg[i - shift] : null));
  });
  return { x, ys };
}

// Average of aligned curves at each point, where at least half of them have a value.
export function meanCurve(ys) {
  if (!ys.length) return [];
  const need = Math.ceil(ys.length / 2);
  return ys[0].map((_, i) => {
    const values = ys.map((y) => y[i]).filter((v) => v !== null);
    return values.length >= need ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null;
  });
}

// One rep curve standing for a whole session, for comparing sessions: the average of
// its reps (aligned at onset), or its best rep (highest peak). -> { x, y } or null.
export function representativeCurve(repCurves, mode = "average") {
  if (!repCurves?.reps.length) return null;
  if (mode === "best") {
    const peaks = repCurves.reps.map((kg) => Math.max(0, ...kg));
    const best = repCurves.reps[peaks.indexOf(Math.max(...peaks))];
    const { x, ys } = alignRepCurves([best], repCurves.hz);
    return { x, y: ys[0] };
  }
  const { x, ys } = alignRepCurves(repCurves.reps, repCurves.hz);
  return { x, y: meanCurve(ys) };
}

// Linear interpolation of the curve (x ascending, y with nulls) at each grid time; null
// outside it or next to a gap.
export function resample(x, y, grid) {
  let j = 0;
  return grid.map((t) => {
    while (j < x.length - 2 && x[j + 1] < t) j++;
    if (!x.length || t < x[0] || t > x[x.length - 1]) return null;
    if (x.length === 1) return t === x[0] ? y[0] : null;
    const [x0, x1, y0, y1] = [x[j], x[j + 1], y[j], y[j + 1]];
    if (y0 === null || y1 === null) return t === x0 ? y0 : t === x1 ? y1 : null;
    return Math.round((y0 + ((y1 - y0) * (t - x0)) / (x1 - x0)) * 100) / 100;
  });
}
