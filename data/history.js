import { device } from "./device.js";
import { downloadCsv, downloadJson } from "./download.js";
import { fileDate, historyCsv, storedCurveCsv } from "./export.js";
import { sessions } from "./sessions.js";
import { formatDate, formatDateTime, renderSession, sessionTags, sessionTitle } from "./sessionview.js";
import { HANDS, KINDS, TEST_IDS, metricPoints } from "./tests.js";

const KIND_ORDER = [...TEST_IDS, "workout"];
// Series in History; alternating sessions contribute to left and right.
const HAND_ORDER = ["both", "left", "right"];
const HAND_COLOR = { both: "--accent", left: "--series-left", right: "--series-right" };
const ALL = "";

const $ = (id) => document.getElementById(id);
const el = {
  main: $("historyMain"),
  detail: $("historyDetail"),
  storage: $("histStorage"),
  error: $("histError"),
  kind: $("histKind"),
  hold: $("histHold"),
  grip: $("histGrip"),
  routineRow: $("histRoutineRow"),
  routine: $("histRoutine"),
  metricRow: $("histMetricRow"),
  metric: $("histMetric"),
  bests: $("histBests"),
  progressTitle: $("histProgressTitle"),
  legend: $("histLegend"),
  chart: $("histChart"),
  chartEmpty: $("histChartEmpty"),
  list: $("histList"),
  back: $("histBack"),
  detailView: $("histDetailView"),
  detailError: $("histDetailError"),
  remove: $("histDelete"),
  csv: $("histCsv"),
  detailCsv: $("histDetailCsv"),
  detailJson: $("histDetailJson"),
};

let progressChart = null;
let detailChart = null;
let openId = null;
let openSession = null;
let metricKind = null; // kind the metric picker was filled for

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function create(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function showError(node, text) {
  node.textContent = text;
  node.hidden = !text;
}

function isVisible() {
  return !document.getElementById("view-history").hidden;
}

// Refills a filter <select>, keeping the current choice when it still exists.
function fillSelect(select, allLabel, values) {
  const current = select.value;
  const options = [create("option", { value: ALL, textContent: allLabel })];
  for (const v of values) options.push(create("option", { value: v, textContent: v }));
  select.replaceChildren(...options);
  select.value = values.includes(current) ? current : ALL;
}

function distinct(list, key) {
  return [...new Set(list.map((s) => s[key]).filter(Boolean))].sort();
}

function filtered() {
  const kind = el.kind.value;
  return sessions.index.filter(
    (s) =>
      s.type === kind &&
      (el.hold.value === ALL || s.holdType === el.hold.value) &&
      (el.grip.value === ALL || s.grip === el.grip.value) &&
      (kind !== "workout" || el.routine.value === ALL || s.name === el.routine.value),
  );
}

function currentMetric() {
  const metrics = KINDS[el.kind.value].metrics;
  return metrics.find((m) => m.key === el.metric.value) || metrics[0];
}

// The session's points for the current metric: one per hand for alternating sessions.
function pointsOf(s) {
  return metricPoints(currentMetric(), s).filter((p) => p.value !== null);
}

// ---------------------------------------------------------------- main view

function renderFilters() {
  const ofKind = sessions.index.filter((s) => s.type === el.kind.value);
  fillSelect(el.hold, "All holds", distinct(ofKind, "holdType"));
  fillSelect(el.grip, "All grips", distinct(ofKind, "grip"));
  fillSelect(el.routine, "All routines", distinct(ofKind, "name"));
  el.routineRow.hidden = el.kind.value !== "workout";

  // New kind: refill the metric picker and start at its default (first) metric.
  if (metricKind !== el.kind.value) {
    metricKind = el.kind.value;
    const metrics = KINDS[metricKind].metrics;
    el.metric.replaceChildren(...metrics.map((m) => create("option", { value: m.key, textContent: m.label })));
    el.metric.value = metrics[0].key;
    el.metricRow.hidden = metrics.length < 2;
  }
}

function renderBests(list, metric) {
  const tiles = [];
  for (const hand of HAND_ORDER) {
    let best = null;
    for (const s of list) {
      for (const p of pointsOf(s)) {
        if (p.hand === hand && (!best || p.value > best.value)) best = { value: p.value, date: s.startedAt };
      }
    }
    if (!best) continue;
    const label = `${hand === "both" ? "best" : `best ${HANDS[hand].toLowerCase()}`} · ${formatDate(best.date)}`;
    tiles.push(create("div", { className: "tile" }, [create("strong", { textContent: metric.format(best.value) }), create("span", { textContent: label })]));
  }
  tiles.push(create("div", { className: "tile" }, [create("strong", { textContent: String(list.length) }), create("span", { textContent: list.length === 1 ? "session" : "sessions" })]));
  el.bests.replaceChildren(...tiles);
}

function renderProgress(list, metric) {
  if (progressChart) {
    progressChart.destroy();
    progressChart = null;
  }
  el.progressTitle.textContent = `Progress: ${metric.label}`;
  const points = list.filter((s) => pointsOf(s).length).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const hands = HAND_ORDER.filter((h) => points.some((s) => pointsOf(s).some((p) => p.hand === h)));
  el.chartEmpty.hidden = points.length >= 2;
  el.chart.hidden = points.length < 2;
  el.legend.replaceChildren(
    ...(hands.length > 1
      ? hands.map((h) => create("span", { className: "legend-item", textContent: HANDS[h] }, []))
      : []),
  );
  [...el.legend.children].forEach((item, i) => item.style.setProperty("--swatch", cssVar(HAND_COLOR[hands[i]])));
  if (points.length < 2 || !isVisible()) return;

  // One x value per session; each hand is its own series with gaps elsewhere.
  const x = points.map((s) => new Date(s.startedAt).getTime() / 1000);
  const series = hands.map((h) => points.map((s) => pointsOf(s).find((p) => p.hand === h)?.value ?? null));
  const text = cssVar("--muted");
  const grid = cssVar("--border");
  progressChart = new uPlot(
    {
      width: el.chart.clientWidth,
      height: el.chart.clientHeight,
      legend: { show: false },
      cursor: { show: false },
      scales: { x: { time: true } },
      axes: [
        {
          stroke: text,
          grid: { stroke: grid, width: 1 },
          ticks: { show: false },
          size: 28,
          space: 56,
          values: (u, vals) =>
            vals.map((v) => new Date(v * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })),
        },
        { stroke: text, grid: { stroke: grid, width: 1 }, ticks: { show: false }, size: 44 },
      ],
      series: [
        {},
        ...hands.map((h) => ({
          stroke: cssVar(HAND_COLOR[h]),
          width: 2,
          spanGaps: true,
          points: { show: true, size: 7, fill: cssVar(HAND_COLOR[h]) },
        })),
      ],
    },
    [x, ...series],
    el.chart,
  );
}

