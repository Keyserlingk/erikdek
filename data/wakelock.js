// Keeps the screen on during a run: the KeepAwake plugin in the Android app, the
// browser's Wake Lock API elsewhere (needs HTTPS or localhost).

import { isNativeApp } from "./platform.js";

let browserLock = null;

// Returns true when the screen will stay on.
export async function keepScreenOn() {
  try {
    if (isNativeApp()) {
      const { KeepAwake } = await import("./vendor/capacitor/keep-awake/index.js");
      await KeepAwake.keepAwake();
      return true;
    }
    if (!("wakeLock" in navigator)) return false;
    if (!browserLock || browserLock.released) browserLock = await navigator.wakeLock.request("screen");
    return true;
  } catch {
    return false;
  }
}

export async function allowScreenOff() {
  try {
    if (isNativeApp()) {
      const { KeepAwake } = await import("./vendor/capacitor/keep-awake/index.js");
      await KeepAwake.allowSleep();
    } else if (browserLock) {
      await browserLock.release();
      browserLock = null;
    }
  } catch {
    // nothing to undo
  }
}
