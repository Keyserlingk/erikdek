// Settings stored in the app, per profile (db "kv" → "settings:<profile id>"): bodyweight,
// rep threshold and how hangs with the sensor start and end. The store holds the active
// profile's settings and reloads when another profile becomes active.
// No DOM access, so it runs under node --test too.

import { db } from "./db.js";
import { profiles } from "./profiles.js";

export const settingsKey = (profileId) => `settings:${profileId}`;

export const MIN_BODYWEIGHT_KG = 20;
export const MAX_BODYWEIGHT_KG = 250;
export const MIN_REP_THRESHOLD_KG = 0.5;
export const MAX_REP_THRESHOLD_KG = 50;
export const START_PCT_RANGE = [5, 100];

export const MAX_BODYWEIGHT_ENTRIES = 1000;

// bodyweightKg: the current bodyweight (0 = not set); bodyweightLog: [{ date, kg }] by
// date (YYYY-MM-DD), so sessions use the weight of their day (bodyweightOn).
// startOnForce: with the sensor, a hang's countdown starts when force is applied, at
// startPct % of the target (the rep threshold without a target).
// recordRelease: after the last hang, keep recording until the climber lets go.
const DEFAULTS = {
  bodyweightKg: 0,
  bodyweightLog: [],
  repThresholdKg: 2,
  startOnForce: true,
  startPct: 30,
  recordRelease: true,
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The local date of a timestamp as YYYY-MM-DD.
export function dayOf(iso = new Date().toISOString()) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// The weight logged on or before the day of `iso`, or null.
export function bodyweightOn(log, iso) {
  const day = dayOf(iso);
  let found = null;
  for (const e of log) if (e.date <= day && (!found || e.date > found.date)) found = e;
  return found ? found.kg : null;
}

// Returns an error message, or null when the settings are valid.
export function validateSettings(v) {
  if (!(v.bodyweightKg === 0 || (v.bodyweightKg >= MIN_BODYWEIGHT_KG && v.bodyweightKg <= MAX_BODYWEIGHT_KG))) {
    return `Bodyweight must be between ${MIN_BODYWEIGHT_KG} and ${MAX_BODYWEIGHT_KG} kg.`;
  }
  if (!(v.repThresholdKg >= MIN_REP_THRESHOLD_KG && v.repThresholdKg <= MAX_REP_THRESHOLD_KG)) {
    return `Rep threshold must be between ${MIN_REP_THRESHOLD_KG} and ${MAX_REP_THRESHOLD_KG} kg.`;
  }
  if (!Array.isArray(v.bodyweightLog) || v.bodyweightLog.length > MAX_BODYWEIGHT_ENTRIES) return "Invalid bodyweight log.";
  for (const e of v.bodyweightLog) {
    if (!e || !DATE.test(e.date) || !(e.kg >= MIN_BODYWEIGHT_KG && e.kg <= MAX_BODYWEIGHT_KG)) return "Invalid bodyweight entry.";
  }
  if (typeof v.startOnForce !== "boolean") return "Invalid start-on-force setting.";
  if (typeof v.recordRelease !== "boolean") return "Invalid record-release setting.";
  const [minPct, maxPct] = START_PCT_RANGE;
  if (!(Number.isInteger(v.startPct) && v.startPct >= minPct && v.startPct <= maxPct)) {
    return `The start level must be a whole number from ${minPct} to ${maxPct} %.`;
  }
  return null;
}

// Fires "change" after load/save (and after switching profile).
class SettingsStore extends EventTarget {
  constructor() {
    super();
    this.values = { ...DEFAULTS };
    profiles.addEventListener("change", () => {
      if (profiles.activeId !== this.profileId) this.load().catch(() => {});
    });
  }

  async load() {
    this.profileId = profiles.activeId;
    this.values = { ...DEFAULTS }; // nothing carried over from the previous profile
    this._set({ ...DEFAULTS, ...((await db.get("kv", settingsKey(this.profileId))) ?? {}) });
  }

  async save(changes) {
    await this.saveFor(profiles.activeId, { ...this.values, ...changes });
  }

  // Stores a profile's complete settings (restoring a backup, or the active one's).
  async saveFor(profileId, values) {
    // Missing values (e.g. an older backup) get the defaults.
    const given = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
    const next = { ...DEFAULTS, ...given };
    const error = validateSettings(next);
    if (error) throw new Error(error);
    await db.write([{ store: "kv", key: settingsKey(profileId), value: next }]);
    if (profileId === this.profileId) this._set(next);
  }

  // Logs a weight for a day (replacing that day's entry). The newest entry is the
  // current bodyweight.
  async logBodyweight(kg, date = dayOf()) {
    const log = [...this.values.bodyweightLog.filter((e) => e.date !== date), { date, kg }].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    await this.save({ bodyweightLog: log, bodyweightKg: log.at(-1).kg });
  }

  async removeBodyweightEntry(date) {
    const log = this.values.bodyweightLog.filter((e) => e.date !== date);
    await this.save({ bodyweightLog: log, ...(log.length ? { bodyweightKg: log.at(-1).kg } : {}) });
  }

  // A session with the bodyweight of its day (from the log), else the one it was
  // saved with. Sessions are always the active profile's here.
  withBodyweight(session) {
    const logged = bodyweightOn(this.values.bodyweightLog, session.startedAt);
    return logged ? { ...session, bodyweightKg: logged } : session;
  }

  // All profiles' settings, for the backup: { profileId: values }.
  async byProfile() {
    const out = {};
    for (const p of profiles.list) {
      const stored = await db.get("kv", settingsKey(p.id));
      if (stored) out[p.id] = { ...DEFAULTS, ...stored };
    }
    return out;
  }

  // Forgets a profile's settings (deleting it, or clearing the guest's data).
  async removeFor(profileId) {
    await db.write([{ store: "kv", key: settingsKey(profileId), value: undefined }]);
    if (profileId === this.profileId) this._set({ ...DEFAULTS });
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
