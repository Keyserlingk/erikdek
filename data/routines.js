import { MAX_TAG_LENGTH } from "./tags.js";

// Built-in routines ship with the web app; custom ones are stored on the device.

export const BUILTIN_ROUTINES = [
  {
    id: "builtin-repeaters",
    name: "Repeaters 7/3",
    builtin: true,
    holdType: "",
    grip: "",
    sets: 4,
    reps: 6,
    workS: 7,
    restS: 3,
    setRestS: 180,
    prepS: 5,
    target: { type: "none", value: 0 },
  },
  {
    id: "builtin-max-hangs",
    name: "Max hangs 10 s",
    builtin: true,
    holdType: "",
    grip: "",
    sets: 5,
    reps: 1,
    workS: 10,
    restS: 0,
    setRestS: 180,
    prepS: 5,
    target: { type: "none", value: 0 },
  },
  {
    id: "builtin-endurance",
    name: "Endurance 10/5",
    builtin: true,
    holdType: "",
    grip: "",
    sets: 3,
    reps: 6,
    workS: 10,
    restS: 5,
    setRestS: 120,
    prepS: 5,
    target: { type: "none", value: 0 },
  },
];

export const LIMITS = {
  sets: [1, 20],
  reps: [1, 50],
  workS: [1, 600],
  restS: [0, 600],
  setRestS: [0, 1800],
  prepS: [0, 60],
};
const TARGET_LIMITS = { kg: [1, 300], bw: [5, 200] };

// Returns an error message, or null when the routine is valid.
export function validateRoutine(r) {
  if (!r.name || !r.name.trim()) return "Give the routine a name.";
  if (r.name.length > 40) return "Name is too long (max 40 characters).";
  for (const key of ["holdType", "grip"]) {
    if (typeof r[key] !== "string" || r[key].length > MAX_TAG_LENGTH) return `Invalid ${key === "grip" ? "grip" : "hold"}.`;
  }
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    if (!Number.isInteger(r[key]) || r[key] < min || r[key] > max) {
      return `${LABELS[key]} must be a whole number from ${min} to ${max}.`;
    }
  }
  if (r.target.type !== "none") {
    const [min, max] = TARGET_LIMITS[r.target.type];
    if (!(r.target.value >= min && r.target.value <= max)) {
      return `Target must be from ${min} to ${max} ${r.target.type === "kg" ? "kg" : "% of bodyweight"}.`;
    }
  }
  return null;
}

const LABELS = {
  sets: "Sets",
  reps: "Reps",
  workS: "Work time",
  restS: "Rest time",
  setRestS: "Rest between sets",
  prepS: "Get ready time",
};

class RoutineStore extends EventTarget {
  constructor() {
    super();
    this.custom = [];
  }

  get all() {
    return [...BUILTIN_ROUTINES, ...this.custom];
  }

  find(id) {
    return this.all.find((r) => r.id === id) || null;
  }

  async load() {
    const res = await fetch("/api/routines");
    if (!res.ok) throw new Error(`Loading routines failed (${res.status})`);
    this.custom = await res.json();
    this.dispatchEvent(new Event("change"));
  }

  async save(routine) {
    const next = this.custom.filter((r) => r.id !== routine.id);
    next.push({ ...routine, builtin: undefined });
    await this._put(next);
  }

  async remove(id) {
    await this._put(this.custom.filter((r) => r.id !== id));
  }

  async replaceAll(list) {
    await this._put(list);
  }

  async _put(list) {
    const res = await fetch("/api/routines", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(list),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Saving failed (${res.status})`);
    this.custom = body;
    this.dispatchEvent(new Event("change"));
  }
}

export const routines = new RoutineStore();

let idCounter = 0;

export function newRoutineId() {
  idCounter = (idCounter + 1) % 1296;
  return `r${Date.now().toString(36)}${idCounter.toString(36)}`;
}

// Routine file: { format, version, routines: [...] } for sharing routines.
export const ROUTINE_FORMAT = "erkdek-routines";
export const ROUTINE_VERSION = 1;
const ROUTINE_FIELDS = ["name", "holdType", "grip", "sets", "reps", "workS", "restS", "setRestS", "prepS", "target"];

function pickRoutine(r) {
  return Object.fromEntries(ROUTINE_FIELDS.map((k) => [k, r[k]]));
}

export function buildRoutineFile(list) {
  return { format: ROUTINE_FORMAT, version: ROUTINE_VERSION, routines: list.map(pickRoutine) };
}

// Parses a routine file into importable routines: valid ones get new ids and a
// "(imported)" suffix when the name is taken. Returns { routines, skipped }.
export function parseRoutineFile(text, existingNames = []) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This is not a valid routine file (not JSON).");
  }
  if (!data || data.format !== ROUTINE_FORMAT || !Array.isArray(data.routines)) {
    throw new Error("This is not an Erkdek routine file.");
  }
  if (data.version > ROUTINE_VERSION) throw new Error("This file was made by a newer version of the app.");
  const taken = new Set(existingNames.map((n) => n.toLowerCase()));
  const routines = [];
  let skipped = 0;
  for (const raw of data.routines) {
    const r = { ...pickRoutine(raw || {}), holdType: raw?.holdType ?? "", grip: raw?.grip ?? "" };
    if (typeof r.name !== "string" || !r.target || typeof r.target.type !== "string" || validateRoutine(r)) {
      skipped++;
      continue;
    }
    let name = r.name.trim();
    if (taken.has(name.toLowerCase())) name = `${name.slice(0, 29)} (imported)`;
    taken.add(name.toLowerCase());
    routines.push({ ...r, name, id: newRoutineId() });
  }
  return { routines, skipped };
}
