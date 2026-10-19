// Screens of the Train and Tests tabs. Run and summary are shared and moved into the
// tab the run was started from (runHost).

import { $ } from "./ui.js";

const screens = {
  list: $("trainList"),
  tests: $("testsMain"),
  edit: $("trainEdit"),
  workoutEdit: $("trainWorkoutEdit"),
  between: $("trainBetween"),
  workoutSummary: $("trainWorkoutSummary"),
  setup: $("trainSetup"),
  run: $("trainRun"),
  summary: $("trainSummary"),
};
const notices = { list: $("trainListNotice"), tests: $("testsNotice") };

// Screens per tab; run and summary belong to the tab they are mounted in.
const GROUPS = { train: ["list", "edit", "workoutEdit", "between", "workoutSummary"], tests: ["tests", "setup"] };
export const HOME = { train: "list", tests: "tests" };
let runHost = "train";

export const getRunHost = () => runHost;

export function show(screen) {
  const group = Object.keys(GROUPS).find((g) => GROUPS[g].includes(screen)) ?? runHost;
  const names = [...GROUPS[group], ...(group === runHost ? ["run", "summary"] : [])];
  for (const name of names) screens[name].hidden = name !== screen;
  window.scrollTo(0, 0);
}

// Moves the shared run/summary screens into the tab a run starts from.
export function mountRunScreens(group) {
  if (group === runHost) return;
  if (!screens.run.hidden || !screens.summary.hidden) show(HOME[runHost]);
  $(`view-${group}`).append(screens.run, screens.summary);
  runHost = group;
}

export function groupOf(kind) {
  return kind === "workout" ? "train" : "tests";
}

// Home screen of the tab a run started from.
export function homeOf(kind) {
  return HOME[groupOf(kind)];
}

export function showNotice(home, text) {
  for (const [name, node] of Object.entries(notices)) {
    node.textContent = name === home ? text : "";
    node.hidden = name !== home || !text;
  }
}
