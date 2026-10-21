// Texts describing routines and workouts (list cards, editor, workout screens).
// No DOM access, so it runs under node --test too.

import { formatDuration, formatKg } from "./format.js";
import { PROTOCOLS } from "./protocols.js";
import { ROUTINE_TYPES } from "./routines.js";
import { HANDS } from "./tests.js";
import { isOpenEnded, totalDurationS } from "./workout.js";
import { workoutDurationS } from "./workouts.js";

// "12 min", or "8 min + reps" when self-paced reps add an unknown time.
export function routineDuration(r) {
  return formatDuration(totalDurationS(r)) + (isOpenEnded(r) ? " + reps" : "");
}

// allRoutines: own routines and templates, to look up the workout's routine ids.
export function workoutDuration(w, allRoutines) {
  const open = w.routineIds.some((id) => {
    const r = allRoutines.find((x) => x.id === id);
    return r && isOpenEnded(r);
  });
  return formatDuration(workoutDurationS(w, allRoutines)) + (open ? " + reps" : "");
}

export function describe(r) {
  const alternate = r.hands === "alternate";
  const type = r.type || "hangboard";
  const parts = [`${r.sets} × ${r.reps}${alternate || r.hands === "each" ? " per hand" : ""}`];
  if (type !== "selfpaced") parts.push(`${r.workS} s on`);
  if (alternate) parts.push(`${r.restS} s hand change`);
  else if (r.reps > 1) parts.push(`${r.restS} s off`);
  if (r.sets > 1) parts.push(`${formatDuration(r.setRestS)} between sets`);
  if (r.target.type === "kg") parts.push(`target ${r.target.value} kg`);
  if (r.target.type === "bw") parts.push(`target ${r.target.value} % BW`);
  if (r.addedWeightKg !== null && r.addedWeightKg !== undefined) {
    parts.push(`${r.addedWeightKg >= 0 ? "+" : "−"}${formatKg(Math.abs(r.addedWeightKg))} kg`);
  }
  // Tests are named after their protocol; other routines after their type.
  const typeLabel = r.test ? PROTOCOLS[r.test].name : type === "hangboard" ? "" : ROUTINE_TYPES[type].label;
  const tags = [typeLabel, r.holdType, r.grip, r.hands && r.hands !== "both" ? HANDS[r.hands] : ""].filter(Boolean);
  return [...tags, ...parts].join(" · ");
}

export function routineFileName(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "routine";
  return `erkdek-routine-${slug}.json`;
}
