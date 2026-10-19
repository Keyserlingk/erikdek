// Settings stored in the app: bodyweight and rep threshold (db "kv" → "settings").
// No DOM access, so it runs under node --test too.

import { db } from "./db.js";

export const MIN_BODYWEIGHT_KG = 20;
export const MAX_BODYWEIGHT_KG = 250;
export const MIN_REP_THRESHOLD_KG = 0.5;
export const MAX_REP_THRESHOLD_KG = 50;

const DEFAULTS = { bodyweightKg: 0, repThresholdKg: 2 };

// Returns an error message, or null when the settings are valid.
export function validateSettings(v) {
  if (!(v.bodyweightKg === 0 || (v.bodyweightKg >= MIN_BODYWEIGHT_KG && v.bodyweightKg <= MAX_BODYWEIGHT_KG))) {
    return `Bodyweight must be between ${MIN_BODYWEIGHT_KG} and ${MAX_BODYWEIGHT_KG} kg.`;
  }
  if (!(v.repThresholdKg >= MIN_REP_THRESHOLD_KG && v.repThresholdKg <= MAX_REP_THRESHOLD_KG)) {
    return `Rep threshold must be between ${MIN_REP_THRESHOLD_KG} and ${MAX_REP_THRESHOLD_KG} kg.`;
  }
  return null;
}

// Settings stored in the app (db "kv" → "settings"). Fires "change" after load/save.
class SettingsStore extends EventTarget {
  constructor() {
    super();
    this.values = { ...DEFAULTS };
  }

  async load() {
    this._set({ ...DEFAULTS, ...((await db.get("kv", "settings")) ?? {}) });
  }

  async save(changes) {
    const next = { ...this.values, ...changes };
    const error = validateSettings(next);
    if (error) throw new Error(error);
    await db.write([{ store: "kv", key: "settings", value: next }]);
    this._set(next);
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
