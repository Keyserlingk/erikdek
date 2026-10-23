// Settings → Sensor → Firmware: updates the sensor over Bluetooth with the firmware
// bundled in the app (data/firmware/, tools/bundle_firmware.py); see ota.h in the
// firmware.

import { device } from "./device.js";
import { allowScreenOff, keepScreenOn } from "./wakelock.js";

const $ = (id) => document.getElementById(id);
const el = {
  section: $("fwUpdate"),
  info: $("fwUpdateInfo"),
  button: $("fwUpdateButton"),
  steps: $("fwUpdateSteps"),
  cancel: $("fwUpdateCancel"),
  start: $("fwUpdateStart"),
  progress: $("fwUpdateProgress"),
  bar: $("fwUpdateBar"),
  pct: $("fwUpdatePct"),
  stop: $("fwUpdateStop"),
  message: $("fwUpdateMessage"),
};

let bundle = null; // { version, size, sha256 } of the firmware in this app
let updating = null; // AbortController while an update runs
let isBusy = () => false;

function message(text, isError = false) {
  el.message.textContent = text;
  el.message.classList.toggle("error-text", isError);
}

function render() {
  const st = device.status;
  el.section.hidden = !bundle || !device.connected || !st;
  if (el.section.hidden) return;
  const current = st.fw === bundle.version;
  el.info.textContent = st.mock
    ? `Simulated sensor: updating only pretends (for trying this screen). This app has ${bundle.version}.`
    : current
      ? `Up to date: ${bundle.version}.`
      : `This app has firmware ${bundle.version}; the sensor has ${st.fw || "an unknown version"}.`;
  el.button.textContent = current ? "Reinstall firmware" : "Update sensor";
  el.button.hidden = Boolean(updating) || !el.steps.hidden;
}

async function run() {
  if (isBusy()) {
    message("Finish the run and save or discard it first.", true);
    return;
  }
  el.steps.hidden = true;
  el.progress.hidden = false;
  el.bar.value = 0;
  el.pct.textContent = "Preparing the sensor…";
  message("");
  updating = new AbortController();
  render();
  await keepScreenOn();
  try {
    const image = new Uint8Array(await (await fetch("firmware/firmware.bin")).arrayBuffer());
    if (image.length !== bundle.size) throw new Error("The firmware file in the app is damaged.");
    await device.transport.updateFirmware(image, {
      signal: updating.signal,
      onProgress: (p) => {
        el.bar.value = p;
        el.pct.textContent = `Sending… ${Math.round(p * 100)} %`;
      },
    });
    message(`Done. The sensor restarts with ${bundle.version} and reconnects by itself.`);
  } catch (e) {
    message(e.message, true);
  } finally {
    updating = null;
    el.progress.hidden = true;
    allowScreenOff();
    render();
  }
}

// busy(): true while a run or an unsaved summary is open (no updating then).
export async function initFirmwareUpdate({ busy }) {
  isBusy = busy;
  el.button.addEventListener("click", () => {
    el.steps.hidden = false;
    message("");
    render();
  });
  el.cancel.addEventListener("click", () => {
    el.steps.hidden = true;
    render();
  });
  el.start.addEventListener("click", run);
  el.stop.addEventListener("click", () => updating?.abort());
  device.on("connection", render);
  device.on("status", (st) => {
    // Back after an update: say so once the new version reports in.
    if (bundle && st.fw === bundle.version && /restarts with/.test(el.message.textContent)) {
      message(`Sensor updated to ${bundle.version}.`);
    }
    render();
  });
  try {
    const res = await fetch("firmware/firmware.json", { cache: "no-store" });
    if (res.ok) bundle = await res.json();
  } catch {
    // no firmware in this build (e.g. the dev server without tools/bundle_firmware.py)
  }
  render();
}
