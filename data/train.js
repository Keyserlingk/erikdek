// Train and Tests tabs: wires up the screens (see trainscreens.js) and their modules.

import { routines } from "./routines.js";
import { initRoutineEditor } from "./routineeditor.js";
import { initRoutineList, renderList, setListView, showListError } from "./routinelist.js";
import { initRunner, isRunning } from "./runner.js";
import { hasResult, initSummary } from "./runsummary.js";
import { grips, holdTypes } from "./tags.js";
import { initTestList } from "./testlist.js";
import { HOME, getRunHost, show, showNotice } from "./trainscreens.js";
import { initWorkouts, isWorkoutActive } from "./workoutflow.js";
import { workouts } from "./workouts.js";

// Tab tapped again: back to that tab's main screen, unless a run or an unsaved
// summary is showing there (those are only left via Stop / Save / Discard).
export function goHome(group) {
  const busy = group === getRunHost() && (isRunning() || hasResult() || (group === "train" && isWorkoutActive()));
  if (!busy) show(HOME[group]);
  window.scrollTo(0, 0);
}

// True while a run or an unsaved summary (or workout) is open: nothing may change the
// profile the session will be saved to.
export function isBusy() {
  return isRunning() || hasResult() || isWorkoutActive();
}

export function initTrain() {
  initRunner();
  initSummary();
  initRoutineEditor({
    // Back to the list it came from; a copied routine template lands under My routines.
    saved: (r) => {
      if (r.test) return show("tests");
      setListView("mine");
      show("list");
    },
  });
  initRoutineList();
  initWorkouts();
  initTestList();

  routines.addEventListener("change", renderList);
  workouts.addEventListener("change", renderList);
  // Data is stored in the app, so it loads right away (no device needed).
  for (const store of [routines, holdTypes, grips, workouts]) store.load().catch((e) => showListError(e.message));
  window.addEventListener("hashchange", () => showNotice(null, ""));

  renderList();
  show("list");
  show("tests");
}
