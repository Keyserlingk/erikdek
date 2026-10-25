// Tindeq Progressor Bluetooth LE protocol, as verified on a Progressor (firmware 2.0.4)
// with tools/tindeq_probe.py; details in PLAN.md ("Tindeq protocol"). No DOM access, so
// it runs under node --test.
//
//   Control point (write)  one command byte
//   Data (notify)          code u8 | length u8 | payload
//     code 0  reply to a query (the reply doesn't say which: one query at a time)
//     code 1  weight: n × (kg f32 | µs u32 since the measurement started), little-endian
//     code 4  low battery warning
// Any command stops a running measurement; start it again afterwards.

const BASE = (n) => `7e4e170${n}-1ea6-40c9-9dcc-13d34ffead57`;
export const TINDEQ_UUID = { service: BASE(1), data: BASE(2), control: BASE(3) };

export const TINDEQ_CMD = {
  tare: 0x64,
  start: 0x65,
  stop: 0x66,
  version: 0x6b, // -> firmware version string, e.g. "2.0.4"
  battery: 0x6f, // -> battery u32 mV
  // Not used: 0x6e puts the Progressor to sleep (off), 0x69/0x6a change its calibration.
};

function view(bytes) {
  if (bytes instanceof DataView) return bytes;
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

// -> { t: "weight", kg: [...], us: [...] } | { t: "reply", bytes } | { t: "lowBattery" } | null
export function decodeTindeq(bytes) {
  const v = view(bytes);
  if (v.byteLength < 2) return null;
  const code = v.getUint8(0);
  const len = Math.min(v.getUint8(1), v.byteLength - 2);
  if (code === 1) {
    const kg = [];
    const us = [];
    for (let i = 2; i + 8 <= len + 2; i += 8) {
      kg.push(v.getFloat32(i, true));
      us.push(v.getUint32(i + 4, true));
    }
    return { t: "weight", kg, us };
  }
  if (code === 0) return { t: "reply", bytes: new Uint8Array(v.buffer, v.byteOffset + 2, len) };
  if (code === 4) return { t: "lowBattery" };
  return null;
}

export const replyText = (bytes) => new TextDecoder().decode(bytes);
export const replyU32 = (bytes) => (bytes.length >= 4 ? view(bytes).getUint32(0, true) : null);
