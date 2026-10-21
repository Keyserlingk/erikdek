// Session kinds: free workouts (routines) and the standard tests. Each kind knows how to
// summarise a recorded run, which metric shows progress, and how to present a session.
// No DOM access, so it runs under node --test too.

import { criticalForceSummary, forceRetention, maxPullSummary, rfdSummary } from "./analysis.js";
import { formatDuration, formatKg } from "./format.js";
import { PROTOCOLS, TEST_IDS } from "./protocols.js";
import { usesSensor } from "./routines.js";
import { isTwoHanded, totalHangs } from "./workout.js";

export { TEST_IDS };

const kg = (v) => (v === null || v === undefined ? "–" : `${formatKg(v)} kg`);
const kgPerS = (v) => (v === null || v === undefined ? "–" : `${Math.round(v)} kg/s`);
const pctBw = (v, bw) => (v && bw > 0 ? ` · ${Math.round((v / bw) * 100)} % BW` : "");
const pct = (v) => (v === null || v === undefined ? "–" : `${Math.round(v)} %`);
const seconds = (v) => (v === null || v === undefined ? "–" : formatDuration(Math.round(v)));
const num = (v) => (typeof v === "number" ? v : null);
// A force as % of the session's bodyweight (the weight of its day, see settingsstore).
const pctOfBw = (v, s) => (typeof v === "number" && s.bodyweightKg > 0 ? (100 * v) / s.bodyweightKg : null);
const BW_INFO = "As a percentage of your bodyweight on the day of the session (Settings → Bodyweight log).";

// One-line explanations shown behind the ⓘ buttons.
const INFO = {
  hold:
    "Share of each hang you were loading the hold (above 80 % of the target, or the rep threshold in Settings without a target), averaged over all reps. A rep counts as full from 90 %.",
  retention: "Average force of your last 3 reps as a percentage of your first 3. Lower means you faded more during the session.",
  work: "Force × time compared with target × hang time. Force above the target doesn't count extra, so this drops if you let go early or hang under the target.",
  avgForce: "Average force during the hangs.",
  bestPeak: "Highest force in any rep.",
  tut: "Total time you were loading the hold during the hangs.",
  holdPerRep: "Hold % of each rep, in order, grouped by set: how much of each hang you stayed on.",
  forceVsRep1: "Average force of each rep as a percentage of rep 1. Shows how much you faded during the session.",
  peakForce: "Highest force in any of the pulls.",
  best1s: "Highest average force over any 1 second. Less affected by a short spike than the peak.",
  cf: "Average force of the last 6 reps of the all-out test: roughly the load you can keep up for a long time.",
  cfShare: "Critical force as a percentage of your peak force. Higher means more endurance relative to your strength.",
  cfPeak: "Highest force in the test, usually in the first reps.",
  wPrime: "Work done above critical force (kg·s): your reserve for efforts harder than critical force.",
  rfd: "How fast you build force: the increase over the first 200 ms after you start pulling, per second.",
  peakRfd: "Steepest rise in force over any 50 ms.",
  timeToPeak: "Time from starting to pull until peak force.",
  perHand: "Average force and hold % of the reps done with this hand, to compare left and right.",
  repsDone: "Reps (or hangs) done out of the planned number. Stopped or skipped reps aren't counted.",
  workTime: "Total time spent in the reps: for self-paced reps until you tapped Done, for timed reps the work time.",
  effort: "How hard the sets felt (RPE, 1 = very easy, 10 = maximal), as you logged them after each set.",
  addedWeight: "The most extra weight used in a set. Negative means assistance (band, pulley).",
  volume: "Added weight × reps, summed over the sets that logged a weight.",
};

const handInitial = (hand) => (hand === "left" ? " L" : hand === "right" ? " R" : "");

// A test done with both hands (alternating or one after the other): the summary also
// gets byHand { left, right }, each made by summarize(pick) with pick(list) keeping the
// items of that hand (list is in the order of reps).
function withHands(summary, reps, summarize) {
  const hands = new Set(reps.map((r) => r.hand));
  if (!hands.has("left") || !hands.has("right")) return { ...summary, byHand: null };
  const of = (hand) => summarize((list) => list.filter((_, i) => reps[i]?.hand === hand));
  return { ...summary, byHand: { left: of("left"), right: of("right") } };
}

