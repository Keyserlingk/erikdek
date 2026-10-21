// Running a routine or test: phases by the clock, live force from the sensor (when the
// routine uses it), the per-set log of routines without the sensor, and the session
// built at the end. The session goes to onEnd (workouts) or else to the summary.

import { compressCurve, compressRepCurves } from "./analysis.js";
import { beep, unlockAudio } from "./audio.js";
import { LiveChart, smoothKg } from "./chart.js";
import { device } from "./device.js";
import { formatClock, formatDuration, formatKg } from "./format.js";
import { instructionFor, usesSensor } from "./routines.js";
import { showResult } from "./runsummary.js";
import { newSessionId } from "./sessions.js";
import { settings } from "./settingsstore.js";
import { HANDS, KINDS, summarizeTraining } from "./tests.js";
import { groupOf, mountRunScreens, show } from "./trainscreens.js";
import { $, button, create } from "./ui.js";
import { allowScreenOff, keepScreenOn } from "./wakelock.js";
import {
  PHASE,
  WorkoutEngine,
  buildPhases,
  hangsPerRep,
  loadThresholdKg,
  repStats,
  targetKg,
  targetStatus,
} from "./workout.js";

const TICK_MS = 50;
// Stored curve: only where force >= 1 kg, at most 1000 points (~6 KB per session).
const CURVE_MIN_KG = 1;
const CURVE_MAX_POINTS = 1000;
// A hang waiting for force keeps this much from before the force came, for the rise (RFD).
const PRE_LOAD_S = 0.25;
// The force number pulses in the last seconds of a hang.
const PULSE_S = 3;
// After the last hang (Settings → recordRelease): keep recording until this long after
// the climber let go, waiting at most RELEASE_MAX_WAIT_S.
const RELEASE_TAIL_S = 0.5;
const RELEASE_MAX_WAIT_S = 5;

const el = {
  card: $("runPhaseCard"),
  phase: $("runPhase"),
  countdown: $("runCountdown"),
  progress: $("runProgress"),
  next: $("runNext"),
  held: $("runHeld"),
  row: $("runRow"),
  gripCard: $("runGripCard"),
  gripLabel: $("runGripLabel"),
  grip: $("runGrip"),
  restOverlay: $("runRestOverlay"),
  restPhase: $("runRestPhase"),
  restCountdown: $("runRestCountdown"),
  restNext: $("runRestNext"),
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
};

let run = null; // active routine or test
let chart = null;

export const isRunning = () => run !== null;

// Starts a run; false when it wasn't started (the sensor is needed but not connected
// and the user declined). Options:
//   onEnd(session, stopped, raw)  called instead of showing the summary
//   workout: { id, name, index, count }  the workout this routine is part of
//   group: the tab to run in (default: Train for routines, Tests for tests)
export async function startRun(kind, routine, hand, { onEnd = null, workout = null, group = groupOf(kind) } = {}) {
  // Tests always use the sensor; routines only when they are hangboard routines.
  const sensor = kind !== "workout" || usesSensor(routine);
  if (sensor && !device.connected && !confirm(`"${routine.name}" uses the sensor, which isn't connected. Start anyway?`)) {
    return false;
  }
  unlockAudio();
  mountRunScreens(group);
  const target = targetKg(routine, settings.values.bodyweightKg);
  const phases = buildPhases(routine);
  run = {
    kind,
    routine,
    hand,
    phases,
    // With the sensor connected each hang's countdown can start when force is applied
    // (Settings → Hangs with the sensor).
    engine: new WorkoutEngine(phases, { waitForLoad: sensor && device.connected && settings.values.startOnForce }),
    target,
    threshold: loadThresholdKg(target, settings.values.repThresholdKg),
    // Force that starts a waiting hang's countdown: a share of the target, but never
    // below the rep threshold (so a light touch doesn't start it).
    startKg: Math.max(settings.values.repThresholdKg, target !== null ? (target * settings.values.startPct) / 100 : 0),
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
    onEnd,
    workout,
    targetText: target !== null ? `Target ${formatKg(target)} kg` : kind === "workout" ? "No target" : HANDS[hand],
  };
  if (routine.target.type === "bw" && target === null) run.targetText = "Set bodyweight for a % target";
  el.held.hidden = true;
  el.screen.dataset.sensor = String(sensor);
  el.setLog.hidden = true;
  chart.clear();
  chart.setBodyweight(settings.values.bodyweightKg); // right axis in % of bodyweight
  chart.setTarget(target);
  el.pause.textContent = "Pause";
  show("run");
  el.wakeHint.hidden = await keepScreenOn();

  run.engine.start(performance.now() / 1000);
  run.timer = setInterval(tick, TICK_MS);
  tick();
  return true;
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
    el.setLog.hidden = true;
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
  el.setLogTitle.textContent = `Set ${set} of ${r.sets} done`;
  renderRpeButtons(log);
  const usesWeight = r.addedWeightKg !== null && r.addedWeightKg !== undefined;
  el.setLogWeightRow.hidden = !usesWeight;
  if (usesWeight) el.setLogWeight.value = run.nextWeightKg ?? log.addedWeightKg;
  el.setLog.hidden = false;
}

