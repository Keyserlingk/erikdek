// Settings stored in the app: bodyweight, rep threshold and whether hangs start on
// force (db "kv" → "settings").
// No DOM access, so it runs under node --test too.

import { db } from "./db.js";

export const MIN_BODYWEIGHT_KG = 20;
export const MAX_BODYWEIGHT_KG = 250;
export const MIN_REP_THRESHOLD_KG = 0.5;
export const MAX_REP_THRESHOLD_KG = 50;
export const START_PCT_RANGE = [5, 100];

// startOnForce: with the sensor, a hang's countdown starts when force is applied, at
// startPct % of the target (the rep threshold without a target).
// recordRelease: after the last hang, keep recording until the climber lets go.
const DEFAULTS = { bodyweightKg: 0, repThresholdKg: 2, startOnForce: true, startPct: 30, recordRelease: true };

// Returns an error message, or null when the settings are valid.
export function validateSettings(v) {
  if (!(v.bodyweightKg === 0 || (v.bodyweightKg >= MIN_BODYWEIGHT_KG && v.bodyweightKg <= MAX_BODYWEIGHT_KG))) {
    return `Bodyweight must be between ${MIN_BODYWEIGHT_KG} and ${MAX_BODYWEIGHT_KG} kg.`;
  }
  if (!(v.repThresholdKg >= MIN_REP_THRESHOLD_KG && v.repThresholdKg <= MAX_REP_THRESHOLD_KG)) {
    return `Rep threshold must be between ${MIN_REP_THRESHOLD_KG} and ${MAX_REP_THRESHOLD_KG} kg.`;
  }
  if (typeof v.startOnForce !== "boolean") return "Invalid start-on-force setting.";
  if (typeof v.recordRelease !== "boolean") return "Invalid record-release setting.";
  const [minPct, maxPct] = START_PCT_RANGE;
  if (!(Number.isInteger(v.startPct) && v.startPct >= minPct && v.startPct <= maxPct)) {
    return `The start level must be a whole number from ${minPct} to ${maxPct} %.`;
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
