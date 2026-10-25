import { UNIT_PADDING, unitsPlugin } from "./chart.js";
import { downloadCsv, downloadJson } from "./download.js";
import { formatBytes } from "./format.js";
import { buildBackup, fileDate, hasCurveData, historyCsv, repsCsv, storedCurveCsv } from "./export.js";
import { profileOf, profiles } from "./profiles.js";
import { bodyweightOn, settings } from "./settingsstore.js";
import { sessions } from "./sessions.js";
import { renderPeople } from "./peoplecompare.js";
import { MAX_COMPARE, renderCompare } from "./sessioncompare.js";
import { editCard } from "./sessionedit.js";
import { notesCard } from "./sessionnotes.js";
import { formatDate, formatDateTime, renderSession, sessionTags, sessionTitle } from "./sessionview.js";
import { HANDS, KINDS, TEST_IDS, metricPoints, metricsFor } from "./tests.js";

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
  routineLabel: $("histRoutineLabel"),
  metricRow: $("histMetricRow"),
  metric: $("histMetric"),
  bests: $("histBests"),
  progressTitle: $("histProgressTitle"),
  metricInfo: $("histMetricInfo"),
  metricInfoText: $("histMetricInfoText"),
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
  detailRepsCsv: $("histDetailRepsCsv"),
  detailJson: $("histDetailJson"),
  detailNotes: $("histDetailNotes"),
  edit: $("histEdit"),
  detailEdit: $("histDetailEdit"),
  tag: $("histTag"),
  modes: document.querySelectorAll("#histMode button"),
  modeBar: $("histMode"),
  mine: $("histMine"),
  people: $("histPeople"),
  board: $("histBoard"),
  boardRow: $("histBoardRow"),
  tagRow: $("histTagRow"),
  select: $("histSelect"),
  selectBar: $("histSelectBar"),
  selectCount: $("histSelectCount"),
  selectAll: $("histSelectAll"),
  selectNone: $("histSelectNone"),
  selectDone: $("histSelectDone"),
  selCompare: $("histSelCompare"),
  compare: $("historyCompare"),
  compareBack: $("histCompareBack"),
  compareView: $("histCompareView"),
  selJson: $("histSelJson"),
  selCsv: $("histSelCsv"),
  selDelete: $("histSelDelete"),
};

// Select mode: tapping a session ticks it instead of opening it; the bar at the bottom
// downloads or deletes the ticked ones.
let selecting = false;
const selected = new Set(); // session ids
let visibleIds = []; // sessions in the list now (after the filters)
let compareChart = null;

let progressChart = null;
let detailChart = null;
let openId = null;
let openSession = null;
let metricKind = null; // kind the metric picker was filled for
let metricKeys = null; // and the metrics it offered

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

// ---------------------------------------------------------------- people
// History is the active profile's ("Mine"); "Compare people" puts the profiles on this
// phone side by side (peoplecompare.js), each with the bodyweight of their own log.

let mode = "mine"; // or "people"
let peopleChart = null;
let profileSettings = {}; // { profileId: settings }, for the others' bodyweight logs

async function loadProfileSettings() {
  profileSettings = await settings.byProfile().catch(() => ({}));
}

// A session with the bodyweight of its day from its own person's log.
function withWeight(s) {
  const pid = profileOf(s);
  if (pid === profiles.activeId) return settings.withBodyweight(s);
  if (s.bodyweightFixed) return s;
  const logged = bodyweightOn(profileSettings[pid]?.bodyweightLog ?? [], s.startedAt);
  return logged ? { ...s, bodyweightKg: logged } : s;
}

const personOf = (s) => profiles.find(profileOf(s))?.name ?? "?";

// The active profile's sessions, each with the bodyweight of its day (bodyweight log).
function mySessions() {
  return sessions.index.map(withWeight);
}

// Everyone's sessions (Compare people).
function everyonesSessions() {
  return sessions.all.map(withWeight);
}

// The Mine / Compare people switch shows once someone else has sessions too.
function renderMode() {
  const others = sessions.all.some((s) => profileOf(s) !== profiles.activeId);
  el.modeBar.hidden = !others;
  if (!others) mode = "mine";
  for (const b of el.modes) {
    b.classList.toggle("active", b.dataset.mode === mode);
    b.setAttribute("aria-selected", String(b.dataset.mode === mode));
  }
  el.mine.hidden = mode !== "mine";
  el.people.hidden = mode !== "people";
}

// Sessions of the chosen kind matching the filters (default: the active profile's).
function filtered(source = mySessions()) {
  const kind = el.kind.value;
  return source.filter(
    (s) =>
      s.type === kind &&
      (el.hold.value === ALL || s.holdType === el.hold.value) &&
      (el.grip.value === ALL || s.grip === el.grip.value) &&
      (el.board.value === ALL || s.board === el.board.value) &&
      (el.tag.value === ALL || (s.tags ?? []).includes(el.tag.value)) &&
      (el.routine.value === ALL || s.name === el.routine.value),
  );
}

