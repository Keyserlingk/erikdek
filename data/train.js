import { compressCurve } from "./analysis.js";
import { beep, unlockAudio } from "./audio.js";
import { downloadCsv, downloadJson } from "./download.js";
import { curveCsv, fileDate } from "./export.js";
import { LiveChart } from "./chart.js";
import { device } from "./device.js";
import { formatDuration, formatKg } from "./format.js";
import {
  BUILTIN_ROUTINES,
  buildRoutineFile,
  newRoutineId,
  parseRoutineFile,
  routines,
  validateRoutine,
} from "./routines.js";
import { newSessionId, sessions } from "./sessions.js";
import { renderSession } from "./sessionview.js";
import { settings } from "./settings.js";
import { TagSelect, grips, holdTypes } from "./tags.js";
import { HANDS, KINDS, TEST_IDS } from "./tests.js";
import {
  PHASE,
  WorkoutEngine,
  buildPhases,
  hangsPerRep,
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
  },
  summary: {
    view: $("sumView"),
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
let resultRaw = null; // its full-rate curve and per-sample phase (not stored on the device)
let chart = null;
let summaryChart = null;
let selects = null; // TagSelects: editHold, editGrip, setupHold, setupGrip

// Screens per tab; run and summary belong to the tab they are mounted in (runHost).
const GROUPS = { train: ["list", "edit"], tests: ["tests", "setup"] };
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

function describe(r) {
  const alternate = r.hands === "alternate";
  const parts = [`${r.sets} × ${r.reps}${alternate ? " per hand" : ""}`, `${r.workS} s on`];
  if (alternate) parts.push(`${r.restS} s hand change`);
  else if (r.reps > 1) parts.push(`${r.restS} s off`);
  if (r.sets > 1) parts.push(`${formatDuration(r.setRestS)} between sets`);
  if (r.target.type === "kg") parts.push(`target ${r.target.value} kg`);
  if (r.target.type === "bw") parts.push(`target ${r.target.value} % BW`);
  const tags = [r.holdType, r.grip, r.hands && r.hands !== "both" ? HANDS[r.hands] : ""].filter(Boolean);
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
  const list = view === "mine" ? routines.custom : BUILTIN_ROUTINES;
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
          create("span", { className: "muted", textContent: formatDuration(totalDurationS(r)) }),
        ]),
        create("p", { className: "muted", textContent: describe(r) }),
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
  for (const key of ["sets", "reps", "workS", "restS", "setRestS", "prepS"]) e[key].value = editing[key];
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
  const type = e.targetType.value;
  return {
    id: editing.id,
    name: e.name.value.trim(),
    holdType: selects.editHold.value,
    grip: selects.editGrip.value,
    hands: e.hands.value,
    sets: int(e.sets),
    reps: int(e.reps),
    workS: int(e.workS),
    restS: int(e.restS),
    setRestS: int(e.setRestS),
    prepS: int(e.prepS),
    target: { type, value: type === "none" ? 0 : parseFloat(e.targetValue.value) },
  };
}

function updateEditorDerived() {
  const e = el.edit;
  const type = e.targetType.value;
  e.targetRow.hidden = type === "none";
  const alternate = e.hands.value === "alternate";
  e.repsLabel.textContent = alternate ? "Reps per set (per hand)" : "Reps per set";
  e.restLabel.textContent = alternate ? "Change hand (s)" : "Rest (s)";
  e.targetUnit.textContent = type === "bw" ? "% BW" : "kg";
  const r = readEditor();
  e.duration.textContent = validateRoutine(r) ? "" : `Total time ${formatDuration(totalDurationS(r))}`;
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

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return false;
  try {
    run.wakeLock = await navigator.wakeLock.request("screen");
    return true;
  } catch {
    return false;
  }
}

