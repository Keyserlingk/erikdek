import { device } from "./device.js";
import { holdTypes } from "./holdtypes.js";

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
  holdList: document.getElementById("holdTypeList"),
  holdNew: document.getElementById("holdTypeNew"),
  holdAdd: document.getElementById("holdTypeAdd"),
  holdError: document.getElementById("holdTypeError"),
};

function showHoldError(text) {
  el.holdError.textContent = text;
  el.holdError.hidden = !text;
}

function renderHoldTypes() {
  const items = holdTypes.custom.map((name) => {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "link danger";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => holdTypes.remove(name).catch((e) => showHoldError(e.message)));
    li.append(label, remove);
    return li;
  });
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "None yet.";
    items.push(li);
  }
  el.holdList.replaceChildren(...items);
}

async function addHoldType() {
  try {
    await holdTypes.add(el.holdNew.value.trim());
    el.holdNew.value = "";
    showHoldError("");
  } catch (e) {
    showHoldError(e.message);
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
  device.on("connection", (state) => {
    el.save.disabled = state !== "open";
    if (state === "open") settings.load().catch((e) => showMessage(e.message, true));
  });

  holdTypes.addEventListener("change", renderHoldTypes);
  el.holdAdd.addEventListener("click", addHoldType);
  el.holdNew.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") addHoldType();
  });
  renderHoldTypes();

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
