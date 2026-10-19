import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BUILTIN_ROUTINES,
  ROUTINE_FORMAT,
  buildRoutineFile,
  instructionFor,
  parseRoutineFile,
  usesSensor,
  validateRoutine,
} from "../../data/routines.js";
import { buildPhases, isOpenEnded, totalDurationS } from "../../data/workout.js";

const mine = { ...BUILTIN_ROUTINES[0], id: "r1", builtin: false, name: "My repeaters", holdType: "18 mm edge" };

test("buildRoutineFile keeps only routine fields", () => {
  const file = buildRoutineFile([mine]);
  assert.equal(file.format, ROUTINE_FORMAT);
  assert.deepEqual(Object.keys(file.routines[0]).sort(), ["addedWeightKg", "grip", "hands", "holdType", "instruction", "name", "prepS", "reps", "restS", "setInstructions", "setRestS", "sets", "target", "type", "workS"]);
  assert.equal(file.routines[0].id, undefined);
});

test("parseRoutineFile round trip gives new ids and renames taken names", () => {
  const text = JSON.stringify(buildRoutineFile([mine, { ...mine, name: "Other" }]));
  const { routines, skipped } = parseRoutineFile(text, ["my repeaters"]);
  assert.equal(skipped, 0);
  assert.deepEqual(routines.map((r) => r.name), ["My repeaters (imported)", "Other"]);
  assert.ok(routines[0].id && routines[0].id !== routines[1].id);
  assert.equal(routines[0].holdType, "18 mm edge");
  assert.equal(routines[0].sets, mine.sets);
});

test("parseRoutineFile skips invalid routines and rejects other files", () => {
  const text = JSON.stringify({ format: ROUTINE_FORMAT, version: 1, routines: [{ ...mine, sets: 0 }, { name: "x" }, mine] });
  const { routines, skipped } = parseRoutineFile(text);
  assert.equal(routines.length, 1);
  assert.equal(skipped, 2);
  assert.throws(() => parseRoutineFile("nope"), /not JSON/);
  assert.throws(() => parseRoutineFile('{"format":"erkdek-backup"}'), /not an Erkdek routine file/);
  assert.throws(() => parseRoutineFile(JSON.stringify({ format: ROUTINE_FORMAT, version: 9, routines: [] })), /newer version/);
});

const campus = {
  ...BUILTIN_ROUTINES[0],
  id: "c1",
  builtin: false,
  name: "Campus ladders",
  type: "selfpaced",
  instruction: "Ladders on medium rungs",
  setInstructions: ["1-3-5", "1-4-7", "1-5-9"],
  addedWeightKg: null,
  sets: 3,
  reps: 2,
  workS: 0,
  restS: 90,
  setRestS: 180,
  prepS: 5,
  target: { type: "none", value: 0 },
};

test("routine types: sensor use, self-paced work has no length, instructions per set", () => {
  assert.equal(validateRoutine(campus), null);
  assert.equal(usesSensor(BUILTIN_ROUTINES[0]), true);
  assert.equal(usesSensor(campus), false);
  assert.equal(isOpenEnded(campus), true);
  const work = buildPhases(campus).filter((p) => p.type === "work");
  assert.equal(work.length, 6);
  assert.ok(work.every((p) => p.durS === null));
  assert.equal(totalDurationS(campus), 5 + 3 * 90 + 2 * 180); // rests and get-ready only
  assert.equal(instructionFor(campus, 2), "1-4-7");
  assert.equal(instructionFor({ ...campus, setInstructions: [] }, 2), "Ladders on medium rungs");
  assert.equal(instructionFor({ ...campus, setInstructions: ["", "x", "y"] }, 1), "Ladders on medium rungs");
});

test("validation of the new fields", () => {
  assert.match(validateRoutine({ ...campus, type: "yoga" }), /routine type/);
  assert.match(validateRoutine({ ...campus, setInstructions: ["a", "b"] }), /every set/);
  assert.match(validateRoutine({ ...campus, instruction: "x".repeat(201) }), /too long/);
  assert.match(validateRoutine({ ...campus, target: { type: "kg", value: 20 } }), /needs the sensor/);
  assert.equal(validateRoutine({ ...campus, type: "timed", workS: 10, addedWeightKg: 15 }), null);
  assert.equal(validateRoutine({ ...campus, type: "timed", workS: 10, addedWeightKg: -20 }), null); // assistance
  assert.match(validateRoutine({ ...campus, addedWeightKg: 400 }), /Added weight/);
  assert.match(validateRoutine({ ...campus, type: "timed", workS: 0 }), /Work time/);
});

test("routine files carry the new fields", () => {
  const { routines } = parseRoutineFile(JSON.stringify(buildRoutineFile([campus])));
  assert.equal(routines[0].type, "selfpaced");
  assert.deepEqual(routines[0].setInstructions, ["1-3-5", "1-4-7", "1-5-9"]);
});

test("all templates are valid and belong to a category", async () => {
  const { TEMPLATE_CATEGORIES } = await import("../../data/routines.js");
  for (const r of BUILTIN_ROUTINES) {
    assert.equal(validateRoutine(r), null, `${r.name}: ${validateRoutine(r)}`);
    assert.ok(TEMPLATE_CATEGORIES.includes(r.category), r.name);
  }
  assert.equal(new Set(BUILTIN_ROUTINES.map((r) => r.id)).size, BUILTIN_ROUTINES.length);
  for (const c of TEMPLATE_CATEGORIES) assert.ok(BUILTIN_ROUTINES.some((r) => r.category === c), c);
});
