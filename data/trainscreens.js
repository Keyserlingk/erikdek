// Screens of the Train and Tests tabs. The routine editor, the run and the summary are
// shared: they are moved into the tab they are opened from (editHost, runHost).

import { $ } from "./ui.js";

const screens = {
  list: $("trainList"),
  tests: $("testsMain"),
  edit: $("trainEdit"),
  workoutEdit: $("trainWorkoutEdit"),
  between: $("trainBetween"),
  workoutSummary: $("trainWorkoutSummary"),
  run: $("trainRun"),
  summary: $("trainSummary"),
};
const notices = { list: $("trainListNotice"), tests: $("testsNotice") };

// Screens per tab, plus the shared ones mounted in it.
const GROUPS = { train: ["list", "workoutEdit", "between", "workoutSummary"], tests: ["tests"] };
export const HOME = { train: "list", tests: "tests" };
let runHost = "train";
let editHost = "train";

export const getRunHost = () => runHost;

function groupOfScreen(screen) {
  if (screen === "edit") return editHost;
  return Object.keys(GROUPS).find((g) => GROUPS[g].includes(screen)) ?? runHost;
}

export function show(screen) {
  const group = groupOfScreen(screen);
  const names = [...GROUPS[group], ...(group === runHost ? ["run", "summary"] : []), ...(group === editHost ? ["edit"] : [])];
  for (const name of names) screens[name].hidden = name !== screen;
  window.scrollTo(0, 0);
}

// The tab's main screen is showing (no editor, run or summary on top).
export const isHome = (group) => !screens[HOME[group]].hidden;

// Moves the shared run/summary screens into the tab a run starts from.
export function mountRunScreens(group) {
  if (group === runHost) return;
  if (!screens.run.hidden || !screens.summary.hidden) show(HOME[runHost]);
  $(`view-${group}`).append(screens.run, screens.summary);
  runHost = group;
}

// Moves the editor into the tab it is opened from (routines: Train, tests: Tests).
export function mountEditor(group) {
  if (group === editHost) return;
  if (!screens.edit.hidden) show(HOME[editHost]);
  $(`view-${group}`).append(screens.edit);
  editHost = group;
}

// The tab a session kind belongs to: routines in Train, tests in Tests.
export function groupOf(kind) {
  return kind === "workout" ? "train" : "tests";
}

export function showNotice(home, text) {
  for (const [name, node] of Object.entries(notices)) {
    node.textContent = name === home ? text : "";
    node.hidden = name !== home || !text;
  }
}
