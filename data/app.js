import { isMuted, setMuted } from "./audio.js";
import { initBackup } from "./backup.js";
import { initCalibrate } from "./calibrate.js";
import { device } from "./device.js";
import { initHistory, showHistory } from "./history.js";
import { initLive } from "./live.js";
import { initMock } from "./mock.js";
import { initSettings, showAbout } from "./settings.js";
import { goHome, initTrain } from "./train.js";

const LOW_RATE_HZ = 60; // below this the HX711 RATE pin is probably still at 10 Hz
const VIEWS = ["live", "train", "tests", "history", "calibrate", "settings"];
// Views without their own tab highlight this tab instead.
const TAB_OF = { calibrate: "settings" };

const el = {
  rate: document.getElementById("rate"),
  mute: document.getElementById("mute"),
  conn: document.getElementById("conn"),
  warning: document.getElementById("warning"),
  tabs: document.querySelectorAll(".tabs a"),
};

function showView() {
  const name = location.hash.slice(1);
  const view = VIEWS.includes(name) ? name : "live";
  for (const v of VIEWS) document.getElementById(`view-${v}`).hidden = v !== view;
  const tab = TAB_OF[view] || view;
  for (const t of el.tabs) t.classList.toggle("active", t.getAttribute("href") === `#${tab}`);
  if (view === "history") showHistory();
  if (view === "settings") showAbout();
  renderStatus();
}

// Sensor warnings (calibration, tare, sample rate) only where the sensor is used: Live,
// Tests, Calibrate, and a running routine with the sensor.
const SENSOR_VIEWS = ["live", "tests", "calibrate"];

function sensorInUse() {
  const view = location.hash.slice(1) || "live";
  if (SENSOR_VIEWS.includes(view)) return true;
  const run = document.getElementById("trainRun");
  return view === "train" && !run.hidden && run.dataset.sensor === "true";
}

function renderStatus() {
  const st = device.status;
  if (!st) {
    el.rate.textContent = "– Hz";
    el.rate.classList.remove("low");
    el.warning.hidden = true;
    return;
  }
  const lowRate = st.rate > 0 && st.rate < LOW_RATE_HZ;
  el.rate.textContent = `${st.rate.toFixed(1)} Hz`;
  el.rate.classList.toggle("low", lowRate);

  const warnings = [];
  if (lowRate) warnings.push(`Sample rate is ${st.rate.toFixed(0)} Hz. Bridge the HX711 RATE pin to VCC for 80 Hz.`);
  if (!st.calibrated) warnings.push("Not calibrated – readings are approximate.");
  if (!st.tared) warnings.push("Not tared – press Tare with no load.");
  el.warning.hidden = warnings.length === 0 || !sensorInUse();
  el.warning.textContent = warnings.join(" ");
  if (!st.calibrated && location.hash !== "#calibrate") {
    el.warning.append(" ", Object.assign(document.createElement("a"), { href: "#calibrate", textContent: "Calibrate now" }));
  }
}

device.on("connection", (state) => {
  el.conn.dataset.state = state;
  renderStatus();
});
device.on("status", renderStatus);

function renderMute() {
  el.mute.setAttribute("aria-pressed", String(isMuted()));
  el.mute.setAttribute("aria-label", isMuted() ? "Unmute beeps" : "Mute beeps");
  el.mute.title = isMuted() ? "Beeps off" : "Beeps on";
}
el.mute.addEventListener("click", () => {
  setMuted(!isMuted());
  renderMute();
});
renderMute();

initLive();
initCalibrate();
initMock();
initSettings();
initTrain();
initHistory();
initBackup();

// Tapping the tab you're already on goes back to that tab's main screen.
const REHOME = {
  "#train": () => goHome("train"),
  "#tests": () => goHome("tests"),
  "#history": () => {
    showHistory();
    window.scrollTo(0, 0);
  },
  "#live": () => window.scrollTo(0, 0),
  "#settings": () => window.scrollTo(0, 0),
};
for (const t of el.tabs) {
  t.addEventListener("click", (ev) => {
    const href = t.getAttribute("href");
    if (href !== location.hash) return; // normal navigation via hashchange
    ev.preventDefault();
    REHOME[href]?.();
  });
}

window.addEventListener("hashchange", showView);
showView();
device.connect();
