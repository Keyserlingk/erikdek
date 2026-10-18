// Session kinds: free workouts (routines) and the standard tests. Each kind knows how to
// summarise a recorded run, which metric shows progress, and how to present a session.
// No DOM access, so it runs under node --test too.

import { CF_LAST_REPS, criticalForceSummary, maxPullSummary, rfdSummary } from "./analysis.js";
import { formatDuration, formatKg } from "./format.js";

const kg = (v) => (v === null || v === undefined ? "–" : `${formatKg(v)} kg`);
const kgPerS = (v) => (v === null || v === undefined ? "–" : `${Math.round(v)} kg/s`);
const pctBw = (v, bw) => (v && bw > 0 ? ` · ${Math.round((v / bw) * 100)} % BW` : "");

export const KINDS = {
  workout: {
    name: "Workout",
    workLabel: "Hang",
    metric: { key: "avgKg", label: "Average force", format: kg },
    analyze({ reps, routine }) {
      return {
        completed: reps.filter((r) => r.completed).length,
        totalReps: routine.sets * routine.reps,
        peakKg: reps.reduce((m, r) => Math.max(m, r.peakKg), 0),
        avgKg: reps.length ? reps.reduce((s, r) => s + r.meanKg, 0) / reps.length : null,
        tutS: reps.reduce((s, r) => s + r.tutS, 0),
      };
    },
    tiles: (s) => [
      [`${s.summary.completed}/${s.summary.totalReps}`, "reps completed"],
      [kg(s.summary.peakKg), "best peak"],
      [kg(s.summary.avgKg), "avg force"],
      [formatDuration(Math.round(s.summary.tutS)), "time under tension"],
    ],
    table: (s) => ({
      head: ["Rep", "Peak", "Avg", "Loaded", ""],
      rows: s.reps.map((r) => [`${r.set}.${r.rep}`, formatKg(r.peakKg), formatKg(r.meanKg), `${r.tutS.toFixed(1)} s`, r.completed ? "✓" : ""]),
    }),
  },

  maxPull: {
    name: "Max pull",
    description: "3 all-out pulls of 5 s with 90 s rest. Measures your strongest pull.",
    workLabel: "Pull",
    routine: { sets: 3, reps: 1, workS: 5, restS: 0, setRestS: 90, prepS: 10 },
    metric: { key: "peakKg", label: "Peak force", format: kg },
    analyze: ({ attempts, dtS }) => maxPullSummary(attempts, dtS),
    tiles: (s) => [
      [kg(s.summary.peakKg), `peak force${pctBw(s.summary.peakKg, s.bodyweightKg)}`],
      [kg(s.summary.best1sKg), "best 1 s average"],
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
    routine: { sets: 1, reps: 24, workS: 7, restS: 3, setRestS: 0, prepS: 10 },
    metric: { key: "cfKg", label: "Critical force", format: kg },
    analyze({ reps, routine }) {
      const cf = criticalForceSummary(
        reps.map((r) => r.meanKg),
        reps.map((r) => r.peakKg),
        routine.workS,
      );
      return cf ?? { cfKg: null, peakKg: Math.max(0, ...reps.map((r) => r.peakKg)), cfShareOfPeak: null, wPrimeKgS: null };
    },
    tiles: (s) => [
      [kg(s.summary.cfKg), `critical force${pctBw(s.summary.cfKg, s.bodyweightKg)}`],
      [s.summary.cfShareOfPeak ? `${Math.round(s.summary.cfShareOfPeak * 100)} %` : "–", "of peak force"],
      [kg(s.summary.peakKg), "peak force"],
      [s.summary.wPrimeKgS !== null ? `${Math.round(s.summary.wPrimeKgS)} kg·s` : "–", "W′ (work above CF)"],
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
    routine: { sets: 3, reps: 1, workS: 3, restS: 0, setRestS: 30, prepS: 10 },
    metric: { key: "rfdKgS", label: "RFD 0–200 ms", format: kgPerS },
    analyze: ({ attempts, dtS }) =>
      rfdSummary(attempts, dtS) ?? { rfdKgS: null, peakRfdKgS: null, timeToPeakS: null, peakKg: null, attemptRfdKgS: [] },
    tiles: (s) => [
      [kgPerS(s.summary.rfdKgS), "RFD 0–200 ms"],
      [kgPerS(s.summary.peakRfdKgS), "peak RFD"],
      [s.summary.timeToPeakS !== null ? `${Math.round(s.summary.timeToPeakS * 1000)} ms` : "–", "time to peak"],
      [kg(s.summary.peakKg), "peak force"],
    ],
    table: (s) => ({
      head: ["Attempt", "Peak", "RFD 0–200 ms"],
      rows: s.reps.map((r, i) => [`${i + 1}`, formatKg(r.peakKg), kgPerS(s.summary.attemptRfdKgS?.[i] ?? null)]),
    }),
  },
};

export const TEST_IDS = ["maxPull", "criticalForce", "rfd"];

export const HANDS = { both: "Both hands", left: "Left hand", right: "Right hand" };