async function startRun(kind, routine, hand) {
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
    wakeLock: null,
    timer: null,
  };
  chart.clear();
  chart.setTarget(target);
  el.run.target.textContent = target !== null ? `Target ${formatKg(target)} kg` : kind === "workout" ? "No target" : HANDS[hand];
  if (routine.target.type === "bw" && target === null) el.run.target.textContent = "Set bodyweight for a % target";
  el.run.pause.textContent = "Pause";
  show("run");
  el.run.wakeHint.hidden = await requestWakeLock();

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

function finishRep() {
  if (!run.repSamples) return;
  const phase = run.phases[run.index];
  run.attempts.push(run.repSamples);
  run.reps.push({ set: phase.set, rep: phase.rep, hand: phase.hand, ...repStats(run.repSamples, sampleDtS(), run.threshold, phase.durS, run.target) });
  run.repSamples = null;
}

function enterPhase(i) {
  finishRep();
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
  }
}

function phaseName(type) {
  if (type === PHASE.WORK) return KINDS[run.kind].workLabel;
  if (type === PHASE.REST && run.routine.hands === "alternate") return "Change hand";
  return { prep: "Get ready", rest: "Rest", setRest: "Set rest" }[type];
}

function tick() {
  const now = performance.now() / 1000;
  const state = run.engine.update(now);
  for (const i of state.entered) enterPhase(i);
  // One beep per change (hang starts, rest starts, finished); not when starting.
  if (state.entered.some((i) => i > 0)) beep();
  if (state.done) {
    endRun(false);
    return;
  }

  const { phase, remainingS } = state;
  const next = run.phases[state.index + 1];
  const r = run.routine;
  el.run.card.dataset.phase = phase.type;
  const handLabel = (p) => (p.hand && p.hand !== "both" ? ` · ${p.hand}` : "");
  el.run.phase.textContent = run.engine.paused ? "Paused" : phaseName(phase.type) + (phase.type === PHASE.WORK ? handLabel(phase) : "");
  el.run.countdown.textContent = Math.ceil(remainingS);
  el.run.progress.textContent =
    r.reps * hangsPerRep(r) > 1 ? `Set ${phase.set}/${r.sets} · Rep ${phase.rep}/${r.reps}` : `Attempt ${phase.set}/${r.sets}`;
  el.run.next.textContent = next ? `Next: ${phaseName(next.type)} ${formatDuration(next.durS)}${handLabel(next)}` : "Last one!";

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
  const summary = KINDS[run.kind].analyze({ reps: run.reps, attempts: run.attempts, dtS, routine: r, target: run.target });
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
    const { name, holdType, grip, hands, sets, reps: repCount, workS, restS, setRestS, prepS, target } = r;
    session.routine = { id: r.id, name, holdType, grip, hands, sets, reps: repCount, workS, restS, setRestS, prepS, target };
  }
  if (stopped) session.stopped = true;
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
  if (run.wakeLock) run.wakeLock.release().catch(() => {});
  if (stopped) finishRep();
  result = buildSession(stopped);
  resultRaw = { hz: 1 / sampleDtS(), kg: run.curve, phases: run.curvePhase.map((i) => run.phases[i] ?? null) };
  run = null;
  showSummary();
}

function stopRun() {
  if (!confirm("Stop now? You can still save what you've done so far.")) return;
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
  const busy = group === runHost && (run !== null || result !== null);
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
  device.on("connection", (state) => {
    if (state !== "open") return;
    routines.load().then(() => showListError(""), (e) => showListError(e.message));
    holdTypes.load().catch((e) => showListError(e.message));
    grips.load().catch((e) => showListError(e.message));
  });
  device.on("samples", (msg) => {
    if (!run) return;
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
    if (run && document.visibilityState === "visible" && run.wakeLock?.released !== false) requestWakeLock();
  });
  window.addEventListener("hashchange", () => showNotice(null, ""));

  el.newRoutine.addEventListener("click", () => openEditor(null));
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
  for (const input of el.screens.edit.querySelectorAll("input, select")) {
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
