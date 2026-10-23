// Erkdek Bluetooth LE protocol: decodes what the sensor sends and encodes commands.
// Same layouts as the firmware's lib/core/ble_protocol.h (little-endian); both sides are
// tested against the same byte vectors. No DOM access, so it runs under node --test.
//
//   Samples (notify)     seq u16 | t0 u32 ms | dt u16 µs/sample | n × force i16 (10 g)
//   Status (read/notify) flags u8 (bit0 tared, bit1 calibrated) | rate u16 (0.1 Hz)
//                        | countsPerKg f32 | uptime u32 ms
//                        | tare noise rms u16 (g) | tare noise peak-to-peak u16 (g)
//                        | battery u16 (mV) | protocol version u8
//   Command (write)      opcode u8 [| value f32]
//   Event (notify)       tared 1 | calibrated 2, calibrated u8, countsPerKg f32, noise u16 (g)
//                        | calError 3, reason u8, noise u16 (g)
// Noise and battery values of 0xFFFF mean "not measured" and decode to null.

const BASE = (n) => `9a0b000${n}-3d10-4e93-8657-4a72c5dd3311`;
export const UUID = {
  service: BASE(1),
  samples: BASE(2),
  status: BASE(3),
  command: BASE(4),
  event: BASE(5),
  ota: BASE(6), // firmware update (write with response / notify)
  // Standard Device Information service / Firmware Revision String
  deviceInfo: "0000180a-0000-1000-8000-00805f9b34fb",
  firmware: "00002a26-0000-1000-8000-00805f9b34fb",
};
export const DEVICE_NAME = "Erkdek";
// The layouts here, numbered: same as kProtocolVersion in the firmware. The app warns
// when the sensor reports another one (its firmware doesn't belong to this app).
export const PROTOCOL_VERSION = 1;

const COMMANDS = { tare: 1, calibrate: 2, calReset: 3, setCalibration: 4 };
const CAL_ERRORS = { 1: "badWeight", 2: "tooSmall", 3: "moving" };

// u16 in thousandths (g -> kg, mV -> V); 0xFFFF = not measured -> null.
function thousandths(v, offset) {
  const g = v.getUint16(offset, true);
  return g === 0xffff ? null : g / 1000;
}

function view(bytes) {
  if (bytes instanceof DataView) return bytes;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// -> { t: "samples", seq, ts, te, kg } in the same shape as the simulated sensor (ms).
export function decodeSamples(bytes) {
  const v = view(bytes);
  const seq = v.getUint16(0, true);
  const t0 = v.getUint32(2, true);
  const dtUs = v.getUint16(6, true);
  const n = (v.byteLength - 8) >> 1;
  const kg = [];
  for (let i = 0; i < n; i++) kg.push(v.getInt16(8 + 2 * i, true) / 100);
  return { t: "samples", seq, ts: t0, te: t0 + Math.round(((n - 1) * dtUs) / 1000), kg };
}

// A status from other firmware may be shorter: the fields it doesn't have come out as
// null (protocol as 0), so the app can say the firmware doesn't match instead of failing.
export function decodeStatus(bytes) {
  const v = view(bytes);
  const has = (end) => v.byteLength >= end;
  const flags = v.getUint8(0);
  return {
    t: "status",
    tared: (flags & 1) !== 0,
    calibrated: (flags & 2) !== 0,
    rate: v.getUint16(1, true) / 10,
    cpk: v.getFloat32(3, true),
    uptime: v.getUint32(7, true),
    tareNoiseKg: has(13) ? thousandths(v, 11) : null,
    tareNoisePpKg: has(15) ? thousandths(v, 13) : null,
    batteryV: has(17) ? thousandths(v, 15) : null,
    protocol: has(18) ? v.getUint8(17) : 0,
  };
}

// -> { t: "tared" } | { t: "calibrated", calibrated, cpk, noiseKg } | { t: "calError", reason, noiseKg } | null
export function decodeEvent(bytes) {
  const v = view(bytes);
  switch (v.getUint8(0)) {
    case 1:
      return { t: "tared" };
    case 2:
      return { t: "calibrated", calibrated: v.getUint8(1) === 1, cpk: v.getFloat32(2, true), noiseKg: thousandths(v, 6) };
    case 3:
      return { t: "calError", reason: CAL_ERRORS[v.getUint8(1)] ?? "unknown", noiseKg: thousandths(v, 2) };
    default:
      return null;
  }
}

// { cmd: "tare" | "calibrate" (kg) | "calReset" | "setCalibration" (cpk) } -> bytes, or
// null for commands the sensor doesn't have (e.g. the simulator's "mock").
export function encodeCommand(msg) {
  const op = COMMANDS[msg.cmd];
  if (!op) return null;
  if (msg.cmd === "calibrate" || msg.cmd === "setCalibration") {
    const out = new Uint8Array(5);
    const v = new DataView(out.buffer);
    v.setUint8(0, op);
    v.setFloat32(1, msg.cmd === "calibrate" ? msg.kg : msg.cpk, true);
    return out;
  }
  return Uint8Array.of(op);
}

// ---------------------------------------------------------------- firmware update
// Same layouts as ble::OtaOp / OtaEvent in the firmware:
//   start 0x01 | size u32 | sha256[32] · data 0x02 | offset u32 | bytes · end 0x03 · abort 0x04
//   event: type u8 (1 ready, 2 progress, 3 done, 4 error) | code u8 | value u32

export const OTA_DATA_HEADER = 5;
const OTA_EVENTS = { 1: "ready", 2: "progress", 3: "done", 4: "error" };
// What went wrong, by error code (the firmware's OtaErrorCode).
export const OTA_ERRORS = {
  0: "The update was cancelled.",
  2: "The firmware file doesn't fit or arrived incomplete.",
  3: "The sensor couldn't prepare the update.",
  4: "Writing the firmware on the sensor failed.",
  5: "Data arrived out of order.",
  6: "The firmware arrived damaged (checksum mismatch).",
  7: "The sensor rejected the firmware image.",
  8: "No update in progress on the sensor.",
  9: "An update is already in progress.",
};

export function encodeOtaStart(size, sha256) {
  const out = new Uint8Array(37);
  out[0] = 1;
  new DataView(out.buffer).setUint32(1, size, true);
  out.set(sha256, 5);
  return out;
}

export function encodeOtaData(offset, bytes) {
  const out = new Uint8Array(OTA_DATA_HEADER + bytes.length);
  out[0] = 2;
  new DataView(out.buffer).setUint32(1, offset, true);
  out.set(bytes, OTA_DATA_HEADER);
  return out;
}

export const encodeOtaEnd = () => Uint8Array.of(3);
export const encodeOtaAbort = () => Uint8Array.of(4);

// -> { t: "ready" | "progress" | "done" | "error", code, value } or null
export function decodeOtaEvent(bytes) {
  const v = view(bytes);
  if (v.byteLength < 6) return null;
  const t = OTA_EVENTS[v.getUint8(0)];
  return t ? { t, code: v.getUint8(1), value: v.getUint32(2, true) } : null;
}
