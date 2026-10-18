import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_WORKOUT_ITEMS, moveItem, resolveRoutines, validateWorkout, workoutDurationS } from "../../data/workouts.js";

const a = { id: "a", sets: 1, reps: 1, workS: 10, restS: 0, setRestS: 0, prepS: 5 }; // 15 s
const b = { id: "b", sets: 1, reps: 2, workS: 5, restS: 5, setRestS: 0, prepS: 5 }; // 20 s

test("validateWorkout", () => {
  assert.equal(validateWorkout({ name: "Session", routineIds: ["a"] }), null);
  assert.match(validateWorkout({ name: " ", routineIds: ["a"] }), /name/);
  assert.match(validateWorkout({ name: "x", routineIds: [] }), /at least one/);
  assert.match(validateWorkout({ name: "x", routineIds: Array(MAX_WORKOUT_ITEMS + 1).fill("a") }), /at most/);
});

test("resolveRoutines keeps order and repeats, marks deleted routines as null", () => {
  const w = { routineIds: ["b", "a", "gone", "b"] };
  assert.deepEqual(resolveRoutines(w, [a, b]), [b, a, null, b]);
  assert.equal(workoutDurationS(w, [a, b]), 20 + 15 + 20);
});

test("moveItem swaps neighbours and ignores moves past the ends", () => {
  assert.deepEqual(moveItem(["x", "y", "z"], 0, 1), ["y", "x", "z"]);
  assert.deepEqual(moveItem(["x", "y", "z"], 2, -1), ["x", "z", "y"]);
  assert.deepEqual(moveItem(["x", "y"], 0, -1), ["x", "y"]);
});
