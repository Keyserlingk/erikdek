// Session kinds: free workouts (routines) and the standard tests. Each kind knows how to
// summarise a recorded run, which metric shows progress, and how to present a session.
// No DOM access, so it runs under node --test too.

import { CF_LAST_REPS, criticalForceSummary, forceRetention, maxPullSummary, rfdSummary } from "./analysis.js";
import { formatDuration, formatKg } from "./format.js";
import { hangsPerRep } from "./workout.js";

const kg = (v) => (v === null || v === undefined ? "–" : `${formatKg(v)} kg`);
const kgPerS = (v) => (v === null || v === undefined ? "–" : `${Math.round(v)} kg/s`);
const pctBw = (v, bw) => (v && bw > 0 ? ` · ${Math.round((v / bw) * 100)} % BW` : "");
const pct = (v) => (v === null || v === undefined ? "–" : `${Math.round(v)} %`);
const seconds = (v) => (v === null || v === undefined ? "–" : formatDuration(Math.round(v)));
const num = (v) => (typeof v === "number" ? v : null);

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
};

const handInitial = (hand) => (hand === "left" ? " L" : hand === "right" ? " R" : "");

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

// Progress metrics. fromSummary(summary, session) reads the value from a session
// summary (or from one hand's summary in summary.byHand); value(session) from the
// whole session. Kinds list them in `metrics`; the first one is the default.
const metric = (key, label, format, fromSummary, info) => ({
  key,
  label,
  format,
  info,
  fromSummary,
  value: (s) => fromSummary(s.summary, s),
});
const summaryMetric = (key, label, format, info) => metric(key, label, format, (summary) => num(summary?.[key]), info);

// Points a session contributes to History: one per hand for alternating sessions,
// otherwise one for the session's hand.
export function metricPoints(m, s) {
  const byHand = s.summary?.byHand;
  if (byHand) return ["left", "right"].map((hand) => ({ hand, value: m.fromSummary(byHand[hand], s) }));
  return [{ hand: s.hand || "both", value: m.value(s) }];
}

