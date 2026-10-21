// Rolling force chart on top of uPlot (loaded globally from vendor/uPlot.iife.min.js).

import { TARGET_TOLERANCE } from "./workout.js";

const MAX_WINDOW_S = 60;
const MAX_POINTS = MAX_WINDOW_S * 80 * 1.2;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// The y axes' units, written above the axes (no width taken from the plot): add the
// returned plugin to a chart's options together with UNIT_PADDING.
export const UNIT_PADDING = [20, null, null, null]; // room above the plot for the units
export function unitsPlugin({ left = "", right = "" }) {
  return {
    hooks: {
      draw: [
        (u) => {
          const { ctx } = u;
          const { left: x0, top, width } = u.bbox;
          const px = devicePixelRatio;
          ctx.save();
          ctx.font = `${12 * px}px system-ui, sans-serif`;
          ctx.fillStyle = cssVar("--muted");
          ctx.textBaseline = "bottom";
          if (left) {
            ctx.textAlign = "right";
            ctx.fillText(left, x0 - 4 * px, top - 6 * px);
          }
          if (right) {
            ctx.textAlign = "left";
            ctx.fillText(right, x0 + width + 4 * px, top - 6 * px);
          }
          ctx.restore();
        },
      ],
    },
  };
}

// The big number is low-pass filtered (exponential moving average) so it reads calmly;
// the graph and all results use the raw samples.
const NUMBER_SMOOTHING_S = 0.25;

// Next smoothed value after one sample (dtS: time per sample); null starts it.
export function smoothKg(prev, kg, dtS) {
  if (prev === null) return kg;
  return prev + (1 - Math.exp(-dtS / NUMBER_SMOOTHING_S)) * (kg - prev);
}

// Status colours of the big number (see workout.js targetStatus).
const STATUS_COLOR = { on: "--ok", below: "--warn", above: "--accent" };

// Rolling force chart: on the left % of bodyweight when one is set (its own scale, so
// the ticks are round percentages), else kg; kg on the right. The current force is
// drawn large in the plot (setOverlay): in front of the grid but behind the curve, or
// in front of everything (Settings → Display, body[data-number-layer]); its strength
// is --chart-number-opacity.
export class LiveChart {
  constructor(container) {
    this.container = container;
    this.windowS = 30;
    this.peakKg = 0;
    this.targetKg = null; // drawn as a line with a ±TARGET_TOLERANCE band
    this.bodyweightKg = 0; // > 0: left axis in % of bodyweight
    this.overlay = { text: "", sub: "", status: "", pulse: false };
    this.x = [];
    this.y = [];
    this.dirty = false;
    this.plot = null;

    new ResizeObserver(() => this._resize()).observe(container);
    // Display settings changed (layer, strength): redraw the number.
    window.addEventListener("erkdek:display", () => {
      this.dirty = true;
      // Only a chart that has drawn (its scales are set); the others draw it new anyway.
      if (this.plot && this.plot.scales.kg.min !== null && this.plot.scales.kg.min !== undefined) this.plot.redraw(false);
    });
    window.addEventListener("erkdek:theme", () => this._build()); // see display.js
    this._build();
  }

  // Calls handler(kg) with the force at the tapped height inside the plot area.
  onTap(handler) {
    this.container.addEventListener("click", (ev) => {
      if (!this.plot) return;
      const rect = this.plot.over.getBoundingClientRect();
      if (ev.clientX < rect.left || ev.clientX > rect.right || ev.clientY < rect.top || ev.clientY > rect.bottom) return;
      handler(this.plot.posToVal(ev.clientY - rect.top, "kg"));
    });
  }

