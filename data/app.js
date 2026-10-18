import { initCalibrate } from "./calibrate.js";
import { device } from "./device.js";
import { initLive } from "./live.js";
import { initMock } from "./mock.js";
import { initSettings } from "./settings.js";

const LOW_RATE_HZ = 60; // below this the HX711 RATE pin is probably still at 10 Hz
const VIEWS = ["live", "calibrate", "settings"];

const el = {
  rate: document.getElementById("rate"),
  conn: document.getElementById("conn"),
  warning: document.getElementById("warning"),
  tabs: document.querySelectorAll(".tabs a"),
};

function showView() {
  const name = location.hash.slice(1);
  const view = VIEWS.includes(name) ? name : "live";
  for (const v of VIEWS) document.getElementById(`view-${v}`).hidden = v !== view;
  for (const t of el.tabs) t.classList.toggle("active", t.getAttribute("href") === `#${view}`);
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
  el.warning.hidden = warnings.length === 0;
  el.warning.textContent = warnings.join(" ");
}

device.on("connection", (state) => {
  el.conn.dataset.state = state;
  renderStatus();
});
device.on("status", renderStatus);

initLive();
initCalibrate();
initMock();
initSettings();

window.addEventListener("hashchange", showView);
showView();
device.connect();
