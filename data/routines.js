import { loadList, saveList } from "./db.js";
import { PROTOCOLS, TEST_IDS, applyProtocol } from "./protocols.js";
import { MAX_TAG_LENGTH } from "./tags.js";
import { HAND_OPTIONS } from "./workout.js";

// Built-in routines ship with the app; custom ones are stored in the app (see RoutineStore).
// Tests are routines too: `test` names their protocol (protocols.js), which fixes the
// timing; the rest (name, hold, grip, hands) is the climber's.

export const TEMPLATE_CATEGORIES = ["Hangboard", "Campus board", "Pull-ups & lock-offs"];

const template = (id, category, fields) => ({
  id: `builtin-${id}`,
  builtin: true,
  category,
  holdType: "",
  grip: "",
  hands: "both",
  type: "hangboard",
  instruction: "",
  setInstructions: [],
  addedWeightKg: null,
  sets: 1,
  reps: 1,
  workS: 0,
  restS: 0,
  setRestS: 0,
  prepS: 5,
  target: { type: "none", value: 0 },
  ...fields,
});

export const BUILTIN_ROUTINES = [
  // Hangboard (with the sensor)
  template("repeaters", "Hangboard", { name: "Repeaters 7/3", sets: 4, reps: 6, workS: 7, restS: 3, setRestS: 180 }),
  template("max-hangs", "Hangboard", { name: "Max hangs 10 s", sets: 5, reps: 1, workS: 10, setRestS: 180 }),
  template("endurance", "Hangboard", { name: "Endurance 10/5", sets: 3, reps: 6, workS: 10, restS: 5, setRestS: 120 }),

  // Campus board
  template("campus-ladders", "Campus board", {
    name: "Campus ladders",
    type: "selfpaced",
    instruction: "Ladders on medium rungs, no matching. Lead with the other hand on rep 2.",
    setInstructions: ["1-3-5", "1-4-7", "1-5-9"],
    sets: 3,
    reps: 2,
    restS: 120,
    setRestS: 180,
  }),
  template("campus-bumps", "Campus board", {
    name: "Campus bumps",
    type: "selfpaced",
    hands: "alternate",
    instruction: "Bumps with one hand (1-3-5-7) while the other stays on rung 1.",
    sets: 3,
    reps: 2,
    restS: 60,
    setRestS: 180,
  }),
  template("campus-max-reach", "Campus board", {
    name: "Campus max reach",
    type: "selfpaced",
    hands: "alternate",
    instruction: "From both hands on rung 1, reach as high as you can and hold. Note the rung.",
    sets: 1,
    reps: 3,
    restS: 120,
  }),
  template("campus-endurance", "Campus board", {
    name: "Campus endurance",
    type: "timed",
    instruction: "Up and down the big rungs, steady pace, for the whole interval.",
    sets: 3,
    reps: 1,
    workS: 30,
    setRestS: 180,
  }),

  // Pull-ups & lock-offs
  template("pull-ups", "Pull-ups & lock-offs", {
    name: "Pull-ups",
    type: "selfpaced",
    instruction: "As many controlled pull-ups as you can. Tap Done when you come down.",
    sets: 4,
    reps: 1,
    setRestS: 120,
  }),
  template("weighted-pull-ups", "Pull-ups & lock-offs", {
    name: "Weighted pull-ups",
    type: "selfpaced",
    instruction: "5 pull-ups with added weight. Raise the weight when all sets feel easy.",
    addedWeightKg: 5,
    sets: 5,
    reps: 1,
    setRestS: 180,
  }),
  template("pull-up-pyramid", "Pull-ups & lock-offs", {
    name: "Pull-up pyramid",
    type: "selfpaced",
    instruction: "Pull-ups, controlled.",
    setInstructions: ["2 pull-ups", "4 pull-ups", "6 pull-ups", "4 pull-ups", "2 pull-ups"],
    sets: 5,
    reps: 1,
    setRestS: 90,
  }),
  template("lock-offs", "Pull-ups & lock-offs", {
    name: "Lock-offs 90° / 120°",
    type: "timed",
    instruction: "Pull up and hold the lock-off.",
    setInstructions: ["Lock off at 90° (elbows at a right angle)", "Lock off at 120° (just below the bar)"],
    sets: 2,
    reps: 3,
    workS: 7,
    restS: 20,
    setRestS: 120,
  }),
  template("offset-pull-ups", "Pull-ups & lock-offs", {
    name: "Offset pull-ups",
    type: "selfpaced",
    hands: "alternate",
    instruction: "One hand on the bar, the other on a sling about 30 cm lower. Pull with the high hand.",
    sets: 3,
    reps: 3,
    restS: 60,
    setRestS: 150,
  }),
];

// Test templates: one per protocol, both hands, no hold or grip yet.
export const BUILTIN_TESTS = TEST_IDS.map((id) =>
  applyProtocol({
    id: `builtin-test-${id}`,
    builtin: true,
    test: id,
    name: PROTOCOLS[id].name,
    instruction: "",
    holdType: "",
    grip: "",
    hands: "both",
  }),
);

export const isTest = (r) => Boolean(r?.test);

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
  if (r.test !== undefined && r.test !== null) {
    if (!PROTOCOLS[r.test]) return "Unknown test.";
    if (!PROTOCOLS[r.test].hands.includes(r.hands)) return "This test can't be done with these hands.";
  }
  if (r.handRestS !== undefined && !(Number.isInteger(r.handRestS) && r.handRestS >= 0 && r.handRestS <= 1800)) {
    return "Invalid rest between hands.";
  }
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

  // Everything a workout can contain: templates, test templates and own ones.
  get all() {
    return [...BUILTIN_ROUTINES, ...BUILTIN_TESTS, ...this.custom];
  }

  // Own routines without the tests (Train), and own tests (Tests).
  get training() {
    return this.custom.filter((r) => !isTest(r));
  }

  get tests() {
    return this.custom.filter(isTest);
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
  "test",
  "handRestS",
];

function pickRoutine(r) {
  return Object.fromEntries(ROUTINE_FIELDS.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));
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
    const picked = { ...pickRoutine(raw || {}), holdType: raw?.holdType ?? "", grip: raw?.grip ?? "" };
    // A test always gets its protocol's timing, whatever the file says.
    const r = PROTOCOLS[picked.test] ? applyProtocol(picked) : picked;
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
