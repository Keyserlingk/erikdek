import { WebSocketTransport } from "./transport.js";

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

export const device = new Device(new WebSocketTransport(`ws://${location.host}/ws`));