// Test tiles: once for the whole test, or per hand ("· left") when done with both.
function handTiles(s, tilesOf) {
  const byHand = s.summary.byHand;
  if (!byHand) return tilesOf(s.summary, "");
  return [...tilesOf(byHand.left, " · left"), ...tilesOf(byHand.right, " · right")];
}

// Workout summary of `reps` against `planned` hangs: per-rep values are averaged over
// all planned hangs, so skipped ones count as 0.
function summarizeReps(reps, planned, target) {
  const sum = (key) => reps.reduce((s, r) => s + (r[key] ?? 0), 0);
  return {
    completed: reps.filter((r) => r.completed).length,
    totalReps: planned,
    holdPct: sum("holdPct") / planned,
    workPct: target ? sum("workPct") / planned : null,
    retentionPct: forceRetention(reps.map((r) => r.meanKg)),
    peakKg: reps.reduce((m, r) => Math.max(m, r.peakKg), 0),
    avgKg: reps.length ? sum("meanKg") / reps.length : null,
    tutS: sum("tutS"),
  };
}

// Routines without the sensor: reps are timed only; effort (RPE) and added weight are
// logged per set. Volume = added weight × reps, over sets that logged a weight.
export function summarizeTraining(reps, sets, routine) {
  const repsInSet = (n) => reps.filter((r) => r.set === n).length;
  const rpes = sets.map((s) => s.rpe).filter((v) => typeof v === "number");
  const weights = sets.filter((s) => typeof s.addedWeightKg === "number" && repsInSet(s.set) > 0);
  return {
    repsDone: reps.length,
    totalReps: totalHangs(routine),
    setsDone: new Set(reps.map((r) => r.set)).size,
    workTimeS: reps.reduce((sum, r) => sum + r.durationS, 0),
    avgRpe: rpes.length ? rpes.reduce((a, b) => a + b, 0) / rpes.length : null,
    maxRpe: rpes.length ? Math.max(...rpes) : null,
    maxAddedWeightKg: weights.length ? Math.max(...weights.map((s) => s.addedWeightKg)) : null,
    volumeKg: weights.length ? weights.reduce((sum, s) => sum + s.addedWeightKg * repsInSet(s.set), 0) : null,
  };
}

// Progress metrics. fromSummary(summary, session) reads the value from a session
// summary (or from one hand's summary in summary.byHand); value(session) from the
// whole session. Kinds list them in `metrics`; the first one is the default.
// Options: sensor (true = routines with the sensor, false = without; unset = any)
// and better ("higher", "lower" or null when neither is better; picks personal bests).
const metric = (key, label, format, fromSummary, info, { sensor, better = "higher" } = {}) => ({
  key,
  label,
  format,
  info,
  sensor,
  better,
  fromSummary,
  value: (s) => fromSummary(s.summary, s),
});
const summaryMetric = (key, label, format, info, options) =>
  metric(key, label, format, (summary) => num(summary?.[key]), info, options);
const SENSOR = { sensor: true };

// The metrics of `kind` that fit `list` (sessions): routine metrics need sessions of
// their kind (with or without the sensor); with no sessions, all are offered.
export function metricsFor(kind, list) {
  const all = KINDS[kind].metrics;
  if (kind !== "workout" || !list.length) return all;
  const withSensor = list.some((s) => !isTraining(s));
  const without = list.some((s) => isTraining(s));
  return all.filter((m) => m.sensor === undefined || (m.sensor ? withSensor : without));
}

// Points a session contributes to History: one per hand for alternating sessions,
// otherwise one for the session's hand.
export function metricPoints(m, s) {
  const byHand = s.summary?.byHand;
  if (byHand) return ["left", "right"].map((hand) => ({ hand, value: m.fromSummary(byHand[hand], s) }));
  return [{ hand: s.hand || "both", value: m.value(s) }];
}

