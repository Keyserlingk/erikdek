// Session kinds: free workouts (routines) and the standard tests. Each kind knows how to
// summarise a recorded run, which metric shows progress, and how to present a session.
// No DOM access, so it runs under node --test too.

import { CF_LAST_REPS, criticalForceSummary, forceRetention, maxPullSummary, rfdSummary } from "./analysis.js";
import { formatDuration, formatKg } from "./format.js";

const kg = (v) => (v === null || v === undefined ? "–" : `${formatKg(v)} kg`);
const kgPerS = (v) => (v === null || v === undefined ? "–" : `${Math.round(v)} kg/s`);
const pctBw = (v, bw) => (v && bw > 0 ? ` · ${Math.round((v / bw) * 100)} % BW` : "");
const pct = (v) => (v === null || v === undefined ? "–" : `${Math.round(v)} %`);
const seconds = (v) => (v === null || v === undefined ? "–" : formatDuration(Math.round(v)));
const num = (v) => (typeof v === "number" ? v : null);
const holdClass = (hold) => (hold >= 90 ? "ok" : hold >= 50 ? "warn" : "bad");

// Progress metrics: value(session) reads it from a saved session (index entry is enough).
// Kinds list them in `metrics`; the first one is the default.
const summaryMetric = (key, label, format) => ({ key, label, format, value: (s) => num(s.summary?.[key]) });

export const KINDS = {
  workout: {
    name: "Workout",
    workLabel: "Hang",
    metrics: [
      {
        key: "holdPct",
        label: "Hold %",
        format: pct,
        // Sessions saved before hold % existed: derive it from time under tension.
        value: (s) =>
          num(s.summary?.holdPct) ??
          (s.summary?.totalReps && s.routine?.workS ? (100 * s.summary.tutS) / (s.summary.totalReps * s.routine.workS) : null),
      },
      summaryMetric("retentionPct", "Force retention", pct),
      summaryMetric("workPct", "Work vs target", pct),
      summaryMetric("tutS", "Time under tension", seconds),
      summaryMetric("avgKg", "Average force", kg),
      summaryMetric("peakKg", "Peak force", kg),
      { key: "targetKg", label: "Target load", format: kg, value: (s) => num(s.targetKg) },
    ],
    // Per-rep values are averaged over all planned reps, so skipped reps count as 0.
    analyze({ reps, routine, target }) {
      const totalReps = routine.sets * routine.reps;
      const sum = (key) => reps.reduce((s, r) => s + (r[key] ?? 0), 0);
      return {
        completed: reps.filter((r) => r.completed).length,
        totalReps,
        holdPct: sum("holdPct") / totalReps,
        workPct: target ? sum("workPct") / totalReps : null,
        retentionPct: forceRetention(reps.map((r) => r.meanKg)),
        peakKg: reps.reduce((m, r) => Math.max(m, r.peakKg), 0),
        avgKg: reps.length ? sum("meanKg") / reps.length : null,
        tutS: sum("tutS"),
      };
    },
    tiles: (s) => [
      [pct(KINDS.workout.metrics[0].value(s)), `hold · ${s.summary.completed}/${s.summary.totalReps} full reps`],
      [pct(s.summary.retentionPct), "force retention (last vs first reps)"],
      ...(s.targetKg ? [[pct(s.summary.workPct), "work vs target"]] : []),
      [kg(s.summary.avgKg), "avg force"],
      [kg(s.summary.peakKg), "best peak"],
      [formatDuration(Math.round(s.summary.tutS)), "time under tension"],
    ],
    table: (s) => {
      const first = s.reps[0]?.meanKg;
      const hasWork = s.reps.some((r) => typeof r.workPct === "number");
      return {
        head: ["Rep", "Avg", "Hold", ...(hasWork ? ["Work"] : []), "vs 1st"],
        rows: s.reps.map((r) => {
          const hold = r.holdPct ?? (100 * r.tutS) / s.routine.workS;
          return [
            `${r.set}.${r.rep}`,
            formatKg(r.meanKg),
            { text: `${Math.round(hold)} %${r.completed ? " ✓" : ""}`, cls: holdClass(hold) },
            ...(hasWork ? [pct(r.workPct)] : []),
            first > 0 ? pct((100 * r.meanKg) / first) : "–",
          ];
        }),
      };
    },
    // Bar strips per rep: hold % and force relative to rep 1.
    strips: (s) => {
      const first = s.reps[0]?.meanKg;
      const strips = [
        {
          label: "Hold per rep",
          bars: s.reps.map((r) => {
            const hold = r.holdPct ?? (100 * r.tutS) / s.routine.workS;
            return { set: r.set, pct: hold, cls: holdClass(hold), title: `${r.set}.${r.rep}: ${Math.round(hold)} %` };
          }),
        },
      ];
      if (first > 0) {
        strips.push({
          label: "Force vs rep 1",
          bars: s.reps.map((r) => {
            const rel = (100 * r.meanKg) / first;
            return { set: r.set, pct: Math.min(rel, 100), cls: "neutral", title: `${r.set}.${r.rep}: ${Math.round(rel)} %` };
          }),
        });
      }
      return strips;
    },
  },

  maxPull: {
    name: "Max pull",
    description: "3 all-out pulls of 5 s with 90 s rest. Measures your strongest pull.",
    workLabel: "Pull",
    routine: { sets: 3, reps: 1, workS: 5, restS: 0, setRestS: 90, prepS: 10 },
    metrics: [summaryMetric("peakKg", "Peak force", kg)],
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
    metrics: [summaryMetric("cfKg", "Critical force", kg)],
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
    metrics: [summaryMetric("rfdKgS", "RFD 0–200 ms", kgPerS)],
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
