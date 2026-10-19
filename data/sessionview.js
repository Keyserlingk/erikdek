// Renders one session (title, details, tiles, force curve, rep table). Used for the
// summary after a workout/test and for a session opened in History.

import { curvePoints } from "./analysis.js";
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
  if (s.workout) tags.push(`${s.workout.name} ${s.workout.index}/${s.workout.count}`);
  return tags;
}

// Builds a static uPlot chart of the session's downsampled curve.
function curveChart(container, curve) {
  const { x, y } = curvePoints(curve);
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
    [x, y],
    container,
  );
}

// Adds an ⓘ button after `label` that shows/hides `info` below it.
function withInfo(label, info) {
  if (!info) return label;
  const text = el("span", { className: "info-text", textContent: info, hidden: true });
  const button = el("button", { type: "button", className: "info-button", textContent: "ⓘ" });
  button.setAttribute("aria-label", "Explain");
  button.addEventListener("click", () => {
    text.hidden = !text.hidden;
    button.setAttribute("aria-expanded", String(!text.hidden));
  });
  return el("span", { className: "with-info" }, [el("span", { className: "info-row" }, [label, button]), text]);
}

// Per-rep percentages, one line per set.
function renderStrip(strip) {
  const sets = [];
  for (const v of strip.values) {
    if (!sets.length || sets.at(-1).set !== v.set) sets.push({ set: v.set, values: [] });
    sets.at(-1).values.push(v);
  }
  return el("div", { className: "strip-block" }, [
    withInfo(el("span", { className: "strip-label", textContent: strip.label }), strip.info),
    ...sets.map((set) =>
      el("div", { className: "strip-row" }, [
        el("span", { className: "strip-set", textContent: sets.length > 1 ? `Set ${set.set}` : "Reps" }),
        ...set.values.map((v) => {
          const hand = v.hand === "left" ? "L " : v.hand === "right" ? "R " : "";
          return el("span", { className: "strip-value", textContent: `${hand}${Math.round(v.pct)} %` });
        }),
      ]),
    ),
  ]);
}

// Fills `root` with the session view. Returns the chart (or null) so callers can destroy it.
export function renderSession(root, s) {
  const kind = KINDS[s.type];
  const meta = [formatDateTime(s.startedAt), formatDuration(s.durationS), ...sessionTags(s)];
  if (s.targetKg) meta.push(`target ${formatKg(s.targetKg)} kg`);

  // Routines show their reps and time; tests have nothing but force to show.
  const noForceTest = s.noForce && s.type !== "workout";
  const tiles = el(
    "div",
    { className: "tiles" },
    (noForceTest ? [] : kind.tiles(s)).map(([value, label, info]) =>
      el("div", { className: "tile" }, [el("strong", { textContent: value }), withInfo(el("span", { textContent: label }), info)]),
    ),
  );

  const chartBox = el("div", { className: "session-chart" });
  // Sessions without the sensor have no force curve.
  const hasCurve = !!s.curve && curvePoints(s.curve).x.length > 1;
  const table = noForceTest ? { head: [], rows: [] } : kind.table(s);
  const rows = table.rows.map((cells) => el("tr", {}, cells.map((c) => el("td", { textContent: c }))));
  const strips = (noForceTest ? [] : kind.strips?.(s) ?? []).filter((strip) => strip.values.length > 1);
  const tableCard = el("div", { className: "card" }, [
    el("table", { className: "reps" }, [
      el("thead", {}, [el("tr", {}, table.head.map((h) => el("th", { textContent: h })))]),
      el("tbody", {}, rows),
    ]),
  ]);

  root.replaceChildren(
    el("h1", { textContent: sessionTitle(s) }),
    el("p", { className: "muted", textContent: meta.join(" · ") }),
    ...(s.noForce ? [el("p", { className: "no-force", textContent: "No force data: the sensor wasn't connected." })] : []),
    ...(noForceTest ? [] : [tiles]),
    ...(hasCurve ? [el("div", { className: "card chart-card" }, [chartBox])] : []),
    ...(strips.length ? [el("div", { className: "card strips" }, strips.map(renderStrip))] : []),
    ...(rows.length ? [tableCard] : []),
  );
  return hasCurve ? curveChart(chartBox, s.curve) : null;
}
