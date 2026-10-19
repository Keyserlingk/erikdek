import assert from "node:assert/strict";
import { test } from "node:test";

import { UUID, decodeEvent, decodeSamples, decodeStatus, encodeCommand } from "../../data/bleprotocol.js";

// Byte vectors shared with the firmware's test/test_core/test_main.cpp.
const SAMPLES = Uint8Array.of(0x02, 0x01, 0xe8, 0x03, 0x00, 0x00, 0xd4, 0x30, 0x00, 0x00, 0xe9, 0x07, 0x6a, 0xff, 0xff, 0x7f);
const STATUS = Uint8Array.of(0x01, 0x20, 0x03, 0x00, 0x00, 0x7a, 0x46, 0x40, 0xe2, 0x01, 0x00);

test("decodeSamples", () => {
  // 4 samples, 12.5 ms apart from t0 = 1000 ms; 400 kg was clamped to 327.67
  assert.deepEqual(decodeSamples(SAMPLES), { t: "samples", seq: 258, ts: 1000, te: 1038, kg: [0, 20.25, -1.5, 327.67] });
  // a DataView over part of a larger buffer works too
  const big = new Uint8Array(20);
  big.set(SAMPLES.slice(0, 10), 4);
  assert.deepEqual(decodeSamples(new DataView(big.buffer, 4, 10)).kg, [0]);
});

test("decodeStatus", () => {
  assert.deepEqual(decodeStatus(STATUS), { t: "status", tared: true, calibrated: false, rate: 80, cpk: 16000, uptime: 123456 });
});

test("decodeEvent", () => {
  assert.deepEqual(decodeEvent(Uint8Array.of(0x01)), { t: "tared" });
  assert.deepEqual(decodeEvent(Uint8Array.of(0x02, 0x01, 0x00, 0x00, 0x7a, 0x46)), { t: "calibrated", calibrated: true, cpk: 16000 });
  assert.deepEqual(decodeEvent(Uint8Array.of(0x03, 0x02)), { t: "calError", reason: "tooSmall" });
  assert.deepEqual(decodeEvent(Uint8Array.of(0x03, 0x01)), { t: "calError", reason: "badWeight" });
  assert.equal(decodeEvent(Uint8Array.of(0x09)), null);
});

test("encodeCommand", () => {
  assert.deepEqual(encodeCommand({ cmd: "tare" }), Uint8Array.of(0x01));
  assert.deepEqual(encodeCommand({ cmd: "calReset" }), Uint8Array.of(0x03));
  assert.deepEqual(encodeCommand({ cmd: "calibrate", kg: 20 }), Uint8Array.of(0x02, 0x00, 0x00, 0xa0, 0x41));
  assert.deepEqual(encodeCommand({ cmd: "setCalibration", cpk: 16000 }), Uint8Array.of(0x04, 0x00, 0x00, 0x7a, 0x46));
  assert.equal(encodeCommand({ cmd: "mock", scenario: "idle" }), null);
});

test("UUIDs are distinct and well-formed", () => {
  const all = Object.values(UUID);
  assert.equal(new Set(all).size, all.length);
  for (const u of all) assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});
