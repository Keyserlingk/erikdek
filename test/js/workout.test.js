import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PHASE,
  WorkoutEngine,
  buildPhases,
  loadThresholdKg,
  repStats,
  targetKg,
  targetStatus,
  totalDurationS,
} from "../../data/workout.js";

const repeaters = { sets: 2, reps: 3, workS: 7, restS: 3, setRestS: 60, prepS: 5 };

test("buildPhases expands sets, reps and rests", () => {
  const phases = buildPhases(repeaters);
  assert.deepEqual(
    phases.map((p) => p.type),
    ["prep", "work", "rest", "work", "rest", "work", "setRest", "work", "rest", "work", "rest", "work"],
  );
  assert.deepEqual(phases[7], { type: PHASE.WORK, durS: 7, set: 2, rep: 1 });
  // rest phases announce the rep that follows
  assert.equal(phases[2].rep, 2);
});

test("buildPhases skips zero-length rests and prep", () => {
  const phases = buildPhases({ sets: 2, reps: 2, workS: 10, restS: 0, setRestS: 0, prepS: 0 });
  assert.deepEqual(
    phases.map((p) => p.type),
    ["work", "work", "work", "work"],
  );
});

test("totalDurationS sums all phases", () => {
  assert.equal(totalDurationS(repeaters), 5 + 6 * 7 + 4 * 3 + 60);
});

test("targetKg handles kg, % bodyweight and none", () => {
  assert.equal(targetKg({ target: { type: "none" } }, 70), null);
  assert.equal(targetKg({ target: { type: "kg", value: 25 } }, 70), 25);
  assert.equal(targetKg({ target: { type: "bw", value: 50 } }, 70), 35);
  assert.equal(targetKg({ target: { type: "bw", value: 50 } }, 0), null);
  assert.equal(targetKg({}, 70), null);
});

test("engine walks through phases and reports every entered phase", () => {
  const engine = new WorkoutEngine(buildPhases(repeaters));
  engine.start(100);
  let s = engine.update(100);
  assert.equal(s.phase.type, "prep");
  assert.deepEqual(s.entered, [0]);
  assert.equal(s.remainingS, 5);

  s = engine.update(105.5); // 0.5 s into the first work phase
  assert.equal(s.phase.type, "work");
  assert.deepEqual(s.entered, [1]);
  assert.equal(s.remainingS, 6.5);

  s = engine.update(116); // jumped over work 1 end, rest, into work 2
  assert.deepEqual(s.entered, [2, 3]);
  assert.equal(s.phase.type, "work");
  assert.equal(s.phase.rep, 2);

  s = engine.update(1000);
  assert.equal(s.done, true);
  assert.equal(s.phase, null);
  assert.equal(s.entered.at(-1), engine.phases.length);
});

test("engine pause stops the clock", () => {
  const engine = new WorkoutEngine(buildPhases(repeaters));
  engine.start(0);
  engine.pause(2);
  assert.equal(engine.update(50).elapsedS, 2);
  engine.resume(50);
  assert.equal(engine.update(51).elapsedS, 3);
});

test("engine skip jumps to the next phase", () => {
  const engine = new WorkoutEngine(buildPhases(repeaters));
  engine.start(0);
  engine.update(1);
  engine.skip(1);
  const s = engine.update(1);
  assert.equal(s.phase.type, "work");
  assert.equal(s.remainingS, 7);
  assert.deepEqual(s.entered, [1]);
});

test("engine skip while paused stays paused at the new phase", () => {
  const engine = new WorkoutEngine(buildPhases(repeaters));
  engine.start(0);
  engine.pause(1);
  engine.skip(3);
  assert.equal(engine.update(10).elapsedS, 5);
});

test("repStats computes peak, mean, time under tension and completion", () => {
  const dt = 1 / 80;
  // 7 s rep: 0.5 s ramp below threshold, then 6.5 s at 20 kg
  const samples = [...Array(40).fill(1), ...Array(520).fill(20)];
  samples[100] = 24;
  const s = repStats(samples, dt, 10, 7);
  assert.equal(s.peakKg, 24);
  assert.ok(Math.abs(s.tutS - 6.5) < 1e-9);
  assert.equal(s.completed, true);
  assert.ok(Math.abs(s.meanKg - (40 * 1 + 519 * 20 + 24) / 560) < 1e-9);
});

test("repStats marks a rep let go early as not completed", () => {
  const samples = [...Array(400).fill(20), ...Array(160).fill(0)]; // 5 of 7 s
  assert.equal(repStats(samples, 1 / 80, 10, 7).completed, false);
  assert.equal(repStats([], 1 / 80, 10, 7).completed, false);
});

test("loadThresholdKg and targetStatus", () => {
  assert.equal(loadThresholdKg(25, 2), 20);
  assert.equal(loadThresholdKg(null, 2), 2);
  assert.equal(targetStatus(20, null), null);
  assert.equal(targetStatus(23, 25), "below");
  assert.equal(targetStatus(25.5, 25), "on");
  assert.equal(targetStatus(27, 25), "above");
});
