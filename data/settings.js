import { device } from "./device.js";
import { applyDisplay, displayPrefs, setDisplayPrefs } from "./display.js";
import { buildInfo, canChooseSensor, isNativeApp, sensorMode, setSensorMode } from "./platform.js";
import { formatBytes, formatKg } from "./format.js";
import { sessions } from "./sessions.js";
import {
  MAX_BODYWEIGHT_KG,
  MAX_REP_THRESHOLD_KG,
  MIN_BODYWEIGHT_KG,
  MIN_REP_THRESHOLD_KG,
  settings,
} from "./settingsstore.js";
import { grips, holdTypes, initTagManager } from "./tags.js";

const el = {
  bodyweight: document.getElementById("setBodyweight"),
  repThreshold: document.getElementById("setRepThreshold"),
  startOnForce: document.getElementById("setStartOnForce"),
  startPct: document.getElementById("setStartPct"),
  startPctRow: document.getElementById("setStartPctRow"),
  startInfo: document.getElementById("setStartInfo"),
  recordRelease: document.getElementById("setRecordRelease"),
  startMessage: document.getElementById("setStartMessage"),
  save: document.getElementById("setSave"),
  message: document.getElementById("setMessage"),
};

// ---------------------------------------------------------------- Sensor

const sensorEl = {
  info: document.getElementById("sensorInfo"),
  modes: document.querySelectorAll("#sensorMode button"),
  modeGroup: document.getElementById("sensorMode"),
  state: document.getElementById("sensorState"),
  battery: document.getElementById("sensorBattery"),
  choose: document.getElementById("sensorChoose"),
};

const STATE_TEXT = { open: "Connected", connecting: "Connecting…", closed: "Not connected" };

function renderSensor() {
  const native = isNativeApp();
  const mode = sensorMode();
  const t = device.transport;
  sensorEl.modeGroup.hidden = !canChooseSensor();
  for (const b of sensorEl.modes) b.classList.toggle("active", b.dataset.mode === mode);
  sensorEl.info.textContent = !native
    ? "In the browser the app uses a simulated sensor (development)."
    : mode === "ble"
      ? "Connects to your Erkdek over Bluetooth and reconnects automatically."
      : "A simulated sensor, for trying the app without the hardware.";
  const parts = [STATE_TEXT[t.state] ?? t.state];
  if (mode === "ble") {
    parts.push(t.deviceId ? `sensor ${t.deviceId}` : "no sensor chosen yet");
    if (t.error && t.state !== "open") parts.push(t.error);
  }
  sensorEl.state.textContent = parts.join(" · ");
  sensorEl.choose.hidden = mode !== "ble";
  renderBattery();
}

// Shown only when the sensor measures its battery.
function renderBattery() {
  const v = device.connected ? device.status?.batteryV : null;
  sensorEl.battery.hidden = v === null || v === undefined;
  if (!sensorEl.battery.hidden) sensorEl.battery.textContent = `Battery ${v.toFixed(2)} V`;
}

function initSensor() {
  for (const b of sensorEl.modes) {
    b.addEventListener("click", () => {
      if (b.dataset.mode === sensorMode()) return;
      setSensorMode(b.dataset.mode);
      location.reload(); // the sensor connection is set up at start
    });
  }
  sensorEl.choose.addEventListener("click", () => device.transport.chooseSensor());
  device.on("connection", renderSensor);
  device.on("status", renderBattery);
  renderSensor();
}

// ---------------------------------------------------------------- Display

const displayEl = {
  layers: document.querySelectorAll("#displayLayer button"),
  themes: document.querySelectorAll("#displayTheme button"),
  opacity: document.getElementById("displayOpacity"),
  opacityValue: document.getElementById("displayOpacityValue"),
};

function renderDisplay() {
  const p = displayPrefs();
  for (const b of displayEl.layers) b.classList.toggle("active", b.dataset.layer === p.numberLayer);
  for (const b of displayEl.themes) b.classList.toggle("active", b.dataset.theme === p.theme);
  displayEl.opacity.value = Math.round(p.numberOpacity * 100);
  displayEl.opacityValue.textContent = `${Math.round(p.numberOpacity * 100)} %`;
}

function initDisplay() {
  applyDisplay();
  for (const b of displayEl.themes) {
    b.addEventListener("click", () => {
      setDisplayPrefs({ theme: b.dataset.theme });
      renderDisplay();
    });
  }
  for (const b of displayEl.layers) {
    b.addEventListener("click", () => {
      setDisplayPrefs({ numberLayer: b.dataset.layer });
      renderDisplay();
    });
  }
  displayEl.opacity.addEventListener("input", () => {
    setDisplayPrefs({ numberOpacity: Number(displayEl.opacity.value) / 100 });
    renderDisplay();
  });
  renderDisplay();
}

// ---------------------------------------------------------------- About

