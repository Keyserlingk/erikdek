import { WebSocketTransport } from "./transport.js";

const SAMPLE_RATE_HZ = 80;
const SMOOTHING_TAU_S = 0.15; // time constant for the big number; raw data is used for peaks
const LOW_RATE_HZ = 60; // below this the HX711 RATE pin is probably still at 10 Hz

const el = {
  kg: document.getElementById("kg"),
  peak: document.getElementById("peak"),
  peakKg: document.getElementById("peakKg"),
  tare: document.getElementById("tare"),
  rate: document.getElementById("rate"),
  conn: document.getElementById("conn"),
  mock: document.getElementById("mock"),
  warning: document.getElementById("warning"),
};

const state = {
  smoothed: null,
  peak: 0,
  status: null,
  connected: false,
  dirty: true,
};

const alpha = 1 - Math.exp(-1 / (SAMPLE_RATE_HZ * SMOOTHING_TAU_S));

function onSamples(msg) {
  for (const kg of msg.kg) {
    state.smoothed = state.smoothed === null ? kg : state.smoothed + alpha * (kg - state.smoothed);
    if (kg > state.peak) state.peak = kg;
  }
  state.dirty = true;
}

function onStatus(msg) {
  state.status = msg;
  el.mock.hidden = !msg.mock;
  el.rate.textContent = `${msg.rate.toFixed(1)} Hz`;
  el.rate.classList.toggle("low", msg.rate > 0 && msg.rate < LOW_RATE_HZ);

  const warnings = [];
  if (msg.rate > 0 && msg.rate < LOW_RATE_HZ) {
    warnings.push(`Sample rate is ${msg.rate.toFixed(0)} Hz. Bridge the HX711 RATE pin to VCC for 80 Hz.`);
  }
  if (!msg.calibrated) warnings.push("Not calibrated – readings are not in kg yet.");
  if (!msg.tared) warnings.push("Not tared – press Tare with no load.");
  el.warning.hidden = warnings.length === 0;
  el.warning.textContent = warnings.join(" ");
}

function formatKg(kg) {
  const s = kg.toFixed(1);
  return s === "-0.0" ? "0.0" : s;
}

function render() {
  if (state.dirty) {
    state.dirty = false;
    el.kg.textContent = state.connected && state.smoothed !== null ? formatKg(state.smoothed) : "–";
    el.peakKg.textContent = formatKg(state.peak);
  }
  requestAnimationFrame(render);
}

function resetPeak() {
  state.peak = 0;
  state.dirty = true;
}

const transport = new WebSocketTransport(`ws://${location.host}/ws`);

transport.addEventListener("state", (ev) => {
  el.conn.dataset.state = ev.detail;
  state.connected = ev.detail === "open";
  el.tare.disabled = !state.connected;
  if (!state.connected) {
    state.smoothed = null;
    el.rate.textContent = "– Hz";
  }
  state.dirty = true;
});

transport.addEventListener("message", (ev) => {
  const msg = ev.detail;
  if (msg.t === "samples") onSamples(msg);
  else if (msg.t === "status") onStatus(msg);
});

el.tare.addEventListener("click", () => {
  transport.send({ cmd: "tare" });
  resetPeak();
});
el.peak.addEventListener("click", resetPeak);

transport.connect();
requestAnimationFrame(render);
