import { device } from "./device.js";

export const MIN_BODYWEIGHT_KG = 20;
export const MAX_BODYWEIGHT_KG = 250;

// Settings stored on the device (GET/PUT /api/settings). Fires "change" after load/save.
class SettingsStore extends EventTarget {
  constructor() {
    super();
    this.values = { bodyweightKg: 0 };
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
  save: document.getElementById("setSave"),
  message: document.getElementById("setMessage"),
};

function showMessage(text, isError = false) {
  el.message.textContent = text;
  el.message.classList.toggle("error-text", isError);
}

export function initSettings() {
  settings.onChange((v) => {
    el.bodyweight.value = v.bodyweightKg > 0 ? v.bodyweightKg : "";
  });
  device.on("connection", (state) => {
    el.save.disabled = state !== "open";
    if (state === "open") settings.load().catch((e) => showMessage(e.message, true));
  });

  el.save.addEventListener("click", async () => {
    const text = el.bodyweight.value.trim();
    const bw = text === "" ? 0 : parseFloat(text);
    if (bw !== 0 && !(bw >= MIN_BODYWEIGHT_KG && bw <= MAX_BODYWEIGHT_KG)) {
      showMessage(`Bodyweight must be between ${MIN_BODYWEIGHT_KG} and ${MAX_BODYWEIGHT_KG} kg.`, true);
      return;
    }
    try {
      await settings.save({ bodyweightKg: bw });
      showMessage("Saved on the device.");
    } catch (e) {
      showMessage(e.message, true);
    }
  });
}
