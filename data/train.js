import { compressCurve } from "./analysis.js";
import { beep, unlockAudio } from "./audio.js";
import { downloadCsv, downloadJson } from "./download.js";
import { curveCsv, fileDate } from "./export.js";
import { LiveChart } from "./chart.js";
import { allowScreenOff, keepScreenOn } from "./wakelock.js";
import { device } from "./device.js";
import { formatClock, formatDuration, formatKg } from "./format.js";
import {
  BUILTIN_ROUTINES,
  ROUTINE_TYPES,
  buildRoutineFile,
  instructionFor,
  newRoutineId,
  parseRoutineFile,
  routines,
  usesSensor,
  validateRoutine,
} from "./routines.js";
import { newSessionId, sessions } from "./sessions.js";
import { renderSession } from "./sessionview.js";
import { settings } from "./settingsstore.js";
import { TagSelect, grips, holdTypes } from "./tags.js";
import { HANDS, KINDS, TEST_IDS, summarizeTraining } from "./tests.js";
import {
  moveItem,
  newWorkoutId,
  resolveRoutines,
  validateWorkout,
  workoutDurationS,
  workouts,
} from "./workouts.js";
import {
  PHASE,
  WorkoutEngine,
  buildPhases,
  hangsPerRep,
  isOpenEnded,
  loadThresholdKg,
  repStats,
  targetKg,
  targetStatus,
  totalDurationS,
} from "./workout.js";

const TICK_MS = 50;
// Stored curve: only where force >= 1 kg, at most 1000 points (~6 KB per session).
const CURVE_MIN_KG = 1;
const CURVE_MAX_POINTS = 1000;
const SETUP_KEY = "erkdek.testSetup";
const LIST_KEY = "erkdek.routineList";

