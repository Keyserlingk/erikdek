import assert from "node:assert/strict";
import { test } from "node:test";

import {
  UUID,
  decodeEvent,
  decodeOtaEvent,
  decodeSamples,
  decodeStatus,
  encodeCommand,
  encodeOtaData,
  encodeOtaEnd,
  encodeOtaStart,
} from "../../data/bleprotocol.js";

// Byte vectors shared with the firmware's test/test_core/test_main.cpp.
const SAMPLES = Uint8Array.of(0x02, 0x01, 0xe8, 0x03, 0x00, 0x00, 0xd4, 0x30, 0x00, 0x00, 0xe9, 0x07, 0x6a, 0xff, 0xff, 0x7f);
const STATUS = Uint8Array.of(0x01, 0x20, 0x03, 0x00, 0x00, 0x7a, 0x46, 0x40, 0xe2, 0x01, 0x00, 0x0c, 0x00, 0x29, 0x00, 0x50, 0x0f, 0x02, 0x02, 0x4a, 0x01);

test("decodeSamples", () => {
  // 4 samples, 12.5 ms apart from t0 = 1000 ms; 400 kg was clamped to 327.67
  assert.deepEqual(decodeSamples(SAMPLES), { t: "samples", seq: 258, ts: 1000, te: 1038, kg: [0, 20.25, -1.5, 327.67] });
  // a DataView over part of a larger buffer works too
  const big = new Uint8Array(20);
  big.set(SAMPLES.slice(0, 10), 4);
  assert.deepEqual(decodeSamples(new DataView(big.buffer, 4, 10)).kg, [0]);
});

test("decodeStatus", () => {
  assert.deepEqual(decodeStatus(STATUS), {
    t: "status",
    tared: true,
    calibrated: false,
    rate: 80,
    cpk: 16000,
    uptime: 123456,
    tareNoiseKg: 0.012,
    tareNoisePpKg: 0.041,
    batteryV: 3.92,
    protocol: 2,
    adc: "ads1220",
    adcRate: 330,
  });
  const hx = STATUS.slice();
  hx.set([0x01, 0x00, 0x00], 18);
  assert.equal(decodeStatus(hx).adc, "hx711");
  assert.equal(decodeStatus(hx).adcRate, 0);
  // Older firmware: shorter status, protocol 0 (the app shows the mismatch).
  const old = decodeStatus(STATUS.slice(0, 11));
  assert.equal(old.protocol, 0);
  assert.equal(old.batteryV, null);
  assert.equal(old.cpk, 16000);
  assert.equal(old.adc, null);
  const untared = STATUS.slice();
  untared.set([0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 11);
  assert.equal(decodeStatus(untared).tareNoiseKg, null);
  assert.equal(decodeStatus(untared).batteryV, null); // no battery reading
});

test("decodeEvent", () => {
  assert.deepEqual(decodeEvent(Uint8Array.of(0x01)), { t: "tared" });
  assert.deepEqual(decodeEvent(Uint8Array.of(0x02, 0x01, 0x00, 0x00, 0x7a, 0x46, 0x12, 0x00)), {
    t: "calibrated",
    calibrated: true,
    cpk: 16000,
    noiseKg: 0.018,
  });
  assert.deepEqual(decodeEvent(Uint8Array.of(0x02, 0x00, 0x00, 0x7c, 0x5f, 0x46, 0xff, 0xff)).noiseKg, null); // reset
  assert.deepEqual(decodeEvent(Uint8Array.of(0x03, 0x03, 0xa4, 0x01)), { t: "calError", reason: "moving", noiseKg: 0.42 });
  assert.deepEqual(decodeEvent(Uint8Array.of(0x03, 0x01, 0xff, 0xff)), { t: "calError", reason: "badWeight", noiseKg: null });
  assert.equal(decodeEvent(Uint8Array.of(0x09)), null);
});

test("encodeCommand", () => {
  assert.deepEqual(encodeCommand({ cmd: "tare" }), Uint8Array.of(0x01));
  assert.deepEqual(encodeCommand({ cmd: "calReset" }), Uint8Array.of(0x03));
  assert.deepEqual(encodeCommand({ cmd: "calibrate", kg: 20 }), Uint8Array.of(0x02, 0x00, 0x00, 0xa0, 0x41));
  assert.deepEqual(encodeCommand({ cmd: "setCalibration", cpk: 16000 }), Uint8Array.of(0x04, 0x00, 0x00, 0x7a, 0x46));
  assert.deepEqual(encodeCommand({ cmd: "setRate", sps: 330 }), Uint8Array.of(0x05, 0x00, 0x00, 0xa5, 0x43));
  assert.equal(encodeCommand({ cmd: "mock", scenario: "idle" }), null);
});

test("UUIDs are distinct and well-formed", () => {
  const all = Object.values(UUID);
  assert.equal(new Set(all).size, all.length);
  for (const u of all) assert.match(u, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("firmware update messages (same vectors as the firmware tests)", () => {
  const sha = Uint8Array.from({ length: 32 }, (_, i) => i);
  const start = encodeOtaStart(618496, sha);
  assert.deepEqual([...start.slice(0, 5)], [0x01, 0x00, 0x70, 0x09, 0x00]);
  assert.equal(start.length, 37);
  assert.equal(start[36], 31);
  assert.deepEqual(encodeOtaData(256, Uint8Array.of(0xaa, 0xbb)), Uint8Array.of(0x02, 0x00, 0x01, 0x00, 0x00, 0xaa, 0xbb));
  assert.deepEqual(encodeOtaEnd(), Uint8Array.of(0x03));
  assert.deepEqual(decodeOtaEvent(Uint8Array.of(0x02, 0x00, 0x00, 0x40, 0x00, 0x00)), { t: "progress", code: 0, value: 16384 });
  assert.deepEqual(decodeOtaEvent(Uint8Array.of(0x04, 0x06, 0x00, 0x00, 0x00, 0x00)), { t: "error", code: 6, value: 0 });
  assert.equal(decodeOtaEvent(Uint8Array.of(0x09, 0, 0, 0, 0, 0)), null);
});