function currentMetric() {
  const metrics = KINDS[el.kind.value].metrics;
  return metrics.find((m) => m.key === el.metric.value) || metrics[0];
}

// The metric picker offers what fits the sessions shown (with or without the sensor);
// it keeps the current choice when it still fits, else starts at one that has data.
function renderMetricPicker() {
  const list = filtered();
  const metrics = metricsFor(el.kind.value, list);
  const keys = metrics.map((m) => m.key).join(",");
  if (keys === metricKeys && el.kind.value === metricKind) return;
  metricKind = el.kind.value;
  metricKeys = keys;
  const current = el.metric.value;
  const option = (m) => create("option", { value: m.key, textContent: m.label });
  const sensorGroup = metrics.filter((m) => m.sensor === true);
  const otherGroup = metrics.filter((m) => m.sensor === false);
  el.metric.replaceChildren(
    ...(sensorGroup.length && otherGroup.length
      ? [
          create("optgroup", { label: "With the sensor" }, sensorGroup.map(option)),
          create("optgroup", { label: "Without the sensor" }, otherGroup.map(option)),
        ]
      : metrics.map(option)),
  );
  const hasData = (m) => list.some((s) => metricPoints(m, s).some((p) => p.value !== null));
  const keep = metrics.find((m) => m.key === current);
  el.metric.value = (keep ?? metrics.find(hasData) ?? metrics[0]).key;
  el.metricRow.hidden = metrics.length < 2;
}

// The session's points for the current metric: one per hand for alternating sessions.
function pointsOf(s) {
  return metricPoints(currentMetric(), s).filter((p) => p.value !== null);
}

// ---------------------------------------------------------------- main view

function renderFilters() {
  const ofKind = (mode === "people" ? everyonesSessions() : mySessions()).filter((s) => s.type === el.kind.value);
  fillSelect(el.hold, "All holds", distinct(ofKind, "holdType"));
  fillSelect(el.grip, "All grips", distinct(ofKind, "grip"));
  fillSelect(el.board, "All hangboards", distinct(ofKind, "board"));
  el.boardRow.hidden = !distinct(ofKind, "board").length;
  const tags = [...new Set(ofKind.flatMap((s) => s.tags ?? []))].sort();
  fillSelect(el.tag, "All tags", tags);
  el.tagRow.hidden = !tags.length;
  // Routines by name, and tests by their saved name (e.g. "Max pull 20 mm L/R").
  const isRoutine = el.kind.value === "workout";
  fillSelect(el.routine, isRoutine ? "All routines" : "All tests", distinct(ofKind, "name"));
  el.routineLabel.textContent = isRoutine ? "Routine" : "Test";
  el.routineRow.hidden = distinct(ofKind, "name").length < 2;

  if (metricKind !== el.kind.value) el.metric.value = ""; // new kind: start fresh
  renderMetricPicker();
}

function renderBests(list, metric) {
  const tiles = [];
  // Metrics where neither direction is better (e.g. work time) get no best.
  const better = (a, b) => (metric.better === "lower" ? a < b : a > b);
  for (const hand of metric.better ? HAND_ORDER : []) {
    let best = null;
    for (const s of list) {
      for (const p of pointsOf(s)) {
        if (p.hand === hand && (!best || better(p.value, best.value))) best = { value: p.value, date: s.startedAt };
      }
    }
    if (!best) continue;
    const word = metric.better === "lower" ? "lowest" : "best";
    const label = `${hand === "both" ? word : `${word} ${HANDS[hand].toLowerCase()}`} · ${formatDate(best.date)}`;
    tiles.push(create("div", { className: "tile" }, [create("strong", { textContent: metric.format(best.value) }), create("span", { textContent: label })]));
  }
  tiles.push(create("div", { className: "tile" }, [create("strong", { textContent: String(list.length) }), create("span", { textContent: list.length === 1 ? "session" : "sessions" })]));
  el.bests.replaceChildren(...tiles);
}

// The unit of a metric's values ("kg", "%", "kg/s", "s"), read off its formatting;
// "" for unit-less ones (effort, reps).
function metricUnit(metric) {
  const match = metric.format(12).match(/[\d.,]\s*([^\d\s.,].*)$/);
  return match ? match[1].trim() : "";
}

