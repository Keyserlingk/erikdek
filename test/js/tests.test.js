import assert from "node:assert/strict";
import { test } from "node:test";

import { KINDS, metricPoints } from "../../data/tests.js";

const metric = (kind, key) => KINDS[kind].metrics.find((m) => m.key === key);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("workout metrics: hold % (default) and the others", () => {
  assert.equal(KINDS.workout.metrics[0].key, "holdPct");
  const s = { targetKg: 22, summary: { holdPct: 91, retentionPct: 80, workPct: 85, tutS: 150, avgKg: 21.2, peakKg: 25 } };
  assert.equal(metric("workout", "holdPct").value(s), 91);
  assert.equal(metric("workout", "retentionPct").value(s), 80);
  assert.equal(metric("workout", "workPct").value(s), 85);
  assert.equal(metric("workout", "targetKg").value(s), 22);
  assert.equal(metric("workout", "workPct").value({ summary: { workPct: null } }), null);
  assert.equal(metric("workout", "holdPct").format(75.4), "75 %");
});

test("workout analyze averages hold and work over all planned reps", () => {
  const reps = [
    { set: 1, rep: 1, meanKg: 20, peakKg: 22, tutS: 7, holdPct: 100, workPct: 100, completed: true },
    { set: 1, rep: 2, meanKg: 18, peakKg: 21, tutS: 5, holdPct: 70, workPct: 60, completed: false },
  ];
  const routine = { type: "hangboard", sets: 1, reps: 4, workS: 7 }; // stopped after 2 of 4 reps
  const s = KINDS.workout.analyze({ reps, routine, target: 20 });
  assert.equal(s.holdPct, 42.5);
  assert.equal(s.workPct, 40);
  close(s.retentionPct, 90);
  assert.equal(s.completed, 1);
  assert.equal(KINDS.workout.analyze({ reps, routine, target: null }).workPct, null);
});

test("workout table and per-rep percentages", () => {
  const s = {
    targetKg: null,
    routine: { type: "hangboard", workS: 7 },
    reps: [
      { set: 1, rep: 1, meanKg: 20, tutS: 7, holdPct: 100, workPct: null, completed: true },
      { set: 2, rep: 1, meanKg: 15, tutS: 3, holdPct: 40, workPct: null, completed: false },
    ],
  };
  const t = KINDS.workout.table(s);
  assert.deepEqual(t.head, ["Rep", "Avg", "Hold", "vs 1st"]);
  assert.deepEqual(t.rows[1], ["2.1", "15.0", "40 %", "75 %"]);
  assert.equal(t.rows[0][2], "100 %");
  const [hold, force] = KINDS.workout.strips(s);
  assert.deepEqual(hold.values.map((v) => [v.set, v.pct]), [[1, 100], [2, 40]]);
  assert.deepEqual(force.values.map((v) => v.pct), [100, 75]);
  assert.ok(hold.info && force.info);
  assert.ok(KINDS.workout.tiles({ ...s, summary: { completed: 1, totalReps: 2, holdPct: 70, tutS: 10 } }).every((t) => t[2]));
});

test("alternating sessions get per-hand values and L/R rep labels", () => {
  const reps = [
    { set: 1, rep: 1, hand: "left", meanKg: 20, peakKg: 21, tutS: 7, holdPct: 100, completed: true },
    { set: 1, rep: 2, hand: "right", meanKg: 16, peakKg: 17, tutS: 5.6, holdPct: 80, completed: false },
    { set: 1, rep: 3, hand: "left", meanKg: 18, peakKg: 19, tutS: 7, holdPct: 90, completed: true },
  ];
  // 3 of 4 planned hangs done (2 reps per hand)
  const summary = KINDS.workout.analyze({ reps, routine: { type: "hangboard", sets: 1, reps: 2, workS: 7, hands: "alternate" }, target: null });
  assert.equal(summary.totalReps, 4);
  assert.equal(summary.holdPct, (100 + 80 + 90) / 4);
  // per hand: 2 planned hangs each
  assert.equal(summary.byHand.left.avgKg, 19);
  assert.equal(summary.byHand.left.holdPct, 95);
  assert.equal(summary.byHand.right.holdPct, 40); // 1 of 2 right hangs done, at 80 %
  assert.equal(summary.byHand.right.peakKg, 17);
  const s = { targetKg: null, routine: { type: "hangboard", workS: 7 }, reps, summary };
  const labels = KINDS.workout.tiles(s).map((t) => t[1]);
  assert.ok(labels.includes("left hand avg · hold 95 %") && labels.includes("right hand avg · hold 40 %"));
  assert.deepEqual(KINDS.workout.table(s).rows.map((r) => r[0]), ["1.1 L", "1.2 R", "1.3 L"]);
  // one hand only: no per-hand summary
  assert.equal(KINDS.workout.analyze({ reps: [reps[0]], routine: { type: "hangboard", sets: 1, reps: 1, workS: 7, hands: "left" }, target: null }).byHand, null);

  // History points: one per hand for alternating sessions, the session's hand otherwise
  const session = { hand: "alternate", targetKg: 20, summary };
  assert.deepEqual(metricPoints(metric("workout", "avgKg"), session), [{ hand: "left", value: 19 }, { hand: "right", value: 16 }]);
  assert.deepEqual(metricPoints(metric("workout", "targetKg"), session).map((p) => p.value), [20, 20]);
  assert.deepEqual(metricPoints(metric("workout", "avgKg"), { hand: "left", summary: { avgKg: 21 } }), [{ hand: "left", value: 21 }]);
  assert.deepEqual(metricPoints(KINDS.maxPull.metrics[0], { summary: { peakKg: 40 } }), [{ hand: "both", value: 40 }]);
});

