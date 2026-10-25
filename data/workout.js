// Workout timing and rep analysis. No DOM access, so it runs under node --test too.

export const PHASE = { PREP: "prep", WORK: "work", REST: "rest", SET_REST: "setRest" };

// A completed rep must be loaded for at least this share of the work time.
export const COMPLETE_SHARE = 0.9;
// Target band around the target load.
export const TARGET_TOLERANCE = 0.05;

// "alternate": every rep one hand, then the other. "each": all sets with one hand, then
// all with the other (a rest of handRestS, else setRestS, in between). Both start with
// startHand ("right" unless set to "left").
export const HAND_OPTIONS = ["both", "left", "right", "alternate", "each"];

// Hangs in one set: with alternating hands each rep is a left and a right hang.
export function hangsPerRep(r) {
  return r.hands === "alternate" ? 2 : 1;
}

// All hangs of the routine (both hands count with "alternate" and "each").
export function totalHangs(r) {
  return r.sets * r.reps * (r.hands === "alternate" || r.hands === "each" ? 2 : 1);
}

// True when the routine is done with both hands, one at a time.
export function isTwoHanded(r) {
  return r.hands === "alternate" || r.hands === "each";
}

// Expands a routine into the timed phases it consists of. Rests and get-ready carry
// the set/rep/hand of the hang that follows. With alternating hands every rep is
// left then right, and the rest between hangs is the time to change hand.
// Self-paced routines have work phases without a duration (durS null): the climber
// ends each one.
export function buildPhases(r) {
  const [first, second] = r.startHand === "left" ? ["left", "right"] : ["right", "left"];
  if (r.hands === "each") {
    const restS = r.handRestS ?? r.setRestS;
    const then = buildPhases({ ...r, hands: second, prepS: 0 });
    // The rest between the hands carries the other hand's first hang, like other rests.
    const change = restS > 0 ? [{ ...then[0], type: PHASE.SET_REST, durS: restS, handChange: true }] : [];
    return [...buildPhases({ ...r, hands: first }), ...change, ...then];
  }
  const hands = r.hands === "alternate" ? [first, second] : [r.hands === "left" || r.hands === "right" ? r.hands : "both"];
  const hangs = []; // per set: { rep, hand }
  for (let rep = 1; rep <= r.reps; rep++) for (const hand of hands) hangs.push({ rep, hand });

  const phases = [];
  if (r.prepS > 0) phases.push({ type: PHASE.PREP, durS: r.prepS, set: 1, ...hangs[0] });
  for (let set = 1; set <= r.sets; set++) {
    hangs.forEach((hang, i) => {
      phases.push({ type: PHASE.WORK, durS: r.type === "selfpaced" ? null : r.workS, set, ...hang });
      const next = hangs[i + 1];
      if (next && r.restS > 0) phases.push({ type: PHASE.REST, durS: r.restS, set, ...next });
    });
    if (set < r.sets && r.setRestS > 0) phases.push({ type: PHASE.SET_REST, durS: r.setRestS, set: set + 1, ...hangs[0] });
  }
  return phases;
}

// Planned time; self-paced work phases count as 0 (see isOpenEnded).
export function totalDurationS(r) {
  return buildPhases(r).reduce((sum, p) => sum + (p.durS ?? 0), 0);
}

// True when the routine's length depends on the climber (self-paced reps).
export function isOpenEnded(r) {
  return r.type === "selfpaced";
}

// Target load in kg, or null when the routine has none (or %BW without a bodyweight).
export function targetKg(r, bodyweightKg) {
  if (!r.target || r.target.type === "none") return null;
  if (r.target.type === "kg") return r.target.value;
  if (r.target.type === "bw") return bodyweightKg > 0 ? (r.target.value / 100) * bodyweightKg : null;
  return null;
}

// Phase sequencer driven by a monotonic clock (seconds). Phases with a duration end on
// their own, exactly on schedule; open-ended phases (durS null, self-paced reps) last
// until done() is called. Pausing stops the clock.
// Runs the phases on a clock. The clock stops while paused and, with waitForLoad, at
// the start of every work phase until loadApplied(): the sensor saw force, so the hang's
// countdown starts when the climber actually starts.
export class WorkoutEngine {
  constructor(phases, { waitForLoad = false } = {}) {
    this.phases = phases;
    this.waitForLoad = waitForLoad;
    // Planned length; open-ended phases count as 0.
    this.totalS = phases.reduce((sum, p) => sum + (p.durS ?? 0), 0);
    this.startedAt = null;
    this.offsetS = 0; // time skipped forward minus time the clock stood still
    this.frozenAt = null; // clock time the elapsed time stopped at (paused or waiting)
    this.isPaused = false;
    this.isWaiting = false;
    this.index = 0;
    this.phaseStartS = 0; // elapsed time when the current phase began
    this.entered = []; // phases entered since the last update()
  }