const about = {
  web: document.getElementById("aboutWeb"),
  fw: document.getElementById("aboutFw"),
  sessions: document.getElementById("aboutSessions"),
  lists: document.getElementById("aboutLists"),
  used: document.getElementById("aboutUsed"),
  quota: document.getElementById("aboutQuota"),
};

// The sensor's firmware, and whether it is the one that belongs to this app (same
// content-based version, tools/fwversion.py).
function renderFirmware(st) {
  const fw = st?.fw;
  const own = buildInfo().firmware;
  let text = fw || "–";
  if (fw && own && !st.mock) text += fw === own ? " (matches this app)" : ` (this app's firmware: ${own})`;
  about.fw.textContent = text;
}

// Refreshes versions and the storage breakdown; called when Settings is shown.
export async function showAbout() {
  renderFirmware(device.status);
  const build = buildInfo();
  about.web.textContent = build.variant === "release" ? build.version : `${build.version} (${build.variant})`;
  try {
    const st = await sessions.storage({ all: true }); // all profiles
    about.sessions.textContent = `${formatBytes(st.sessionsBytes)} (${sessions.all.length})`;
    about.lists.textContent = formatBytes(st.listsBytes);
    // The browser's estimate for the whole app (data plus its own overhead).
    about.used.textContent = st.usedBytes === null ? "–" : formatBytes(st.usedBytes);
    about.quota.textContent = st.quotaBytes === null ? "–" : formatBytes(st.quotaBytes - (st.usedBytes ?? 0));
  } catch {
    for (const key of ["sessions", "lists", "used", "quota"]) about[key].textContent = "–";
  }
}

function showMessage(text, isError = false) {
  el.message.textContent = text;
  el.message.classList.toggle("error-text", isError);
}

export function initSettings() {
  settings.onChange((v) => {
    el.bodyweight.value = v.bodyweightKg > 0 ? v.bodyweightKg : "";
    el.repThreshold.value = v.repThresholdKg;
    el.startOnForce.checked = v.startOnForce;
    el.startPct.value = v.startPct;
    el.recordRelease.checked = v.recordRelease;
    el.startPctRow.hidden = !v.startOnForce;
    el.startInfo.hidden = !v.startOnForce;
    el.startInfo.textContent =
      `Never below the rep threshold (${formatKg(v.repThresholdKg)} kg), which is also the start level without a target. ` +
      `E.g. with a 40 kg target: ${formatKg(Math.max(v.repThresholdKg, (40 * v.startPct) / 100))} kg.`;
  });
  device.on("status", (st) => {
    renderFirmware(st);
  });
  settings.load().catch((e) => showMessage(e.message, true));
  initSensor();
  initDisplay();

  initTagManager(
    document.getElementById("manageHolds"),
    holdTypes,
    "Your holds",
    "Added to the standard holds (edges, pinch, sloper…) when choosing a hold.",
    "e.g. 18 mm edge",
  );
  initTagManager(
    document.getElementById("manageGrips"),
    grips,
    "Your grips",
    "Added to the standard grips (open hand, half crimp…) when choosing a grip.",
    "e.g. Four-finger open",
  );

  // Saved right away (no Save button in this card).
  const saveStart = async (changes) => {
    try {
      await settings.save(changes);
      el.startMessage.textContent = "";
    } catch (e) {
      el.startMessage.textContent = e.message;
      el.startMessage.classList.add("error-text");
      el.startOnForce.checked = settings.values.startOnForce;
      el.startPct.value = settings.values.startPct;
      el.recordRelease.checked = settings.values.recordRelease;
    }
  };
  el.recordRelease.addEventListener("change", () => saveStart({ recordRelease: el.recordRelease.checked }));
  el.startOnForce.addEventListener("change", () => saveStart({ startOnForce: el.startOnForce.checked }));
  el.startPct.addEventListener("change", () => saveStart({ startPct: Number(el.startPct.value) }));

  el.save.addEventListener("click", async () => {
    const text = el.bodyweight.value.trim();
    const bw = text === "" ? 0 : parseFloat(text);
    if (bw !== 0 && !(bw >= MIN_BODYWEIGHT_KG && bw <= MAX_BODYWEIGHT_KG)) {
      showMessage(`Bodyweight must be between ${MIN_BODYWEIGHT_KG} and ${MAX_BODYWEIGHT_KG} kg.`, true);
      return;
    }
    const thr = parseFloat(el.repThreshold.value);
    if (!(thr >= MIN_REP_THRESHOLD_KG && thr <= MAX_REP_THRESHOLD_KG)) {
      showMessage(`Rep threshold must be between ${MIN_REP_THRESHOLD_KG} and ${MAX_REP_THRESHOLD_KG} kg.`, true);
      return;
    }
    try {
      await settings.save({ bodyweightKg: bw, repThresholdKg: thr });
      showMessage("Saved.");
    } catch (e) {
      showMessage(e.message, true);
    }
  });
}
