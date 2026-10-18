import { beep, unlockAudio } from "./audio.js";
import { LiveChart } from "./chart.js";
import { device } from "./device.js";
import { formatDuration, formatKg } from "./format.js";
import { BUILTIN_HOLD_TYPES, holdTypes } from "./holdtypes.js";
import { BUILTIN_ROUTINES, newRoutineId, routines, validateRoutine } from "./routines.js";
import { settings } from "./settings.js";
import {
  PHASE,
  WorkoutEngine,
  buildPhases,
  loadThresholdKg,
  repStats,
  targetKg,
  targetStatus,
  totalDurationS,
} from "./workout.js";

const TICK_MS = 50;
const NEW_HOLD_TYPE = "__new__";
const PHASE_NAMES = { prep: "Get ready", work: "Hang", rest: "Rest", setRest: "Set rest" };

const $ = (id) => document.getElementById(id);
const el = {
  screens: { list: $("trainList"), edit: $("trainEdit"), run: $("trainRun"), summary: $("trainSummary") },
  list: $("routineList"),
  listError: $("trainListError"),
  newRoutine: $("routineNew"),
  edit: {
    title: $("editTitle"),
    name: $("editName"),
    holdType: $("editHoldType"),
    holdNewRow: $("editHoldNewRow"),
    holdNew: $("editHoldNew"),
    holdAdd: $("editHoldAdd"),
    holdError: $("editHoldError"),
    sets: $("editSets"),
    reps: $("editReps"),
    workS: $("editWork"),
    restS: $("editRest"),
    setRestS: $("editSetRest"),
    prepS: $("editPrep"),
    targetType: $("editTargetType"),
    targetValue: $("editTargetValue"),
    targetUnit: $("editTargetUnit"),
    targetRow: $("editTargetValueRow"),
    duration: $("editDuration"),
    error: $("editError"),
    cancel: $("editCancel"),
    save: $("editSave"),
    remove: $("editDelete"),
  },
  run: {
    card: $("runPhaseCard"),
    phase: $("runPhase"),
    countdown: $("runCountdown"),
    progress: $("runProgress"),
    next: $("runNext"),
    kg: $("runKg"),
    target: $("runTarget"),
    chart: $("runChart"),
    pause: $("runPause"),
    skip: $("runSkip"),
    stop: $("runStop"),
    wakeHint: $("runWakeHint"),
  },
  summary: {
    title: $("sumTitle"),
    meta: $("sumMeta"),
    tiles: $("sumTiles"),
    reps: $("sumReps"),
    done: $("sumDone"),
  },
};

let editing = null; // routine being edited (copy)
let run = null; // active workout
let lastResult = null;
let chart = null;

function show(screen) {
  for (const [name, node] of Object.entries(el.screens)) node.hidden = name !== screen;
}

function describe(r) {
  const parts = [`${r.sets} × ${r.reps}`, `${r.workS} s on`];
  if (r.holdType) parts.unshift(r.holdType);
  if (r.reps > 1) parts.push(`${r.restS} s off`);
  if (r.sets > 1) parts.push(`${formatDuration(r.setRestS)} between sets`);
  if (r.target.type === "kg") parts.push(`target ${r.target.value} kg`);
  if (r.target.type === "bw") parts.push(`target ${r.target.value} % BW`);
  return parts.join(" · ");
}

// ---------------------------------------------------------------- list

function renderList() {
  el.list.replaceChildren();
  for (const r of routines.all) {
    const card = document.createElement("div");
    card.className = "card routine";
    const head = document.createElement("div");
    head.className = "routine-head";
    const name = document.createElement("h2");
    name.textContent = r.name;
    const dur = document.createElement("span");
    dur.className = "muted";
    dur.textContent = formatDuration(totalDurationS(r));
    head.append(name, dur);
    const desc = document.createElement("p");
    desc.className = "muted";
    desc.textContent = describe(r);
    const actions = document.createElement("div");
    actions.className = "actions";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "secondary";
    editBtn.textContent = r.builtin ? "Copy & edit" : "Edit";
    editBtn.addEventListener("click", () => openEditor(r));
    const startBtn = document.createElement("button");
    startBtn.type = "button";
    startBtn.className = "primary";
    startBtn.textContent = "Start";
    startBtn.addEventListener("click", () => startWorkout(r));
    actions.append(editBtn, startBtn);
    card.append(head, desc, actions);
    el.list.append(card);
  }
}

