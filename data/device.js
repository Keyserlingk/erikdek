import { SimulatedTransport } from "./simdevice.js";

// Transports connect the app to a sensor. Interface:
//   connect()             start connecting (and reconnect when the link drops)
//   send(obj)             send a command ({cmd: "tare"} ...); false when not connected
//   "state" event         detail: "connecting" | "open" | "closed"
//   "message" event       detail: message from the sensor ({t: "samples"|"status"|...})
// In the browser the simulated sensor is used; the Android app will use Bluetooth.
function createTransport() {
  return new SimulatedTransport();
}

// The connected device as seen by the views. Re-dispatches every device message as an
// event named after its "t" field (samples, status, tared, calibrated, calError, ...),
// plus "connection" when the link goes up or down.
class Device extends EventTarget {
  constructor(transport) {
    super();
    this.transport = transport;
    this.connected = false;
    this.status = null;

    transport.addEventListener("state", (ev) => {
      const connected = ev.detail === "open";
      if (!connected) this.status = null;
      this.connected = connected;
      this.dispatchEvent(new CustomEvent("connection", { detail: ev.detail }));
    });
    transport.addEventListener("message", (ev) => {
      const msg = ev.detail;
      if (msg.t === "status") this.status = msg;
      this.dispatchEvent(new CustomEvent(msg.t, { detail: msg }));
    });
  }

  connect() {
    this.transport.connect();
  }

  send(cmd, args = {}) {
    return this.transport.send({ cmd, ...args });
  }

  on(type, handler) {
    this.addEventListener(type, (ev) => handler(ev.detail));
  }
}

export const device = new Device(createTransport());
