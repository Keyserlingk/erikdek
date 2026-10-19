// Train tab: workouts (ordered lists of routines). The list, the editor, and running
// one: each routine is a normal run whose session comes back here instead of going to
// the routine summary; between routines a screen shows the result and what's next.

import { formatDuration, formatKg } from "./format.js";
import { BUILTIN_ROUTINES, TEMPLATE_CATEGORIES, routines } from "./routines.js";
import { describe, routineDuration, workoutDuration } from "./routinetext.js";
import { startRun } from "./runner.js";
import { sessions } from "./sessions.js";
import { summarizeTraining } from "./tests.js";
import { show, showNotice } from "./trainscreens.js";
import { $, button, create } from "./ui.js";
import { moveItem, newWorkoutId, resolveRoutines, validateWorkout, workouts } from "./workouts.js";

const el = {
  list: $("workoutList"),
  newWorkout: $("workoutNew"),
  edit: {
    title: $("wEditTitle"),
    name: $("wEditName"),
    items: $("wEditItems"),
    add: $("wEditAdd"),
    addButton: $("wEditAddButton"),
    duration: $("wEditDuration"),
    error: $("wEditError"),
    cancel: $("wEditCancel"),
    save: $("wEditSave"),
    remove: $("wEditDelete"),
  },
  between: {
    workout: $("betweenWorkout"),
    title: $("betweenTitle"),
    result: $("betweenResult"),
    next: $("betweenNext"),
    end: $("betweenEnd"),
    start: $("betweenStart"),
  },
  sum: {
    title: $("wSumTitle"),
    meta: $("wSumMeta"),
    list: $("wSumList"),
    error: $("wSumError"),
    discard: $("wSumDiscard"),
    save: $("wSumSave"),
  },
};

let editingWorkout = null; // { id, name, routineIds, isNew }
let workoutRun = null; // running workout: { workout, routines, index, sessions }

export const isWorkoutActive = () => workoutRun !== null;

export function renderWorkouts() {
  if (!workouts.list.length) {
    el.list.replaceChildren(create("p", { className: "muted empty-note", textContent: "No workouts yet." }));
    return;
  }
  el.list.replaceChildren(
    ...workouts.list.map((w) => {
      const items = resolveRoutines(w, routines.all);
      const names = items.map((r) => (r ? r.name : "(deleted routine)")).join(" → ");
      return create("div", { className: "card routine" }, [
        create("div", { className: "routine-head" }, [
          create("h2", { textContent: w.name }),
          create("span", { className: "muted", textContent: workoutDuration(w, routines.all) }),
        ]),
        create("p", { className: "muted", textContent: `${items.length} routine${items.length === 1 ? "" : "s"}: ${names}` }),
        create("div", { className: "actions" }, [
          button("secondary", "Edit", () => openWorkoutEditor(w)),
          button("primary", "Start", () => startWorkout(w)),
        ]),
      ]);
    }),
  );
}

// ---------------------------------------------------------------- editor

function openWorkoutEditor(w) {
  editingWorkout = w ? { ...structuredClone(w), isNew: false } : { id: newWorkoutId(), name: "", routineIds: [], isNew: true };
  el.edit.title.textContent = editingWorkout.isNew ? "New workout" : "Edit workout";
  el.edit.name.value = editingWorkout.name;
  el.edit.remove.hidden = editingWorkout.isNew;
  el.edit.error.hidden = true;
  renderWorkoutAddOptions();
  renderWorkoutItems();
  show("workoutEdit");
}

function renderWorkoutAddOptions() {
  const group = (label, list) =>
    create("optgroup", { label }, list.map((r) => create("option", { value: r.id, textContent: r.name })));
  const groups = [];
  if (routines.custom.length) groups.push(group("My routines", routines.custom));
  for (const category of TEMPLATE_CATEGORIES) {
    groups.push(group(`Templates · ${category}`, BUILTIN_ROUTINES.filter((r) => r.category === category)));
  }
  el.edit.add.replaceChildren(...groups);
}

