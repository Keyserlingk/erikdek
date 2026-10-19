// Where the app runs (inside the Android app or in a browser) and what kind of build it is.

export function isNativeApp() {
  return globalThis.Capacitor?.isNativePlatform?.() === true;
}

// From buildinfo.js (written by tools/build_android.sh, served by tools/serve.py).
export function buildInfo() {
  return { version: "–", variant: "dev", ...(globalThis.ERKDEK_BUILD ?? {}) };
}

// Only the debug app offers the simulated sensor; release builds always use Bluetooth.
export function canChooseSensor() {
  return isNativeApp() && buildInfo().variant !== "release";
}

const SENSOR_MODE_KEY = "erkdek.sensorMode";

// "ble" or "sim". The browser always uses the simulated sensor, the release app always
// Bluetooth; the debug app starts simulated until Bluetooth is chosen under Settings.
export function sensorMode() {
  if (!isNativeApp()) return "sim";
  if (!canChooseSensor()) return "ble";
  try {
    return localStorage.getItem(SENSOR_MODE_KEY) === "ble" ? "ble" : "sim";
  } catch {
    return "sim";
  }
}

export function setSensorMode(mode) {
  try {
    localStorage.setItem(SENSOR_MODE_KEY, mode);
  } catch {
    // not remembered
  }
}
