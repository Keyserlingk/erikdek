// Workouts: named, ordered lists of routines (own routines or templates) run one after
// another. Stored on the device (GET/PUT /api/workouts) as { id, name, routineIds }.
// The logic here has no DOM access, so it runs under node --test too.

import { totalDurationS } from "./workout.js";

export const MAX_WORKOUT_ITEMS = 20;

// Returns an error message, or null when the workout is valid.
export function validateWorkout(w) {
  if (!w.name || !w.name.trim()) return "Give the workout a name.";
  if (w.name.length > 40) return "Name is too long (max 40 characters).";
  if (!Array.isArray(w.routineIds) || !w.routineIds.length) return "Add at least one routine.";
  if (w.routineIds.length > MAX_WORKOUT_ITEMS) return `A workout can have at most ${MAX_WORKOUT_ITEMS} routines.`;
  if (!w.routineIds.every((id) => typeof id === "string")) return "Invalid routine in the workout.";
  return null;
}

// The workout's routines in order; deleted routines come back as null.
export function resolveRoutines(w, allRoutines) {
  return w.routineIds.map((id) => allRoutines.find((r) => r.id === id) ?? null);
}

export function workoutDurationS(w, allRoutines) {
  return resolveRoutines(w, allRoutines).reduce((sum, r) => sum + (r ? totalDurationS(r) : 0), 0);
}

// Moves item `from` one step up (-1) or down (+1); returns a new array.
export function moveItem(list, from, step) {
  const to = from + step;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

let idCounter = 0;

export function newWorkoutId() {
  idCounter = (idCounter + 1) % 1296;
  return `w${Date.now().toString(36)}${idCounter.toString(36)}`;
}

class WorkoutStore extends EventTarget {
  constructor() {
    super();
    this.list = [];
  }

  find(id) {
    return this.list.find((w) => w.id === id) || null;
  }

  async load() {
    const res = await fetch("/api/workouts");
    if (!res.ok) throw new Error(`Loading workouts failed (${res.status})`);
    this.list = await res.json();
    this.dispatchEvent(new Event("change"));
  }

  async save(workout) {
    const next = this.list.filter((w) => w.id !== workout.id);
    next.push(workout);
    await this.replaceAll(next);
  }

  async remove(id) {
    await this.replaceAll(this.list.filter((w) => w.id !== id));
  }

  async replaceAll(list) {
    const res = await fetch("/api/workouts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(list),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Saving failed (${res.status})`);
    this.list = body;
    this.dispatchEvent(new Event("change"));
  }
}

export const workouts = new WorkoutStore();
