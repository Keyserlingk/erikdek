// Workout timing and rep analysis. No DOM access, so it runs under node --test too.

export const PHASE = { PREP: "prep", WORK: "work", REST: "rest", SET_REST: "setRest" };

// A completed rep must be loaded for at least this share of the work time.
export const COMPLETE_SHARE = 0.9;
// Target band around the target load.
export const TARGET_TOLERANCE = 0.05;

// Expands a routine into the timed phases it consists of.
export function buildPhases(r) {
  const phases = [];
  if (r.prepS > 0) phases.push({ type: PHASE.PREP, durS: r.prepS, set: 1, rep: 1 });
  for (let set = 1; set <= r.sets; set++) {
    for (let rep = 1; rep <= r.reps; rep++) {
      phases.push({ type: PHASE.WORK, durS: r.workS, set, rep });
      if (rep < r.reps && r.restS > 0) phases.push({ type: PHASE.REST, durS: r.restS, set, rep: rep + 1 });
    }
    if (set < r.sets && r.setRestS > 0) phases.push({ type: PHASE.SET_REST, durS: r.setRestS, set: set + 1, rep: 1 });
  }
  return phases;
}

export function totalDurationS(r) {
  return buildPhases(r).reduce((sum, p) => sum + p.durS, 0);
}

// Target load in kg, or null when the routine has none (or %BW without a bodyweight).
export function targetKg(r, bodyweightKg) {
  if (!r.target || r.target.type === "none") return null;
  if (r.target.type === "kg") return r.target.value;
  if (r.target.type === "bw") return bodyweightKg > 0 ? (r.target.value / 100) * bodyweightKg : null;
  return null;
}

// Time-driven phase sequencer. All times are in seconds from a monotonic clock.
export class WorkoutEngine {
  constructor(phases) {
    this.phases = phases;
    this.starts = [];
    let t = 0;
    for (const p of phases) {
      this.starts.push(t);
      t += p.durS;
    }
    this.totalS = t;
    this.startedAt = null;
    this.pausedAt = null;
    this.offsetS = 0; // time skipped forward minus time spent paused
    this.lastIndex = -1;
  }

  start(now) {
    this.startedAt = now;
    this.lastIndex = -1;
  }

  get paused() {
    return this.pausedAt !== null;
  }

  pause(now) {
    if (!this.paused) this.pausedAt = now;
  }

  resume(now) {
    if (this.paused) {
      this.offsetS -= now - this.pausedAt;
      this.pausedAt = null;
    }
  }

  elapsed(now) {
    const t = this.paused ? this.pausedAt : now;
    return Math.min(this.totalS, Math.max(0, t - this.startedAt + this.offsetS));
  }

  indexAt(elapsedS) {
    if (elapsedS >= this.totalS) return this.phases.length;
    let i = 0;
    while (i + 1 < this.phases.length && this.starts[i + 1] <= elapsedS) i++;
    return i;
  }

  // Jumps to the start of the next phase.
  skip(now) {
    const i = this.indexAt(this.elapsed(now));
    if (i >= this.phases.length) return;
    const nextStart = i + 1 < this.phases.length ? this.starts[i + 1] : this.totalS;
    this.offsetS += nextStart - this.elapsed(now);
  }

  // Current position plus the phases entered since the previous update (none skipped).
  update(now) {
    const elapsedS = this.elapsed(now);
    const index = this.indexAt(elapsedS);
    const entered = [];
    for (let i = this.lastIndex + 1; i <= index; i++) entered.push(i);
    this.lastIndex = index;
    const done = index >= this.phases.length;
    const phase = done ? null : this.phases[index];
    const remainingS = done ? 0 : this.starts[index] + phase.durS - elapsedS;
    return { index, phase, remainingS, elapsedS, done, entered };
  }
}

// Statistics for one work phase. dtS is the time per sample.
export function repStats(samples, dtS, thresholdKg, workS) {
  let peak = 0;
  let sum = 0;
  let loaded = 0;
  for (const kg of samples) {
    if (kg > peak) peak = kg;
    sum += kg;
    if (kg >= thresholdKg) loaded++;
  }
  const tutS = loaded * dtS;
  return {
    peakKg: peak,
    meanKg: samples.length ? sum / samples.length : 0,
    tutS,
    completed: samples.length > 0 && tutS >= COMPLETE_SHARE * workS,
  };
}

// Load needed for a rep to count as "loaded": 80 % of the target, or the
// threshold from the settings when there is no target.
export function loadThresholdKg(target, repThresholdKg) {
  return target !== null ? 0.8 * target : repThresholdKg;
}

export function targetStatus(kg, target) {
  if (target === null) return null;
  if (kg < target * (1 - TARGET_TOLERANCE)) return "below";
  if (kg > target * (1 + TARGET_TOLERANCE)) return "above";
  return "on";
}
