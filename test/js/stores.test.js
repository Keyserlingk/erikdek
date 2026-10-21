import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { MemoryBackend, db, useBackend } from "../../data/db.js";
import { GUEST_PROFILE, profiles } from "../../data/profiles.js";
import { routines } from "../../data/routines.js";
import { sessions } from "../../data/sessions.js";
import { bodyweightOn, dayOf, settings, validateSettings } from "../../data/settingsstore.js";
import { holdTypes } from "../../data/tags.js";
import { workouts } from "../../data/workouts.js";

beforeEach(async () => {
  useBackend(new MemoryBackend());
  await profiles.load(); // fresh defaults: "Me" active
});

test("settings: defaults, save, validation and reload", async () => {
  await settings.load();
  assert.deepEqual(settings.values, {
    bodyweightKg: 0,
    bodyweightLog: [],
    repThresholdKg: 2,
    startOnForce: true,
    startPct: 30,
    recordRelease: true,
  });
  await settings.save({ bodyweightKg: 72 });
  await settings.save({ startOnForce: false });
  await settings.load();
  assert.deepEqual(settings.values, {
    bodyweightKg: 72,
    bodyweightLog: [],
    repThresholdKg: 2,
    startOnForce: false,
    startPct: 30,
    recordRelease: true,
  });
  await assert.rejects(settings.save({ bodyweightKg: 300 }), /Bodyweight/);
  const ok = { bodyweightKg: 0, bodyweightLog: [], repThresholdKg: 2, startOnForce: true, startPct: 30, recordRelease: true };
  assert.equal(validateSettings(ok), null);
  assert.match(validateSettings({ ...ok, repThresholdKg: 0.1 }), /Rep threshold/);
  assert.match(validateSettings({ ...ok, startOnForce: "yes" }), /start-on-force/);
  assert.match(validateSettings({ ...ok, startPct: 2 }), /start level/);
  assert.match(validateSettings({ ...ok, startPct: 30.5 }), /start level/);
  assert.match(validateSettings({ ...ok, recordRelease: 1 }), /record-release/);
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
  assert.deepEqual(sessions.index, [{ profile: "me", id: "s1", type: "maxPull", summary: { peakKg: 40 } }]);
  assert.deepEqual(await sessions.get("s1"), { profile: "me", ...s });
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

test("profiles: sessions and settings are kept apart; delete and clear guest", async () => {
  assert.deepEqual(profiles.list.map((p) => p.name), ["Me", "Guest"]);
  await settings.load();
  await settings.save({ bodyweightKg: 72 });
  await sessions.load();
  await sessions.save({ id: "a1", type: "maxPull", summary: {} });

  const anna = await profiles.add("Anna");
  await assert.rejects(profiles.add("anna"), /already exists/);
  await profiles.setActive(anna.id);
  await settings.load();
  assert.equal(settings.values.bodyweightKg, 0); // Anna's own settings
  assert.equal(sessions.index.length, 0); // Me's session isn't hers
  await sessions.save({ id: "b1", type: "maxPull", summary: {} });
  await settings.save({ bodyweightKg: 55 });
  assert.deepEqual(Object.fromEntries(Object.entries(await settings.byProfile()).map(([k, v]) => [k, v.bodyweightKg])), {
    me: 72,
    [anna.id]: 55,
  });

  await profiles.setActive("me");
  await settings.load();
  assert.equal(settings.values.bodyweightKg, 72);
  assert.deepEqual(sessions.index.map((s) => s.id), ["a1"]);
  assert.equal(sessions.all.length, 2);
  // A restored session keeps its own profile.
  await sessions.save({ id: "b2", profile: anna.id, type: "maxPull", summary: {} });
  assert.deepEqual(sessions.index.map((s) => s.id), ["a1"]);

  await assert.rejects(profiles.remove("me"), /can't be deleted/);
  await sessions.removeProfile(anna.id);
  await settings.removeFor(anna.id);
  await profiles.remove(anna.id);
  assert.deepEqual(sessions.all.map((s) => s.id), ["a1"]);
  assert.equal(profiles.find(anna.id), null);

  await profiles.setActive(GUEST_PROFILE);
  await sessions.save({ id: "g1", type: "maxPull", summary: {} });
  await sessions.removeProfile(GUEST_PROFILE); // "Clear guest data"
  assert.deepEqual(sessions.all.map((s) => s.id), ["a1"]);
});

test("bodyweight log: newest is current; sessions use the weight of their day", async () => {
  await settings.load();
  await settings.logBodyweight(74, "2026-09-01");
  await settings.logBodyweight(72, "2026-10-01");
  await settings.logBodyweight(71.5, "2026-10-01"); // same day: replaced
  assert.deepEqual(settings.values.bodyweightLog, [
    { date: "2026-09-01", kg: 74 },
    { date: "2026-10-01", kg: 71.5 },
  ]);
  assert.equal(settings.values.bodyweightKg, 71.5);
  assert.equal(bodyweightOn(settings.values.bodyweightLog, "2026-09-15T12:00:00"), 74);
  assert.equal(bodyweightOn(settings.values.bodyweightLog, "2026-08-15T12:00:00"), null);
  assert.equal(settings.withBodyweight({ startedAt: "2026-09-20T12:00:00", bodyweightKg: 0 }).bodyweightKg, 74);
  assert.equal(settings.withBodyweight({ startedAt: "2026-08-20T12:00:00", bodyweightKg: 69 }).bodyweightKg, 69);
  await settings.removeBodyweightEntry("2026-10-01");
  assert.equal(settings.values.bodyweightKg, 74);
  assert.equal(dayOf("2026-10-21T12:00:00").length, 10);
  assert.match(validateSettings({ ...settings.values, bodyweightLog: [{ date: "x", kg: 70 }] }), /bodyweight entry/);
});

test("sessions: notes and tags can be updated", async () => {
  await sessions.load();
  await sessions.save({ id: "n1", type: "maxPull", summary: {}, reps: [{ peakKg: 1 }] });
  await sessions.update("n1", { note: "Felt strong", tags: ["Good skin", "Gym"] });
  assert.deepEqual(sessions.index[0].tags, ["Good skin", "Gym"]);
  assert.equal((await sessions.get("n1")).note, "Felt strong");
  assert.deepEqual((await sessions.get("n1")).reps, [{ peakKg: 1 }]); // the rest is kept
  await assert.rejects(sessions.update("n1", { note: "x".repeat(501), tags: [] }), /Notes/);
  await assert.rejects(sessions.update("n1", { note: "", tags: [""] }), /Tags/);
});
