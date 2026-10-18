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
  const routine = { sets: 1, reps: 4, workS: 7 }; // stopped after 2 of 4 reps
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
    routine: { workS: 7 },
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
  const summary = KINDS.workout.analyze({ reps, routine: { sets: 1, reps: 2, workS: 7, hands: "alternate" }, target: null });
  assert.equal(summary.totalReps, 4);
  assert.equal(summary.holdPct, (100 + 80 + 90) / 4);
  // per hand: 2 planned hangs each
  assert.equal(summary.byHand.left.avgKg, 19);
  assert.equal(summary.byHand.left.holdPct, 95);
  assert.equal(summary.byHand.right.holdPct, 40); // 1 of 2 right hangs done, at 80 %
  assert.equal(summary.byHand.right.peakKg, 17);
  const s = { targetKg: null, routine: { workS: 7 }, reps, summary };
  const labels = KINDS.workout.tiles(s).map((t) => t[1]);
  assert.ok(labels.includes("left hand avg · hold 95 %") && labels.includes("right hand avg · hold 40 %"));
  assert.deepEqual(KINDS.workout.table(s).rows.map((r) => r[0]), ["1.1 L", "1.2 R", "1.3 L"]);
  // one hand only: no per-hand summary
  assert.equal(KINDS.workout.analyze({ reps: [reps[0]], routine: { sets: 1, reps: 1, workS: 7, hands: "left" }, target: null }).byHand, null);

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
