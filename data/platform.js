// Where the app runs: inside the Android app (Capacitor) or in a browser.

export function isNativeApp() {
  return globalThis.Capacitor?.isNativePlatform?.() === true;
}

const SENSOR_MODE_KEY = "erkdek.sensorMode";

// "ble" or "sim". The browser always uses the simulated sensor; the app starts with it
// until Bluetooth is chosen under Settings → Sensor.
export function sensorMode() {
  if (!isNativeApp()) return "sim";
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