function renderWorkoutItems() {
  const ids = editingWorkout.routineIds;
  const items = resolveRoutines(editingWorkout, routines.all);
  const iconButton = (text, label, disabled, onClick) => {
    const b = create("button", { type: "button", className: "icon-button", textContent: text, disabled });
    b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick);
    return b;
  };
  const update = (routineIds) => {
    editingWorkout.routineIds = routineIds;
    renderWorkoutItems();
  };
  el.edit.items.replaceChildren(
    ...items.map((r, i) =>
      create("li", {}, [
        create("span", { className: `item-name${r ? "" : " missing"}` }, [
          `${i + 1}. ${r ? r.name : "Deleted routine (will be skipped)"}`,
          ...(r ? [create("small", { textContent: `${routineDuration(r)} · ${describe(r)}` })] : []),
        ]),
        iconButton("↑", "Move up", i === 0, () => update(moveItem(ids, i, -1))),
        iconButton("↓", "Move down", i === ids.length - 1, () => update(moveItem(ids, i, 1))),
        iconButton("✕", "Remove", false, () => update(ids.filter((_, j) => j !== i))),
      ]),
    ),
  );
  if (!ids.length) el.edit.items.replaceChildren(create("li", { className: "muted", textContent: "No routines yet. Add one below." }));
  el.edit.duration.textContent = ids.length ? `Total time ${workoutDuration(editingWorkout, routines.all)}` : "";
}

async function saveWorkoutEditor() {
  const w = { id: editingWorkout.id, name: el.edit.name.value.trim(), routineIds: editingWorkout.routineIds };
  const error = validateWorkout(w);
  el.edit.error.textContent = error || "";
  el.edit.error.hidden = !error;
  if (error) return;
  try {
    await workouts.save(w);
    show("list");
  } catch (err) {
    el.edit.error.textContent = err.message;
    el.edit.error.hidden = false;
  }
}

async function deleteWorkout() {
  if (!confirm(`Delete the workout "${editingWorkout.name}"? Its routines are kept.`)) return;
  try {
    await workouts.remove(editingWorkout.id);
    show("list");
  } catch (err) {
    el.edit.error.textContent = err.message;
    el.edit.error.hidden = false;
  }
}

// ---------------------------------------------------------------- running

function startWorkout(w) {
  const items = resolveRoutines(w, routines.all).filter(Boolean);
  if (!items.length) {
    alert("This workout has no routines left. Edit it to add some.");
    return;
  }
  workoutRun = { workout: w, routines: items, index: 0, sessions: [] };
  startWorkoutRoutine();
}

async function startWorkoutRoutine() {
  const { workout, routines: items, index } = workoutRun;
  const r = items[index];
  const info = { id: workout.id, name: workout.name, index: index + 1, count: items.length };
  if (await startRun("workout", r, r.hands || "both", { onEnd: workoutRoutineDone, workout: info })) return;
  // Declined to start without the sensor: end the workout here.
  if (workoutRun.sessions.length) showWorkoutSummary();
  else workoutRun = null;
}

function shortResult(s) {
  if (s.sets || s.noForce) {
    // Without the sensor: reps, effort, weight.
    const t = s.summary;
    const parts = [`${t.repsDone}/${t.totalReps} reps`];
    if (s.noForce) parts.push("no force data");
    if (t.avgRpe !== null) parts.push(`effort ${Math.round(t.avgRpe * 10) / 10}`);
    if (t.maxAddedWeightKg !== null) parts.push(`${t.maxAddedWeightKg >= 0 ? "+" : "−"}${formatKg(Math.abs(t.maxAddedWeightKg))} kg`);
    return parts.join(" · ");
  }
  const parts = [];
  if (s.summary.holdPct !== null && s.summary.holdPct !== undefined) parts.push(`hold ${Math.round(s.summary.holdPct)} %`);
  if (s.summary.avgKg !== null && s.summary.avgKg !== undefined) parts.push(`avg ${formatKg(s.summary.avgKg)} kg`);
  return parts.join(" · ") || "–";
}

