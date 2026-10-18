import assert from "node:assert/strict";
import { test } from "node:test";

import { KINDS } from "../../data/tests.js";

const metric = (kind, key) => KINDS[kind].metrics.find((m) => m.key === key);

test("workout metrics read reps held %, TUT, forces and target load", () => {
  const s = { targetKg: 22, summary: { completed: 18, totalReps: 24, tutS: 150, avgKg: 21.2, peakKg: 25 } };
  assert.equal(metric("workout", "heldPct").value(s), 75);
  assert.equal(metric("workout", "tutS").value(s), 150);
  assert.equal(metric("workout", "avgKg").value(s), 21.2);
  assert.equal(metric("workout", "targetKg").value(s), 22);
  assert.equal(metric("workout", "targetKg").value({ targetKg: null, summary: {} }), null);
  assert.equal(metric("workout", "heldPct").format(75), "75 %");
  assert.equal(KINDS.workout.metrics[0].key, "heldPct"); // default
});

test("each test has its summary metric and treats missing values as null", () => {
  assert.equal(KINDS.maxPull.metrics[0].value({ summary: { peakKg: 40 } }), 40);
  assert.equal(KINDS.criticalForce.metrics[0].value({ summary: { cfKg: null } }), null);
  assert.equal(KINDS.rfd.metrics[0].value({}), null);
});
