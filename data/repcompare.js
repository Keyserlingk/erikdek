// Compares a session's reps (History and the summary after a run): every rep's force
// curve on one chart, lined up at the moment its force starts. Coloured by rep, one hue
// from light (first) to dark (last) so fatigue shows as a trend, or by hand (left vs
// right) with each hand's average drawn bold. Tapping rep chips picks reps: then only
// the picked ones are drawn, with their numbers listed.

import { alignRepCurves, meanCurve } from "./analysis.js";
import { formatDuration, formatKg } from "./format.js";
import { HANDS } from "./tests.js";

const HAND_REP_ALPHA = 0.35; // single reps under the hand averages

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgba = (hex, a) => `rgba(${hexToRgb(hex).join(", ")}, ${a})`;

// Colour i of n on the ramp between two hex colours.
function rampColor(from, to, i, n) {
  const t = n > 1 ? i / (n - 1) : 1;
  const [a, b] = [hexToRgb(from), hexToRgb(to)];
  return `#${a.map((v, k) => Math.round(v + (b[k] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

function repLabel(s, r) {
  const sets = new Set(s.reps.map((x) => x.set)).size;
  const hand = r.hand === "left" ? " L" : r.hand === "right" ? " R" : "";
  return (sets > 1 || s.reps.some((x) => x.rep > 1) ? `${r.set}.${r.rep}` : `${r.set}`) + hand;
}

function repDetail(s, r) {
  const parts = [`Rep ${repLabel(s, r)}`];
  if (r.hand && r.hand !== "both") parts.push(HANDS[r.hand]);
  if (typeof r.peakKg === "number") parts.push(`peak ${formatKg(r.peakKg)} kg`);
  if (typeof r.meanKg === "number") parts.push(`avg ${formatKg(r.meanKg)} kg`);
  if (typeof r.holdPct === "number") parts.push(`hold ${Math.round(r.holdPct)} %`);
  return parts.join(" · ");
}

// Returns the card, or null when the session has no rep curves (or just one rep).
export function repCompareCard(s) {
  const curves = s.repCurves;
  if (!curves || curves.reps.length < 2 || curves.reps.length !== s.reps.length) return null;
  const { x, ys } = alignRepCurves(curves.reps, curves.hz);
  const hands = new Set(s.reps.map((r) => r.hand));
  const bothHands = hands.has("left") && hands.has("right");

  const state = { mode: "rep", picked: new Set(), plot: null }; // picked: rep indexes
  const chartBox = el("div", { className: "session-chart" });
  const chips = el("div", { className: "rep-chips" });
  const detail = el("div", { className: "muted rep-detail" });
  const clear = el("button", { type: "button", className: "pill-button", textContent: "Show all reps", hidden: true });
  clear.addEventListener("click", () => {
    state.picked.clear();
    draw();
  });
  const intro = el("p", { className: "muted" });
  const legend = el("div", { className: "rep-legend" });
  const modes = el("div", { className: "segmented", role: "group" });
  modes.setAttribute("aria-label", "Colour the reps");

  const colors = () => {
    if (state.mode === "hand") {
      return s.reps.map((r) => cssVar(r.hand === "right" ? "--series-right" : r.hand === "left" ? "--series-left" : "--accent"));
    }
    return s.reps.map((_, i) => rampColor(cssVar("--rep-first"), cssVar("--rep-last"), i, s.reps.length));
  };

  function draw() {
    state.plot?.destroy();
    const repColors = colors();
    const picking = state.picked.size > 0;
    const data = [x, ...ys];
    const series = [{}];
    // With reps picked only those are drawn (bold); otherwise all of them.
    ys.forEach((_, i) => {
      const picked = state.picked.has(i);
      const alpha = state.mode === "hand" && !picking ? HAND_REP_ALPHA : 1;
      series.push({
        stroke: rgba(repColors[i], alpha),
        width: picked ? 2.5 : 1.5,
        show: !picking || picked,
        points: { show: false },
        spanGaps: false,
      });
    });
    if (state.mode === "hand" && !picking) {
      for (const hand of ["left", "right"]) {
        data.push(meanCurve(ys.filter((_, i) => s.reps[i].hand === hand)));
        series.push({ stroke: cssVar(hand === "left" ? "--series-left" : "--series-right"), width: 3, points: { show: false } });
      }
    }
    const axis = { stroke: cssVar("--muted"), grid: { stroke: cssVar("--border"), width: 1 }, ticks: { show: false } };
    state.plot = new uPlot(
      {
        width: chartBox.clientWidth || 340,
        height: 200,
        legend: { show: false },
        cursor: { show: false },
        scales: { x: { time: false } },
        axes: [
          { ...axis, size: 28, values: (u, vals) => vals.map((v) => (v < 0 ? "" : formatDuration(v))) },
          { ...axis, size: 40 },
        ],
        series,
      },
      data,
      chartBox,
    );
    for (const [i, chip] of [...chips.children].entries()) {
      chip.querySelector(".swatch").style.background = repColors[i];
      chip.classList.toggle("active", state.picked.has(i));
      chip.setAttribute("aria-pressed", String(state.picked.has(i)));
    }
    detail.replaceChildren(
      ...(picking
        ? [...state.picked].sort((a, b) => a - b).map((i) => el("div", { textContent: repDetail(s, s.reps[i]) }))
        : [el("div", { textContent: "Tap reps to show only those and compare their numbers." })]),
    );
    clear.hidden = !picking;
    legend.hidden = state.mode !== "hand" || picking;
    intro.textContent =
      state.mode === "hand"
        ? "Each rep's force, lined up where the pull starts. Bold: each hand's average."
        : "Each rep's force, lined up where the pull starts. First rep light, last rep dark.";
    for (const b of modes.children) b.classList.toggle("active", b.dataset.mode === state.mode);
  }

  chips.replaceChildren(
    ...s.reps.map((r, i) => {
      const b = el("button", { type: "button", className: "rep-chip" }, [el("span", { className: "swatch" }), repLabel(s, r)]);
      b.addEventListener("click", () => {
        if (state.picked.has(i)) state.picked.delete(i); // tap again to take it out
        else state.picked.add(i);
        draw();
      });
      return b;
    }),
  );
  if (bothHands) {
    for (const [mode, text] of [["rep", "By rep"], ["hand", "Left vs right"]]) {
      const b = el("button", { type: "button", textContent: text });
      b.dataset.mode = mode;
      b.addEventListener("click", () => {
        state.mode = mode;
        draw();
      });
      modes.append(b);
    }
    const key = (hand) => el("span", { className: "rep-key" }, [el("span", { className: `swatch ${hand}` }), `${HANDS[hand]} (average)`]);
    legend.append(key("left"), key("right"));
  }

  const card = el("div", { className: "card rep-compare" }, [
    el("div", { className: "rep-compare-head" }, [el("h2", { textContent: "Reps compared" }), ...(bothHands ? [modes] : [])]),
    intro,
    chartBox,
    legend,
    chips,
    detail,
    clear,
  ]);
  // Drawn once the card is in the page (the chart needs its width).
  card.drawChart = draw;
  card.destroyChart = () => state.plot?.destroy();
  return card;
}
