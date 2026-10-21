import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PHASE,
  hangsPerRep,
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
  assert.deepEqual(phases[7], { type: PHASE.WORK, durS: 7, set: 2, rep: 1, hand: "both" });
  // rest phases announce the rep that follows
  assert.equal(phases[2].rep, 2);
});

test("alternating hands: each rep is left then right, separated by hand changes", () => {
  const r = { sets: 2, reps: 2, workS: 7, restS: 3, setRestS: 60, prepS: 5, hands: "alternate" };
  assert.equal(hangsPerRep(r), 2);
  const phases = buildPhases(r);
  const work = phases.filter((p) => p.type === "work");
  assert.equal(work.length, 8); // 2 sets × 2 reps × 2 hands
  assert.deepEqual(
    work.slice(0, 4).map((p) => `${p.set}.${p.rep}${p.hand[0]}`),
    ["1.1l", "1.1r", "1.2l", "1.2r"],
  );
  // get-ready and the gaps between hangs announce the next hang
  assert.equal(phases[0].hand, "left");
  assert.deepEqual(
    phases.slice(1, 4).map((p) => [p.type, p.hand]),
    [["work", "left"], ["rest", "right"], ["work", "right"]],
  );
  assert.equal(totalDurationS(r), 5 + 8 * 7 + 6 * 3 + 60);
  assert.equal(hangsPerRep({ ...r, hands: "left" }), 1);
  assert.ok(buildPhases({ ...r, hands: "left" }).filter((p) => p.type === "work").every((p) => p.hand === "left"));
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

test("waitForLoad: a hang's countdown starts when force is applied", () => {
  const engine = new WorkoutEngine(buildPhases(repeaters), { waitForLoad: true });
  engine.start(0);
  let s = engine.update(6); // prep (5 s) is over: waiting at the start of the hang
  assert.equal(s.phase.type, "work");
  assert.equal(s.waitingForLoad, true);
  assert.equal(s.remainingS, 7);
  s = engine.update(30); // still waiting, however long
  assert.equal(s.remainingS, 7);
  assert.deepEqual(s.entered, []);

  engine.loadApplied(30);
  s = engine.update(32);
  assert.equal(s.waitingForLoad, false);
  assert.equal(s.remainingS, 5);
  s = engine.update(37.5); // hang over (30 + 7), rest (3 s) runs on the clock
  assert.equal(s.phase.type, "rest");
  assert.equal(s.remainingS, 2.5);
  s = engine.update(41); // next hang waits again
  assert.equal(s.phase.type, "work");
  assert.equal(s.waitingForLoad, true);
  assert.equal(s.remainingS, 7);
});

test("waitForLoad with pause and skip", () => {
  const engine = new WorkoutEngine(buildPhases(repeaters), { waitForLoad: true });
  engine.start(0);
  engine.update(6);
  engine.pause(8);
  engine.loadApplied(9); // force while paused: the hang starts on resume
  assert.equal(engine.update(12).remainingS, 7);
  engine.resume(12);
  assert.equal(engine.update(14).remainingS, 5);

  const other = new WorkoutEngine(buildPhases(repeaters), { waitForLoad: true });
  other.start(0);
  other.update(6);
  other.skip(10); // skips the waiting hang whole
  const s = other.update(10);
  assert.equal(s.phase.type, "rest");
  assert.equal(s.remainingS, 3);
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

test("repStats hold % and work vs target", () => {
  const dt = 1 / 80;
  // 4 s of a 5 s hang loaded: 2 s at the 20 kg target, 2 s at 25 kg (counts as 20), 1 s off
  const samples = [...Array(160).fill(20), ...Array(160).fill(25), ...Array(80).fill(0)];
  const s = repStats(samples, dt, 16, 5, 20);
  assert.ok(Math.abs(s.holdPct - 80) < 1e-9);
  assert.ok(Math.abs(s.workPct - 80) < 1e-9);
  // 5 s at 10 kg against a 20 kg target: fully held above a 5 kg threshold, half the work
  const light = repStats(Array(400).fill(10), dt, 5, 5, 20);
  assert.equal(light.holdPct, 100);
  assert.ok(Math.abs(light.workPct - 50) < 1e-9);
  assert.equal(repStats(samples, dt, 16, 5).workPct, null);
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

test("open-ended phases wait for finishRep, then the rest counts down", () => {
  const r = { sets: 1, reps: 2, workS: 0, restS: 10, setRestS: 0, prepS: 5, type: "selfpaced" };
  const engine = new WorkoutEngine(buildPhases(r));
  engine.start(0);
  assert.deepEqual(engine.update(0).entered, [0]);

  let s = engine.update(40); // prep over long ago; the first rep waits
  assert.deepEqual(s.entered, [1]);
  assert.equal(s.phase.type, "work");
  assert.equal(s.remainingS, null);
  assert.equal(s.inPhaseS, 35); // stopwatch since the rep began at 5 s
  assert.equal(engine.waitingForDone, true);

  engine.finishRep(40);
  s = engine.update(43);
  assert.deepEqual(s.entered, [2]);
  assert.equal(s.phase.type, "rest");
  assert.equal(s.remainingS, 7); // rest started when Done was tapped

  s = engine.update(55); // rest ended at 50 → second rep, waiting 5 s
  assert.equal(s.phase.type, "work");
  assert.equal(s.inPhaseS, 5);
  engine.finishRep(60);
  s = engine.update(60);
  assert.equal(s.done, true);
  assert.deepEqual(s.entered, [4]);
});

test("pausing freezes the stopwatch of an open-ended rep; finishRep is ignored in timed phases", () => {
  const r = { sets: 1, reps: 1, workS: 0, restS: 0, setRestS: 0, prepS: 5, type: "selfpaced" };
  const engine = new WorkoutEngine(buildPhases(r));
  engine.start(0);
  engine.finishRep(2); // still in the timed get-ready phase: no effect
  assert.equal(engine.update(2).phase.type, "prep");
  engine.update(8);
  engine.pause(10);
  assert.equal(engine.update(100).inPhaseS, 5);
  engine.resume(100);
  assert.equal(engine.update(101).inPhaseS, 6);
});

test("each hand in turn: all sets left, a rest between hands, then all right", () => {
  const r = { sets: 2, reps: 1, workS: 5, restS: 10, setRestS: 90, prepS: 5, hands: "each", handRestS: 600 };
  const phases = buildPhases(r);
  assert.deepEqual(
    phases.map((p) => [p.type, p.durS, p.hand]),
    [
      ["prep", 5, "left"],
      ["work", 5, "left"],
      ["setRest", 90, "left"],
      ["work", 5, "left"],
      ["setRest", 600, "right"],
      ["work", 5, "right"],
      ["setRest", 90, "right"],
      ["work", 5, "right"],
    ],
  );
  assert.equal(phases[4].handChange, true);
  // Without handRestS (training routines) the rest between sets is used.
  assert.equal(buildPhases({ ...r, handRestS: undefined })[4].durS, 90);
});
