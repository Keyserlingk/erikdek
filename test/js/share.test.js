import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { MemoryBackend, useBackend } from "../../data/db.js";
import { profiles } from "../../data/profiles.js";
import { sessions } from "../../data/sessions.js";
import { buildShare, importShare, parseShare } from "../../data/share.js";

beforeEach(async () => {
  useBackend(new MemoryBackend());
  await profiles.load();
  await sessions.load();
});

const session = (id, extra = {}) => ({
  id,
  profile: "me",
  type: "maxPull",
  name: "Max pull",
  startedAt: "2026-10-20T08:00:00Z",
  summary: { peakKg: 45 },
  reps: [{ peakKg: 45 }],
  note: "Felt strong, bad skin",
  tags: ["Gym"],
  curve: { hz: 20, segments: [] },
  repCurves: { hz: 40, reps: [[1, 2]] },
  bodyweightKg: 72,
  ...extra,
});

test("a share leaves notes out; curves and bodyweight only when chosen", () => {
  const plain = buildShare({ from: { shareId: "abc123", name: "Erik" }, list: [session("s1")] });
  const s = plain.sessions[0];
  assert.equal(s.note, undefined);
  assert.equal(s.profile, undefined);
  assert.equal(s.curve, undefined);
  assert.equal(s.repCurves, undefined);
  assert.equal(s.bodyweightKg, 0);
  assert.deepEqual(s.tags, ["Gym"]);
  const full = buildShare({ from: { shareId: "abc123", name: "Erik" }, list: [session("s1")], curves: true, bodyweight: true });
  assert.ok(full.sessions[0].repCurves);
  assert.equal(full.sessions[0].bodyweightKg, 72);
  assert.equal(full.sessions[0].bodyweightFixed, true);
});

test("importing files a friend's sessions under one friend profile and updates them", async () => {
  const share = (sessionsList, name = "Anna") =>
    parseShare(JSON.stringify(buildShare({ from: { shareId: "anna42", name }, list: sessionsList })));
  let r = await importShare(share([session("a1"), session("a2")]));
  assert.deepEqual(r, { name: "Anna", added: 2, updated: 0, skipped: 0 });
  const friend = profiles.find("fanna42");
  assert.equal(friend.friend, true);
  assert.equal(sessions.all.filter((s) => s.profile === "fanna42").length, 2);
  assert.equal(sessions.index.length, 0); // not mine

  r = await importShare(share([session("a2", { summary: { peakKg: 47 } }), session("a3")], "Anna B"));
  assert.deepEqual(r, { name: "Anna B", added: 1, updated: 1, skipped: 0 });
  assert.equal((await sessions.get("a2")).summary.peakKg, 47);
  await assert.rejects(profiles.setActive("fanna42"), /Unknown profile/);
  assert.deepEqual(profiles.local.map((p) => p.name), ["Me", "Guest"]);

  await sessions.save({ id: "x1", type: "maxPull", summary: {} }); // mine
  r = await importShare(share([session("x1")]));
  assert.equal(r.skipped, 1);
});

test("parseShare rejects other files", () => {
  assert.throws(() => parseShare("{nope"), /not JSON/);
  assert.throws(() => parseShare('{"format":"erkdek-backup"}'), /not an Erkdek results file/);
  assert.throws(() => parseShare('{"format":"erkdek-share","from":{"shareId":"x","name":"A"},"sessions":[]}'), /whose results/);
});
