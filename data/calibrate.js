import { device } from "./device.js";
import { SampleWindow, formatKg } from "./format.js";

// Readings count as settled when the last second varies less than this
// (relative to the reading, with a floor for small weights). The sensor refuses a
// calibration whose readings vary more, with the same limits (firmware calibration.h).
const STABLE_WINDOW = 80;
const STABLE_STD_KG = 0.15;
const STABLE_STD_REL = 0.005;

// Noise under load at the last calibration, kept per app (the sensor reports it only once).
const CAL_NOISE_KEY = "erkdek.calNoise";

const el = {
  current: document.getElementById("calCurrent"),
  settingsStatus: document.getElementById("setCalStatus"),
  settingsNoise: document.getElementById("setNoise"),
  steps: document.querySelectorAll("#view-calibrate .step"),
  tare: document.getElementById("calTare"),
  weight: document.getElementById("calWeight"),
  reading: document.getElementById("calReading"),
  stability: document.getElementById("calStability"),
  measure: document.getElementById("calMeasure"),
  error: document.getElementById("calError"),
  result: document.getElementById("calResult"),
  done: document.getElementById("calDone"),
  restart: document.getElementById("calRestart"),
  reset: document.getElementById("calReset"),
};

const ERRORS = {
  tooSmall: () => "The weight barely changed the reading. Check that the weight is hanging freely and the load cell is wired correctly.",
  badWeight: () => "Enter the weight in kg, larger than 0.",
  moving: (noiseKg) =>
    `The weight was moving (the reading varied ±${grams(noiseKg)}). Let it hang still until it shows Stable, then measure again.`,
};

const grams = (kg) => (kg === null || kg === undefined ? "–" : kg < 1 ? `${Math.round(kg * 1000)} g` : `${formatKg(kg, 2)} kg`);

function loadCalNoise() {
  try {
    return JSON.parse(localStorage.getItem(CAL_NOISE_KEY));
  } catch {
    return null;
  }
}

function saveCalNoise(value) {
  try {
    localStorage.setItem(CAL_NOISE_KEY, JSON.stringify(value));
  } catch {
    // not remembered
  }
}

// Settings: the sensor's noise at the last tare (from the status) and under load at the
// last calibration.
function renderNoise() {
  const st = device.status;
  const lines = [];
  if (st?.tareNoiseKg !== null && st?.tareNoiseKg !== undefined) {
    const approx = st.calibrated ? "" : " (approximate until calibrated)";
    lines.push(`Noise at the last tare: ±${grams(st.tareNoiseKg)} rms, ${grams(st.tareNoisePpKg)} peak to peak${approx}.`);
  }
  const cal = loadCalNoise();
  if (cal) lines.push(`Noise under load at the last calibration (${cal.kg} kg): ±${grams(cal.noiseKg)} rms.`);
  el.settingsNoise.textContent = lines.join(" ");
  el.settingsNoise.hidden = !lines.length;
}

const window_ = new SampleWindow(STABLE_WINDOW);
let step = "tare"; // tare -> taring -> weight -> measuring -> done
let measuredKg = 0;

function setStep(next) {
  step = next;
  const visible = { tare: "tare", taring: "tare", weight: "weight", measuring: "weight", done: "done" }[step];
  for (const s of el.steps) s.hidden = s.dataset.step !== visible;
  el.tare.disabled = step === "taring" || !device.connected;
  el.tare.textContent = step === "taring" ? "Taring…" : "Tare";
  el.measure.textContent = step === "measuring" ? "Measuring…" : "Measure";
  updateMeasureButton();
}

function isStable() {
  if (!window_.full) return false;
  const limit = Math.max(STABLE_STD_KG, Math.abs(window_.mean()) * STABLE_STD_REL);
  return window_.stdDev() < limit;
}

function updateMeasureButton() {
  const kg = parseFloat(el.weight.value);
  el.measure.disabled = step !== "weight" || !device.connected || !(kg > 0);
}

function renderCurrent() {
  const st = device.status;
  if (!st) {
    el.current.textContent = "Not connected.";
  } else if (st.calibrated) {
    el.current.textContent = `Calibrated (${Math.abs(st.cpk).toFixed(0)} counts/kg).`;
  } else {
    el.current.textContent = "Not calibrated – using a rough default factor.";
  }
  el.reset.hidden = !st || !st.calibrated;
  el.settingsStatus.textContent = el.current.textContent;
  renderNoise();
}

function showError(text) {
  el.error.textContent = text;
  el.error.hidden = !text;
}

export function initCalibrate() {
  device.on("samples", (msg) => {
    window_.push(msg.kg);
    if (step === "weight" || step === "measuring") {
      el.reading.textContent = formatKg(window_.mean(), 2);
      const stable = isStable();
      el.stability.textContent = stable ? "Stable" : "Settling…";
      el.stability.dataset.stable = stable;
    }
  });
  device.on("status", renderCurrent);
  device.on("connection", () => {
    renderCurrent();
    if (!device.connected && step !== "done") setStep("tare");
    else setStep(step);
  });
  device.on("tared", () => {
    if (step !== "taring") return;
    window_.clear();
    setStep("weight");
  });
  device.on("calibrated", (msg) => {
    if (step === "measuring") {
      const noise = msg.noiseKg !== null && msg.noiseKg !== undefined ? ` Noise under load: ±${grams(msg.noiseKg)} rms.` : "";
      el.result.textContent = `${formatKg(measuredKg, 2)} kg now reads correctly (${Math.abs(msg.cpk).toFixed(0)} counts/kg). Saved on the sensor.${noise}`;
      if (msg.noiseKg !== null && msg.noiseKg !== undefined) saveCalNoise({ kg: measuredKg, noiseKg: msg.noiseKg });
      setStep("done");
    }
    if (!msg.calibrated) saveCalNoise(null); // reset: that calibration is gone
    device.status = { ...device.status, calibrated: msg.calibrated, cpk: msg.cpk };
    renderCurrent();
  });
  device.on("calError", (msg) => {
    if (step !== "measuring") return;
    showError(ERRORS[msg.reason]?.(msg.noiseKg) || `Calibration failed (${msg.reason}).`);
    setStep("weight");
  });

  el.tare.addEventListener("click", () => {
    showError("");
    if (device.send("tare")) setStep("taring");
  });
  el.weight.addEventListener("input", updateMeasureButton);
  el.measure.addEventListener("click", () => {
    showError("");
    measuredKg = parseFloat(el.weight.value);
    if (device.send("calibrate", { kg: measuredKg })) setStep("measuring");
  });
  el.done.addEventListener("click", () => {
    setStep("tare");
    location.hash = "#settings";
  });
  el.restart.addEventListener("click", () => setStep("tare"));
  el.reset.addEventListener("click", () => {
    if (confirm("Discard the calibration and go back to the default factor?")) device.send("calReset");
  });

  setStep("tare");
  renderCurrent();
}