// "21.0 kg", or "L 21.0 kg · R 15.7 kg" for an alternating session.
function formatPoints(s, metric) {
  const points = pointsOf(s);
  if (!points.length) return "–";
  if (points.length === 1) return metric.format(points[0].value);
  return points.map((p) => `${p.hand[0].toUpperCase()} ${metric.format(p.value)}`).join(" · ");
}

function renderList(list, metric) {
  const sorted = [...list].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  if (!sorted.length) {
    el.list.replaceChildren(create("p", { className: "muted", textContent: "No sessions yet. Run a test or routine in Train and save it." }));
    return;
  }
  el.list.replaceChildren(
    ...sorted.map((s) => {
      const row = create("button", { type: "button", className: "card session-row" }, [
        create("div", { className: "session-main" }, [
          create("strong", { textContent: s.type === "workout" ? sessionTitle(s) : formatDateTime(s.startedAt) }),
          create("span", {
            className: "muted",
            textContent: [s.type === "workout" ? formatDateTime(s.startedAt) : null, ...sessionTags(s), s.stopped ? "stopped" : null]
              .filter(Boolean)
              .join(" · "),
          }),
        ]),
        create("span", { className: "session-metric", textContent: formatPoints(s, metric) }),
      ]);
      row.addEventListener("click", () => openDetail(s.id));
      return row;
    }),
  );
}

async function renderStorage() {
  try {
    const { totalBytes, usedBytes } = await sessions.storage();
    const kb = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
    el.storage.textContent = `Device storage: ${kb(usedBytes)} of ${kb(totalBytes)} used (${Math.round((usedBytes / totalBytes) * 100)} %)`;
  } catch {
    el.storage.textContent = "";
  }
}

function render() {
  renderFilters();
  const list = filtered();
  const metric = currentMetric();
  renderBests(list, metric);
  renderProgress(list, metric);
  renderList(list, metric);
}

// ---------------------------------------------------------------- detail

async function openDetail(id) {
  openId = id;
  showError(el.detailError, "");
  el.main.hidden = true;
  el.detail.hidden = false;
  el.detailView.replaceChildren(create("p", { className: "muted", textContent: "Loading…" }));
  window.scrollTo(0, 0);
  try {
    const s = await sessions.get(id);
    if (openId !== id) return;
    openSession = s;
    if (detailChart) detailChart.destroy();
    detailChart = renderSession(el.detailView, s);
  } catch (e) {
    el.detailView.replaceChildren();
    showError(el.detailError, e.message);
  }
}

function closeDetail() {
  openId = null;
  openSession = null;
  el.detail.hidden = true;
  el.main.hidden = false;
  render();
}

async function deleteOpen() {
  if (!confirm("Delete this session? This cannot be undone.")) return;
  try {
    await sessions.remove(openId);
    closeDetail();
    renderStorage();
  } catch (e) {
    showError(el.detailError, e.message);
  }
}

// ---------------------------------------------------------------- init

export function initHistory() {
  el.kind.replaceChildren(
    ...KIND_ORDER.map((k) => create("option", { value: k, textContent: k === "workout" ? "Workouts" : KINDS[k].name })),
  );
  for (const select of [el.kind, el.hold, el.grip, el.routine, el.metric]) select.addEventListener("change", render);
  el.back.addEventListener("click", closeDetail);
  el.remove.addEventListener("click", deleteOpen);
  el.csv.addEventListener("click", () => downloadCsv(`erkdek-history-${fileDate()}.csv`, historyCsv(sessions.index)));
  const detailName = (s) => `erkdek-${s.type}-${fileDate(new Date(s.startedAt))}-${s.id}`;
  el.detailCsv.addEventListener("click", () => {
    if (openSession?.curve) downloadCsv(`${detailName(openSession)}.csv`, storedCurveCsv(openSession.curve));
  });
  el.detailJson.addEventListener("click", () => {
    if (openSession) downloadJson(`${detailName(openSession)}.json`, openSession);
  });

  sessions.addEventListener("change", () => {
    if (isVisible() && el.detail.hidden) render();
  });
  device.on("connection", (state) => {
    if (state === "open") sessions.load().then(() => showError(el.error, ""), (e) => showError(el.error, e.message));
  });
  new ResizeObserver(() => {
    if (progressChart) progressChart.setSize({ width: el.chart.clientWidth, height: el.chart.clientHeight });
  }).observe(el.chart);
}

// Called when the History tab becomes visible: back to the overview, freshly rendered.
export function showHistory() {
  if (!el.detail.hidden) closeDetail();
  else render();
  renderStorage();
}
