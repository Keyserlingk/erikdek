import assert from "node:assert/strict";
import { test } from "node:test";

import { UUID } from "../../data/bleprotocol.js";
import { createHash } from "node:crypto";
import { BleTransport } from "../../data/bletransport.js";

// Node 18 has no CustomEvent (browsers and Node 19+ do).
globalThis.CustomEvent ??= class extends Event {
  constructor(type, init) {
    super(type, init);
    this.detail = init?.detail;
  }
};

const STATUS = Uint8Array.of(0x03, 0x20, 0x03, 0x00, 0x00, 0x7a, 0x46, 0x40, 0xe2, 0x01, 0x00, 0x0c, 0x00, 0x29, 0x00, 0xff, 0xff, 0x01);
const SAMPLES = Uint8Array.of(0x02, 0x01, 0xe8, 0x03, 0x00, 0x00, 0xd4, 0x30, 0x00, 0x00, 0xe9, 0x07);
const dv = (bytes) => new DataView(bytes.buffer);
const tick = () => new Promise((r) => setTimeout(r, 5));

// Fake of the Capacitor BleClient: records calls, lets tests push notifications.
function fakeClient({ pick = "AA:BB", failConnect = 0 } = {}) {
  const c = {
    calls: [],
    notify: {},
    writes: [],
    disconnectCb: null,
    failConnect,
    async initialize(opts) {
      c.calls.push(["initialize", opts]);
    },
    async isEnabled() {
      return true;
    },
    async requestDevice(opts) {
      c.calls.push(["requestDevice", opts]);
      if (!pick) throw new Error("cancelled");
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
    async requestConnectionPriority() {},
    async read(id, service, chr) {
      if (chr === UUID.firmware) return dv(new TextEncoder().encode("abc1234"));
      if (chr === UUID.status) return dv(STATUS);
      throw new Error("unknown characteristic");
    },
    async startNotifications(id, service, chr, cb) {
      c.notify[chr] = cb;
    },
    async write(id, service, chr, value) {
      const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
      c.writes.push([chr, bytes]);
      if (chr === UUID.ota) c.ota(bytes);
    },
    async getMtu() {
      return 247;
    },
    async stopNotifications() {},
    // Plays the sensor's side of a firmware update.
    otaArmed: true,
    otaImage: [],
    ota(bytes) {
      const send = (type, code = 0, value = 0) => {
        const ev = new Uint8Array(6);
        ev[0] = type;
        ev[1] = code;
        new DataView(ev.buffer).setUint32(2, value, true);
        setTimeout(() => c.notify[UUID.ota](new DataView(ev.buffer)), 1);
      };
      if (bytes[0] === 1) {
        c.otaSize = new DataView(bytes.buffer).getUint32(1, true);
        c.otaSha = Buffer.from(bytes.slice(5)).toString("hex");
        if (!c.otaArmed) send(4, 1);
        else send(1, 0, c.otaSize);
      } else if (bytes[0] === 2) {
        c.otaImage.push(...bytes.slice(5));
      } else if (bytes[0] === 3) {
        const sha = createHash("sha256").update(Uint8Array.from(c.otaImage)).digest("hex");
        if (sha === c.otaSha && c.otaImage.length === c.otaSize) send(3, 0, c.otaSize);
        else send(4, 6);
      } else if (bytes[0] === 4) {
        c.otaAborted = true;
      }
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
  return { messages, states };
}

test("without a chosen sensor connect waits; chooseSensor picks, remembers and streams", async () => {
  const client = fakeClient();
  const storage = memoryStorage();
  const t = new BleTransport({ loadClient: async () => client, storage });
  const { messages, states } = collect(t);
  await t.connect(); // at app start: no picker
  assert.deepEqual(states, ["closed"]);
  assert.equal(client.calls.length, 0);
  states.length = 0;
  await t.chooseSensor();

  assert.deepEqual(states, ["closed", "connecting", "open"]); // forget() closes first
  assert.deepEqual(client.calls[0], ["initialize", { androidNeverForLocation: true }]);
  assert.deepEqual(client.calls[1], ["requestDevice", { services: [UUID.service] }]);
  assert.equal(storage.data["erkdek.bleDevice"], "AA:BB");
  assert.deepEqual(messages[0], {
    t: "status",
    tared: true,
    calibrated: true,
    rate: 80,
    cpk: 16000,
    uptime: 123456,
    tareNoiseKg: 0.012,
    tareNoisePpKg: 0.041,
    batteryV: null,
    protocol: 1,
    fw: "abc1234",
    mock: false,
  });

  client.notify[UUID.samples](dv(SAMPLES));
  assert.deepEqual(messages.at(-1).kg, [0, 20.25]);
  client.notify[UUID.event](dv(Uint8Array.of(0x01)));
  assert.deepEqual(messages.at(-1), { t: "tared" });
});

test("a remembered sensor connects without the picker; commands are encoded", async () => {
  const client = fakeClient();
  const t = new BleTransport({ loadClient: async () => client, storage: memoryStorage({ "erkdek.bleDevice": "CC:DD" }) });
  await t.connect();
  assert.ok(!client.calls.some((c) => c[0] === "requestDevice"));
  assert.ok(client.calls.some((c) => c[0] === "connect" && c[1] === "CC:DD"));

  assert.equal(t.send({ cmd: "calibrate", kg: 20 }), true);
  assert.equal(t.send({ cmd: "mock", scenario: "idle" }), false); // simulator-only command
  assert.deepEqual(client.writes, [[UUID.command, Uint8Array.of(0x02, 0x00, 0x00, 0xa0, 0x41)]]);
});

test("reconnects after a dropped link and after failed attempts", async () => {
  const client = fakeClient({ failConnect: 1 });
  const t = new BleTransport({ loadClient: async () => client, storage: memoryStorage(), reconnectDelaysMs: [0] });
  const { states } = collect(t);
  await t.connect({ pick: true }); // picks AA:BB, connect fails once
  await tick();
  assert.deepEqual(states, ["connecting", "closed", "connecting", "open"]);

  client.disconnectCb();
  await tick();
  assert.deepEqual(states.slice(4), ["closed", "connecting", "open"]);
  assert.equal(t.send({ cmd: "tare" }), true);
});

test("a cancelled picker waits for the user; forget clears the sensor", async () => {
  const client = fakeClient({ pick: null });
  const storage = memoryStorage();
  const t = new BleTransport({ loadClient: async () => client, storage, reconnectDelaysMs: [0] });
  const { states } = collect(t);
  await t.connect({ pick: true });
  await tick();
  assert.deepEqual(states, ["connecting", "closed"]); // no retry loop
  assert.match(t.error, /cancelled/);
  assert.equal(t.send({ cmd: "tare" }), false);

  const ok = fakeClient();
  const t2 = new BleTransport({ loadClient: async () => ok, storage: memoryStorage({ "erkdek.bleDevice": "AA:BB" }) });
  await t2.connect();
  await t2.forget();
  assert.equal(t2.deviceId, null);
  assert.ok(ok.calls.some((c) => c[0] === "disconnect"));
  assert.equal(t2.state, "closed");
});

const digest = async (bytes) => new Uint8Array(createHash("sha256").update(bytes).digest());

test("firmware update: sends the image in order and waits for the sensor", async () => {
  const client = fakeClient();
  const t = new BleTransport({ loadClient: async () => client, storage: memoryStorage({ "erkdek.bleDevice": "AA:BB" }), digest });
  await t.connect();
  const image = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
  const progress = [];
  await t.updateFirmware(image, { onProgress: (p) => progress.push(p) });
  assert.deepEqual(Uint8Array.from(client.otaImage), image);
  const dataWrites = client.writes.filter(([chr, b]) => chr === UUID.ota && b[0] === 2);
  assert.equal(dataWrites[0][1].length, 247 - 3); // as much as the packet size allows
  assert.equal(progress.at(-1), 1);
});

test("firmware update: readable errors, and cancelling aborts on the sensor", async () => {
  const client = fakeClient();
  client.otaArmed = false;
  const t = new BleTransport({ loadClient: async () => client, storage: memoryStorage({ "erkdek.bleDevice": "AA:BB" }), digest });
  await t.connect();
  await assert.rejects(t.updateFirmware(Uint8Array.of(1, 2, 3)), /BOOT button/);

  client.otaArmed = true;
  const cancel = new AbortController();
  cancel.abort();
  await assert.rejects(t.updateFirmware(Uint8Array.of(1, 2, 3), { signal: cancel.signal }), /cancelled/);
  assert.equal(client.otaAborted, true);
});
