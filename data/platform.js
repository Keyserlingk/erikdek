// Where the app runs (inside the Android app or in a browser) and what kind of build it is.

export function isNativeApp() {
  return globalThis.Capacitor?.isNativePlatform?.() === true;
}

// From buildinfo.js (written by tools/build_android.sh, served by tools/serve.py).
// firmware: the version of the firmware that belongs to this app (tools/fwversion.py).
export function buildInfo() {
  return { version: "–", variant: "dev", firmware: null, ...(globalThis.ERKDEK_BUILD ?? {}) };
}

// The sensors to choose from under Settings → Sensor: Erkdek or a Tindeq Progressor
// (both Bluetooth); the debug app also offers the simulated sensor. The browser has
// only the simulated one.
export function sensorModes() {
  if (!isNativeApp()) return ["sim"];
  return buildInfo().variant === "release" ? ["ble", "tindeq"] : ["sim", "ble", "tindeq"];
}

export function canChooseSensor() {
  return sensorModes().length > 1;
}

const SENSOR_MODE_KEY = "erkdek.sensorMode";

// "ble" (Erkdek), "tindeq" or "sim". Until one is chosen: the release app uses Erkdek,
// the debug app the simulated sensor.
export function sensorMode() {
  const modes = sensorModes();
  try {
    const chosen = localStorage.getItem(SENSOR_MODE_KEY);
    if (modes.includes(chosen)) return chosen;
  } catch {
    // storage unavailable: the default
  }
  return modes.includes("sim") ? "sim" : "ble";
}

export function setSensorMode(mode) {
  try {
    localStorage.setItem(SENSOR_MODE_KEY, mode);
  } catch {
    // not remembered
  }
}
