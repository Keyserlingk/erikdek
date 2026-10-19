import { loadList, saveList } from "./db.js";
import { MAX_TAG_LENGTH } from "./tags.js";
import { HAND_OPTIONS } from "./workout.js";

// Built-in routines ship with the app; custom ones are stored in the app (see RoutineStore).

export const BUILTIN_ROUTINES = [
  {
    id: "builtin-repeaters",
    name: "Repeaters 7/3",
    builtin: true,
    holdType: "",
    grip: "",
    hands: "both",
    type: "hangboard",
    instruction: "",
    setInstructions: [],
    addedWeightKg: null,
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
    hands: "both",
    type: "hangboard",
    instruction: "",
    setInstructions: [],
    addedWeightKg: null,
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
    hands: "both",
    type: "hangboard",
    instruction: "",
    setInstructions: [],
    addedWeightKg: null,
    sets: 3,
    reps: 6,
    workS: 10,
    restS: 5,
    setRestS: 120,
    prepS: 5,
    target: { type: "none", value: 0 },
  },
];

// Routine types. Only hangboard routines use the sensor; the others are timed by the
// clock (timed) or by the climber tapping Done (self-paced).
export const ROUTINE_TYPES = {
  hangboard: { label: "Hangboard", sensor: true },
  timed: { label: "Timed", sensor: false },
  selfpaced: { label: "Self-paced", sensor: false },
};
export const MAX_INSTRUCTION_LENGTH = 200;
export const MAX_SET_INSTRUCTION_LENGTH = 100;
export const ADDED_WEIGHT_LIMITS = [-100, 300]; // negative = assistance (band, pulley)

export function usesSensor(r) {
  return ROUTINE_TYPES[r.type]?.sensor ?? false;
}

// Instruction for a set (1-based): its own when set instructions are given.
export function instructionFor(r, set) {
  return (r.setInstructions?.length ? r.setInstructions[set - 1] : "") || r.instruction || "";
}

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
  if (!ROUTINE_TYPES[r.type]) return "Choose a routine type.";
  if (!HAND_OPTIONS.includes(r.hands)) return "Choose which hands to use.";
  if (typeof r.instruction !== "string" || r.instruction.length > MAX_INSTRUCTION_LENGTH) {
    return `Instruction is too long (max ${MAX_INSTRUCTION_LENGTH} characters).`;
  }
  if (!Array.isArray(r.setInstructions)) return "Invalid set instructions.";
  if (r.setInstructions.length && r.setInstructions.length !== r.sets) return "Give an instruction for every set.";
  if (r.setInstructions.some((t) => typeof t !== "string" || t.length > MAX_SET_INSTRUCTION_LENGTH)) {
    return `Set instructions can be at most ${MAX_SET_INSTRUCTION_LENGTH} characters.`;
  }
  const [minW, maxW] = ADDED_WEIGHT_LIMITS;
  if (r.addedWeightKg !== null && !(r.addedWeightKg >= minW && r.addedWeightKg <= maxW)) {
    return `Added weight must be from ${minW} to ${maxW} kg.`;
  }
  if (!usesSensor(r) && r.target.type !== "none") return "A target load needs the sensor (hangboard routines).";
  for (const key of ["holdType", "grip"]) {
    if (typeof r[key] !== "string" || r[key].length > MAX_TAG_LENGTH) return `Invalid ${key === "grip" ? "grip" : "hold"}.`;
  }
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    if (key === "workS" && r.type === "selfpaced") continue; // the climber ends each rep
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

const MAX_ROUTINES = 100;

// Own routines stored in the app (db "kv" → "routines"); templates are BUILTIN_ROUTINES.
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
    this.custom = await loadList("routines");
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
    this.custom = await saveList("routines", list, MAX_ROUTINES);
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
const ROUTINE_FIELDS = [
  "name",
  "type",
  "instruction",
  "setInstructions",
  "addedWeightKg",
  "holdType",
  "grip",
  "hands",
  "sets",
  "reps",
  "workS",
  "restS",
  "setRestS",
  "prepS",
  "target",
];

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
