// Renders one session (title, details, tiles, force curve, rep table). Used for the
// summary after a workout/test and for a session opened in History.

import { formatDuration, formatKg } from "./format.js";
import { HANDS, KINDS } from "./tests.js";

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

export function sessionTitle(s) {
  const name = s.type === "workout" ? s.name : KINDS[s.type].name;
  return s.stopped ? `${name} (stopped)` : name;
}

export function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  return `${formatDate(iso)} ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

export function sessionTags(s) {
  const tags = [];
  if (s.holdType) tags.push(s.holdType);
  if (s.grip) tags.push(s.grip);
  if (s.hand && s.hand !== "both") tags.push(HANDS[s.hand]);
  return tags;
}

// Builds a static uPlot chart of the session's downsampled curve.
function curveChart(container, curve) {
  const x = curve.kg.map((_, i) => i / curve.hz);
  const width = container.clientWidth || 340;
  return new uPlot(
    {
      width,
      height: 160,
      legend: { show: false },
      cursor: { show: false },
      scales: { x: { time: false } },
      axes: [
        {
          stroke: cssVar("--muted"),
          grid: { stroke: cssVar("--border"), width: 1 },
          ticks: { show: false },
          size: 28,
          values: (u, vals) => vals.map((v) => formatDuration(v)),
        },
        { stroke: cssVar("--muted"), grid: { stroke: cssVar("--border"), width: 1 }, ticks: { show: false }, size: 40 },
      ],
      series: [{}, { stroke: cssVar("--accent"), width: 1.5, points: { show: false } }],
    },
    [x, curve.kg],
    container,
  );
}

// Fills `root` with the session view. Returns the chart (or null) so callers can destroy it.
export function renderSession(root, s) {
  const kind = KINDS[s.type];
  const meta = [formatDateTime(s.startedAt), formatDuration(s.durationS), ...sessionTags(s)];
  if (s.targetKg) meta.push(`target ${formatKg(s.targetKg)} kg`);

  const tiles = el(
    "div",
    { className: "tiles" },
    kind.tiles(s).map(([value, label]) => el("div", { className: "tile" }, [el("strong", { textContent: value }), el("span", { textContent: label })])),
  );

  const chartBox = el("div", { className: "session-chart" });
  const table = kind.table(s);
  const rows = table.rows.map((cells) => el("tr", {}, cells.map((c) => el("td", { textContent: c }))));
  if (table.head.at(-1) === "Held") for (const tr of rows) tr.lastChild.className = "ok";
  const tableCard = el("div", { className: "card" }, [
    el("table", { className: "reps" }, [
      el("thead", {}, [el("tr", {}, table.head.map((h) => el("th", { textContent: h })))]),
      el("tbody", {}, rows),
    ]),
  ]);

  root.replaceChildren(
    el("h1", { textContent: sessionTitle(s) }),
    el("p", { className: "muted", textContent: meta.join(" · ") }),
    tiles,
    el("div", { className: "card chart-card" }, [chartBox]),
    ...(rows.length ? [tableCard] : []),
  );
  return s.curve && s.curve.kg.length > 1 ? curveChart(chartBox, s.curve) : null;
}
