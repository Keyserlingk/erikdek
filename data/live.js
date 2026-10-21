import { LiveChart } from "./chart.js";
import { device } from "./device.js";
import { formatKg } from "./format.js";
import { settings } from "./settingsstore.js";
import { targetStatus } from "./workout.js";

const SAMPLE_RATE_HZ = 80;
const SMOOTHING_TAU_S = 0.15; // time constant for the big number; raw data is used for peaks
const alpha = 1 - Math.exp(-1 / (SAMPLE_RATE_HZ * SMOOTHING_TAU_S));
const WINDOW_KEY = "erkdek.chartWindow";
const TARGET_KEY = "erkdek.liveTarget";
const MIN_TARGET_KG = 0.5;

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
  connect: document.getElementById("liveConnect"),
  connectText: document.getElementById("liveConnectText"),
  connectButton: document.getElementById("liveConnectButton"),
  targetHint: document.getElementById("targetHint"),
  targetInfo: document.getElementById("targetInfo"),
  targetKg: document.getElementById("targetKg"),
  removeTarget: document.getElementById("removeTarget"),
  chartKg: document.getElementById("chartKg"),
  chartSub: document.getElementById("chartSub"),
};

const state = { smoothed: null, peak: 0, target: null, dirty: true };
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
    el.kg.dataset.status = value !== null ? (targetStatus(value, state.target) ?? "") : "";
    // The same number behind the graph (when that layout is on, see display.js).
    el.chartKg.textContent = el.kg.textContent;
    el.chartKg.dataset.status = el.kg.dataset.status;
    const bw = settings.values.bodyweightKg > 0 && value !== null ? `${percentOfBodyweight(value)} BW · ` : "";
    el.chartSub.textContent = `${bw}Peak ${formatKg(state.peak)} kg`;
    el.bw.textContent = value !== null ? `${percentOfBodyweight(value)} of bodyweight` : "";
    el.bw.hidden = !(settings.values.bodyweightKg > 0);
    el.peakKg.textContent = formatKg(state.peak);
    el.peakBw.textContent = settings.values.bodyweightKg > 0 ? `· ${percentOfBodyweight(state.peak)}` : "";
    chart.setPeak(state.peak);
  }
  chart.render();
  requestAnimationFrame(render);
}

// Per-browser convenience: the live target is remembered across reloads.
function setTarget(kg) {
  state.target = kg;
  chart.setTarget(kg);
  el.targetHint.hidden = kg !== null;
  el.targetInfo.hidden = kg === null;
  if (kg !== null) el.targetKg.textContent = formatKg(kg);
  state.dirty = true;
  try {
    if (kg === null) localStorage.removeItem(TARGET_KEY);
    else localStorage.setItem(TARGET_KEY, String(kg));
  } catch {
    // storage unavailable: the target just isn't remembered
  }
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

// Bluetooth only: a way to choose the sensor (no picker pops up on its own), and a
// note while a remembered sensor is out of reach.
function renderConnect() {
  const t = device.transport;
  const bluetooth = typeof t.chooseSensor === "function";
  el.connect.hidden = !bluetooth || device.connected;
  if (el.connect.hidden) return;
  el.connectText.textContent = t.deviceId
    ? "Looking for your sensor… make sure it's switched on and nearby."
    : "No sensor connected yet. Switch on your Erkdek and connect it.";
  el.connectButton.textContent = t.deviceId ? "Choose another sensor" : "Connect sensor";
  el.connectButton.disabled = t.state === "connecting";
}

export function initLive() {
  device.on("connection", renderConnect);
  el.connectButton.addEventListener("click", () => device.transport.chooseSensor());
  renderConnect();
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
  chart.onTap((kg) => {
    const rounded = Math.round(kg * 2) / 2;
    if (rounded >= MIN_TARGET_KG) setTarget(rounded);
  });
  el.removeTarget.addEventListener("click", () => setTarget(null));

  let savedTarget = null;
  try {
    savedTarget = Number(localStorage.getItem(TARGET_KEY)) || null;
  } catch {
    // keep none
  }
  setTarget(savedTarget);

  let saved = 30;
  try {
    saved = Number(localStorage.getItem(WINDOW_KEY)) || 30;
  } catch {
    // keep default
  }
  setWindow(saved);
  requestAnimationFrame(render);
}
