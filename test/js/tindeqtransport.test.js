import assert from "node:assert/strict";
import { test } from "node:test";

import { PROTOCOL_VERSION } from "../../data/bleprotocol.js";
import { TINDEQ_CMD, TINDEQ_UUID, decodeTindeq, replyText, replyU32 } from "../../data/tindeqprotocol.js";
import { TindeqTransport } from "../../data/tindeqtransport.js";

// Node 18 has no CustomEvent (browsers and Node 19+ do).
globalThis.CustomEvent ??= class extends Event {
  constructor(type, init) {
    super(type, init);
    this.detail = init?.detail;
  }
};

// Captured from a Progressor (firmware 2.0.4) with tools/tindeq_probe.py.
const hex = (s) => Uint8Array.from(s.match(/../g), (b) => parseInt(b, 16));
// First notification after start, not tared: 15 × (kg f32, µs u32), -0.193 kg at 55298 µs.
const WEIGHT_UNTARED = hex(
  "017878eb45be02d80000104f42be5705010048d144bead32010058a147be04600100406c42be598d0100202543beafba010018b743be05e8010004e740be5c150200708344beb2420200b8c94dbe09700200e8e94cbe5f9d0200e08d47beb6ca0200d0b746be0bf80200682440be62250300e8f847beba520300",
);
// Tare and start sent while measuring: two samples from before (763351, 774959 µs), then
// the timestamps start again (5274 µs).
const WEIGHT_RESTART = hex(
  "017800a042b9d7a50b0000f8113a2fd30b00005c03bb9a140000006ca53af0410000000c45bb486f00000000fd39a09c000000fecf3bf8c900008052003c51f7000000007d3ba82401000004b4ba00520100003a083b587f0100007ac73bb0ac010000d0df3a08da010000262fbb6007020000d396bbb8340200",
);
// The last 8 samples, sent at stop.
const WEIGHT_LAST = hex("0140008258bbc565160000209e3b1c931600006ca53a74c01600007ac73bcded16000072893b241b17000096b13b7d48170000282f3ad675170000b3f5bb2ea31700");
const REPLY_VERSION = hex("0005322e302e34"); // "2.0.4"
const REPLY_BATTERY = hex("0004b40e0000"); // 3764 mV

const dv = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const tick = () => new Promise((r) => setTimeout(r, 5));
// Setting up takes a few fake round trips: wait until done (or fail after a second).
async function until(done) {
  for (let i = 0; i < 200 && !done(); i++) await tick();
}

// A weight notification: [[kg, µs], ...].
function weight(samples) {
  const v = new DataView(new ArrayBuffer(2 + samples.length * 8));
  v.setUint8(0, 1);
  v.setUint8(1, samples.length * 8);
  samples.forEach(([kg, us], i) => {
    v.setFloat32(2 + i * 8, kg, true);
    v.setUint32(6 + i * 8, us, true);
  });
  return v;
}

// Fake of the Capacitor BleClient playing a Progressor: answers the version and battery
// queries; tests push the weight notifications.
function fakeClient({ pick = "EB:C0", failConnect = 0 } = {}) {
  const c = {
    calls: [],
    commands: [],
    notify: null,
    disconnectCb: null,
    failConnect,
    async initialize() {},
    async isEnabled() {
      return true;
    },
    async requestDevice(opts) {
      c.calls.push(["requestDevice", opts]);
      return { deviceId: pick };
    },
    async connect(id, onDisconnect) {
      c.calls.push(["connect", id]);
      if (c.failConnect-- > 0) throw new Error("not in range");
      c.disconnectCb = onDisconnect;
    },
    async disconnect(id) {
      c.calls.push(["disconnect", id]);
    },
    async startNotifications(id, service, chr, cb) {
      assert.equal(service, TINDEQ_UUID.service);
      assert.equal(chr, TINDEQ_UUID.data);
      c.notify = cb;
    },
    async write(id, service, chr, value) {
      assert.equal(chr, TINDEQ_UUID.control);
      const code = value.getUint8(0);
      c.commands.push(code);
      const reply = { [TINDEQ_CMD.version]: REPLY_VERSION, [TINDEQ_CMD.battery]: REPLY_BATTERY }[code];
      if (reply) setTimeout(() => c.notify(dv(reply)), 1);
    },
  };
  return c;
}

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { data, get: (k) => data[k] ?? null, set: (k, v) => (v === null ? delete data[k] : (data[k] = v)) };
}

function collect(transport) {
  const messages = [];
  const states = [];
  transport.addEventListener("message", (e) => messages.push(e.detail));
  transport.addEventListener("state", (e) => states.push(e.detail));
  return { messages, states, samples: () => messages.filter((m) => m.t === "samples") };
}

async function connected(client = fakeClient()) {
  const t = new TindeqTransport({ loadClient: async () => client, storage: memoryStorage({ "erkdek.tindeqDevice": "EB:C0" }) });
  const c = collect(t);
  await t.connect();
  client.commands.length = 0;
  return { t, client, ...c };
}

test("decodes captured notifications", () => {
  const w = decodeTindeq(WEIGHT_UNTARED);
  assert.equal(w.t, "weight");
  assert.equal(w.kg.length, 15);
  assert.equal(w.us[0], 55298);
  assert.equal(w.us[14], 217786);
  assert.ok(Math.abs(w.kg[0] + 0.193) < 0.0005);
  assert.equal(decodeTindeq(WEIGHT_LAST).kg.length, 8);
  assert.equal(replyText(decodeTindeq(REPLY_VERSION).bytes), "2.0.4");
  assert.equal(replyU32(decodeTindeq(REPLY_BATTERY).bytes), 3764);
  assert.deepEqual(decodeTindeq(Uint8Array.of(4, 0)), { t: "lowBattery" });
  assert.equal(decodeTindeq(Uint8Array.of(1)), null);
});

