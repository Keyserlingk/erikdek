// Force-curve analysis for the tests. No DOM access, so it runs under node --test too.

// Number of final reps averaged for critical force (Giles et al. 24 × 7:3 protocol).
export const CF_LAST_REPS = 6;
// Window for rate of force development measured from pull onset.
export const RFD_WINDOW_S = 0.2;
// Pull onset: first sample above this share of the attempt's peak (at least 1 kg).
const ONSET_SHARE = 0.05;
const ONSET_MIN_KG = 1;

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

// Max pull: best peak and best 1 s average over all attempts.
export function maxPullSummary(attempts, dtS) {
  const peaks = attempts.map((a) => a.reduce((m, kg) => Math.max(m, kg), 0));
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

// Rate of force development of one explosive pull.
//   rfdKgS:      average slope over the first 200 ms after onset
//   peakRfdKgS:  steepest slope over a 50 ms window
//   timeToPeakS: onset to peak force
export function rfdOfPull(samples, dtS) {
  let peak = 0;
  let peakIdx = -1;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] > peak) {
      peak = samples[i];
      peakIdx = i;
    }
  }
  const threshold = Math.max(ONSET_MIN_KG, ONSET_SHARE * peak);
  if (peak < threshold * 2) return null; // no real pull
  let onset = samples.findIndex((kg) => kg >= threshold);
  if (onset > 0) onset--; // last sample before the rise
  const end = onset + Math.round(RFD_WINDOW_S / dtS);
  if (end >= samples.length) return null;

  const half = Math.max(1, Math.round(0.025 / dtS)); // ±25 ms
  let peakRfd = 0;
  for (let i = onset + half; i + half < samples.length && i <= peakIdx; i++) {
    const slope = (samples[i + half] - samples[i - half]) / (2 * half * dtS);
    if (slope > peakRfd) peakRfd = slope;
  }
  return {
    rfdKgS: (samples[end] - samples[onset]) / RFD_WINDOW_S,
    peakRfdKgS: peakRfd,
    timeToPeakS: (peakIdx - onset) * dtS,
    peakKg: peak,
  };
}

// Best attempt (by 200 ms RFD) plus all attempts.
export function rfdSummary(attempts, dtS) {
  const results = attempts.map((a) => rfdOfPull(a, dtS));
  const valid = results.filter(Boolean);
  if (!valid.length) return null;
  const best = valid.reduce((a, b) => (b.rfdKgS > a.rfdKgS ? b : a));
  return { ...best, attemptRfdKgS: results.map((r) => (r ? r.rfdKgS : null)) };
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