function showListError(text) {
  el.listError.textContent = text;
  el.listError.hidden = !text;
}

// ---------------------------------------------------------------- editor

function openEditor(r) {
  const isNew = !r || r.builtin;
  editing = r
    ? structuredClone({ ...r, id: r.builtin ? newRoutineId() : r.id, builtin: false })
    : { ...structuredClone(BUILTIN_ROUTINES[0]), id: newRoutineId(), name: "", builtin: false };
  if (r && r.builtin) editing.name = `${r.name} (copy)`;
  editing.isNew = isNew;

  const e = el.edit;
  e.title.textContent = isNew ? "New routine" : "Edit routine";
  e.name.value = editing.name;
  editing.holdType = editing.holdType || "";
  renderHoldTypeOptions(editing.holdType);
  showHoldNew(false);
  for (const key of ["sets", "reps", "workS", "restS", "setRestS", "prepS"]) e[key].value = editing[key];
  e.targetType.value = editing.target.type;
  e.targetValue.value = editing.target.type === "none" ? "" : editing.target.value;
  e.remove.hidden = isNew;
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
    holdType: e.holdType.value === NEW_HOLD_TYPE ? "" : e.holdType.value,
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
  e.targetUnit.textContent = type === "bw" ? "% BW" : "kg";
  const r = readEditor();
  e.duration.textContent = validateRoutine(r) ? "" : `Total time ${formatDuration(totalDurationS(r))}`;
}

function option(value, label) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  return o;
}

function renderHoldTypeOptions(selected) {
  const select = el.edit.holdType;
  const standard = document.createElement("optgroup");
  standard.label = "Standard";
  standard.append(...BUILTIN_HOLD_TYPES.map((h) => option(h, h)));
  const own = document.createElement("optgroup");
  own.label = "Your hold types";
  // Keep a routine's hold type selectable even if it was removed from the list.
  const custom = [...holdTypes.custom];
  if (selected && !holdTypes.all.includes(selected)) custom.push(selected);
  own.append(...custom.map((h) => option(h, h)));
  select.replaceChildren(option("", "Not specified"), standard);
  if (custom.length) select.append(own);
  select.append(option(NEW_HOLD_TYPE, "+ Add new…"));
  select.value = selected;
}

function showHoldNew(visible) {
  el.edit.holdNewRow.hidden = !visible;
  el.edit.holdError.hidden = true;
  el.edit.holdNew.value = "";
  if (visible) el.edit.holdNew.focus();
}

async function addHoldType() {
  const name = el.edit.holdNew.value.trim();
  try {
    await holdTypes.add(name);
    editing.holdType = name;
    renderHoldTypeOptions(name);
    showHoldNew(false);
  } catch (err) {
    el.edit.holdError.textContent = err.message;
    el.edit.holdError.hidden = false;
  }
}