// Routine sessions with the sensor: hold %, force, retention, per hand.
function sensorTiles(s) {
  return [
    [
      pct(KINDS.workout.metrics[0].value(s)),

        `hold · ${s.summary.completed}/${s.summary.totalReps} full ${s.summary.byHand ? "hangs" : "reps"}`,
        INFO.hold,
      ],
      [pct(s.summary.retentionPct), "force retention", INFO.retention],
      ...["left", "right"]
        .filter((h) => s.summary.byHand?.[h])
        .map((h) => [kg(s.summary.byHand[h].avgKg), `${h} hand avg · hold ${pct(s.summary.byHand[h].holdPct)}`, INFO.perHand]),
      ...(s.targetKg ? [[pct(s.summary.workPct), "work vs target", INFO.work]] : []),
      [kg(s.summary.avgKg), "avg force", INFO.avgForce],
      [kg(s.summary.peakKg), "best peak", INFO.bestPeak],
      [formatDuration(Math.round(s.summary.tutS)), "time under tension", INFO.tut],
  ];
}

function sensorTable(s) {
      const first = s.reps[0]?.meanKg;
      const hasWork = s.reps.some((r) => typeof r.workPct === "number");
      return {
        head: ["Rep", "Avg", "Hold", ...(hasWork ? ["Work"] : []), "vs 1st"],
        rows: s.reps.map((r) => {
          const hold = r.holdPct ?? (100 * r.tutS) / s.routine.workS;
          return [
            `${r.set}.${r.rep}${handInitial(r.hand)}`,
            formatKg(r.meanKg),
            pct(hold),
            ...(hasWork ? [pct(r.workPct)] : []),
            first > 0 ? pct((100 * r.meanKg) / first) : "–",
          ];
        }),
      };
}

// Per-rep percentages, grouped by set: hold % and force relative to rep 1.
function sensorStrips(s) {
      const first = s.reps[0]?.meanKg;
      const strips = [
        {
          label: "Hold per rep",
          info: INFO.holdPerRep,
          values: s.reps.map((r) => ({ set: r.set, hand: r.hand, pct: r.holdPct ?? (100 * r.tutS) / s.routine.workS })),
        },
      ];
      if (first > 0) {
        strips.push({
          label: "Force vs rep 1",
          info: INFO.forceVsRep1,
          values: s.reps.map((r) => ({ set: r.set, hand: r.hand, pct: (100 * r.meanKg) / first })),
        });
      }
      return strips;
}

// Routine sessions without the sensor (or meant for it but it wasn't connected):
// reps, time, effort, added weight per set.
function isTraining(s) {
  return s.noForce || (s.routine ? !usesSensor(s.routine) : false);
}

const rpe = (v) => (v === null || v === undefined ? "–" : (Math.round(v * 10) / 10).toString());
const signedKg = (v) => (v === null || v === undefined ? "–" : `${v >= 0 ? "+" : "−"}${formatKg(Math.abs(v))} kg`);

function trainingTiles(s) {
  const t = s.summary;
  const tiles = [
    [`${t.repsDone}/${t.totalReps}`, "reps done", INFO.repsDone],
    [seconds(t.workTimeS), "work time", INFO.workTime],
  ];
  if (s.sets) tiles.push([rpe(t.avgRpe), `average effort${t.maxRpe !== null ? ` · max ${t.maxRpe}` : ""}`, INFO.effort]);
  if (t.maxAddedWeightKg !== null) {
    tiles.push([signedKg(t.maxAddedWeightKg), "highest added weight", INFO.addedWeight]);
    tiles.push([kg(t.volumeKg), "volume (weight × reps)", INFO.volume]);
  }
  return tiles;
}

function trainingTable(s) {
  const usesWeight = s.routine.addedWeightKg !== null && s.routine.addedWeightKg !== undefined;
  const logged = !!s.sets; // effort is logged per set (not for sensor runs without force data)
  const sets = new Map((s.sets ?? []).map((x) => [x.set, x]));
  const setNumbers = [...new Set(s.reps.map((r) => r.set))];
  return {
    head: ["Set", "Reps", "Time", ...(logged ? ["Effort"] : []), ...(usesWeight ? ["Weight"] : [])],
    rows: setNumbers.map((n) => {
      const reps = s.reps.filter((r) => r.set === n);
      const log = sets.get(n) ?? {};
      return [
        `${n}`,
        `${reps.length}`,
        seconds(reps.reduce((sum, r) => sum + r.durationS, 0)),
        ...(logged ? [rpe(log.rpe)] : []),
        ...(usesWeight ? [signedKg(log.addedWeightKg)] : []),
      ];
    }),
  };
}