function renderProgress(list, metric) {
  if (progressChart) {
    progressChart.destroy();
    progressChart = null;
  }
  el.progressTitle.textContent = `Progress: ${metric.label}`;
  el.metricInfoText.textContent = metric.info || "";
  el.metricInfo.hidden = !metric.info;
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
      padding: UNIT_PADDING,
      plugins: [unitsPlugin({ left: metricUnit(metric) })],
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
    el.list.replaceChildren(create("p", { className: "muted", textContent: "No sessions yet. Run a routine in Train or a test in Tests and save it." }));
    return;
  }
  el.list.replaceChildren(
    ...sorted.map((s) => {
      const row = create("button", { type: "button", className: "card session-row" }, [
        create("div", { className: "session-main" }, [
          create("strong", { textContent: s.type === "workout" || s.routine ? sessionTitle(s) : formatDateTime(s.startedAt) }),
          create("span", {
            className: "muted",
            textContent: [
              profileOf(s) !== profiles.activeId ? personOf(s) : null, // a friend's session
              s.type === "workout" || s.routine ? formatDateTime(s.startedAt) : null,
              ...sessionTags(s), s.stopped ? "stopped" : null, s.noForce ? "no force data" : null, ...(s.tags ?? [])]
              .filter(Boolean)
              .join(" · "),
          }),
          ...(s.note ? [create("span", { className: "note-line", textContent: `“${s.note}”` })] : []),
        ]),
        create("span", { className: "session-metric", textContent: formatPoints(s, metric) }),
      ]);
      if (selecting) {
        const on = selected.has(s.id);
        row.classList.add("selectable");
        row.classList.toggle("selected", on);
        row.setAttribute("aria-pressed", String(on));
        row.prepend(create("span", { className: "tick", textContent: on ? "✓" : "" }));
      }
      row.addEventListener("click", () => (selecting ? toggleSelected(s.id) : openDetail(s.id)));
      return row;
    }),
  );
}

// ---------------------------------------------------------------- select mode

function setSelecting(on) {
  selecting = on;
  selected.clear();
  el.select.hidden = on;
  el.csv.hidden = on;
  render();
}

function toggleSelected(id) {
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  render();
}

function renderSelectBar() {
  el.selectBar.hidden = !selecting;
  if (!selecting) return;
  // Only what the filters show can stay selected.
  for (const id of [...selected]) if (!visibleIds.includes(id)) selected.delete(id);
  const n = selected.size;
  el.selectCount.textContent = n > MAX_COMPARE ? `${n} selected (compare up to ${MAX_COMPARE})` : `${n} selected`;
  for (const b of [el.selJson, el.selCsv, el.selDelete]) b.disabled = n === 0;
  el.selCompare.disabled = n < 2 || n > MAX_COMPARE;
}

const selectedIndex = () => mySessions().filter((s) => selected.has(s.id));

// Selected sessions as a backup file (sessions only): can be restored under Settings.
async function downloadSelectedJson() {
  try {
    const full = [];
    for (const s of selectedIndex()) full.push(await sessions.get(s.id));
    const backup = buildBackup({ settings: null, calibration: null, routines: [], workouts: [], holdTypes: [], grips: [], hangboards: [], sessions: full });
    await downloadJson(`erkdek-sessions-${fileDate()}.json`, backup);
  } catch (e) {
    showError(el.error, e.message);
  }
}

// The selected sessions side by side (oldest first), on their own screen.
// entries: index entries of the sessions to compare (the selection, or people's bests).
async function openCompare(entries = selectedIndex()) {
  showError(el.error, "");
  try {
    const list = [];
    for (const s of [...entries].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) list.push(await sessions.get(s.id));
    el.main.hidden = true;
    el.compare.hidden = false;
    window.scrollTo(0, 0);
    compareChart?.destroy();
    // With friends' sessions in it, each is labelled with its person.
    const several = new Set(list.map(profileOf)).size > 1;
    compareChart = renderCompare(
      el.compareView,
      list.map((s) => ({ ...withWeight(s), person: several ? personOf(s) : "" })),
    );
  } catch (e) {
    showError(el.error, e.message);
  }
}

function closeCompare() {
  compareChart?.destroy();
  compareChart = null;
  el.compare.hidden = true;
  el.main.hidden = false;
  render(); // still in select mode, with the same sessions ticked
}

async function deleteSelected() {
  const n = selected.size;
  if (!confirm(`Delete ${n} session${n === 1 ? "" : "s"}? This cannot be undone.`)) return;
  try {
    await sessions.removeMany([...selected]);
    setSelecting(false);
    renderStorage();
  } catch (e) {
    showError(el.error, e.message);
  }
}

async function renderStorage() {
  try {
    // Only the saved sessions here; the full breakdown is under Settings → About.
    const st = await sessions.storage();
    const n = sessions.index.length;
    el.storage.textContent = `Saved routines & tests: ${formatBytes(st.sessionsBytes)} (${n} session${n === 1 ? "" : "s"})`;
  } catch {
    el.storage.textContent = "";
  }
}

