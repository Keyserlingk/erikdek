import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { MemoryBackend, db, useBackend } from "../../data/db.js";
import { routines } from "../../data/routines.js";
import { sessions } from "../../data/sessions.js";
import { settings, validateSettings } from "../../data/settingsstore.js";
import { holdTypes } from "../../data/tags.js";
import { workouts } from "../../data/workouts.js";

beforeEach(() => useBackend(new MemoryBackend()));

test("settings: defaults, save, validation and reload", async () => {
  await settings.load();
  assert.deepEqual(settings.values, { bodyweightKg: 0, repThresholdKg: 2 });
  await settings.save({ bodyweightKg: 72 });
  await settings.load();
  assert.deepEqual(settings.values, { bodyweightKg: 72, repThresholdKg: 2 });
  await assert.rejects(settings.save({ bodyweightKg: 300 }), /Bodyweight/);
  assert.match(validateSettings({ bodyweightKg: 0, repThresholdKg: 0.1 }), /Rep threshold/);
  assert.equal(validateSettings({ bodyweightKg: 0, repThresholdKg: 2 }), null);
});

test("routines: save, replace and remove persist", async () => {
  await routines.load();
  assert.deepEqual(routines.custom, []);
  await routines.save({ id: "r1", name: "A" });
  await routines.save({ id: "r1", name: "A2" }); // same id replaces
  await routines.save({ id: "r2", name: "B" });
  await routines.load();
  assert.deepEqual(routines.custom.map((r) => r.name), ["A2", "B"]);
  await routines.remove("r1");
  await routines.load();
  assert.deepEqual(routines.custom.map((r) => r.id), ["r2"]);
});

test("holds and workouts persist as lists", async () => {
  await holdTypes.load();
  await holdTypes.add("18 mm edge");
  await assert.rejects(holdTypes.add("18 MM EDGE"), /already exists/);
  await workouts.load();
  await workouts.save({ id: "w1", name: "Evening", routineIds: ["r1"] });
  assert.deepEqual(await db.get("kv", "holdtypes"), ["18 mm edge"]);
  assert.equal((await db.get("kv", "workouts"))[0].name, "Evening");
});

test("sessions: save keeps reps and curve out of the index; get, duplicate, remove", async () => {
  const s = { id: "s1", type: "maxPull", summary: { peakKg: 40 }, reps: [{ peakKg: 40 }], curve: { hz: 10, segments: [] } };
  await sessions.load();
  await sessions.save(s);
  assert.deepEqual(sessions.index, [{ id: "s1", type: "maxPull", summary: { peakKg: 40 } }]);
  assert.deepEqual(await sessions.get("s1"), s);
  await assert.rejects(sessions.save(s), /already saved/);
  await assert.rejects(sessions.save({ ...s, id: "BAD!" }), /Invalid session id/);

  await sessions.load(); // fresh load from the db
  assert.equal(sessions.index.length, 1);
  const st = await sessions.storage();
  assert.ok(st.sessionsBytes > 50);

  await sessions.remove("s1");
  assert.equal(sessions.index.length, 0);
  await assert.rejects(sessions.get("s1"), /no longer exists/);
  await sessions.load();
  assert.equal(sessions.index.length, 0);
});