test("chooseSensor picks a Progressor, reads version and battery, then measures", async () => {
  const client = fakeClient();
  const storage = memoryStorage();
  const t = new TindeqTransport({ loadClient: async () => client, storage });
  const { messages, states } = collect(t);
  await t.chooseSensor();
  assert.deepEqual(states, ["closed", "connecting", "open"]);
  assert.deepEqual(client.calls[0], ["requestDevice", { services: [TINDEQ_UUID.service] }]);
  assert.equal(storage.data["erkdek.tindeqDevice"], "EB:C0");
  assert.equal(storage.data["erkdek.bleDevice"], undefined); // the Erkdek's choice stays
  assert.deepEqual(client.commands, [TINDEQ_CMD.version, TINDEQ_CMD.battery, TINDEQ_CMD.start]);
  assert.deepEqual(messages[0], {
    t: "status",
    tared: true,
    calibrated: true,
    rate: 0,
    cpk: null,
    uptime: 0,
    tareNoiseKg: null,
    tareNoisePpKg: null,
    batteryV: 3.764,
    lowBattery: false,
    protocol: PROTOCOL_VERSION,
    fw: "2.0.4",
    mock: false,
    device: "tindeq",
  });
});

test("weight notifications become samples on one continuous ms timeline", async () => {
  const { client, samples } = await connected();
  client.notify(dv(WEIGHT_UNTARED));
  const first = samples()[0];
  assert.equal(first.ts, 55);
  assert.equal(first.te, 218);
  assert.equal(first.kg.length, 15);
  assert.equal(first.kg[0], -0.193); // rounded to grams

  client.notify(dv(WEIGHT_RESTART)); // the device's timestamps start again mid-packet
  const second = samples()[1];
  assert.equal(second.ts, 763);
  // 13 samples after the restart (5274..144568 µs), a sample period after 775 ms.
  assert.ok(second.te > 914 && second.te < 955, `continues after the restart: ${second.te}`);
  client.notify(dv(WEIGHT_LAST));
  assert.ok(samples()[2].ts > second.te);
});

test("status about once a second, with the rate from the timestamps", async () => {
  const { client, messages } = await connected();
  const statuses = () => messages.filter((m) => m.t === "status").length;
  const before = statuses();
  // 2.5 s at 80 Hz with every 16th sample missing (as the Progressor does): 75 Hz.
  for (let p = 0; p < 13; p++) {
    const packet = [];
    for (let i = 0; i < 15; i++) packet.push([0, (p * 16 + i) * 12500]);
    client.notify(weight(packet));
  }
  assert.equal(statuses() - before, 2);
  const st = messages.findLast((m) => m.t === "status");
  assert.ok(Math.abs(st.rate - 75) < 0.5, st.rate);
  assert.ok(st.uptime >= 2000);
});

test("tare: tare, start again, then tared; other commands don't apply", async () => {
  const { t, client, messages } = await connected();
  assert.equal(t.send({ cmd: "tare" }), true);
  await until(() => messages.at(-1).t === "tared");
  assert.deepEqual(client.commands, [TINDEQ_CMD.tare, TINDEQ_CMD.start]);
  assert.deepEqual(messages.at(-1), { t: "tared" });
  for (const cmd of ["calibrate", "calReset", "setCalibration", "mock"]) assert.equal(t.send({ cmd }), false);
  await assert.rejects(t.updateFirmware(Uint8Array.of(1)), /can't be updated/);
});

test("battery: asked again after 10 minutes, only while nothing pulls", async () => {
  const { client, messages } = await connected();
  client.notify(weight([[0, 1000]]));
  client.notify(weight([[20, 600_000_000]])); // loaded: not now
  await tick();
  assert.deepEqual(client.commands, []);
  client.notify(weight([[0, 606_000_000]])); // idle for 6 s
  await until(() => client.commands.length >= 2);
  assert.deepEqual(client.commands, [TINDEQ_CMD.battery, TINDEQ_CMD.start]);
  client.notify(dv(Uint8Array.of(4, 0))); // low battery warning
  client.notify(weight([[0, 607_100_000]]));
  const st = messages.findLast((m) => m.t === "status");
  assert.equal(st.batteryV, 3.764);
  assert.equal(st.lowBattery, true);
});

test("reconnects after a dropped link and starts measuring again", async () => {
  const client = fakeClient({ failConnect: 1 });
  const t = new TindeqTransport({ loadClient: async () => client, storage: memoryStorage(), reconnectDelaysMs: [0] });
  const { states } = collect(t);
  await t.connect({ pick: true });
  await until(() => states.length >= 4);
  assert.deepEqual(states, ["connecting", "closed", "connecting", "open"]);

  client.commands.length = 0;
  client.disconnectCb();
  await until(() => states.length >= 7);
  assert.deepEqual(states.slice(4), ["closed", "connecting", "open"]);
  assert.deepEqual(client.commands, [TINDEQ_CMD.version, TINDEQ_CMD.battery, TINDEQ_CMD.start]);

  await t.forget();
  assert.equal(client.commands.at(-1), TINDEQ_CMD.stop);
  assert.ok(client.calls.some((c) => c[0] === "disconnect"));
  assert.equal(t.state, "closed");
});
