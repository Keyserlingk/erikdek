// History → Compare people: the profiles on this phone side by side for one test or
// routine (History's filters and "Compare by"): who's best (leaderboard), everyone's
// progress as a line each, and their best sessions overlaid on the compare screen.
// Each person keeps one colour (the --cmp-N slots, in profile order).

import { UNIT_PADDING, unitsPlugin } from "./chart.js";
import { profileOf, profiles } from "./profiles.js";
import { formatDate } from "./sessionview.js";
import { metricPoints } from "./tests.js";

const picked = new Set(); // profile ids left out by the user (everyone else is shown)

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const colourOf = (pid) => `--cmp-${(profiles.list.findIndex((p) => p.id === pid) % 6) + 1}`;

// A session's value for the metric: its best hand when there are several.
function valueOf(metric, s) {
  const values = metricPoints(metric, s)
    .map((p) => p.value)
    .filter((v) => v !== null);
  if (!values.length) return null;
  return metric.better === "lower" ? Math.min(...values) : Math.max(...values);
}

// Fills root. list: everyone's sessions (filtered, bodyweight of their day); metric: the
// one to compare; unit: its unit; onCompare(sessions): open the compare screen.
// Returns { destroy } for the chart.
export function renderPeople(root, { list, metric, unit, onCompare }) {
  const better = (a, b) => (metric.better === "lower" ? a < b : a > b);
  const people = profiles.list.filter((p) => list.some((s) => profileOf(s) === p.id));
  const shown = people.filter((p) => !picked.has(p.id));
  let chart = null;

  const chips = el(
    "div",
    { className: "rep-chips" },
    people.map((p) => {
      const on = !picked.has(p.id);
      const b = el("button", { type: "button", className: `rep-chip${on ? " active" : ""}` }, [
        el("span", { className: "cmp-swatch", style: `background: var(${colourOf(p.id)})` }),
        p.name,
      ]);
      b.setAttribute("aria-pressed", String(on));
      b.addEventListener("click", () => {
        if (on) picked.add(p.id);
        else picked.delete(p.id);
        root.dispatchEvent(new Event("change")); // history.js renders again
      });
      return b;
    }),
  );

  if (people.length < 2) {
    root.replaceChildren(
      el("div", { className: "card" }, [
        el("p", {
          className: "muted",
          textContent:
            "Nobody else has sessions for this yet. Add a profile for a friend under Settings → Profiles and let them train, or import results a friend shared from their phone (Settings → Profiles), then compare here.",
        }),
      ]),
    );
    return { destroy() {} };
  }

  // Everyone's best session for the metric.
  const best = new Map(); // pid -> session
  for (const s of list) {
    const v = valueOf(metric, s);
    const pid = profileOf(s);
    if (v === null || !shown.some((p) => p.id === pid)) continue;
    if (!best.has(pid) || (metric.better && better(v, valueOf(metric, best.get(pid))))) best.set(pid, s);
  }
  const ranked = [...best.entries()].sort(([, a], [, b]) => (better(valueOf(metric, a), valueOf(metric, b)) ? -1 : 1));
  const board = metric.better
    ? el(
        "ol",
        { className: "card leaderboard" },
        ranked.map(([pid, s], i) =>
          el("li", { className: pid === profiles.activeId ? "me" : "" }, [
            el("span", { className: "rank", textContent: `${i + 1}` }),
            el("span", { className: "who" }, [
              el("strong", { textContent: profiles.find(pid)?.name ?? "?" }),
              el("span", { className: "muted", textContent: formatDate(s.startedAt) }),
            ]),
            el("span", { className: "value", textContent: metric.format(valueOf(metric, s)) }),
          ]),
        ),
      )
    : el("p", { className: "muted", textContent: "This result has no better or worse. Pick another one under Compare by." });

  const chartBox = el("div", { className: "chart progress-chart" });
  const compare = el("button", { type: "button", className: "secondary", textContent: "Compare best sessions" });
  compare.disabled = best.size < 2;
  compare.addEventListener("click", () => onCompare([...best.values()]));

  root.replaceChildren(
    el("h2", { className: "section", textContent: "People" }),
    chips,
    el("h2", { className: "section", textContent: `Best: ${metric.label}` }),
    board,
    el("h2", { className: "section", textContent: `Progress: ${metric.label}` }),
    el("div", { className: "card chart-card" }, [chartBox]),
    compare,
  );

  // One line per person over all their sessions' dates (gaps between them bridged).
  const sessionsOf = (pid) =>
    list
      .filter((s) => profileOf(s) === pid && valueOf(metric, s) !== null)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const lines = shown.map((p) => ({ p, sessions: sessionsOf(p.id) })).filter((l) => l.sessions.length);
  const times = [...new Set(lines.flatMap((l) => l.sessions.map((s) => new Date(s.startedAt).getTime() / 1000)))].sort((a, b) => a - b);
  if (times.length >= 2) {
    const series = lines.map((l) => {
      const at = new Map(l.sessions.map((s) => [new Date(s.startedAt).getTime() / 1000, valueOf(metric, s)]));
      return times.map((t) => at.get(t) ?? null);
    });
    const text = cssVar("--muted");
    const grid = cssVar("--border");
    chart = new uPlot(
      {
        width: chartBox.clientWidth || 340,
        height: 220,
        legend: { show: false },
        cursor: { show: false },
        padding: UNIT_PADDING,
        plugins: [unitsPlugin({ left: unit })],
        scales: { x: { time: true } },
        axes: [
          {
            stroke: text,
            grid: { stroke: grid, width: 1 },
            ticks: { show: false },
            size: 28,
            space: 56,
            values: (u, vals) => vals.map((v) => new Date(v * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })),
          },
          { stroke: text, grid: { stroke: grid, width: 1 }, ticks: { show: false }, size: 44 },
        ],
        series: [
          {},
          ...lines.map((l) => ({
            stroke: cssVar(colourOf(l.p.id)),
            width: 2,
            spanGaps: true,
            points: { show: true, size: 7, fill: cssVar(colourOf(l.p.id)) },
          })),
        ],
      },
      [times, ...series],
      chartBox,
    );
  } else {
    chartBox.replaceWith(el("p", { className: "muted empty", textContent: "Two or more sessions are needed for a progress line." }));
  }
  return { destroy: () => chart?.destroy() };
}