export const KINDS = {
  workout: {
    name: "Routine", // sessions of type "workout" are routine runs
    workLabel: "Hang",
    metrics: [
      summaryMetric("holdPct", "Hold %", pct, `${INFO.hold} Rising toward 100 % means you stay on longer.`, SENSOR),
      summaryMetric("retentionPct", "Force retention", pct, `${INFO.retention} Higher means less fading.`, SENSOR),
      summaryMetric(
        "workPct",
        "Work vs target",
        pct,
        `${INFO.work} Only sessions with a target are shown. Near 100 % means you can raise the target.`,
        SENSOR,
      ),
      summaryMetric("tutS", "Time under tension", seconds, INFO.tut, SENSOR),
      summaryMetric("avgKg", "Average force", kg, INFO.avgForce, SENSOR),
      summaryMetric("peakKg", "Peak force", kg, "Highest force in the session.", SENSOR),
      metric("peakPctBw", "Peak force % BW", pct, (summary, s) => pctOfBw(summary?.peakKg, s), `Highest force in the session. ${BW_INFO}`, SENSOR),
      metric(
        "targetKg",
        "Target load",
        kg,
        (summary, s) => num(s.targetKg),
        "The target load the routine used, in kg (a % of bodyweight target is converted with the bodyweight at the time).",
        SENSOR,
      ),
      // Routines without the sensor
      summaryMetric("maxAddedWeightKg", "Added weight", signedKg, `${INFO.addedWeight} Rising means you're getting stronger.`, {
        sensor: false,
      }),
      summaryMetric("volumeKg", "Volume (weight × reps)", kg, INFO.volume, { sensor: false }),
      summaryMetric(
        "avgRpe",
        "Effort",
        rpe,
        `${INFO.effort} For the same routine, lower effort over time means it's getting easier.`,
        { sensor: false, better: "lower" },
      ),
      summaryMetric("repsDone", "Reps done", (v) => (v === null ? "–" : `${v}`), INFO.repsDone, { sensor: false }),
      summaryMetric("workTimeS", "Work time", seconds, INFO.workTime, { sensor: false, better: null }),
    ],
    // Alternating sessions also get the same summary per hand in byHand.
    analyze({ reps, routine, target, sets = [] }) {
      if (!usesSensor(routine)) return summarizeTraining(reps, sets, routine);
      const planned = totalHangs(routine);
      const summary = summarizeReps(reps, planned, target);
      summary.byHand =
        isTwoHanded(routine)
          ? Object.fromEntries(
              ["left", "right"].map((h) => [h, summarizeReps(reps.filter((r) => r.hand === h), planned / 2, target)]),
            )
          : null;
      return summary;
    },
    tiles: (s) => (isTraining(s) ? trainingTiles(s) : sensorTiles(s)),
    table: (s) => (isTraining(s) ? trainingTable(s) : sensorTable(s)),
    strips: (s) => (isTraining(s) ? [] : sensorStrips(s)),
  },


  maxPull: {
    name: PROTOCOLS.maxPull.name,
    description: PROTOCOLS.maxPull.description,
    workLabel: "Pull",
    routine: PROTOCOLS.maxPull.timing,
    metrics: [
      summaryMetric("peakKg", "Peak force", kg, `${INFO.peakForce} Your strongest pull in each test.`),
      summaryMetric("best1sKg", "Best 1 s average", kg, INFO.best1s),
      metric("peakPctBw", "Peak force % BW", pct, (summary, s) => pctOfBw(summary?.peakKg, s), `${INFO.peakForce} ${BW_INFO}`),
    ],
    analyze: ({ attempts, dtS, reps }) =>
      withHands(maxPullSummary(attempts, dtS), reps, (pick) => maxPullSummary(pick(attempts), dtS)),
    tiles: (s) =>
      handTiles(s, (sum, label) => [
        [kg(sum.peakKg), `peak force${label}${pctBw(sum.peakKg, s.bodyweightKg)}`, INFO.peakForce],
        [kg(sum.best1sKg), `best 1 s average${label}`, INFO.best1s],
      ]),
    table: (s) => ({
      head: ["Attempt", "Peak", "Avg"],
      rows: s.reps.map((r, i) => [`${i + 1}${handInitial(r.hand)}`, formatKg(r.peakKg), formatKg(r.meanKg)]),
    }),
  },

  criticalForce: {
    name: PROTOCOLS.criticalForce.name,
    description: PROTOCOLS.criticalForce.description,
    workLabel: "Pull",
    routine: PROTOCOLS.criticalForce.timing,
    metrics: [
      summaryMetric("cfKg", "Critical force", kg, INFO.cf),
      metric("cfPctBw", "Critical force % BW", pct, (summary, s) => pctOfBw(summary?.cfKg, s), `${INFO.cf} ${BW_INFO}`),
      summaryMetric("peakKg", "Peak force", kg, INFO.cfPeak),
    ],
    analyze({ reps, routine }) {
      const cfOf = (list) =>
        criticalForceSummary(
          list.map((r) => r.meanKg),
          list.map((r) => r.peakKg),
          routine.workS,
        ) ?? { cfKg: null, peakKg: Math.max(0, ...list.map((r) => r.peakKg)), cfShareOfPeak: null, wPrimeKgS: null };
      // Both hands in one test: critical force only means something per hand.
      return withHands(cfOf(reps), reps, (pick) => cfOf(pick(reps)));
    },
    tiles: (s) =>
      handTiles(s, (sum, label) => [
        [kg(sum.cfKg), `critical force${label}${pctBw(sum.cfKg, s.bodyweightKg)}`, INFO.cf],
        [sum.cfShareOfPeak ? `${Math.round(sum.cfShareOfPeak * 100)} %` : "–", `of peak force${label}`, INFO.cfShare],
        [kg(sum.peakKg), `peak force${label}`, INFO.cfPeak],
        [sum.wPrimeKgS !== null ? `${Math.round(sum.wPrimeKgS)} kg·s` : "–", `W′ (work above CF)${label}`, INFO.wPrime],
      ]),
    table: (s) => ({
      head: ["Rep", "Peak", "Avg"],
      rows: s.reps.map((r, i) => [`${r.rep ?? i + 1}${handInitial(r.hand)}`, formatKg(r.peakKg), formatKg(r.meanKg)]),
    }),
  },

  rfd: {
    name: PROTOCOLS.rfd.name,
    shortName: "RFD",
    description: PROTOCOLS.rfd.description,
    workLabel: "Pull",
    routine: PROTOCOLS.rfd.timing,
    metrics: [summaryMetric("rfdKgS", "RFD 0–200 ms", kgPerS, INFO.rfd)],
    analyze: ({ attempts, dtS, reps }) => {
      const rfdOf = (list) =>
        rfdSummary(list, dtS) ?? { rfdKgS: null, peakRfdKgS: null, timeToPeakS: null, peakKg: null, attemptRfdKgS: [] };
      return withHands(rfdOf(attempts), reps, (pick) => rfdOf(pick(attempts)));
    },
    tiles: (s) =>
      handTiles(s, (sum, label) => [
        [kgPerS(sum.rfdKgS), `RFD 0–200 ms${label}`, INFO.rfd],
        [kgPerS(sum.peakRfdKgS), `peak RFD${label}`, INFO.peakRfd],
        [sum.timeToPeakS !== null ? `${Math.round(sum.timeToPeakS * 1000)} ms` : "–", `time to peak${label}`, INFO.timeToPeak],
        [kg(sum.peakKg), `peak force${label}`, INFO.peakForce],
      ]),
    table: (s) => ({
      head: ["Attempt", "Peak", "RFD 0–200 ms"],
      rows: s.reps.map((r, i) => [`${i + 1}${handInitial(r.hand)}`, formatKg(r.peakKg), kgPerS(s.summary.attemptRfdKgS?.[i] ?? null)]),
    }),
  },
};

export const HANDS = {
  both: "Both hands",
  left: "Left hand",
  right: "Right hand",
  alternate: "Alternating hands",
  each: "Each hand in turn",
};
