// Train tab main screen: My routines / Templates / Workouts, and routine files
// (download all, import).

import { downloadJson } from "./download.js";
import { fileDate } from "./export.js";
import { BUILTIN_ROUTINES, TEMPLATE_CATEGORIES, buildRoutineFile, parseRoutineFile, routines } from "./routines.js";
import { openEditor } from "./routineeditor.js";
import { describe, routineDuration } from "./routinetext.js";
import { startRun } from "./runner.js";
import { grips, holdTypes } from "./tags.js";
import { $, button, create } from "./ui.js";
import { renderWorkouts } from "./workoutflow.js";

const LIST_KEY = "erkdek.routineList";

const el = {
  list: $("routineList"),
  listError: $("trainListError"),
  newRoutine: $("routineNew"),
  fileActions: $("routineFileActions"),
  download: $("routinesDownload"),
  import: $("routinesImport"),
  fileMessage: $("routineFileMessage"),
  workoutsNote: $("workoutsNote"),
  workoutList: $("workoutList"),
  workoutNew: $("workoutNew"),
  tabs: document.querySelectorAll("#routineTabs button"),
  empty: $("routineEmpty"),
  templatesNote: $("templatesNote"),
};

// Which list the Train tab shows: "mine", "templates" or "workouts". Null until chosen,
// then remembered per browser; by default "mine" when there are own routines.
let listView = null;
try {
  listView = localStorage.getItem(LIST_KEY);
} catch {
  // storage unavailable: use the default
}

export function setListView(view) {
  listView = view;
  try {
    localStorage.setItem(LIST_KEY, view);
  } catch {
    // not remembered
  }
  renderList();
}

export function renderList() {
  const view = listView ?? (routines.training.length ? "mine" : "templates");
  for (const b of el.tabs) {
    const active = b.dataset.list === view;
    b.classList.toggle("active", active);
    b.setAttribute("aria-selected", String(active));
  }
  const isWorkouts = view === "workouts";
  el.workoutsNote.hidden = !isWorkouts;
  el.workoutNew.hidden = !isWorkouts;
  el.workoutList.hidden = !isWorkouts;
  el.list.hidden = isWorkouts;
  if (isWorkouts) renderWorkouts();
  const list = view === "mine" ? routines.training : view === "templates" ? BUILTIN_ROUTINES : [];
  el.empty.hidden = view !== "mine" || list.length > 0;
  el.templatesNote.hidden = view !== "templates";
  el.newRoutine.hidden = view !== "mine";
  el.fileActions.hidden = view !== "mine";
  el.download.hidden = !routines.training.length;
  if (view !== "mine") showFileMessage("");
  if (view === "templates") {
    // Templates under their category headings.
    el.list.replaceChildren(
      ...TEMPLATE_CATEGORIES.flatMap((category) => [
        create("h2", { className: "section", textContent: category }),
        ...BUILTIN_ROUTINES.filter((r) => r.category === category).map(routineCard),
      ]),
    );
  } else {
    el.list.replaceChildren(...list.map(routineCard));
  }
}

// A routine or test: what it is, and Edit (Copy & edit for templates) and Start.
export function routineCard(r) {
  return create("div", { className: "card routine" }, [
    create("div", { className: "routine-head" }, [
      create("h2", { textContent: r.name }),
      create("span", { className: "muted", textContent: routineDuration(r) }),
    ]),
    create("p", { className: "muted", textContent: describe(r) }),
    ...(r.instruction ? [create("p", { className: "muted instruction", textContent: r.instruction })] : []),
    create("div", { className: "actions" }, [
      button("secondary", r.builtin ? "Copy & edit" : "Edit", () => openEditor(r)),
      button("primary", "Start", () => startRun(r.test || "workout", r, r.hands || "both")),
    ]),
  ]);
}

export function showListError(text) {
  el.listError.textContent = text;
  el.listError.hidden = !text;
}

function showFileMessage(text, isError = false) {
  el.fileMessage.textContent = text;
  el.fileMessage.classList.toggle("error-text", isError);
}

async function importRoutines() {
  const file = el.import.files[0];
  el.import.value = "";
  if (!file) return;
  try {
    const { routines: imported, skipped } = parseRoutineFile(await file.text(), routines.all.map((r) => r.name));
    if (!imported.length) throw new Error(skipped ? "No valid routines in this file." : "The file has no routines.");
    await routines.replaceAll([...routines.custom, ...imported]);
    // Holds/grips the routines use but the lists don't have yet.
    for (const [store, key] of [[holdTypes, "holdType"], [grips, "grip"]]) {
      const missing = [...new Set(imported.map((r) => r[key]).filter((v) => v && !store.all.includes(v)))];
      if (missing.length) await store.replaceAll([...store.custom, ...missing]);
    }
    showFileMessage(
      `Imported ${imported.length} routine${imported.length === 1 ? "" : "s"}` + (skipped ? ` (${skipped} invalid skipped).` : "."),
    );
  } catch (err) {
    showFileMessage(err.message, true);
  }
}

export function initRoutineList() {
  el.newRoutine.addEventListener("click", () => openEditor(null));
  for (const b of el.tabs) b.addEventListener("click", () => setListView(b.dataset.list));
  el.download.addEventListener("click", () =>
    downloadJson(`erkdek-routines-${fileDate()}.json`, buildRoutineFile(routines.training)),
  );
  el.import.addEventListener("change", importRoutines);
}
