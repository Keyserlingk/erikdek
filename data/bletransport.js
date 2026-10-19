// Bluetooth LE transport for the Android app (Capacitor @capacitor-community/bluetooth-le).
// Same interface as the simulated sensor ("state"/"message" events, connect(), send()).
//
// Connecting needs a chosen sensor: chooseSensor() shows Android's device picker
// (filtered to the Erkdek service). The chosen sensor is remembered, connected at start
// and reconnected automatically when the link drops. Without one, connect() waits.
// The BLE client is injected so tests can drive this with a fake.

import { UUID, decodeEvent, decodeSamples, decodeStatus, encodeCommand } from "./bleprotocol.js";

const DEVICE_KEY = "erkdek.bleDevice";
const RECONNECT_DELAYS_MS = [1000, 2000, 5000];

async function loadBleClient() {
  const { BleClient } = await import("./vendor/capacitor/bluetooth-le/index.js");
  return BleClient;
}

const browserStorage = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      // not remembered
    }
  },
};

export class BleTransport extends EventTarget {
  constructor({ loadClient = loadBleClient, storage = browserStorage, reconnectDelaysMs = RECONNECT_DELAYS_MS } = {}) {
    super();
    this.loadClient = loadClient;
    this.storage = storage;
    this.reconnectDelaysMs = reconnectDelaysMs;
    this.client = null;
    this.state = "closed";
    this.deviceId = storage.get(DEVICE_KEY);
    this.firmware = null;
    this.error = null; // last problem, shown under Settings → Sensor
    this.attempt = 0;
    this.wanted = false; // keep (re)connecting
    this.timer = null;
  }

  // pick: show the device picker when no sensor is chosen yet (only on the user's request).
  async connect({ pick = false } = {}) {
    this.wanted = true;
    clearTimeout(this.timer);
    if (this.state === "connecting" || this.state === "open") return;
    if (!this.deviceId && !pick) {
      this.error = null;
      this.setState("closed"); // no sensor chosen yet: wait for chooseSensor()
      return;
    }
    this.setState("connecting");
    try {
      const client = await this.ensureClient();
      if (!this.deviceId) {
        const device = await client.requestDevice({ services: [UUID.service] });
        this.deviceId = device.deviceId;
        this.storage.set(DEVICE_KEY, this.deviceId);
      }
      await client.connect(this.deviceId, () => this.onDisconnect());
      await this.setUp(client);
      this.attempt = 0;
      this.error = null;
      this.setState("open");
    } catch (err) {
      this.error = err?.message || String(err);
      this.setState("closed");
      // Without a chosen sensor (e.g. the picker was cancelled) wait for the user.
      if (this.deviceId) this.scheduleReconnect();
    }
  }

  async ensureClient() {
    if (!this.client) {
      this.client = await this.loadClient();
      // Android 12+: scan without location permission (see AndroidManifest.xml).
      await this.client.initialize({ androidNeverForLocation: true });
    }
    if (this.client.isEnabled && !(await this.client.isEnabled())) {
      await this.client.requestEnable?.();
    }
    return this.client;
  }

  async setUp(client) {
    const id = this.deviceId;
    await client.requestConnectionPriority?.(id, 1).catch(() => {}); // 1 = high: short interval
    try {
      const fw = await client.read(id, UUID.deviceInfo, UUID.firmware);
      this.firmware = new TextDecoder().decode(fw);
    } catch {
      this.firmware = null;
    }
    this.emitStatus(await client.read(id, UUID.service, UUID.status));
    await client.startNotifications(id, UUID.service, UUID.samples, (v) => this.emit(decodeSamples(v)));
    await client.startNotifications(id, UUID.service, UUID.status, (v) => this.emitStatus(v));
    await client.startNotifications(id, UUID.service, UUID.event, (v) => {
      const ev = decodeEvent(v);
      if (ev) this.emit(ev);
    });
  }

  onDisconnect() {
    this.setState("closed");
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (!this.wanted || !this.deviceId) return;
    const delay = this.reconnectDelaysMs[Math.min(this.attempt, this.reconnectDelaysMs.length - 1)];
    this.attempt++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  // Forgets the sensor (if any) and shows the picker.
  async chooseSensor() {
    await this.forget();
    return this.connect({ pick: true });
  }

  async forget() {
    this.wanted = false;
    clearTimeout(this.timer);
    const id = this.deviceId;
    this.deviceId = null;
    this.storage.set(DEVICE_KEY, null);
    if (id && this.client) await this.client.disconnect(id).catch(() => {});
    this.setState("closed");
  }

  send(msg) {
    if (this.state !== "open") return false;
    const bytes = encodeCommand(msg);
    if (!bytes) return false;
    this.client.write(this.deviceId, UUID.service, UUID.command, new DataView(bytes.buffer)).catch((err) => {
      this.error = err?.message || String(err);
    });
    return true;
  }

  emitStatus(view) {
    this.emit({ ...decodeStatus(view), fw: this.firmware, mock: false });
  }

  emit(msg) {
    this.dispatchEvent(new CustomEvent("message", { detail: msg }));
  }

  setState(state) {
    this.state = state;
    this.dispatchEvent(new CustomEvent("state", { detail: state }));
  }
}