function renderRpeButtons(log) {
  el.setLogRpe.replaceChildren(
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
  el.setLogWeight.value = run.nextWeightKg;
}

function phaseName(p) {
  const type = p.type;
  if (p.handChange) return "Change hand"; // between the hands of "each hand in turn"
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
    if (!lingerForRelease(now)) endRun(false);
    return;
  }

  const { phase, remainingS, inPhaseS } = state;
  const next = run.phases[state.index + 1];
  const r = run.routine;
  el.card.dataset.phase = phase.type;
  const waiting = state.waitingForLoad;
  el.phase.textContent = run.engine.paused ? "Paused" : phaseName(phase) + (waiting ? " to start" : "");
  renderGrip(state.index);
  // Countdown, or a stopwatch while a self-paced rep waits for Done.
  el.countdown.textContent = remainingS === null ? formatClock(inPhaseS) : Math.ceil(remainingS);
  el.done.hidden = !run.engine.waitingForDone;
  el.skip.hidden = run.engine.waitingForDone;
  const instruction = instructionFor(r, phase.set);
  el.instruction.hidden = !instruction;
  el.instruction.textContent = instruction;
  el.progress.textContent =
    r.reps * hangsPerRep(r) > 1 ? `Set ${phase.set}/${r.sets} · Rep ${phase.rep}/${r.reps}` : `Attempt ${phase.set}/${r.sets}`;
  const nextTime = (p) => (p.durS === null ? "" : ` ${formatDuration(p.durS)}`);
  el.next.textContent = next ? `Next: ${phaseName(next)}${nextTime(next)}` : "Last one!";

  if (!run.sensor) return;
  const kg = run.smoothed ?? 0;
  const repInfo = renderHeld(phase);
  // Getting ready or resting: a panel over the (dimmed) graph with the countdown and
  // what comes next.
  el.restOverlay.hidden = phase.type === PHASE.WORK;
  el.restOverlay.dataset.phase = phase.type;
  el.restPhase.textContent = el.phase.textContent;
  el.restCountdown.textContent = el.countdown.textContent;
  // The force, large in the graph (see display.js), with the target and the rep so far.
  chart.setOverlay({
    text: device.connected ? formatKg(kg) : "–",
    status: targetStatus(kg, run.target) ?? "",
    pulse: phase.type === PHASE.WORK && !waiting && remainingS !== null && remainingS <= PULSE_S,
    sub: waiting ? `${phaseName(phase)} to start the countdown` : [run.targetText, repInfo].filter(Boolean).join(" · "),
  });
  chart.render();
}