const $ = (id) => document.getElementById(id);
const el = {
  // Screens of the Train and Tests tabs. Run and summary are shared and moved into the
  // tab the run was started from.
  screens: {
    list: $("trainList"),
    tests: $("testsMain"),
    edit: $("trainEdit"),
    workoutEdit: $("trainWorkoutEdit"),
    between: $("trainBetween"),
    workoutSummary: $("trainWorkoutSummary"),
    setup: $("trainSetup"),
    run: $("trainRun"),
    summary: $("trainSummary"),
  },
  tests: $("testList"),
  list: $("routineList"),
  listError: $("trainListError"),
  notices: { list: $("trainListNotice"), tests: $("testsNotice") },
  newRoutine: $("routineNew"),
  routineFileActions: $("routineFileActions"),
  routinesDownload: $("routinesDownload"),
  routinesImport: $("routinesImport"),
  routineFileMessage: $("routineFileMessage"),
  workoutsNote: $("workoutsNote"),
  workoutList: $("workoutList"),
  workoutNew: $("workoutNew"),
  wEdit: {
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
  wSum: {
    title: $("wSumTitle"),
    meta: $("wSumMeta"),
    list: $("wSumList"),
    error: $("wSumError"),
    discard: $("wSumDiscard"),
    save: $("wSumSave"),
  },
  listTabs: document.querySelectorAll("#routineTabs button"),
  routineEmpty: $("routineEmpty"),
  templatesNote: $("templatesNote"),
  edit: {
    title: $("editTitle"),
    name: $("editName"),
    sets: $("editSets"),
    reps: $("editReps"),
    workS: $("editWork"),
    restS: $("editRest"),
    setRestS: $("editSetRest"),
    prepS: $("editPrep"),
    hands: $("editHands"),
    type: $("editType"),
    typeHint: $("editTypeHint"),
    instruction: $("editInstruction"),
    perSet: $("editPerSet"),
    setInstructions: $("editSetInstructions"),
    weightBlock: $("editWeightBlock"),
    useWeight: $("editUseWeight"),
    weightRow: $("editWeightRow"),
    weight: $("editWeight"),
    workField: $("editWorkField"),
    workLabel: $("editWorkLabel"),
    targetBlock: $("editTargetBlock"),
    repsLabel: $("editRepsLabel"),
    restLabel: $("editRestLabel"),
    targetType: $("editTargetType"),
    targetValue: $("editTargetValue"),
    targetUnit: $("editTargetUnit"),
    targetRow: $("editTargetValueRow"),
    duration: $("editDuration"),
    error: $("editError"),
    cancel: $("editCancel"),
    save: $("editSave"),
    remove: $("editDelete"),
    download: $("editDownload"),
  },
  setup: {
    title: $("setupTitle"),
    description: $("setupDescription"),
    hands: document.querySelectorAll("#setupHand button"),
    cancel: $("setupCancel"),
    start: $("setupStart"),
  },
  run: {
    card: $("runPhaseCard"),
    phase: $("runPhase"),
    countdown: $("runCountdown"),
    progress: $("runProgress"),
    next: $("runNext"),
    kg: $("runKg"),
    target: $("runTarget"),
    held: $("runHeld"),
    repInfo: $("runRepInfo"),
    chart: $("runChart"),
    pause: $("runPause"),
    skip: $("runSkip"),
    stop: $("runStop"),
    wakeHint: $("runWakeHint"),
    screen: $("trainRun"),
    instruction: $("runInstruction"),
    done: $("runDone"),
    setLog: $("runSetLog"),
    setLogTitle: $("setLogTitle"),
    setLogRpe: $("setLogRpe"),
    setLogWeightRow: $("setLogWeightRow"),
    setLogWeight: $("setLogWeight"),
    setLogMinus: $("setLogMinus"),
    setLogPlus: $("setLogPlus"),
  },
  summary: {
    view: $("sumView"),
    sets: $("sumSets"),
    setRows: $("sumSetRows"),
    error: $("sumError"),
    discard: $("sumDiscard"),
    save: $("sumSave"),
    rawCsv: $("sumRawCsv"),
    json: $("sumJson"),
  },
};

let editing = null; // routine being edited (copy)
let setup = null; // test being set up: { kind, hand }
let run = null; // active workout or test
let result = null; // finished, unsaved session
let resultRaw = null; // its full-rate curve and per-sample phase (not saved with the session)
let chart = null;
let summaryChart = null;
let selects = null; // TagSelects: editHold, editGrip, setupHold, setupGrip
let editingWorkout = null; // { id, name, routineIds, isNew }
let workoutRun = null; // running workout: { workout, routines, index, sessions }

// Screens per tab; run and summary belong to the tab they are mounted in (runHost).
const GROUPS = { train: ["list", "edit", "workoutEdit", "between", "workoutSummary"], tests: ["tests", "setup"] };
const HOME = { train: "list", tests: "tests" };
let runHost = "train";

function show(screen) {
  const group = Object.keys(GROUPS).find((g) => GROUPS[g].includes(screen)) ?? runHost;
  const names = [...GROUPS[group], ...(group === runHost ? ["run", "summary"] : [])];
  for (const name of names) el.screens[name].hidden = name !== screen;
  window.scrollTo(0, 0);
}

// Moves the shared run/summary screens into the tab a run starts from.
function mountRunScreens(group) {
  if (group === runHost) return;
  if (!el.screens.run.hidden || !el.screens.summary.hidden) show(HOME[runHost]);
  $(`view-${group}`).append(el.screens.run, el.screens.summary);
  runHost = group;
}

function create(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function button(className, text, onClick) {
  const b = create("button", { type: "button", className, textContent: text });
  b.addEventListener("click", onClick);
  return b;
}

// "12 min", or "8 min + reps" when self-paced reps add an unknown time.
function routineDuration(r) {
  return formatDuration(totalDurationS(r)) + (isOpenEnded(r) ? " + reps" : "");
}

function workoutDuration(w) {
  const open = w.routineIds.some((id) => {
    const r = routines.find(id);
    return r && isOpenEnded(r);
  });
  return formatDuration(workoutDurationS(w, routines.all)) + (open ? " + reps" : "");
}

function describe(r) {
  const alternate = r.hands === "alternate";
  const type = r.type || "hangboard";
  const parts = [`${r.sets} × ${r.reps}${alternate ? " per hand" : ""}`];
  if (type !== "selfpaced") parts.push(`${r.workS} s on`);
  if (alternate) parts.push(`${r.restS} s hand change`);
  else if (r.reps > 1) parts.push(`${r.restS} s off`);
  if (r.sets > 1) parts.push(`${formatDuration(r.setRestS)} between sets`);
  if (r.target.type === "kg") parts.push(`target ${r.target.value} kg`);
  if (r.target.type === "bw") parts.push(`target ${r.target.value} % BW`);
  if (r.addedWeightKg !== null && r.addedWeightKg !== undefined) {
    parts.push(`${r.addedWeightKg >= 0 ? "+" : "−"}${formatKg(Math.abs(r.addedWeightKg))} kg`);
  }
  const typeLabel = type === "hangboard" ? "" : ROUTINE_TYPES[type].label;
  const tags = [typeLabel, r.holdType, r.grip, r.hands && r.hands !== "both" ? HANDS[r.hands] : ""].filter(Boolean);
  return [...tags, ...parts].join(" · ");
}

// ---------------------------------------------------------------- list

function renderTests() {
  el.tests.replaceChildren(
    ...TEST_IDS.map((id) => {
      const kind = KINDS[id];
      return create("div", { className: "card routine" }, [
        create("div", { className: "routine-head" }, [
          create("h2", { textContent: kind.name }),
          create("span", { className: "muted", textContent: formatDuration(totalDurationS(kind.routine)) }),
        ]),
        create("p", { className: "muted", textContent: kind.description }),
        button("primary", "Start test", () => openSetup(id)),
      ]);
    }),
  );
}

// Which list the Train tab shows: "mine" or "templates". Null until chosen, then
// remembered per browser; by default "mine" when there are own routines.
let listView = null;
try {
  listView = localStorage.getItem(LIST_KEY);
} catch {
  // storage unavailable: use the default
}

function setListView(view) {
  listView = view;
  try {
    localStorage.setItem(LIST_KEY, view);
  } catch {
    // not remembered
  }
  renderList();
}

function renderList() {
  const view = listView ?? (routines.custom.length ? "mine" : "templates");
  for (const b of el.listTabs) {
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
  const list = view === "mine" ? routines.custom : view === "templates" ? BUILTIN_ROUTINES : [];
  el.routineEmpty.hidden = view !== "mine" || list.length > 0;
  el.templatesNote.hidden = view !== "templates";
  el.newRoutine.hidden = view !== "mine";
  el.routineFileActions.hidden = view !== "mine";
  el.routinesDownload.hidden = !routines.custom.length;
  if (view !== "mine") showRoutineFileMessage("");
  el.list.replaceChildren(
    ...list.map((r) =>
      create("div", { className: "card routine" }, [
        create("div", { className: "routine-head" }, [
          create("h2", { textContent: r.name }),
          create("span", { className: "muted", textContent: routineDuration(r) }),
        ]),
        create("p", { className: "muted", textContent: describe(r) }),
        ...(r.instruction ? [create("p", { className: "muted instruction", textContent: r.instruction })] : []),
        create("div", { className: "actions" }, [
          button("secondary", r.builtin ? "Copy & edit" : "Edit", () => openEditor(r)),
          button("primary", "Start", () => startRun("workout", r, r.hands || "both")),
        ]),
      ]),
    ),
  );
}

function showListError(text) {
  el.listError.textContent = text;
  el.listError.hidden = !text;
}

// Home screen of the tab a run started from.
function homeOf(kind) {
  return HOME[groupOf(kind)];
}

function groupOf(kind) {
  return kind === "workout" ? "train" : "tests";
}

function showNotice(home, text) {
  for (const [name, node] of Object.entries(el.notices)) {
    node.textContent = name === home ? text : "";
    node.hidden = name !== home || !text;
  }
}

// ---------------------------------------------------------------- editor

function openEditor(r) {
  const isNew = !r || r.builtin;
  editing = r
    ? structuredClone({ ...r, id: r.builtin ? newRoutineId() : r.id, builtin: false })
    : { ...structuredClone(BUILTIN_ROUTINES[0]), id: newRoutineId(), name: "", builtin: false };
  if (r && r.builtin) editing.name = `${r.name} (copy)`;

  const e = el.edit;
  e.title.textContent = isNew ? "New routine" : "Edit routine";
  e.name.value = editing.name;
  selects.editHold.value = editing.holdType || "";
  selects.editGrip.value = editing.grip || "";
  e.hands.value = editing.hands || "both";
  e.type.value = editing.type || "hangboard";
  e.instruction.value = editing.instruction || "";
  editSetTexts = [...(editing.setInstructions || [])];
  e.perSet.checked = editSetTexts.length > 0;
  e.useWeight.checked = editing.addedWeightKg !== null && editing.addedWeightKg !== undefined;
  e.weight.value = e.useWeight.checked ? editing.addedWeightKg : "";
  for (const key of ["sets", "reps", "workS", "restS", "setRestS", "prepS"]) e[key].value = editing[key];
  renderSetInstructions();
  e.targetType.value = editing.target.type;
  e.targetValue.value = editing.target.type === "none" ? "" : editing.target.value;
  e.remove.hidden = isNew;
  e.download.hidden = isNew;
  e.error.hidden = true;
  updateEditorDerived();
  show("edit");
}

function readEditor() {
  const e = el.edit;
  const int = (input) => (input.value.trim() === "" ? NaN : Number(input.value));
  const routineType = e.type.value;
  const sensor = ROUTINE_TYPES[routineType].sensor;
  const type = sensor ? e.targetType.value : "none";
  const sets = int(e.sets);
  return {
    id: editing.id,
    name: e.name.value.trim(),
    type: routineType,
    instruction: e.instruction.value.trim(),
    setInstructions: e.perSet.checked ? editSetTexts.slice(0, sets).map((t) => (t || "").trim()) : [],
    addedWeightKg: !sensor && e.useWeight.checked ? parseFloat(e.weight.value) : null,
    holdType: selects.editHold.value,
    grip: selects.editGrip.value,
    hands: e.hands.value,
    sets,
    reps: int(e.reps),
    workS: routineType === "selfpaced" ? 0 : int(e.workS),
    restS: int(e.restS),
    setRestS: int(e.setRestS),
    prepS: int(e.prepS),
    target: { type, value: type === "none" ? 0 : parseFloat(e.targetValue.value) },
  };
}

// One text field per set when "Different instruction per set" is on; texts are kept
// while the number of sets changes.
let editSetTexts = [];

function renderSetInstructions() {
  const e = el.edit;
  const sets = Math.max(0, Math.min(20, Number(e.sets.value) || 0));
  e.setInstructions.hidden = !e.perSet.checked;
  if (!e.perSet.checked) return;
  e.setInstructions.replaceChildren(
    ...Array.from({ length: sets }, (_, i) => {
      const input = create("input", { type: "text", maxLength: 100, value: editSetTexts[i] || "", placeholder: e.instruction.value || "e.g. 1-4-7" });
      input.setAttribute("aria-label", `Instruction for set ${i + 1}`);
      input.addEventListener("input", () => {
        editSetTexts[i] = input.value;
        updateEditorDerived();
      });
      return create("label", { className: "field" }, [create("span", { textContent: `Set ${i + 1}` }), input]);
    }),
  );
}

const TYPE_HINTS = {
  hangboard: "Measures force with the sensor: hold %, target load and the force graph.",
  timed: "Work and rest by the clock. No sensor needed.",
  selfpaced: "Each rep lasts until you tap Done (e.g. a campus ladder), then the rest counts down. No sensor needed.",
};

function updateEditorDerived() {
  const e = el.edit;
  const routineType = e.type.value;
  const sensor = ROUTINE_TYPES[routineType].sensor;
  e.typeHint.textContent = TYPE_HINTS[routineType];
  e.targetBlock.hidden = !sensor;
  e.workField.hidden = routineType === "selfpaced";
  e.workLabel.textContent = sensor ? "Hang (s)" : "Work (s)";
  e.weightBlock.hidden = sensor;
  e.weightRow.hidden = !e.useWeight.checked;
  const type = sensor ? e.targetType.value : "none";
  e.targetRow.hidden = type === "none";
  const alternate = e.hands.value === "alternate";
  e.repsLabel.textContent = alternate ? "Reps per set (per hand)" : "Reps per set";
  e.restLabel.textContent = alternate ? "Change hand (s)" : "Rest (s)";
  e.targetUnit.textContent = type === "bw" ? "% BW" : "kg";
  const r = readEditor();
  e.duration.textContent = validateRoutine(r) ? "" : `Total time ${routineDuration(r)}`;
}

async function saveEditor() {
  const r = readEditor();
  const error = validateRoutine(r);
  el.edit.error.textContent = error || "";
  el.edit.error.hidden = !error;
  if (error) return;
  try {
    await routines.save(r);
    setListView("mine"); // a copied template lands under My routines
    show("list");
  } catch (err) {
    el.edit.error.textContent = err.message;
    el.edit.error.hidden = false;
  }
}

// ---------------------------------------------------------------- workouts

function renderWorkouts() {
  if (!workouts.list.length) {
    el.workoutList.replaceChildren(create("p", { className: "muted empty-note", textContent: "No workouts yet." }));
    return;
  }
  el.workoutList.replaceChildren(
    ...workouts.list.map((w) => {
      const items = resolveRoutines(w, routines.all);
      const names = items.map((r) => (r ? r.name : "(deleted routine)")).join(" → ");
      return create("div", { className: "card routine" }, [
        create("div", { className: "routine-head" }, [
          create("h2", { textContent: w.name }),
          create("span", { className: "muted", textContent: workoutDuration(w) }),
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

function openWorkoutEditor(w) {
  editingWorkout = w ? { ...structuredClone(w), isNew: false } : { id: newWorkoutId(), name: "", routineIds: [], isNew: true };
  el.wEdit.title.textContent = editingWorkout.isNew ? "New workout" : "Edit workout";
  el.wEdit.name.value = editingWorkout.name;
  el.wEdit.remove.hidden = editingWorkout.isNew;
  el.wEdit.error.hidden = true;
  renderWorkoutAddOptions();
  renderWorkoutItems();
  show("workoutEdit");
}

function renderWorkoutAddOptions() {
  const group = (label, list) =>
    create("optgroup", { label }, list.map((r) => create("option", { value: r.id, textContent: r.name })));
  const groups = [];
  if (routines.custom.length) groups.push(group("My routines", routines.custom));
  groups.push(group("Templates", BUILTIN_ROUTINES));
  el.wEdit.add.replaceChildren(...groups);
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
  el.wEdit.items.replaceChildren(
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
  if (!ids.length) el.wEdit.items.replaceChildren(create("li", { className: "muted", textContent: "No routines yet. Add one below." }));
  el.wEdit.duration.textContent = ids.length ? `Total time ${workoutDuration(editingWorkout)}` : "";
}

async function saveWorkoutEditor() {
  const w = { id: editingWorkout.id, name: el.wEdit.name.value.trim(), routineIds: editingWorkout.routineIds };
  const error = validateWorkout(w);
  el.wEdit.error.textContent = error || "";
  el.wEdit.error.hidden = !error;
  if (error) return;
  try {
    await workouts.save(w);
    show("list");
  } catch (err) {
    el.wEdit.error.textContent = err.message;
    el.wEdit.error.hidden = false;
  }
}

async function deleteWorkout() {
  if (!confirm(`Delete the workout "${editingWorkout.name}"? Its routines are kept.`)) return;
  try {
    await workouts.remove(editingWorkout.id);
    show("list");
  } catch (err) {
    el.wEdit.error.textContent = err.message;
    el.wEdit.error.hidden = false;
  }
}

// Running: each routine is a normal run; endRun() hands the session over to
// workoutRoutineDone() instead of showing the routine summary.
function startWorkout(w) {
  const items = resolveRoutines(w, routines.all).filter(Boolean);
  if (!items.length) {
    alert("This workout has no routines left. Edit it to add some.");
    return;
  }
  workoutRun = { workout: w, routines: items, index: 0, sessions: [] };
  startWorkoutRoutine();
}

function startWorkoutRoutine() {
  const r = workoutRun.routines[workoutRun.index];
  startRun("workout", r, r.hands || "both");
  if (run) {
    run.inWorkout = true; // set synchronously by startRun before its first await
  } else if (workoutRun.sessions.length) {
    showWorkoutSummary(); // declined to start without the sensor: end the workout here
  } else {
    workoutRun = null;
  }
}

function shortResult(s) {
  if (s.sets) {
    // Without the sensor: reps, effort, weight.
    const t = s.summary;
    const parts = [`${t.repsDone}/${t.totalReps} reps`];
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
  el.wSum.title.textContent = workout.name;
  const totalS = done.reduce((sum, s) => sum + s.durationS, 0);
  el.wSum.meta.textContent = `${done.length} of ${items.length} routines · ${formatDuration(totalS)}`;
  el.wSum.list.replaceChildren(
    ...done.map((s, i) =>
      create("div", { className: "card" }, [
        ...resultRow(s, `${i + 1}. ${s.name}${s.stopped ? " (stopped)" : ""}`),
      ]),
    ),
  );
  el.wSum.error.hidden = true;
  el.wSum.save.disabled = false;
  show("workoutSummary");
}

async function saveWorkout() {
  el.wSum.save.disabled = true;
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
    el.wSum.error.textContent = err.message;
    el.wSum.error.hidden = false;
    el.wSum.save.disabled = false;
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

// ---------------------------------------------------------------- routine files

function showRoutineFileMessage(text, isError = false) {
  el.routineFileMessage.textContent = text;
  el.routineFileMessage.classList.toggle("error-text", isError);
}

function routineFileName(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "routine";
  return `erkdek-routine-${slug}.json`;
}

async function importRoutines() {
  const file = el.routinesImport.files[0];
  el.routinesImport.value = "";
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
    showRoutineFileMessage(
      `Imported ${imported.length} routine${imported.length === 1 ? "" : "s"}` + (skipped ? ` (${skipped} invalid skipped).` : "."),
    );
  } catch (err) {
    showRoutineFileMessage(err.message, true);
  }
}

async function deleteEditing() {
  if (!confirm(`Delete "${editing.name}"?`)) return;
  try {
    await routines.remove(editing.id);
    show("list");
  } catch (err) {
    el.edit.error.textContent = err.message;
    el.edit.error.hidden = false;
  }
}

// ---------------------------------------------------------------- test setup

function loadSetupDefaults(kind) {
  try {
    return JSON.parse(localStorage.getItem(SETUP_KEY))?.[kind] || {};
  } catch {
    return {};
  }
}

function saveSetupDefaults(kind, values) {
  try {
    const all = JSON.parse(localStorage.getItem(SETUP_KEY)) || {};
    all[kind] = values;
    localStorage.setItem(SETUP_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: setup just isn't remembered
  }
}

function setHand(hand) {
  setup.hand = hand;
  for (const b of el.setup.hands) b.classList.toggle("active", b.dataset.hand === hand);
}

function openSetup(kind) {
  const defaults = loadSetupDefaults(kind);
  setup = { kind };
  el.setup.title.textContent = KINDS[kind].name;
  el.setup.description.textContent = KINDS[kind].description;
  setHand(defaults.hand || "both");
  selects.setupHold.value = defaults.holdType || "";
  selects.setupGrip.value = defaults.grip || "";
  show("setup");
}

function startTest() {
  const values = { hand: setup.hand, holdType: selects.setupHold.value, grip: selects.setupGrip.value };
  saveSetupDefaults(setup.kind, values);
  const routine = {
    ...KINDS[setup.kind].routine,
    name: KINDS[setup.kind].name,
    holdType: values.holdType,
    grip: values.grip,
    target: { type: "none", value: 0 },
  };
  startRun(setup.kind, routine, values.hand);
}

// ---------------------------------------------------------------- running


async function startRun(kind, routine, hand) {
  // Tests always use the sensor; routines only when they are hangboard routines.
  const sensor = kind !== "workout" || usesSensor(routine);
  if (sensor && !device.connected && !confirm(`"${routine.name}" uses the sensor, which isn't connected. Start anyway?`)) {
    return;
  }
  unlockAudio();
  mountRunScreens(groupOf(kind));
  const target = targetKg(routine, settings.values.bodyweightKg);
  const phases = buildPhases(routine);
  run = {
    kind,
    routine,
    hand,
    phases,
    engine: new WorkoutEngine(phases),
    target,
    threshold: loadThresholdKg(target, settings.values.repThresholdKg),
    index: -1,
    repSamples: null,
    attempts: [], // raw samples of each work phase
    reps: [],
    curve: [], // every sample while not paused
    curvePhase: [], // phase index of each curve sample
    smoothed: null,
    startedAt: new Date(),
    timer: null,
    sensor,
    repStartS: 0, // elapsed time when the current rep began (non-sensor rep times)
    sets: [], // per set: { set, rpe, addedWeightKg } (non-sensor routines)
    nextWeightKg: null, // weight entered for the next set
  };
  el.run.held.hidden = true;
  el.run.screen.dataset.sensor = String(sensor);
  el.run.setLog.hidden = true;
  chart.clear();
  chart.setTarget(target);
  el.run.target.textContent = target !== null ? `Target ${formatKg(target)} kg` : kind === "workout" ? "No target" : HANDS[hand];
  if (routine.target.type === "bw" && target === null) el.run.target.textContent = "Set bodyweight for a % target";
  el.run.pause.textContent = "Pause";
  show("run");
  el.run.wakeHint.hidden = await keepScreenOn();

  run.engine.start(performance.now() / 1000);
  run.timer = setInterval(tick, TICK_MS);
  tick();
}

function sampleDtS() {
  return 1 / (device.status?.rate || 80);
}

// Lets the simulator follow the workout (see mock.js).
function announcePhase(type) {
  window.dispatchEvent(new CustomEvent("erkdek:phase", { detail: { type } }));
}

function finishRep(now) {
  const prev = run.phases[run.index];
  if (!run.sensor) {
    if (prev?.type === PHASE.WORK) {
      const durationS = prev.durS ?? run.engine.elapsed(now) - run.repStartS;
      run.reps.push({ set: prev.set, rep: prev.rep, hand: prev.hand, durationS: Math.round(durationS * 10) / 10 });
    }
    return;
  }
  if (!run.repSamples) return;
  const phase = run.phases[run.index];
  run.attempts.push(run.repSamples);
  run.reps.push({ set: phase.set, rep: phase.rep, hand: phase.hand, ...repStats(run.repSamples, sampleDtS(), run.threshold, phase.durS, run.target) });
  run.repSamples = null;
}

function enterPhase(i, now) {
  const prev = run.phases[run.index];
  finishRep(now);
  // A set ends when its last rep ends (the next phase belongs to another set, or done).
  if (!run.sensor && prev?.type === PHASE.WORK && (i >= run.phases.length || run.phases[i].set !== prev.set)) {
    setEnded(prev.set, i >= run.phases.length);
  }
  run.index = i;
  if (i >= run.phases.length) {
    announcePhase("done");
    return;
  }
  const phase = run.phases[i];
  announcePhase(phase.type);
  if (phase.type === PHASE.WORK) {
    run.repSamples = [];
    run.repLoadedSamples = 0;
    run.repStartS = run.engine.elapsed(now);
    el.run.setLog.hidden = true;
  }
}

// ---- per-set log (effort, added weight) for routines without the sensor

function setLog(set) {
  let log = run.sets.find((s) => s.set === set);
  if (!log) {
    // Weight: what was entered after the previous set, else that set's, else the routine's.
    const weight = run.nextWeightKg ?? run.sets.at(-1)?.addedWeightKg ?? run.routine.addedWeightKg ?? null;
    log = { set, rpe: null, addedWeightKg: weight };
    run.sets.push(log);
  }
  return log;
}

function setEnded(set, last) {
  const log = setLog(set);
  if (last) return; // the summary lets you log the last set
  const r = run.routine;
  el.run.setLogTitle.textContent = `Set ${set} of ${r.sets} done`;
  renderRpeButtons(log);
  const usesWeight = r.addedWeightKg !== null && r.addedWeightKg !== undefined;
  el.run.setLogWeightRow.hidden = !usesWeight;
  if (usesWeight) el.run.setLogWeight.value = run.nextWeightKg ?? log.addedWeightKg;
  el.run.setLog.hidden = false;
}

function renderRpeButtons(log) {
  el.run.setLogRpe.replaceChildren(
    ...Array.from({ length: 10 }, (_, i) => {
      const value = i + 1;
      const b = button(log.rpe === value ? "active" : "", String(value), () => {
        log.rpe = log.rpe === value ? null : value; // tap again to clear
        renderRpeButtons(log);
      });
      b.setAttribute("aria-pressed", String(log.rpe === value));
      return b;
    }),
  );
}

// The weight entered after a set is what the next set is done with.
function changeLoggedWeight(value) {
  if (!Number.isFinite(value)) return;
  run.nextWeightKg = Math.round(value * 10) / 10;
  el.run.setLogWeight.value = run.nextWeightKg;
}

function phaseName(type) {
  if (type === PHASE.WORK && !run.sensor) return run.routine.type === "selfpaced" ? "Go" : "Work";
  if (type === PHASE.WORK) return KINDS[run.kind].workLabel;
  if (type === PHASE.REST && run.routine.hands === "alternate") return "Change hand";
  return { prep: "Get ready", rest: "Rest", setRest: "Set rest" }[type];
}

function tick() {
  const now = performance.now() / 1000;
  const state = run.engine.update(now);
  for (const i of state.entered) enterPhase(i, now);
  // One beep per change (hang starts, rest starts, finished); not when starting.
  if (state.entered.some((i) => i > 0)) beep();
  if (state.done) {
    endRun(false);
    return;
  }

  const { phase, remainingS, inPhaseS } = state;
  const next = run.phases[state.index + 1];
  const r = run.routine;
  el.run.card.dataset.phase = phase.type;
  const handLabel = (p) => (p.hand && p.hand !== "both" ? ` · ${p.hand}` : "");
  el.run.phase.textContent = run.engine.paused ? "Paused" : phaseName(phase.type) + (phase.type === PHASE.WORK ? handLabel(phase) : "");
  // Countdown, or a stopwatch while a self-paced rep waits for Done.
  el.run.countdown.textContent = remainingS === null ? formatClock(inPhaseS) : Math.ceil(remainingS);
  el.run.done.hidden = !run.engine.waitingForDone;
  el.run.skip.hidden = run.engine.waitingForDone;
  const instruction = instructionFor(r, phase.set);
  el.run.instruction.hidden = !instruction;
  el.run.instruction.textContent = instruction;
  el.run.progress.textContent =
    r.reps * hangsPerRep(r) > 1 ? `Set ${phase.set}/${r.sets} · Rep ${phase.rep}/${r.reps}` : `Attempt ${phase.set}/${r.sets}`;
  const nextTime = (p) => (p.durS === null ? "" : ` ${formatDuration(p.durS)}`);
  el.run.next.textContent = next ? `Next: ${phaseName(next.type)}${nextTime(next)}${handLabel(next)}` : "Last one!";

  if (!run.sensor) return;
  const kg = run.smoothed ?? 0;
  el.run.kg.textContent = device.connected ? formatKg(kg) : "–";
  el.run.kg.dataset.status = targetStatus(kg, run.target) ?? "";
  renderHeld(phase);
  chart.render();
}

const round2 = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);

function buildSession(stopped) {
  const dtS = sampleDtS();
  const r = run.routine;
  const reps = run.reps.map((rep) => Object.fromEntries(Object.entries(rep).map(([k, v]) => [k, round2(v)])));
  const summary = KINDS[run.kind].analyze({ reps: run.reps, attempts: run.attempts, dtS, routine: r, target: run.target, sets: run.sets });
  const session = {
    id: newSessionId(),
    type: run.kind,
    name: r.name,
    startedAt: run.startedAt.toISOString(),
    durationS: Math.round((Date.now() - run.startedAt.getTime()) / 1000), // wall time, incl. skips/pauses
    holdType: r.holdType || "",
    grip: r.grip || "",
    hand: run.hand,
    bodyweightKg: settings.values.bodyweightKg || 0,
    targetKg: run.target,
    summary: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, Array.isArray(v) ? v.map(round2) : round2(v)])),
    reps,
    curve: compressCurve(run.curve, 1 / dtS, { minKg: CURVE_MIN_KG, maxPoints: CURVE_MAX_POINTS }),
  };
  if (run.kind === "workout") {
    const { name, type, instruction, setInstructions, addedWeightKg, holdType, grip, hands } = r;
    const { sets, reps: repCount, workS, restS, setRestS, prepS, target } = r;
    session.routine = {
      id: r.id,
      name,
      type: type || "hangboard",
      instruction,
      setInstructions,
      addedWeightKg,
      holdType,
      grip,
      hands,
      sets,
      reps: repCount,
      workS,
      restS,
      setRestS,
      prepS,
      target,
    };
    if (!run.sensor) session.sets = run.sets.map((x) => ({ ...x }));
  }
  if (stopped) session.stopped = true;
  if (run.inWorkout) {
    session.workout = { id: workoutRun.workout.id, name: workoutRun.workout.name, index: workoutRun.index + 1, count: workoutRun.routines.length };
  }
  return session;
}

// Routines only: how long the current rep has been held, the last rep's hold % and
// the average hold % of the reps done so far.
function renderHeld(phase) {
  const show = run.kind === "workout";
  el.run.held.hidden = !show || !run.reps.length;
  el.run.repInfo.hidden = !show;
  if (!show) return;
  const avgHold = run.reps.reduce((sum, r) => sum + r.holdPct, 0) / (run.reps.length || 1);
  el.run.held.textContent = `Hold ${Math.round(avgHold)} % so far`;

  const last = run.reps.at(-1);
  if (phase.type === PHASE.WORK) {
    el.run.repInfo.textContent = `Held ${(run.repLoadedSamples * sampleDtS()).toFixed(1)} / ${phase.durS} s`;
    el.run.repInfo.dataset.state = "live";
  } else if (last) {
    el.run.repInfo.textContent = `Last rep ${Math.round(last.holdPct)} %${last.completed ? " ✓" : ""}`;
    el.run.repInfo.dataset.state = last.completed ? "held" : "short";
  } else {
    el.run.repInfo.textContent = "";
  }
}

function endRun(stopped) {
  if (stopped) announcePhase("done");
  clearInterval(run.timer);
  allowScreenOff();
  if (stopped) {
    const now = performance.now() / 1000;
    const prev = run.phases[run.index];
    finishRep(now);
    if (!run.sensor && prev?.type === PHASE.WORK) setLog(prev.set);
  }
  const session = buildSession(stopped);
  const raw = { hz: 1 / sampleDtS(), kg: run.curve, phases: run.curvePhase.map((i) => run.phases[i] ?? null) };
  const inWorkout = run.inWorkout;
  run = null;
  if (inWorkout) {
    workoutRoutineDone(session, stopped);
    return;
  }
  result = session;
  resultRaw = raw;
  showSummary();
}

function stopRun() {
  const message = run.inWorkout
    ? "Stop this routine and end the workout? You can still save what you've done."
    : "Stop now? You can still save what you've done so far.";
  if (!confirm(message)) return;
  endRun(true);
}

function togglePause() {
  const now = performance.now() / 1000;
  if (run.engine.paused) run.engine.resume(now);
  else run.engine.pause(now);
  el.run.pause.textContent = run.engine.paused ? "Resume" : "Pause";
  tick();
}

// ---------------------------------------------------------------- summary

function showSummary() {
  if (summaryChart) summaryChart.destroy();
  el.summary.error.hidden = true;
  el.summary.save.disabled = false;
  show("summary");
  summaryChart = renderSession(el.summary.view, result);
  renderSetEditor();
}

// Routines without the sensor: effort and weight per set can be filled in or corrected
// before saving (the last set is always logged here).
function renderSetEditor() {
  const sets = result?.sets;
  el.summary.sets.hidden = !sets?.length;
  if (!sets?.length) return;
  const r = result.routine;
  const usesWeight = r.addedWeightKg !== null && r.addedWeightKg !== undefined;
  const refresh = () => {
    result.summary = summarizeTraining(result.reps, result.sets, r);
    renderSession(el.summary.view, result);
  };
  el.summary.setRows.replaceChildren(
    ...sets.map((log) => {
      const select = create("select", {}, [
        create("option", { value: "", textContent: "Effort –" }),
        ...Array.from({ length: 10 }, (_, i) => create("option", { value: String(i + 1), textContent: `Effort ${i + 1}` })),
      ]);
      select.value = log.rpe ?? "";
      select.addEventListener("change", () => {
        log.rpe = select.value ? Number(select.value) : null;
        refresh();
      });
      const cells = [create("strong", { textContent: `Set ${log.set}` }), select];
      if (usesWeight) {
        const input = create("input", { type: "number", step: "0.5", inputMode: "decimal", value: log.addedWeightKg ?? "" });
        input.setAttribute("aria-label", `Added weight in set ${log.set} (kg)`);
        input.addEventListener("change", () => {
          const v = parseFloat(input.value);
          log.addedWeightKg = Number.isFinite(v) ? v : null;
          refresh();
        });
        cells.push(input);
      }
      return create("div", { className: "set-row" }, cells);
    }),
  );
}

async function saveResult() {
  el.summary.save.disabled = true;
  try {
    await sessions.save(result);
    const home = homeOf(result.type);
    result = null;
    resultRaw = null;
    show(home);
    showNotice(home, "Saved to history.");
  } catch (err) {
    el.summary.error.textContent = err.message;
    el.summary.error.hidden = false;
    el.summary.save.disabled = false;
  }
}

function discardResult() {
  if (!confirm("Discard this session? It will not be saved.")) return;
  const home = homeOf(result.type);
  result = null;
  resultRaw = null;
  show(home);
}

// ---------------------------------------------------------------- init

// Tab tapped again: back to that tab's main screen, unless a run or an unsaved
// summary is showing there (those are only left via Stop / Save / Discard).
export function goHome(group) {
  const busy = group === runHost && (run !== null || result !== null || (group === "train" && workoutRun !== null));
  if (!busy) show(HOME[group]);
  window.scrollTo(0, 0);
}

export function initTrain() {
  chart = new LiveChart(el.run.chart);
  chart.setWindow(10);
  selects = {
    editHold: new TagSelect($("editHold"), holdTypes, "Hold", "e.g. 18 mm edge"),
    editGrip: new TagSelect($("editGrip"), grips, "Grip", "e.g. Four-finger open"),
    setupHold: new TagSelect($("setupHold"), holdTypes, "Hold", "e.g. 18 mm edge"),
    setupGrip: new TagSelect($("setupGrip"), grips, "Grip", "e.g. Four-finger open"),
  };

  routines.addEventListener("change", renderList);
  workouts.addEventListener("change", renderList);
  // Data is stored in the app, so it loads right away (no device needed).
  for (const store of [routines, holdTypes, grips, workouts]) store.load().catch((e) => showListError(e.message));
  device.on("samples", (msg) => {
    if (!run || !run.sensor) return;
    chart.push(msg.ts, msg.te ?? msg.ts, msg.kg);
    for (const kg of msg.kg) run.smoothed = run.smoothed === null ? kg : run.smoothed + 0.08 * (kg - run.smoothed);
    if (run.engine.paused || run.index < 0) return; // not started yet (or paused)
    run.curve.push(...msg.kg);
    for (let i = 0; i < msg.kg.length; i++) run.curvePhase.push(run.index);
    if (run.repSamples) {
      run.repSamples.push(...msg.kg);
      for (const kg of msg.kg) if (kg >= run.threshold) run.repLoadedSamples++;
    }
  });
  document.addEventListener("visibilitychange", () => {
    // The browser drops its wake lock when the page is hidden; take it again.
    if (run && document.visibilityState === "visible") keepScreenOn();
  });
  window.addEventListener("hashchange", () => showNotice(null, ""));

  el.newRoutine.addEventListener("click", () => openEditor(null));
  el.edit.perSet.addEventListener("change", () => {
    renderSetInstructions();
    updateEditorDerived();
  });
  el.edit.sets.addEventListener("input", renderSetInstructions);
  el.edit.instruction.addEventListener("input", renderSetInstructions);
  el.workoutNew.addEventListener("click", () => openWorkoutEditor(null));
  el.wEdit.addButton.addEventListener("click", () => {
    if (!el.wEdit.add.value) return;
    editingWorkout.routineIds = [...editingWorkout.routineIds, el.wEdit.add.value];
    renderWorkoutItems();
  });
  el.wEdit.cancel.addEventListener("click", () => show("list"));
  el.wEdit.save.addEventListener("click", saveWorkoutEditor);
  el.wEdit.remove.addEventListener("click", deleteWorkout);
  el.between.start.addEventListener("click", startNextWorkoutRoutine);
  el.between.end.addEventListener("click", endWorkoutEarly);
  el.wSum.save.addEventListener("click", saveWorkout);
  el.wSum.discard.addEventListener("click", discardWorkout);
  for (const b of el.listTabs) b.addEventListener("click", () => setListView(b.dataset.list));
  el.edit.cancel.addEventListener("click", () => show("list"));
  el.edit.save.addEventListener("click", saveEditor);
  el.edit.remove.addEventListener("click", deleteEditing);
  el.edit.download.addEventListener("click", () => {
    const r = readEditor();
    const error = validateRoutine(r);
    if (error) {
      el.edit.error.textContent = error;
      el.edit.error.hidden = false;
      return;
    }
    downloadJson(routineFileName(r.name), buildRoutineFile([r]));
  });
  el.routinesDownload.addEventListener("click", () =>
    downloadJson(`erkdek-routines-${fileDate()}.json`, buildRoutineFile(routines.custom)),
  );
  el.routinesImport.addEventListener("change", importRoutines);
  for (const input of el.screens.edit.querySelectorAll("input, select, textarea")) {
    input.addEventListener("input", updateEditorDerived);
  }
  for (const b of el.setup.hands) b.addEventListener("click", () => setHand(b.dataset.hand));
  el.setup.cancel.addEventListener("click", () => show("tests"));
  el.setup.start.addEventListener("click", startTest);
  el.run.pause.addEventListener("click", togglePause);
  el.run.skip.addEventListener("click", () => {
    run.engine.skip(performance.now() / 1000);
    tick();
  });
  el.run.stop.addEventListener("click", stopRun);
  el.run.done.addEventListener("click", () => {
    run.engine.finishRep(performance.now() / 1000);
    tick();
  });
  el.run.setLogMinus.addEventListener("click", () => changeLoggedWeight(parseFloat(el.run.setLogWeight.value || "0") - 2.5));
  el.run.setLogPlus.addEventListener("click", () => changeLoggedWeight(parseFloat(el.run.setLogWeight.value || "0") + 2.5));
  el.run.setLogWeight.addEventListener("change", () => changeLoggedWeight(parseFloat(el.run.setLogWeight.value)));
  el.summary.save.addEventListener("click", saveResult);
  el.summary.rawCsv.addEventListener("click", () =>
    downloadCsv(`erkdek-${result.type}-${fileDate(new Date(result.startedAt))}-${result.id}-raw.csv`, curveCsv(resultRaw, resultRaw.phases)),
  );
  el.summary.json.addEventListener("click", () =>
    downloadJson(`erkdek-${result.type}-${fileDate(new Date(result.startedAt))}-${result.id}.json`, result),
  );
  el.summary.discard.addEventListener("click", discardResult);

  renderTests();
  renderList();
  show("list");
  show("tests");
}
