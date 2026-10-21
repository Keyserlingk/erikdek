// Rolling force chart on top of uPlot (loaded globally from vendor/uPlot.iife.min.js).

import { TARGET_TOLERANCE } from "./workout.js";

const MAX_WINDOW_S = 60;
const MAX_POINTS = MAX_WINDOW_S * 80 * 1.2;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// A y axis' unit, written vertically along the axis (uPlot rotates y-axis labels).
export function axisLabel(text) {
  return { label: text, labelSize: 16, labelGap: 0, labelFont: "12px system-ui, sans-serif" };
}

// Rolling force chart: kg on the left; on the right % of bodyweight when one is set
// (its own scale, so the ticks are round percentages), else kg again.
export class LiveChart {
  constructor(container) {
    this.container = container;
    this.windowS = 30;
    this.peakKg = 0;
    this.targetKg = null; // drawn as a line with a ±TARGET_TOLERANCE band
    this.bodyweightKg = 0; // > 0: right axis in % of bodyweight
    this.x = [];
    this.y = [];
    this.dirty = false;
    this.plot = null;

    new ResizeObserver(() => this._resize()).observe(container);
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

  setTarget(kg) {
    this.targetKg = kg;
    this.dirty = true;
  }

  // Call once per animation frame.
  render() {
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
      { scale: "kg", stroke: text, grid: { stroke: grid, width: 1 }, ticks: { show: false }, size: 34, ...axisLabel("kg") },
      this.bodyweightKg
        ? {
            scale: "pct",
            side: 1,
            stroke: text,
            grid: { show: false },
            ticks: { show: false },
            size: 38,
            values: (u, vals) => vals.map((v) => `${Math.round(v)}`),
            ...axisLabel("% BW"),
          }
        : { scale: "kg", side: 1, stroke: text, grid: { show: false }, ticks: { show: false }, size: 34, ...axisLabel("kg") },
    ];

    this.plot = new uPlot(
      {
        width: this.container.clientWidth,
        height: this.container.clientHeight,
        legend: { show: false },
        cursor: { show: false },
        scales: { x: { time: false }, kg: { auto: false }, pct: { auto: false } },
        axes,
        series: [{}, { scale: "kg", stroke: line, width: 2, points: { show: false } }],
        hooks: {
          drawClear: [(u) => this._drawTarget(u, band, cssVar("--ok"))],
          draw: [(u) => this._drawPeak(u, peak)],
        },
      },
      [[], []],
      this.container,
    );
    this.dirty = true;
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