  // ts/te: device millis() of the first and last sample in kg[].
  push(ts, te, kg) {
    const last = this.x.length ? this.x[this.x.length - 1] : -Infinity;
    if (ts / 1000 < last - 1) this.clear(); // device restarted
    const step = kg.length > 1 ? (te - ts) / (kg.length - 1) : 0;
    for (let i = 0; i < kg.length; i++) {
      this.x.push((ts + i * step) / 1000);
      this.y.push(kg[i]);
    }
    if (this.x.length > MAX_POINTS) {
      const drop = this.x.length - MAX_WINDOW_S * 80;
      this.x.splice(0, drop);
      this.y.splice(0, drop);
    }
    this.dirty = true;
  }

  clear() {
    this.x = [];
    this.y = [];
    this.dirty = true;
  }

  setWindow(seconds) {
    this.windowS = seconds;
    this.dirty = true;
  }

  setPeak(kg) {
    if (kg !== this.peakKg) {
      this.peakKg = kg;
      this.dirty = true;
    }
  }

  setBodyweight(kg) {
    const bw = kg > 0 ? kg : 0;
    if (bw === this.bodyweightKg) return;
    this.bodyweightKg = bw;
    this._build(); // the right axis changes
  }

  // The big number in the plot: text, a smaller line under it, the target status
  // ("on"/"below"/"above" colours it) and pulse (the last seconds of a hang).
  setOverlay({ text = "", sub = "", status = "", pulse = false }) {
    const o = this.overlay;
    if (o.text === text && o.sub === sub && o.status === status && o.pulse === pulse) return;
    this.overlay = { text, sub, status, pulse };
    this.dirty = true;
  }

  setTarget(kg) {
    this.targetKg = kg;
    this.dirty = true;
  }

  // Call once per animation frame.
  render() {
    if (this.overlay.pulse) this.dirty = true; // animates
    if (!this.dirty || !this.plot) return;
    this.dirty = false;
    const end = this.x.length ? this.x[this.x.length - 1] : 0;
    const start = end - this.windowS;
    let i = 0;
    while (i < this.x.length && this.x[i] < start) i++;
    this.plot.batch(() => {
      this.plot.setData([this.x.slice(i), this.y.slice(i)], false);
      this.plot.setScale("x", { min: start, max: end });
      let min = 0;
      // keep the peak and target lines in view
      let max = Math.max(this.peakKg, this.targetKg !== null ? this.targetKg * (1 + TARGET_TOLERANCE) : 0);
      for (let j = i; j < this.y.length; j++) {
        if (this.y[j] > max) max = this.y[j];
        if (this.y[j] < min) min = this.y[j];
      }
      const top = Math.max(10, max * 1.15);
      this.plot.setScale("kg", { min, max: top });
      if (this.bodyweightKg) this.plot.setScale("pct", { min: (min / this.bodyweightKg) * 100, max: (top / this.bodyweightKg) * 100 });
    });
  }

  _build() {
    if (this.plot) this.plot.destroy();
    const text = cssVar("--muted");
    const grid = cssVar("--border");
    const line = cssVar("--accent");
    const peak = cssVar("--warn");
    const band = cssVar("--band");

    const axes = [
      {
        stroke: text,
        grid: { stroke: grid, width: 1 },
        ticks: { show: false },
        size: 28,
        // Ticks at fixed offsets from "now", so labels and grid stay put while the data scrolls.
        splits: (u) => {
          const end = u.scales.x.max;
          const step = this.windowS <= 10 ? 2 : this.windowS <= 30 ? 5 : 10;
          const splits = [];
          for (let off = this.windowS; off >= 0; off -= step) splits.push(end - off);
          return splits;
        },
        values: (u, vals) => {
          const end = u.scales.x.max;
          return vals.map((v) => `${Math.round(v - end)}s`);
        },
      },
      // The kg axis draws the horizontal grid lines; the % BW axis only labels them.
      this.bodyweightKg
        ? {
            scale: "pct",
            stroke: text,
            grid: { show: false },
            ticks: { show: false },
            size: 40,
            values: (u, vals) => vals.map((v) => `${Math.round(v)}`),
          }
        : { scale: "kg", stroke: text, grid: { show: false }, ticks: { show: false }, size: 40 },
      { scale: "kg", side: 1, stroke: text, grid: { stroke: grid, width: 1 }, ticks: { show: false }, size: 40 },
    ];

    this.plot = new uPlot(
      {
        width: this.container.clientWidth,
        height: this.container.clientHeight,
        legend: { show: false },
        cursor: { show: false },
        padding: UNIT_PADDING,
        plugins: [unitsPlugin({ left: this.bodyweightKg ? "% BW" : "kg", right: "kg" })],
        scales: { x: { time: false }, kg: { auto: false }, pct: { auto: false } },
        axes,
        series: [{}, { scale: "kg", stroke: line, width: 2, points: { show: false } }],
        hooks: {
          drawClear: [(u) => this._drawTarget(u, band, cssVar("--ok"))],
          // After the grid, before the curve: the number behind the curve.
          drawAxes: [(u) => document.body.dataset.numberLayer !== "front" && this._drawNumber(u)],
          draw: [(u) => this._drawPeak(u, peak), (u) => document.body.dataset.numberLayer === "front" && this._drawNumber(u)],
        },
      },
      [[], []],
      this.container,
    );
    this.dirty = true;
  }