test("each test has its summary metric and treats missing values as null", () => {
  assert.equal(KINDS.maxPull.metrics[0].value({ summary: { peakKg: 40 } }), 40);
  assert.equal(KINDS.criticalForce.metrics[0].value({ summary: { cfKg: null } }), null);
  assert.equal(KINDS.rfd.metrics[0].value({}), null);
});

test("every History metric has an explanation", () => {
  for (const [kind, def] of Object.entries(KINDS)) {
    for (const m of def.metrics) assert.ok(m.info && m.info.length > 20, `${kind}.${m.key} has no info`);
  }
});

test("non-sensor routines: reps, time, effort, added weight and volume per set", async () => {
  const { summarizeTraining } = await import("../../data/tests.js");
  const routine = { type: "selfpaced", sets: 3, reps: 2, hands: "both", addedWeightKg: 10 };
  const reps = [
    { set: 1, rep: 1, durationS: 12 },
    { set: 1, rep: 2, durationS: 14 },
    { set: 2, rep: 1, durationS: 15 },
  ];
  const sets = [
    { set: 1, rpe: 6, addedWeightKg: 10 },
    { set: 2, rpe: 8, addedWeightKg: 12.5 },
  ];
  assert.deepEqual(summarizeTraining(reps, sets, routine), {
    repsDone: 3,
    totalReps: 6,
    setsDone: 2,
    workTimeS: 41,
    avgRpe: 7,
    maxRpe: 8,
    maxAddedWeightKg: 12.5,
    volumeKg: 10 * 2 + 12.5 * 1,
  });
  // nothing logged
  const bare = summarizeTraining(reps, [], { ...routine, addedWeightKg: null });
  assert.equal(bare.avgRpe, null);
  assert.equal(bare.volumeKg, null);
  // analyze() picks this for non-sensor routines
  assert.equal(KINDS.workout.analyze({ reps, sets, routine }).volumeKg, 32.5);
});

test("sensor routine without force data shows reps and time, no effort or force metrics", () => {
  const routine = { type: "hangboard", sets: 2, reps: 1, workS: 7, addedWeightKg: null, hands: "both" };
  const s = {
    type: "workout",
    noForce: true,
    routine,
    reps: [{ set: 1, rep: 1, hand: "both", durationS: 7 }, { set: 2, rep: 1, hand: "both", durationS: 7 }],
    summary: { repsDone: 2, totalReps: 2, workTimeS: 14, avgRpe: null, maxRpe: null, maxAddedWeightKg: null, volumeKg: null },
  };
  assert.deepEqual(KINDS.workout.tiles(s).map((t) => t[1]), ["reps done", "work time"]);
  assert.deepEqual(KINDS.workout.table(s), { head: ["Set", "Reps", "Time"], rows: [["1", "1", "7 s"], ["2", "1", "7 s"]] });
  assert.deepEqual(KINDS.workout.strips(s), []);
  assert.deepEqual(metricPoints(metric("workout", "holdPct"), s), [{ hand: "both", value: null }]);
});

test("tests done with both hands get results per hand", () => {
  const pull = (kg) => Array.from({ length: 80 }, () => kg);
  const reps = [{ hand: "left" }, { hand: "right" }, { hand: "left" }, { hand: "right" }];
  const max = KINDS.maxPull.analyze({ attempts: [pull(40), pull(35), pull(42), pull(36)], dtS: 1 / 80, reps });
  assert.equal(max.peakKg, 42);
  assert.equal(max.byHand.left.peakKg, 42);
  assert.equal(max.byHand.right.peakKg, 36);
  assert.deepEqual(metricPoints(metric("maxPull", "peakKg"), { summary: max }), [
    { hand: "left", value: 42 },
    { hand: "right", value: 36 },
  ]);
  assert.equal(KINDS.maxPull.analyze({ attempts: [pull(40)], dtS: 1 / 80, reps: [{ hand: "left" }] }).byHand, null);

  // Critical force, each hand in turn: 24 reps left, then 24 right.
  const cfReps = [
    ...Array.from({ length: 24 }, () => ({ hand: "left", meanKg: 20, peakKg: 30 })),
    ...Array.from({ length: 24 }, () => ({ hand: "right", meanKg: 18, peakKg: 28 })),
  ];
  const cf = KINDS.criticalForce.analyze({ reps: cfReps, routine: { workS: 7 } });
  assert.equal(cf.byHand.left.cfKg, 20);
  assert.equal(cf.byHand.right.cfKg, 18);
  assert.equal(KINDS.maxPull.tiles({ summary: max, bodyweightKg: 0 })[0][1], "peak force · left");
});
