// Erkdek Bluetooth LE protocol: decodes what the sensor sends and encodes commands.
// Same layouts as the firmware's lib/core/ble_protocol.h (little-endian); both sides are
// tested against the same byte vectors. No DOM access, so it runs under node --test.
//
//   Samples (notify)     seq u16 | t0 u32 ms | dt u16 µs/sample | n × force i16 (10 g)
//   Status (read/notify) flags u8 (bit0 tared, bit1 calibrated) | rate u16 (0.1 Hz)
//                        | countsPerKg f32 | uptime u32 ms
//                        | tare noise rms u16 (g) | tare noise peak-to-peak u16 (g)
//   Command (write)      opcode u8 [| value f32]
//   Event (notify)       tared 1 | calibrated 2, calibrated u8, countsPerKg f32, noise u16 (g)
//                        | calError 3, reason u8, noise u16 (g)
// Noise values of 0xFFFF mean "not measured" and decode to null.

const BASE = (n) => `9a0b000${n}-3d10-4e93-8657-4a72c5dd3311`;
export const UUID = {
  service: BASE(1),
  samples: BASE(2),
  status: BASE(3),
  command: BASE(4),
  event: BASE(5),
  // Standard Device Information service / Firmware Revision String
  deviceInfo: "0000180a-0000-1000-8000-00805f9b34fb",
  firmware: "00002a26-0000-1000-8000-00805f9b34fb",
};
export const DEVICE_NAME = "Erkdek";

const COMMANDS = { tare: 1, calibrate: 2, calReset: 3, setCalibration: 4 };
const CAL_ERRORS = { 1: "badWeight", 2: "tooSmall", 3: "moving" };

// Grams (0xFFFF = not measured) -> kg or null.
function noiseKg(v, offset) {
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

export function decodeStatus(bytes) {
  const v = view(bytes);
  const flags = v.getUint8(0);
  return {
    t: "status",
    tared: (flags & 1) !== 0,
    calibrated: (flags & 2) !== 0,
    rate: v.getUint16(1, true) / 10,
    cpk: v.getFloat32(3, true),
    uptime: v.getUint32(7, true),
    tareNoiseKg: noiseKg(v, 11),
    tareNoisePpKg: noiseKg(v, 13),
  };
}

// -> { t: "tared" } | { t: "calibrated", calibrated, cpk, noiseKg } | { t: "calError", reason, noiseKg } | null
export function decodeEvent(bytes) {
  const v = view(bytes);
  switch (v.getUint8(0)) {
    case 1:
      return { t: "tared" };
    case 2:
      return { t: "calibrated", calibrated: v.getUint8(1) === 1, cpk: v.getFloat32(2, true), noiseKg: noiseKg(v, 6) };
    case 3:
      return { t: "calError", reason: CAL_ERRORS[v.getUint8(1)] ?? "unknown", noiseKg: noiseKg(v, 2) };
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