function render() {
  renderMode();
  renderFilters();
  const metric = currentMetric();
  peopleChart?.destroy();
  peopleChart = null;
  if (mode === "people") {
    if (selecting) setSelecting(false);
    peopleChart = renderPeople(el.people, {
      list: filtered(everyonesSessions()),
      metric,
      unit: metricUnit(metric),
      onCompare: (best) => openCompare(best),
    });
    return;
  }
  const list = filtered();
  renderBests(list, metric);
  renderProgress(list, metric);
  visibleIds = list.map((s) => s.id);
  renderList(list, metric);
  renderSelectBar();
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
    showEditor(false);
    // Without the sensor there is no force curve to download.
    el.detailCsv.hidden = !hasCurveData(s.curve);
    el.detailRepsCsv.hidden = !s.reps?.length;
    if (detailChart) detailChart.destroy();
    detailChart = renderSession(el.detailView, withWeight(s));
    // Note and tags are saved as they change.
    el.detailNotes.replaceChildren(
      notesCard(s, async (changes) => {
        await sessions.update(s.id, changes);
        Object.assign(openSession, changes);
      }),
    );
  } catch (e) {
    el.detailView.replaceChildren();
    showError(el.detailError, e.message);
  }
}

// The edit form in place of the session view (its Save stores and reopens it).
function showEditor(on) {
  el.detailEdit.replaceChildren();
  for (const node of [el.detailView, el.detailNotes, el.edit]) node.hidden = on;
  if (!on) return;
  el.detailEdit.append(
    editCard(openSession, {
      save: async (edited) => {
        await sessions.replace(edited);
        await openDetail(edited.id);
      },
      cancel: () => showEditor(false),
    }),
  );
  window.scrollTo(0, 0);
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
    ...KIND_ORDER.map((k) => create("option", { value: k, textContent: k === "workout" ? "Routines" : KINDS[k].name })),
  );
  for (const select of [el.kind, el.hold, el.grip, el.board, el.tag, el.routine, el.metric]) select.addEventListener("change", render);
  for (const b of el.modes) {
    b.addEventListener("click", () => {
      mode = b.dataset.mode;
      render();
    });
  }
  el.people.addEventListener("change", render); // someone ticked on/off
  el.back.addEventListener("click", closeDetail);
  el.edit.addEventListener("click", () => showEditor(true));
  el.metricInfo.addEventListener("click", () => {
    el.metricInfoText.hidden = !el.metricInfoText.hidden;
    el.metricInfo.setAttribute("aria-expanded", String(!el.metricInfoText.hidden));
  });
  el.remove.addEventListener("click", deleteOpen);
  el.csv.addEventListener("click", () => downloadCsv(`erkdek-history-${fileDate()}.csv`, historyCsv(mySessions())));
  el.select.addEventListener("click", () => setSelecting(true));
  el.selectDone.addEventListener("click", () => setSelecting(false));
  el.selectAll.addEventListener("click", () => {
    for (const id of visibleIds) selected.add(id);
    render();
  });
  el.selectNone.addEventListener("click", () => {
    selected.clear();
    render();
  });
  el.selJson.addEventListener("click", downloadSelectedJson);
  el.selCompare.addEventListener("click", openCompare);
  el.compareBack.addEventListener("click", closeCompare);
  el.selCsv.addEventListener("click", () => downloadCsv(`erkdek-history-${fileDate()}.csv`, historyCsv(selectedIndex())));
  el.selDelete.addEventListener("click", deleteSelected);
  const detailName = (s) => `erkdek-${s.type}-${fileDate(new Date(s.startedAt))}-${s.id}`;
  el.detailCsv.addEventListener("click", () => {
    if (openSession?.curve) downloadCsv(`${detailName(openSession)}.csv`, storedCurveCsv(openSession.curve));
  });
  el.detailRepsCsv.addEventListener("click", () => {
    if (openSession) downloadCsv(`${detailName(openSession)}-reps.csv`, repsCsv(openSession));
  });
  el.detailJson.addEventListener("click", () => {
    if (openSession) downloadJson(`${detailName(openSession)}.json`, openSession);
  });

  sessions.addEventListener("change", () => {
    if (!isVisible()) return;
    if (el.detail.hidden && el.compare.hidden) render();
    renderStorage();
  });
  sessions.load().catch((e) => showError(el.error, e.message));
  // The bodyweight log changes the % BW values.
  settings.onChange(async () => {
    await loadProfileSettings(); // the others' bodyweight logs too
    if (isVisible() && el.detail.hidden && el.compare.hidden) render();
  });
  new ResizeObserver(() => {
    if (progressChart) progressChart.setSize({ width: el.chart.clientWidth, height: el.chart.clientHeight });
  }).observe(el.chart);
}

// Called when the History tab becomes visible: back to the overview, freshly rendered.
export async function showHistory() {
  await loadProfileSettings();
  if (!el.detail.hidden) closeDetail();
  else if (!el.compare.hidden) closeCompare();
  else render();
  renderStorage();
}
