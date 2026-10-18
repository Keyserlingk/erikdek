import assert from "node:assert/strict";
import { test } from "node:test";

import { KINDS } from "../../data/tests.js";

const metric = (kind, key) => KINDS[kind].metrics.find((m) => m.key === key);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("workout metrics: hold % (default) with fallback for older sessions, and the others", () => {
  assert.equal(KINDS.workout.metrics[0].key, "holdPct");
  const s = { targetKg: 22, summary: { holdPct: 91, retentionPct: 80, workPct: 85, tutS: 150, avgKg: 21.2, peakKg: 25 } };
  assert.equal(metric("workout", "holdPct").value(s), 91);
  assert.equal(metric("workout", "retentionPct").value(s), 80);
  assert.equal(metric("workout", "workPct").value(s), 85);
  assert.equal(metric("workout", "targetKg").value(s), 22);
  assert.equal(metric("workout", "workPct").value({ summary: { workPct: null } }), null);
  // saved before hold % existed: 126 s loaded of 24 × 7 s planned
  close(metric("workout", "holdPct").value({ routine: { workS: 7 }, summary: { tutS: 126, totalReps: 24 } }), 75);
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

test("workout table and strips per rep", () => {
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
  assert.deepEqual(t.rows[1], ["2.1", "15.0", { text: "40 %", cls: "bad" }, "75 %"]);
  assert.deepEqual(t.rows[0][2], { text: "100 % ✓", cls: "ok" });
  const [hold, force] = KINDS.workout.strips(s);
  assert.deepEqual(hold.bars.map((b) => [b.set, b.pct, b.cls]), [[1, 100, "ok"], [2, 40, "bad"]]);
  assert.deepEqual(force.bars.map((b) => b.pct), [100, 75]);
});

test("each test has its summary metric and treats missing values as null", () => {
  assert.equal(KINDS.maxPull.metrics[0].value({ summary: { peakKg: 40 } }), 40);
  assert.equal(KINDS.criticalForce.metrics[0].value({ summary: { cfKg: null } }), null);
  assert.equal(KINDS.rfd.metrics[0].value({}), null);
});