  start(now) {
    this.startedAt = now;
    this.index = 0;
    this.phaseStartS = 0;
    this.entered = [0];
    this.waitIfWork();
  }

  get paused() {
    return this.isPaused;
  }

  // True while a work phase waits for force (waitForLoad).
  get waitingForLoad() {
    return this.isWaiting;
  }

  get done() {
    return this.index >= this.phases.length;
  }

  // True while the current phase waits for done() (a self-paced rep).
  get waitingForDone() {
    return !this.done && this.phases[this.index].durS === null;
  }

  // Clock time at which the elapsed time was elapsedS.
  clockAt(elapsedS) {
    return this.startedAt + elapsedS - this.offsetS;
  }

  freeze(at) {
    if (this.frozenAt === null) this.frozenAt = at;
  }

  // Restarts the clock once nothing holds it any more.
  thaw(now) {
    if (this.isPaused || this.isWaiting || this.frozenAt === null) return;
    this.offsetS -= now - this.frozenAt;
    this.frozenAt = null;
  }

  pause(now) {
    if (this.isPaused) return;
    this.isPaused = true;
    this.freeze(now);
  }

  resume(now) {
    if (!this.isPaused) return;
    this.isPaused = false;
    this.thaw(now);
  }

  // The sensor saw force: the waiting work phase starts now.
  loadApplied(now) {
    if (!this.isWaiting) return;
    this.isWaiting = false;
    this.thaw(now);
  }

  elapsed(now) {
    const t = this.frozenAt ?? now;
    return Math.max(0, t - this.startedAt + this.offsetS);
  }

  // Stops the clock at the start of a work phase until loadApplied().
  waitIfWork() {
    if (!this.waitForLoad || this.done || this.phases[this.index].type !== PHASE.WORK) return;
    this.isWaiting = true;
    this.freeze(this.clockAt(this.phaseStartS));
  }

  advance(startS) {
    this.index++;
    this.phaseStartS = startS;
    this.entered.push(this.index);
    this.waitIfWork();
  }

  // Moves past timed phases that have ended by now.
  catchUp(now) {
    while (!this.done && !this.isWaiting) {
      const { durS } = this.phases[this.index];
      if (durS === null || this.elapsed(now) < this.phaseStartS + durS) break;
      this.advance(this.phaseStartS + durS);
    }
  }

  // Ends the current phase now: jumps to the end of a timed phase (a waiting hang is
  // skipped whole), or finishes an open-ended one.
  skip(now) {
    this.loadApplied(now);
    this.catchUp(now);
    if (this.done) return;
    const e = this.elapsed(now);
    const { durS } = this.phases[this.index];
    if (durS === null) this.advance(e);
    else this.offsetS += this.phaseStartS + durS - e;
  }

  // The climber finished a self-paced rep.
  finishRep(now) {
    if (this.waitingForDone) this.skip(now);
  }

  // Current position plus the phases entered since the previous update (none skipped).
  // remainingS is null in an open-ended phase; inPhaseS counts up in every phase.
  update(now) {
    this.catchUp(now);
    const elapsedS = this.elapsed(now);
    const entered = this.entered;
    this.entered = [];
    const done = this.done;
    const phase = done ? null : this.phases[this.index];
    const inPhaseS = done ? 0 : elapsedS - this.phaseStartS;
    const remainingS = done ? 0 : phase.durS === null ? null : phase.durS - inPhaseS;
    return { index: this.index, phase, remainingS, inPhaseS, elapsedS, done, entered, waitingForLoad: this.isWaiting };
  }
}

// Statistics for one work phase. dtS is the time per sample.
//   holdPct: share of the hang time spent loaded (above thresholdKg), max 100
//   workPct: force × time against target × hang time, counting force up to the
//            target only (null without a target)
export function repStats(samples, dtS, thresholdKg, workS, targetKg = null) {
  let peak = 0;
  let sum = 0;
  let loaded = 0;
  let work = 0;
  for (const kg of samples) {
    if (kg > peak) peak = kg;
    sum += kg;
    if (kg >= thresholdKg) loaded++;
    if (targetKg !== null) work += Math.min(Math.max(kg, 0), targetKg);
  }
  const tutS = loaded * dtS;
  return {
    peakKg: peak,
    meanKg: samples.length ? sum / samples.length : 0,
    tutS,
    holdPct: Math.min(100, (100 * tutS) / workS),
    workPct: targetKg ? Math.min(100, (100 * work * dtS) / (targetKg * workS)) : null,
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