// Hand, hold and grip, one per line: of the hang now (during a hang) or of the next hang
// (while getting ready or resting). In their own card left of the countdown, and while
// not hanging also on the rest panel over the graph.
function renderGrip(index) {
  const current = run.phases[index];
  const isWork = current.type === PHASE.WORK;
  const hang = isWork ? current : run.phases.slice(index + 1).find((p) => p.type === PHASE.WORK);
  // Phases carry the hand; "both" falls back to the run's hand.
  const hand = hang && hang.hand && hang.hand !== "both" ? hang.hand : run.hand;
  const parts = hang ? [hand && hand !== "both" ? HANDS[hand] : "", run.routine.holdType, run.routine.grip].filter(Boolean) : [];
  // Without grip info the rest panel says what comes next instead ("Hang 7 s").
  const nextPhase = run.phases[index + 1];
  const fallback = nextPhase ? phaseName(nextPhase) + (nextPhase.durS === null ? "" : ` ${formatDuration(nextPhase.durS)}`) : "";
  const key = `${index}|${isWork}|${parts.join("|")}`;
  if (key === run.gripKey) return; // unchanged: don't rebuild the list every tick
  run.gripKey = key;
  const lines = () => parts.map((text) => create("div", { textContent: text }));
  el.gripCard.hidden = !parts.length;
  el.row.dataset.grip = String(parts.length > 0);
  el.gripLabel.textContent = isWork ? "Now" : "Next";
  el.grip.replaceChildren(...lines());
  const restLines = parts.length ? lines() : fallback ? [create("div", { textContent: fallback })] : [];
  el.restNext.replaceChildren(...(restLines.length ? [create("div", { className: "grip-next", textContent: "Next" }), ...restLines] : []));
}

const round2 = (v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v);

function buildSession(stopped) {
  const dtS = sampleDtS();
  const r = run.routine;
  // A run meant for the sensor that got no samples (it wasn't connected) has no force
  // results: only reps and time are kept, as for routines without the sensor.
  const noForce = run.sensor && !run.curve.length;
  const repList = noForce ? run.reps.map(({ set, rep, hand }) => ({ set, rep, hand, durationS: r.workS })) : run.reps;
  const reps = repList.map((rep) => Object.fromEntries(Object.entries(rep).map(([k, v]) => [k, round2(v)])));
  const summary = noForce
    ? summarizeTraining(repList, [], r)
    : KINDS[run.kind].analyze({ reps: run.reps, attempts: run.attempts, dtS, routine: r, target: run.target, sets: run.sets });
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
  };
  if (noForce) session.noForce = true;
  else session.curve = compressCurve(run.curve, 1 / dtS, { minKg: CURVE_MIN_KG, maxPoints: CURVE_MAX_POINTS });
  // Each rep's own curve, for comparing reps in History.
  if (!noForce && run.attempts.length === reps.length && reps.length) session.repCurves = compressRepCurves(run.attempts, 1 / dtS);
  // The routine or test as it was run (tests: their setup, for History's filters).
  {
    const { name, type, instruction, setInstructions, addedWeightKg, holdType, grip, hands, test, handRestS } = r;
    const { sets, reps: repCount, workS, restS, setRestS, prepS, target } = r;
    session.routine = {
      id: r.id,
      ...(test ? { test, handRestS } : {}),
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
    if (run.kind === "workout" && !run.sensor) session.sets = run.sets.map((x) => ({ ...x }));
  }
  if (stopped) session.stopped = true;
  if (run.workout) session.workout = { ...run.workout };
  return session;
}

// Routines only: the average hold % of the reps done so far (phase card), and returns
// how long the current rep has been held, or the last rep's hold % (for the graph).
function renderHeld(phase) {
  const show = run.kind === "workout";
  el.held.hidden = !show || !run.reps.length;
  if (!show) return "";
  const avgHold = run.reps.reduce((sum, r) => sum + r.holdPct, 0) / (run.reps.length || 1);
  el.held.textContent = `Hold ${Math.round(avgHold)} % so far`;

  const last = run.reps.at(-1);
  if (phase.type === PHASE.WORK) return `Held ${(run.repLoadedSamples * sampleDtS()).toFixed(1)} / ${phase.durS} s`;
  if (last) return `Last rep ${Math.round(last.holdPct)} %${last.completed ? " ✓" : ""}`;
  return "";
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
  const onEnd = run.onEnd;
  run = null;
  if (onEnd) onEnd(session, stopped, raw);
  else showResult(session, raw);
}

