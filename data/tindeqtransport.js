// Tindeq Progressor as the sensor (Bluetooth LE, tindeqprotocol.js). Same interface as
// BleTransport, whose picker, remembered sensor and reconnecting it reuses.
//
// The Progressor streams weight only after a start command and stops at any other
// command, so tare and the battery query restart the measurement right after. It has no
// status of its own: one is put together about once a second (rate from the sample
// timestamps; it is factory calibrated and can't be calibrated or updated from here).

import { PROTOCOL_VERSION } from "./bleprotocol.js";
import { BleTransport } from "./bletransport.js";
import { TINDEQ_CMD, TINDEQ_UUID, decodeTindeq, replyText, replyU32 } from "./tindeqprotocol.js";

const DEVICE_KEY = "erkdek.tindeqDevice";
const REPLY_TIMEOUT_MS = 1000;
const STATUS_EVERY_MS = 1000; // of sample time
// The battery query pauses the measurement for ~0.1 s: only now and then, and only
// while nothing pulls on the sensor.
const BATTERY_EVERY_MS = 10 * 60 * 1000;
const IDLE_KG = 1;

export class TindeqTransport extends BleTransport {
  constructor(options = {}) {
    super({ deviceKey: DEVICE_KEY, service: TINDEQ_UUID.service, ...options });
    this.firmware = null;
    this.batteryV = null;
    this.lowBattery = false;
    this.reply = null; // resolves the query waiting for its reply
    this.queue = Promise.resolve(); // commands one after the other
  }

  async setUp(client) {
    const id = this.deviceId;
    await client.requestConnectionPriority?.(id, 1).catch(() => {}); // 1 = high: short interval
    this.resetTime();
    await client.startNotifications(id, TINDEQ_UUID.service, TINDEQ_UUID.data, (v) => this.onData(v));
    // Version and battery before measuring (each would stop the measurement).
    this.queue = Promise.resolve();
    this.firmware = await this.command(TINDEQ_CMD.version, { reply: true }).then(replyText, () => null);
    await this.queryBattery(false);
    await this.command(TINDEQ_CMD.start);
    this.emitStatus();
  }

  resetTime() {
    this.lastUs = null; // device timestamp of the last sample (resets at each start)
    this.lastMs = null; // its time in ms on our own, continuous timeline
    this.base = 0; // ms to add to the device's time in the current measurement
    this.periodMs = 1000 / 80; // until measured
    this.count = 0; // samples and their span, over all measurements, for the rate
    this.spanMs = 0;
    this.statusAt = 0;
    this.batteryAt = 0;
    this.lastLoadAt = -Infinity;
  }

  // Writes a command; with reply: waits for the reply (the device answers one at a time).
  command(code, { reply = false } = {}) {
    const run = async () => {
      let timer;
      const replied = reply
        ? new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error("The Progressor didn't answer.")), REPLY_TIMEOUT_MS);
            this.reply = resolve;
          })
        : null;
      try {
        await this.client.write(this.deviceId, TINDEQ_UUID.service, TINDEQ_UUID.control, new DataView(Uint8Array.of(code).buffer));
        return await replied;
      } finally {
        clearTimeout(timer);
        this.reply = null;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async queryBattery(restart) {
    const mv = await this.command(TINDEQ_CMD.battery, { reply: true }).then(replyU32, () => null);
    if (mv) this.batteryV = mv / 1000;
    if (restart) await this.command(TINDEQ_CMD.start);
  }

  onData(v) {
    const msg = decodeTindeq(v);
    if (!msg) return;
    if (msg.t === "reply") {
      this.reply?.(msg.bytes.slice());
    } else if (msg.t === "lowBattery") {
      this.lowBattery = true;
    } else if (msg.kg.length) {
      this.onWeight(msg);
    }
  }

  // Device timestamps (µs since the last start) -> one continuous ms timeline: a restart
  // (timestamps going back) continues one sample period after the last sample.
  onWeight({ kg, us }) {
    const ms = us.map((t) => {
      if (this.lastUs !== null && t <= this.lastUs) this.base = this.lastMs + this.periodMs - t / 1000;
      else if (this.lastUs !== null) {
        this.count++;
        this.spanMs += (t - this.lastUs) / 1000;
      }
      this.lastUs = t;
      this.lastMs = this.base + t / 1000;
      return Math.round(this.lastMs);
    });
    if (this.spanMs > 0) this.periodMs = this.spanMs / this.count;
    const rounded = kg.map((k) => Math.round(k * 1000) / 1000);
    this.emit({ t: "samples", ts: ms[0], te: ms.at(-1), kg: rounded });

    const now = this.lastMs;
    if (rounded.some((k) => Math.abs(k) >= IDLE_KG)) this.lastLoadAt = now;
    if (now - this.statusAt >= STATUS_EVERY_MS) {
      this.statusAt = now;
      this.emitStatus();
    }
    if (now - this.batteryAt >= BATTERY_EVERY_MS && now - this.lastLoadAt > 5000) {
      this.batteryAt = now;
      this.queryBattery(true).catch(() => {});
    }
  }

  emitStatus() {
    this.emit({
      t: "status",
      tared: true, // the Progressor keeps its zero; tare from the app when needed
      calibrated: true, // factory calibrated
      rate: this.spanMs > 0 ? Math.round(10000 / this.periodMs) / 10 : 0,
      cpk: null,
      uptime: Math.round(this.lastMs ?? 0),
      tareNoiseKg: null,
      tareNoisePpKg: null,
      batteryV: this.batteryV,
      lowBattery: this.lowBattery,
      protocol: PROTOCOL_VERSION, // no Erkdek firmware to match
      fw: this.firmware,
      mock: false,
      device: "tindeq",
    });
  }

  // Only tare: calibration, firmware and the simulator's commands don't apply.
  send(msg) {
    if (this.state !== "open" || msg.cmd !== "tare") return false;
    this.command(TINDEQ_CMD.tare)
      .then(() => this.command(TINDEQ_CMD.start))
      .then(() => this.emit({ t: "tared" }))
      .catch((err) => {
        this.error = err?.message || String(err);
      });
    return true;
  }

  async forget() {
    if (this.state === "open") await this.command(TINDEQ_CMD.stop).catch(() => {});
    return super.forget();
  }

  async updateFirmware() {
    throw new Error("The Tindeq Progressor's firmware can't be updated from this app.");
  }
}