  _drawNumber(u) {
    const { text, sub, status, pulse } = this.overlay;
    if (!text) return;
    const { ctx } = u;
    const { left, top, width, height } = u.bbox;
    const px = devicePixelRatio;
    const base = Number(getComputedStyle(document.documentElement).getPropertyValue("--chart-number-opacity")) || 0.16;
    // Pulse: once a second, a bit larger and stronger.
    const beat = pulse ? (1 - Math.cos((2 * Math.PI * performance.now()) / 1000)) / 2 : 0;
    let size = Math.min(180, Math.max(88, innerWidth * 0.3)) * px * (1 + 0.08 * beat);
    ctx.save();
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    const fit = (width * 0.92) / ctx.measureText(text).width;
    if (fit < 1) {
      size *= fit;
      ctx.font = `700 ${size}px system-ui, sans-serif`;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = cssVar(STATUS_COLOR[status] ?? "--text");
    ctx.globalAlpha = Math.min(1, base * (status ? 1.8 : 1) * (1 + 2 * beat));
    const x = left + width / 2;
    const y = top + height / 2 - (sub ? 10 * px : 0);
    ctx.fillText(text, x, y);
    if (sub) {
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = cssVar("--muted");
      ctx.font = `${16 * px}px system-ui, sans-serif`;
      ctx.fillText(sub, x, y + size * 0.42 + 12 * px, width * 0.95);
    }
    ctx.restore();
  }

  _drawPeak(u, color) {
    if (!(this.peakKg > 0)) return;
    const y = Math.round(u.valToPos(this.peakKg, "kg", true));
    const { ctx } = u;
    const { left, width } = u.bbox;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = devicePixelRatio;
    ctx.setLineDash([6 * devicePixelRatio, 4 * devicePixelRatio]);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + width, y);
    ctx.stroke();
    ctx.restore();
  }

  _drawTarget(u, bandColor, lineColor) {
    if (this.targetKg === null) return;
    const top = u.valToPos(this.targetKg * (1 + TARGET_TOLERANCE), "kg", true);
    const bottom = u.valToPos(this.targetKg * (1 - TARGET_TOLERANCE), "kg", true);
    const y = Math.round(u.valToPos(this.targetKg, "kg", true));
    const { ctx } = u;
    const { left, width } = u.bbox;
    ctx.save();
    ctx.fillStyle = bandColor;
    ctx.fillRect(left, top, width, bottom - top);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = devicePixelRatio;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + width, y);
    ctx.stroke();
    ctx.restore();
  }

  _resize() {
    if (this.plot) this.plot.setSize({ width: this.container.clientWidth, height: this.container.clientHeight });
  }
}
