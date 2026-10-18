import assert from "node:assert/strict";
import { test } from "node:test";

import { BUILTIN_ROUTINES, ROUTINE_FORMAT, buildRoutineFile, parseRoutineFile } from "../../data/routines.js";

const mine = { ...BUILTIN_ROUTINES[0], id: "r1", builtin: false, name: "My repeaters", holdType: "18 mm edge" };

test("buildRoutineFile keeps only routine fields", () => {
  const file = buildRoutineFile([mine]);
  assert.equal(file.format, ROUTINE_FORMAT);
  assert.deepEqual(Object.keys(file.routines[0]).sort(), ["grip", "holdType", "name", "prepS", "reps", "restS", "setRestS", "sets", "target", "workS"]);
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
