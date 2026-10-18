// Built-in routines ship with the web app; custom ones are stored on the device.

export const BUILTIN_ROUTINES = [
  {
    id: "builtin-repeaters",
    name: "Repeaters 7/3",
    builtin: true,
    sets: 4,
    reps: 6,
    workS: 7,
    restS: 3,
    setRestS: 180,
    prepS: 10,
    target: { type: "none", value: 0 },
  },
  {
    id: "builtin-max-hangs",
    name: "Max hangs 10 s",
    builtin: true,
    sets: 5,
    reps: 1,
    workS: 10,
    restS: 0,
    setRestS: 180,
    prepS: 10,
    target: { type: "none", value: 0 },
  },
  {
    id: "builtin-endurance",
    name: "Endurance 10/5",
    builtin: true,
    sets: 3,
    reps: 6,
    workS: 10,
    restS: 5,
    setRestS: 120,
    prepS: 10,
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

export function newRoutineId() {
  return `r${Date.now().toString(36)}`;
}
