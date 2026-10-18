import { device } from "./device.js";
import { formatBytes } from "./format.js";
import { sessions } from "./sessions.js";
import { grips, holdTypes, initTagManager } from "./tags.js";

export const MIN_BODYWEIGHT_KG = 20;
export const MAX_BODYWEIGHT_KG = 250;
export const MIN_REP_THRESHOLD_KG = 0.5;
export const MAX_REP_THRESHOLD_KG = 50;

// Settings stored on the device (GET/PUT /api/settings). Fires "change" after load/save.
class SettingsStore extends EventTarget {
  constructor() {
    super();
    this.values = { bodyweightKg: 0, repThresholdKg: 2 };
  }

  async load() {
    const res = await fetch("/api/settings");
    if (!res.ok) throw new Error(`Loading settings failed (${res.status})`);
    this._set(await res.json());
  }

  async save(changes) {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(changes),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Saving failed (${res.status})`);
    this._set(body);
  }

  _set(values) {
    this.values = { ...this.values, ...values };
    this.dispatchEvent(new Event("change"));
  }

  onChange(handler) {
    this.addEventListener("change", () => handler(this.values));
  }
}

export const settings = new SettingsStore();

const el = {
  bodyweight: document.getElementById("setBodyweight"),
  repThreshold: document.getElementById("setRepThreshold"),
  save: document.getElementById("setSave"),
  message: document.getElementById("setMessage"),
};

// ---------------------------------------------------------------- About

const about = {
  web: document.getElementById("aboutWeb"),
  fw: document.getElementById("aboutFw"),
  storage: document.getElementById("aboutStorage"),
  app: document.getElementById("aboutApp"),
  sessions: document.getElementById("aboutSessions"),
  lists: document.getElementById("aboutLists"),
  fs: document.getElementById("aboutFs"),
};

// Refreshes versions and the storage breakdown; called when Settings is shown.
export async function showAbout() {
  about.fw.textContent = device.status?.fw || "–";
  try {
    const res = await fetch("/version.json");
    about.web.textContent = res.ok ? (await res.json()).version : "–";
  } catch {
    about.web.textContent = "–";
  }
  try {
    const st = await sessions.storage();
    // Whatever isn't in a file: directories and the file system's own bookkeeping.
    const fsBytes = Math.max(0, st.usedBytes - st.sessionsBytes - st.listsBytes - st.appBytes);
    about.storage.textContent = `${formatBytes(st.usedBytes)} of ${formatBytes(st.totalBytes)} (${Math.round((100 * st.usedBytes) / st.totalBytes)} %)`;
    about.app.textContent = formatBytes(st.appBytes);
    about.sessions.textContent = formatBytes(st.sessionsBytes);
    about.lists.textContent = formatBytes(st.listsBytes);
    about.fs.textContent = formatBytes(fsBytes);
  } catch {
    for (const key of ["storage", "app", "sessions", "lists", "fs"]) about[key].textContent = "–";
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
  });
  device.on("status", (st) => {
    about.fw.textContent = st.fw || "–";
  });
  device.on("connection", (state) => {
    el.save.disabled = state !== "open";
    if (state === "open") settings.load().catch((e) => showMessage(e.message, true));
  });

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
      showMessage("Saved on the device.");
    } catch (e) {
      showMessage(e.message, true);
    }
  });
}
