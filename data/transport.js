// Connection to the device. The rest of the app only uses this interface
// (events + send), so a Bluetooth transport can be dropped in later.
//
// Events:
//   "state"   detail: "connecting" | "open" | "closed"
//   "message" detail: parsed JSON message from the device

export class WebSocketTransport extends EventTarget {
  constructor(url) {
    super();
    this.url = url;
    this.ws = null;
    this.retryMs = 1000;
    this.state = "closed";
  }

  connect() {
    this._setState("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.retryMs = 1000;
      this._setState("open");
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.dispatchEvent(new CustomEvent("message", { detail: msg }));
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this._setState("closed");
      setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 5000);
    };
    ws.onerror = () => ws.close();
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  _setState(state) {
    this.state = state;
    this.dispatchEvent(new CustomEvent("state", { detail: state }));
  }
}
