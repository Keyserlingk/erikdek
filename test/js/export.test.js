import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BACKUP_FORMAT,
  buildBackup,
  csvEscape,
  curveCsv,
  fileDate,
  historyCsv,
  mergeBy,
  parseBackup,
  storedCurveCsv,
  toCsv,
} from "../../data/export.js";

test("csvEscape quotes commas, quotes and newlines", () => {
  assert.equal(csvEscape("20 mm edge"), "20 mm edge");
  assert.equal(csvEscape('a "b", c'), '"a ""b"", c"');
  assert.equal(csvEscape("line\nbreak"), '"line\nbreak"');
  assert.equal(csvEscape(null), "");
  assert.equal(csvEscape(0), "0");
  assert.equal(toCsv([["a", "b"], [1, 2]]), "a,b\n1,2\n");
});

test("curveCsv writes time and force, with optional phase columns", () => {
  assert.equal(curveCsv({ hz: 4, kg: [0, 1.23456] }), "time_s,force_kg\n0,0\n0.25,1.235\n");
  const phases = [{ type: "prep", set: 1, rep: 1 }, { type: "work", set: 1, rep: 2 }];
  assert.equal(curveCsv({ hz: 80, kg: [0, 10] }, phases), "time_s,force_kg,phase,set,rep\n0,0,prep,1,1\n0.0125,10,work,1,2\n");
});

test("historyCsv has one sorted row per session and a column per scalar metric", () => {
  const csv = historyCsv([
    { startedAt: "2026-10-02T10:00:00Z", type: "rfd", name: "RFD", holdType: "", grip: "", hand: "both", durationS: 80, summary: { rfdKgS: 250.123, attemptRfdKgS: [1, 2] } },
    { startedAt: "2026-10-01T10:00:00Z", type: "maxPull", name: "Max pull", holdType: "20 mm edge", grip: "Half crimp", hand: "left", bodyweightKg: 70, durationS: 205, summary: { peakKg: 40 } },
  ]);
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "date,type,name,hold,grip,hand,bodyweight_kg,duration_s,stopped,peakKg,rfdKgS");
  assert.equal(lines[1], "2026-10-01T10:00:00Z,maxPull,Max pull,20 mm edge,Half crimp,left,70,205,,40,");
  assert.equal(lines[2], "2026-10-02T10:00:00Z,rfd,RFD,,,both,,80,,,250.123");
});

test("backup round trip and validation", () => {
  const backup = buildBackup({
    settings: { bodyweightKg: 70 },
    calibration: { cpk: 16000, calibrated: true },
    routines: [{ id: "r1" }],
    holdTypes: ["18 mm edge"],
    grips: [],
    sessions: [{ id: "s1", type: "maxPull" }],
    exportedAt: new Date("2026-10-18T12:00:00Z"),
  });
  assert.equal(backup.format, BACKUP_FORMAT);
  const parsed = parseBackup(JSON.stringify(backup));
  assert.equal(parsed.exportedAt, "2026-10-18T12:00:00.000Z");
  assert.deepEqual(parsed.routines, [{ id: "r1" }]);
  assert.equal(parsed.calibration.cpk, 16000);
  assert.equal(parsed.sessions.length, 1);

  assert.throws(() => parseBackup("{nope"), /not JSON/);
  assert.throws(() => parseBackup('{"format":"other"}'), /not an Erkdek backup/);
  assert.equal(parseBackup(JSON.stringify({ ...backup, format: "tindek-backup" })).sessions.length, 1); // pre-rename
  assert.throws(() => parseBackup(JSON.stringify({ ...backup, version: 99 })), /newer version/);
  assert.throws(() => parseBackup(JSON.stringify({ ...backup, sessions: "x" })), /damaged/);
});

test("mergeBy replaces matching items and keeps the rest", () => {
  const merged = mergeBy([{ id: "a", v: 1 }, { id: "b", v: 1 }], [{ id: "b", v: 2 }, { id: "c", v: 2 }], (r) => r.id);
  assert.deepEqual(merged, [{ id: "a", v: 1 }, { id: "b", v: 2 }, { id: "c", v: 2 }]);
});

test("fileDate formats local date", () => {
  assert.equal(fileDate(new Date(2026, 0, 5)), "2026-01-05");
});

test("storedCurveCsv writes stored samples with their real time", () => {
  assert.equal(storedCurveCsv({ hz: 10, segments: [{ t: 1, kg: [5, 6] }] }), "time_s,force_kg\n1,5\n1.1,6\n");
  assert.equal(storedCurveCsv({ hz: 2, kg: [1, 2] }), "time_s,force_kg\n0,1\n0.5,2\n");
});
