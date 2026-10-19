import assert from "node:assert/strict";
import { test } from "node:test";

import { describe, routineDuration, routineFileName, workoutDuration } from "../../data/routinetext.js";

const none = { type: "none", value: 0 };
const hang = { id: "h", sets: 3, reps: 6, workS: 7, restS: 3, setRestS: 180, prepS: 5, target: { type: "bw", value: 120 }, holdType: "20 mm edge", grip: "", hands: "both" };
const ladder = { id: "l", type: "selfpaced", sets: 2, reps: 1, workS: 0, restS: 0, setRestS: 120, prepS: 10, target: none, hands: "both", addedWeightKg: null };

test("describe lists type, tags and timing", () => {
  assert.equal(describe(hang), "20 mm edge · 3 × 6 · 7 s on · 3 s off · 3 min between sets · target 120 % BW");
  assert.equal(describe(ladder), "Self-paced · 2 × 1 · 2 min between sets");
  const pullups = { ...ladder, type: "timed", workS: 20, addedWeightKg: -5, hands: "alternate", reps: 2, restS: 10 };
  assert.equal(describe(pullups), "Timed · Alternating hands · 2 × 2 per hand · 20 s on · 10 s hand change · 2 min between sets · −5.0 kg");
});

test("durations mark open-ended (self-paced) routines", () => {
  assert.doesNotMatch(routineDuration(hang), /reps/);
  assert.match(routineDuration(ladder), / \+ reps$/);
  assert.match(workoutDuration({ routineIds: ["h", "l"] }, [hang, ladder]), / \+ reps$/);
  assert.doesNotMatch(workoutDuration({ routineIds: ["h", "gone"] }, [hang, ladder]), /reps/);
});

test("routineFileName makes a safe slug", () => {
  assert.equal(routineFileName("Max Hangs 10 s!"), "erkdek-routine-max-hangs-10-s.json");
  assert.equal(routineFileName("***"), "erkdek-routine-routine.json");
});
