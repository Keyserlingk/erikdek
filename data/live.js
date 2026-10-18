import { device } from "./device.js";
import { formatKg } from "./format.js";

const SAMPLE_RATE_HZ = 80;
const SMOOTHING_TAU_S = 0.15; // time constant for the big number; raw data is used for peaks
const alpha = 1 - Math.exp(-1 / (SAMPLE_RATE_HZ * SMOOTHING_TAU_S));

const el = {
  kg: document.getElementById("kg"),
  peak: document.getElementById("peak"),
  peakKg: document.getElementById("peakKg"),
  tare: document.getElementById("tare"),
};

const state = { smoothed: null, peak: 0, dirty: true };

function render() {
  if (state.dirty) {
    state.dirty = false;
    el.kg.textContent = device.connected && state.smoothed !== null ? formatKg(state.smoothed) : "–";
    el.peakKg.textContent = formatKg(state.peak);
  }
  requestAnimationFrame(render);
}

function resetPeak() {
  state.peak = 0;
  state.dirty = true;
}

export function initLive() {
  device.on("samples", (msg) => {
    for (const kg of msg.kg) {
      state.smoothed = state.smoothed === null ? kg : state.smoothed + alpha * (kg - state.smoothed);
      if (kg > state.peak) state.peak = kg;
    }
    state.dirty = true;
  });
  device.on("connection", () => {
    el.tare.disabled = !device.connected;
    if (!device.connected) state.smoothed = null;
    state.dirty = true;
  });
  // A new calibration changes the scale of everything seen so far.
  device.on("calibrated", resetPeak);

  el.tare.addEventListener("click", () => {
    device.send("tare");
    resetPeak();
  });
  el.peak.addEventListener("click", resetPeak);
  requestAnimationFrame(render);
}