export const KINDS = {
  workout: {
    name: "Workout",
    workLabel: "Hang",
    metrics: [
      summaryMetric("holdPct", "Hold %", pct, `${INFO.hold} Rising toward 100 % means you stay on longer.`),
      summaryMetric("retentionPct", "Force retention", pct, `${INFO.retention} Higher means less fading.`),
      summaryMetric(
        "workPct",
        "Work vs target",
        pct,
        `${INFO.work} Only sessions with a target are shown. Near 100 % means you can raise the target.`,
      ),
      summaryMetric("tutS", "Time under tension", seconds, INFO.tut),
      summaryMetric("avgKg", "Average force", kg, INFO.avgForce),
      summaryMetric("peakKg", "Peak force", kg, "Highest force in the session."),
      metric("targetKg", "Target load", kg, (summary, s) => num(s.targetKg), "The target load the routine used, in kg (a % of bodyweight target is converted with the bodyweight at the time)."),
    ],
    // Alternating sessions also get the same summary per hand in byHand.
    analyze({ reps, routine, target }) {
      const planned = routine.sets * routine.reps * hangsPerRep(routine);
      const summary = summarizeReps(reps, planned, target);
      summary.byHand =
        routine.hands === "alternate"
          ? Object.fromEntries(
              ["left", "right"].map((h) => [h, summarizeReps(reps.filter((r) => r.hand === h), planned / 2, target)]),
            )
          : null;
      return summary;
    },
    tiles: (s) => [
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
    ],
    table: (s) => {
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
    },
    // Per-rep percentages, grouped by set: hold % and force relative to rep 1.
    strips: (s) => {
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
    },
  },

  maxPull: {
    name: "Max pull",
    description: "3 all-out pulls of 5 s with 90 s rest. Measures your strongest pull.",
    workLabel: "Pull",
    routine: { sets: 3, reps: 1, workS: 5, restS: 0, setRestS: 90, prepS: 5 },
    metrics: [summaryMetric("peakKg", "Peak force", kg, `${INFO.peakForce} Your strongest pull in each test.`)],
    analyze: ({ attempts, dtS }) => maxPullSummary(attempts, dtS),
    tiles: (s) => [
      [kg(s.summary.peakKg), `peak force${pctBw(s.summary.peakKg, s.bodyweightKg)}`, INFO.peakForce],
      [kg(s.summary.best1sKg), "best 1 s average", INFO.best1s],
    ],
    table: (s) => ({
      head: ["Attempt", "Peak", "Avg"],
      rows: s.reps.map((r, i) => [`${i + 1}`, formatKg(r.peakKg), formatKg(r.meanKg)]),
    }),
  },

  criticalForce: {
    name: "Critical force",
    description: `24 all-out pulls of 7 s with 3 s rest. Critical force is the average of the last ${CF_LAST_REPS} reps: the load you can sustain.`,
    workLabel: "Pull",
    routine: { sets: 1, reps: 24, workS: 7, restS: 3, setRestS: 0, prepS: 5 },
    metrics: [summaryMetric("cfKg", "Critical force", kg, INFO.cf)],
    analyze({ reps, routine }) {
      const cf = criticalForceSummary(
        reps.map((r) => r.meanKg),
        reps.map((r) => r.peakKg),
        routine.workS,
      );
      return cf ?? { cfKg: null, peakKg: Math.max(0, ...reps.map((r) => r.peakKg)), cfShareOfPeak: null, wPrimeKgS: null };
    },
    tiles: (s) => [
      [kg(s.summary.cfKg), `critical force${pctBw(s.summary.cfKg, s.bodyweightKg)}`, INFO.cf],
      [s.summary.cfShareOfPeak ? `${Math.round(s.summary.cfShareOfPeak * 100)} %` : "–", "of peak force", INFO.cfShare],
      [kg(s.summary.peakKg), "peak force", INFO.cfPeak],
      [s.summary.wPrimeKgS !== null ? `${Math.round(s.summary.wPrimeKgS)} kg·s` : "–", "W′ (work above CF)", INFO.wPrime],
    ],
    table: (s) => ({
      head: ["Rep", "Peak", "Avg"],
      rows: s.reps.map((r, i) => [`${i + 1}`, formatKg(r.peakKg), formatKg(r.meanKg)]),
    }),
  },

  rfd: {
    name: "Rate of force development",
    shortName: "RFD",
    description: "3 explosive pulls of 3 s with 30 s rest. Pull as fast and hard as you can from a relaxed hang.",
    workLabel: "Pull",
    routine: { sets: 3, reps: 1, workS: 3, restS: 0, setRestS: 30, prepS: 5 },
    metrics: [summaryMetric("rfdKgS", "RFD 0–200 ms", kgPerS, INFO.rfd)],
    analyze: ({ attempts, dtS }) =>
      rfdSummary(attempts, dtS) ?? { rfdKgS: null, peakRfdKgS: null, timeToPeakS: null, peakKg: null, attemptRfdKgS: [] },
    tiles: (s) => [
      [kgPerS(s.summary.rfdKgS), "RFD 0–200 ms", INFO.rfd],
      [kgPerS(s.summary.peakRfdKgS), "peak RFD", INFO.peakRfd],
      [s.summary.timeToPeakS !== null ? `${Math.round(s.summary.timeToPeakS * 1000)} ms` : "–", "time to peak", INFO.timeToPeak],
      [kg(s.summary.peakKg), "peak force", INFO.peakForce],
    ],
    table: (s) => ({
      head: ["Attempt", "Peak", "RFD 0–200 ms"],
      rows: s.reps.map((r, i) => [`${i + 1}`, formatKg(r.peakKg), kgPerS(s.summary.attemptRfdKgS?.[i] ?? null)]),
    }),
  },
};

export const TEST_IDS = ["maxPull", "criticalForce", "rfd"];

export const HANDS = { both: "Both hands", left: "Left hand", right: "Right hand", alternate: "Alternating hands" };
