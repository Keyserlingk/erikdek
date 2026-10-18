import { LiveChart } from "./chart.js";
import { device } from "./device.js";
import { formatKg } from "./format.js";
import { settings } from "./settings.js";

const SAMPLE_RATE_HZ = 80;
const SMOOTHING_TAU_S = 0.15; // time constant for the big number; raw data is used for peaks
const alpha = 1 - Math.exp(-1 / (SAMPLE_RATE_HZ * SMOOTHING_TAU_S));
const WINDOW_KEY = "tindek.chartWindow";

const el = {
  kg: document.getElementById("kg"),
  bw: document.getElementById("bw"),
  peak: document.getElementById("peak"),
  peakKg: document.getElementById("peakKg"),
  peakBw: document.getElementById("peakBw"),
  tare: document.getElementById("tare"),
  resetPeak: document.getElementById("resetPeak"),
  chart: document.getElementById("chart"),
  windows: document.querySelectorAll("#chartWindow button"),
};

const state = { smoothed: null, peak: 0, dirty: true };
let chart;

function percentOfBodyweight(kg) {
  const bw = settings.values.bodyweightKg;
  return bw > 0 ? `${Math.round((Math.max(0, kg) / bw) * 100)} %` : "";
}

function render() {
  if (state.dirty) {
    state.dirty = false;
    const value = device.connected ? state.smoothed : null;
    el.kg.textContent = value !== null ? formatKg(value) : "–";
    el.bw.textContent = value !== null ? `${percentOfBodyweight(value)} of bodyweight` : "";
    el.bw.hidden = !(settings.values.bodyweightKg > 0);
    el.peakKg.textContent = formatKg(state.peak);
    el.peakBw.textContent = settings.values.bodyweightKg > 0 ? `· ${percentOfBodyweight(state.peak)}` : "";
    chart.setPeak(state.peak);
  }
  chart.render();
  requestAnimationFrame(render);
}

function resetPeak() {
  state.peak = 0;
  state.dirty = true;
}

function setWindow(seconds) {
  chart.setWindow(seconds);
  for (const b of el.windows) b.classList.toggle("active", Number(b.dataset.s) === seconds);
  try {
    localStorage.setItem(WINDOW_KEY, String(seconds));
  } catch {
    // storage unavailable: the choice just isn't remembered
  }
}

export function initLive() {
  chart = new LiveChart(el.chart);

  device.on("samples", (msg) => {
    for (const kg of msg.kg) {
      state.smoothed = state.smoothed === null ? kg : state.smoothed + alpha * (kg - state.smoothed);
      if (kg > state.peak) state.peak = kg;
    }
    chart.push(msg.ts, msg.te ?? msg.ts, msg.kg);
    state.dirty = true;
  });
  device.on("connection", () => {
    el.tare.disabled = !device.connected;
    if (!device.connected) state.smoothed = null;
    state.dirty = true;
  });
  // A new calibration changes the scale of everything seen so far.
  device.on("calibrated", () => {
    resetPeak();
    chart.clear();
  });
  settings.onChange(() => {
    state.dirty = true;
  });

  el.tare.addEventListener("click", () => {
    device.send("tare");
    resetPeak();
  });
  el.peak.addEventListener("click", resetPeak);
  el.resetPeak.addEventListener("click", resetPeak);
  for (const b of el.windows) b.addEventListener("click", () => setWindow(Number(b.dataset.s)));

  let saved = 30;
  try {
    saved = Number(localStorage.getItem(WINDOW_KEY)) || 30;
  } catch {
    // keep default
  }
  setWindow(saved);
  requestAnimationFrame(render);
}