// After the last hang: true while still recording the release (until RELEASE_TAIL_S
// after the force dropped below the rep threshold, at most RELEASE_MAX_WAIT_S).
function lingerForRelease(now) {
  if (!run.finish) {
    const linger = run.sensor && device.connected && settings.values.recordRelease;
    run.finish = { linger, startS: now, releasedS: null };
    if (linger) {
      el.card.dataset.phase = "rest";
      el.phase.textContent = "Let go";
      el.countdown.textContent = "✓";
      el.next.textContent = "Recording the release…";
      el.restOverlay.hidden = true;
      chart.setOverlay({ text: formatKg(run.smoothed ?? 0), sub: "Done – let go" });
    }
  }
  const f = run.finish;
  if (!f.linger || !device.connected) return false;
  if (f.releasedS !== null && now >= f.releasedS + RELEASE_TAIL_S) return false;
  if (now >= f.startS + RELEASE_MAX_WAIT_S) return false;
  chart.setOverlay({ text: formatKg(run.smoothed ?? 0), sub: "Done – let go" });
  chart.render();
  return true;
}

function stopRun() {
  if (run.finish) {
    endRun(false); // already past the last hang: just finish
    return;
  }
  const message = run.workout
    ? "Stop this routine and end the workout? You can still save what you've done."
    : "Stop now? You can still save what you've done so far.";
  if (!confirm(message)) return;
  endRun(true);
}

function togglePause() {
  const now = performance.now() / 1000;
  if (run.engine.paused) run.engine.resume(now);
  else run.engine.pause(now);
  el.pause.textContent = run.engine.paused ? "Resume" : "Pause";
  tick();
}

export function initRunner() {
  chart = new LiveChart(el.chart);
  chart.setWindow(10);
  device.on("samples", (msg) => {
    if (!run || !run.sensor) return;
    chart.push(msg.ts, msg.te ?? msg.ts, msg.kg);
    for (const kg of msg.kg) run.smoothed = smoothKg(run.smoothed, kg, sampleDtS());
    if (run.engine.paused || run.index < 0) return; // not started yet (or paused)
    if (run.finish && run.finish.releasedS === null && msg.kg.some((kg) => kg < settings.values.repThresholdKg)) {
      run.finish.releasedS = performance.now() / 1000; // let go after the last hang
    }
    run.curve.push(...msg.kg);
    for (let i = 0; i < msg.kg.length; i++) run.curvePhase.push(run.index);
    if (run.repSamples) {
      const from = run.repSamples.length;
      run.repSamples.push(...msg.kg);
      const hit = run.engine.waitingForLoad ? msg.kg.findIndex((kg) => kg >= run.startKg) : -1;
      if (hit >= 0) {
        // Force: the hang starts now. Its samples start just before, for the rise.
        run.repSamples = run.repSamples.slice(Math.max(0, from + hit - Math.round(PRE_LOAD_S / sampleDtS())));
        run.repLoadedSamples = run.repSamples.filter((kg) => kg >= run.threshold).length;
        run.engine.loadApplied(performance.now() / 1000);
      } else if (!run.engine.waitingForLoad) {
        for (const kg of msg.kg) if (kg >= run.threshold) run.repLoadedSamples++;
      }
    }
  });
  // Lost the sensor: hangs no longer wait for force (they'd wait forever).
  device.on("connection", () => {
    if (!run || device.connected || !run.engine.waitForLoad) return;
    run.engine.waitForLoad = false;
    run.engine.loadApplied(performance.now() / 1000);
  });
  document.addEventListener("visibilitychange", () => {
    // The browser drops its wake lock when the page is hidden; take it again.
    if (run && document.visibilityState === "visible") keepScreenOn();
  });
  el.pause.addEventListener("click", togglePause);
  el.skip.addEventListener("click", () => {
    run.engine.skip(performance.now() / 1000);
    tick();
  });
  el.stop.addEventListener("click", stopRun);
  el.done.addEventListener("click", () => {
    run.engine.finishRep(performance.now() / 1000);
    tick();
  });
  el.setLogMinus.addEventListener("click", () => changeLoggedWeight(parseFloat(el.setLogWeight.value || "0") - 2.5));
  el.setLogPlus.addEventListener("click", () => changeLoggedWeight(parseFloat(el.setLogWeight.value || "0") + 2.5));
  el.setLogWeight.addEventListener("change", () => changeLoggedWeight(parseFloat(el.setLogWeight.value)));
}
