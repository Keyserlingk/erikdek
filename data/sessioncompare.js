// Compares 2–6 sessions of one kind (History → Select → Compare): each session's
// average rep (or best rep) on one chart, lined up where the pull starts, and their
// numbers side by side with the best of each row in bold. Sessions keep one colour each
// (categorical slots in fixed order, --cmp-1..6) in the legend, chart and table.

import { UNIT_PADDING, unitsPlugin } from "./chart.js";
import { representativeCurve, resample } from "./analysis.js";
import { formatDuration } from "./format.js";
import { formatDateTime, sessionTags } from "./sessionview.js";
import { KINDS, metricPoints } from "./tests.js";

export const MAX_COMPARE = 6;
const GRID_STEP_S = 0.025;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const colorOf = (i) => cssVar(`--cmp-${i + 1}`);
const swatch = (i) => el("span", { className: "cmp-swatch", style: `background: var(--cmp-${i + 1})` });

// Short column label: day and month, plus the time when two sessions share a day.
function shortLabels(list) {
  const day = (s) => new Date(s.startedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const time = (s) => new Date(s.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return list.map((s) => (list.filter((o) => day(o) === day(s)).length > 1 ? `${day(s)} ${time(s)}` : day(s)));
}

function formatValue(m, s) {
  const points = metricPoints(m, s).filter((p) => p.value !== null);
  if (!points.length) return { text: "–", value: null };
  if (points.length === 1) return { text: m.format(points[0].value), value: points[0].value };
  return { text: points.map((p) => `${p.hand[0].toUpperCase()} ${m.format(p.value)}`).join(" · "), value: null };
}

function metricsTable(list) {
  const kind = KINDS[list[0].type];
  const labels = shortLabels(list);
  const rows = [["Duration", list.map((s) => ({ text: formatDuration(s.durationS), value: null })), null]];
  for (const m of kind.metrics) {
    const cells = list.map((s) => formatValue(m, s));
    if (cells.some((c) => c.text !== "–")) rows.push([m.label, cells, m.better]);
  }
  const body = rows.map(([label, cells, better]) => {
    // Best of the row in bold (single values only, and only when "better" means something).
    const values = cells.map((c) => c.value).filter((v) => v !== null);
    const best = better && values.length > 1 ? (better === "lower" ? Math.min(...values) : Math.max(...values)) : null;
    return el("tr", {}, [
      el("th", { scope: "row", textContent: label }),
      ...cells.map((c) => el("td", { textContent: c.text, className: best !== null && c.value === best ? "best" : "" })),
    ]);
  });
  return el("div", { className: "cmp-table-wrap" }, [
    el("table", { className: "cmp-table" }, [
      el("thead", {}, [el("tr", {}, [el("th"), ...labels.map((l, i) => el("th", { scope: "col" }, [swatch(i), l]))])]),
      el("tbody", {}, body),
    ]),
  ]);
}

// Fills root with the comparison of the full sessions in list (oldest first). Returns
// { destroy } for its chart.
export function renderCompare(root, list) {
  const kind = KINDS[list[0].type];
  const state = { mode: list[0].type === "maxPull" || list[0].type === "rfd" ? "best" : "average", plot: null };
  const chartBox = el("div", { className: "session-chart" });
  const modes = el("div", { className: "segmented", role: "group" });
  modes.setAttribute("aria-label", "Rep to compare");
  const missing = list.filter((s) => !s.repCurves);
  const withCurves = list.map((s, i) => ({ s, i })).filter(({ s }) => s.repCurves);

  function draw() {
    state.plot?.destroy();
    for (const b of modes.children) b.classList.toggle("active", b.dataset.mode === state.mode);
    const curves = withCurves.map(({ s, i }) => ({ i, c: representativeCurve(s.repCurves, state.mode) })).filter((r) => r.c);
    if (!curves.length) return;
    const from = Math.min(...curves.map((r) => r.c.x[0]));
    const to = Math.max(...curves.map((r) => r.c.x.at(-1)));
    const grid = [];
    for (let t = from; t <= to + 1e-9; t += GRID_STEP_S) grid.push(Math.round(t * 1000) / 1000);
    const axis = { stroke: cssVar("--muted"), grid: { stroke: cssVar("--border"), width: 1 }, ticks: { show: false } };
    state.plot = new uPlot(
      {
        width: chartBox.clientWidth || 340,
        height: 220,
        legend: { show: false },
        cursor: { show: false },
        padding: UNIT_PADDING,
        plugins: [unitsPlugin({ left: "kg" })],
        scales: { x: { time: false } },
        axes: [
          { ...axis, size: 28, values: (u, vals) => vals.map((v) => (v < 0 ? "" : formatDuration(v))) },
          { ...axis, size: 40 },
        ],
        series: [{}, ...curves.map((r) => ({ stroke: colorOf(r.i), width: 2, points: { show: false } }))],
      },
      [grid, ...curves.map((r) => resample(r.c.x, r.c.y, grid))],
      chartBox,
    );
  }

  for (const [mode, text] of [["average", "Average rep"], ["best", "Best rep"]]) {
    const b = el("button", { type: "button", textContent: text });
    b.dataset.mode = mode;
    b.addEventListener("click", () => {
      state.mode = mode;
      draw();
    });
    modes.append(b);
  }

  const legend = el(
    "ul",
    { className: "cmp-legend" },
    list.map((s, i) =>
      el("li", {}, [
        swatch(i),
        el("span", {}, [
          el("strong", { textContent: formatDateTime(s.startedAt) }),
          el("span", { className: "muted", textContent: [s.type === "workout" ? s.name : "", ...sessionTags(s), ...(s.tags ?? [])].filter(Boolean).join(" · ") }),
        ]),
      ]),
    ),
  );

  root.replaceChildren(
    el("h1", { textContent: `Compare ${list.length} sessions` }),
    el("p", { className: "muted", textContent: kind.name }),
    el("div", { className: "card" }, [legend]),
    el("div", { className: "card" }, [
      el("div", { className: "rep-compare-head" }, [el("h2", { textContent: "Force per rep" }), modes]),
      el("p", {
        className: "muted",
        textContent: "Each session's average rep (or its best rep), lined up where the pull starts.",
      }),
      ...(withCurves.length ? [chartBox] : []),
      ...(missing.length
        ? [el("p", { className: "muted", textContent: `No rep curves for ${shortLabels(list).filter((_, i) => !list[i].repCurves).join(", ")} (recorded without the sensor, or before rep curves were saved).` })]
        : []),
    ]),
    el("div", { className: "card" }, [el("h2", { textContent: "Numbers" }), metricsTable(list)]),
  );
  draw();
  return { destroy: () => state.plot?.destroy() };
}