// A finished routine in a workout: name and result, plus (without the sensor) the effort
// of its last set, which is otherwise logged on the routine summary that workouts skip.
function resultRow(s, label) {
  const value = create("span", { textContent: shortResult(s) });
  const row = [create("div", { className: "result-line" }, [create("span", { textContent: label }), value])];
  const last = s.sets?.at(-1);
  if (last) {
    const select = create("select", {}, [
      create("option", { value: "", textContent: "Effort, last set –" }),
      ...Array.from({ length: 10 }, (_, i) => create("option", { value: String(i + 1), textContent: `Effort, last set: ${i + 1}` })),
    ]);
    select.value = last.rpe ?? "";
    select.addEventListener("change", () => {
      last.rpe = select.value ? Number(select.value) : null;
      s.summary = summarizeTraining(s.reps, s.sets, s.routine);
      value.textContent = shortResult(s);
    });
    row.push(create("label", { className: "field last-set-effort" }, [select]));
  }
  return row;
}

function workoutRoutineDone(session, stopped) {
  workoutRun.sessions.push(session);
  const { routines: items, index, workout } = workoutRun;
  if (stopped || index + 1 >= items.length) {
    showWorkoutSummary();
    return;
  }
  el.between.workout.textContent = workout.name;
  el.between.title.textContent = `Routine ${index + 1} of ${items.length} done`;
  el.between.result.replaceChildren(...resultRow(session, session.name));
  const next = items[index + 1];
  el.between.next.replaceChildren(
    create("div", { className: "routine-head" }, [
      create("h2", { textContent: next.name }),
      create("span", { className: "muted", textContent: routineDuration(next) }),
    ]),
    create("p", { className: "muted", textContent: describe(next) }),
  );
  show("between");
}

function startNextWorkoutRoutine() {
  workoutRun.index++;
  startWorkoutRoutine();
}

function showWorkoutSummary() {
  const { workout, sessions: done, routines: items } = workoutRun;
  el.sum.title.textContent = workout.name;
  const totalS = done.reduce((sum, s) => sum + s.durationS, 0);
  el.sum.meta.textContent = `${done.length} of ${items.length} routines · ${formatDuration(totalS)}`;
  el.sum.list.replaceChildren(
    ...done.map((s, i) =>
      create("div", { className: "card" }, [
        ...resultRow(s, `${i + 1}. ${s.name}${s.stopped ? " (stopped)" : ""}`),
      ]),
    ),
  );
  el.sum.error.hidden = true;
  el.sum.save.disabled = false;
  show("workoutSummary");
}

async function saveWorkout() {
  el.sum.save.disabled = true;
  try {
    // Saved one by one; already saved sessions are dropped so a retry doesn't duplicate.
    while (workoutRun.sessions.length) {
      await sessions.save(workoutRun.sessions[0]);
      workoutRun.sessions.shift();
    }
    workoutRun = null;
    show("list");
    showNotice("list", "Workout saved to history.");
  } catch (err) {
    el.sum.error.textContent = err.message;
    el.sum.error.hidden = false;
    el.sum.save.disabled = false;
  }
}

function discardWorkout() {
  if (!confirm("Discard this workout? None of its routines will be saved.")) return;
  workoutRun = null;
  show("list");
}

function endWorkoutEarly() {
  if (!confirm("End the workout now? You can still save the routines you've done.")) return;
  showWorkoutSummary();
}

export function initWorkouts() {
  el.newWorkout.addEventListener("click", () => openWorkoutEditor(null));
  el.edit.addButton.addEventListener("click", () => {
    if (!el.edit.add.value) return;
    editingWorkout.routineIds = [...editingWorkout.routineIds, el.edit.add.value];
    renderWorkoutItems();
  });
  el.edit.cancel.addEventListener("click", () => show("list"));
  el.edit.save.addEventListener("click", saveWorkoutEditor);
  el.edit.remove.addEventListener("click", deleteWorkout);
  el.between.start.addEventListener("click", startNextWorkoutRoutine);
  el.between.end.addEventListener("click", endWorkoutEarly);
  el.sum.save.addEventListener("click", saveWorkout);
  el.sum.discard.addEventListener("click", discardWorkout);
}