async function saveEditor() {
  const r = readEditor();
  const error = validateRoutine(r);
  el.edit.error.textContent = error || "";
  el.edit.error.hidden = !error;
  if (error) return;
  try {
    await routines.save(r);
    show("list");
  } catch (err) {
    el.edit.error.textContent = err.message;
    el.edit.error.hidden = false;
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

async function startWorkout(r) {
  unlockAudio();
  const target = targetKg(r, settings.values.bodyweightKg);
  const phases = buildPhases(r);
  run = {
    routine: r,
    phases,
    engine: new WorkoutEngine(phases),
    target,
    threshold: loadThresholdKg(target, settings.values.repThresholdKg),
    index: -1,
    repSamples: null,
    reps: [],
    smoothed: null,
    lastCountdown: null,
    startedAt: new Date(),
    wakeLock: null,
    timer: null,
  };
  chart.clear();
  chart.setTarget(target);
  el.run.target.textContent = target !== null ? `Target ${formatKg(target)} kg` : "No target";
  if (r.target.type === "bw" && target === null) el.run.target.textContent = "Set bodyweight for a % target";
  el.run.pause.textContent = "Pause";
  show("run");
  el.run.wakeHint.hidden = await requestWakeLock();

  run.engine.start(performance.now() / 1000);
  run.timer = setInterval(tick, TICK_MS);
  tick();
}

function finishRep() {
  if (!run.repSamples) return;
  const phase = run.phases[run.index];
  const dtS = 1 / (device.status?.rate || 80);
  run.reps.push({ set: phase.set, rep: phase.rep, ...repStats(run.repSamples, dtS, run.threshold, phase.durS) });
  run.repSamples = null;
}

function enterPhase(i) {
  finishRep();
  run.index = i;
  run.lastCountdown = null;
  if (i >= run.phases.length) return;
  const phase = run.phases[i];
  if (phase.type === PHASE.WORK) {
    run.repSamples = [];
    beep.work();
  } else if (i > 0) {
    beep.rest();
  }
}

function tick() {
  const now = performance.now() / 1000;
  const state = run.engine.update(now);
  for (const i of state.entered) enterPhase(i);
  if (state.done) {
    finishWorkout();
    return;
  }

  const { phase, remainingS } = state;
  const next = run.phases[state.index + 1];
  // 3-2-1 countdown beeps before each hang
  if (phase.type !== PHASE.WORK && next?.type === PHASE.WORK) {
    const secs = Math.ceil(remainingS);
    if (secs <= 3 && secs >= 1 && secs !== run.lastCountdown && !run.engine.paused) {
      run.lastCountdown = secs;
      beep.countdown();
    }
  }

  const r = run.routine;
  el.run.card.dataset.phase = phase.type;
  el.run.phase.textContent = run.engine.paused ? "Paused" : PHASE_NAMES[phase.type];
  el.run.countdown.textContent = Math.ceil(remainingS);
  el.run.progress.textContent = `Set ${phase.set}/${r.sets} · Rep ${phase.rep}/${r.reps}`;
  el.run.next.textContent = next ? `Next: ${PHASE_NAMES[next.type]} ${formatDuration(next.durS)}` : "Last one!";

  const kg = run.smoothed ?? 0;
  el.run.kg.textContent = device.connected ? formatKg(kg) : "–";
  el.run.kg.dataset.status = targetStatus(kg, run.target) ?? "";
  chart.render();
}

function stopTimers() {
  clearInterval(run.timer);
  if (run.wakeLock) run.wakeLock.release().catch(() => {});
}

function finishWorkout() {
  stopTimers();
  beep.finished();
  lastResult = {
    routine: run.routine,
    startedAt: run.startedAt.toISOString(),
    durationS: Math.round(run.engine.totalS),
    targetKg: run.target,
    reps: run.reps,
  };
  run = null;
  renderSummary(lastResult);
  show("summary");
}

function stopWorkout() {
  if (!confirm("Stop the workout?")) return;
  stopTimers();
  finishRep();
  const result = {
    routine: run.routine,
    startedAt: run.startedAt.toISOString(),
    durationS: Math.round(run.engine.elapsed(performance.now() / 1000)),
    targetKg: run.target,
    reps: run.reps,
    stopped: true,
  };
  run = null;
  lastResult = result;
  renderSummary(result);
  show("summary");
}

function togglePause() {
  const now = performance.now() / 1000;
  if (run.engine.paused) run.engine.resume(now);
  else run.engine.pause(now);
  el.run.pause.textContent = run.engine.paused ? "Resume" : "Pause";
  tick();
}

// ---------------------------------------------------------------- summary

function tile(label, value) {
  const div = document.createElement("div");
  div.className = "tile";
  const v = document.createElement("strong");
  v.textContent = value;
  const l = document.createElement("span");
  l.textContent = label;
  div.append(v, l);
  return div;
}

function renderSummary(result) {
  const s = el.summary;
  const reps = result.reps;
  const totalReps = result.routine.sets * result.routine.reps;
  s.title.textContent = result.stopped ? `${result.routine.name} (stopped)` : result.routine.name;
  const meta = [formatDuration(result.durationS)];
  if (result.routine.holdType) meta.push(result.routine.holdType);
  if (result.targetKg !== null) meta.push(`target ${formatKg(result.targetKg)} kg`);
  s.meta.textContent = meta.join(" · ");

  const completed = reps.filter((r) => r.completed).length;
  const best = reps.reduce((m, r) => Math.max(m, r.peakKg), 0);
  const avg = reps.length ? reps.reduce((sum, r) => sum + r.meanKg, 0) / reps.length : 0;
  const tut = reps.reduce((sum, r) => sum + r.tutS, 0);
  s.tiles.replaceChildren(
    tile("reps completed", `${completed}/${totalReps}`),
    tile("best peak", `${formatKg(best)} kg`),
    tile("avg force", `${formatKg(avg)} kg`),
    tile("time under tension", formatDuration(Math.round(tut))),
  );

  const rows = reps.map((r) => {
    const tr = document.createElement("tr");
    for (const text of [`${r.set}.${r.rep}`, formatKg(r.peakKg), formatKg(r.meanKg), `${r.tutS.toFixed(1)} s`, r.completed ? "✓" : ""]) {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    }
    tr.lastChild.className = "ok";
    return tr;
  });
  s.reps.replaceChildren(...rows);
}

// ---------------------------------------------------------------- init

export function getLastResult() {
  return lastResult;
}

export function initTrain() {
  chart = new LiveChart(el.run.chart);
  chart.setWindow(10);

  routines.addEventListener("change", renderList);
  device.on("connection", (state) => {
    if (state !== "open") return;
    routines.load().then(() => showListError(""), (e) => showListError(e.message));
    holdTypes.load().catch((e) => showListError(e.message));
  });
  device.on("samples", (msg) => {
    if (!run) return;
    chart.push(msg.ts, msg.te ?? msg.ts, msg.kg);
    for (const kg of msg.kg) run.smoothed = run.smoothed === null ? kg : run.smoothed + 0.08 * (kg - run.smoothed);
    if (run.repSamples && !run.engine.paused) run.repSamples.push(...msg.kg);
  });
  document.addEventListener("visibilitychange", () => {
    if (run && document.visibilityState === "visible" && run.wakeLock?.released !== false) requestWakeLock();
  });

  el.newRoutine.addEventListener("click", () => openEditor(null));
  el.edit.cancel.addEventListener("click", () => show("list"));
  el.edit.holdType.addEventListener("change", () => {
    if (el.edit.holdType.value === NEW_HOLD_TYPE) {
      showHoldNew(true);
    } else {
      editing.holdType = el.edit.holdType.value;
      showHoldNew(false);
    }
  });
  el.edit.holdAdd.addEventListener("click", addHoldType);
  el.edit.holdNew.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") addHoldType();
  });
  el.edit.save.addEventListener("click", saveEditor);
  el.edit.remove.addEventListener("click", deleteEditing);
  for (const input of el.screens.edit.querySelectorAll("input, select")) {
    input.addEventListener("input", updateEditorDerived);
  }
  el.run.pause.addEventListener("click", togglePause);
  el.run.skip.addEventListener("click", () => {
    run.engine.skip(performance.now() / 1000);
    tick();
  });
  el.run.stop.addEventListener("click", stopWorkout);
  el.summary.done.addEventListener("click", () => show("list"));

  renderList();
  show("list");
}
