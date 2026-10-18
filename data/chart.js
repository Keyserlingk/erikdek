// Rolling force chart on top of uPlot (loaded globally from vendor/uPlot.iife.min.js).

const MAX_WINDOW_S = 60;
const MAX_POINTS = MAX_WINDOW_S * 80 * 1.2;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export class LiveChart {
  constructor(container) {
    this.container = container;
    this.windowS = 30;
    this.bodyweightKg = 0;
    this.peakKg = 0;
    this.target = null; // { min, max } band in kg
    this.x = [];
    this.y = [];
    this.dirty = false;
    this.plot = null;

    new ResizeObserver(() => this._resize()).observe(container);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this._build());
    this._build();
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

  setTarget(band) {
    this.target = band;
    this.dirty = true;
  }

  setBodyweight(kg) {
    if (kg !== this.bodyweightKg) {
      this.bodyweightKg = kg;
      this._build();
    }
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
      let max = Math.max(this.peakKg, this.target ? this.target.max : 0); // keep lines in view
      for (let j = i; j < this.y.length; j++) {
        if (this.y[j] > max) max = this.y[j];
        if (this.y[j] < min) min = this.y[j];
      }
      this.plot.setScale("kg", { min, max: Math.max(10, max * 1.15) });
    });
  }

  _build() {
    if (this.plot) this.plot.destroy();
    const text = cssVar("--muted");
    const grid = cssVar("--border");
    const line = cssVar("--accent");
    const peak = cssVar("--warn");
    const band = cssVar("--band");
    const bw = this.bodyweightKg;

    const axes = [
      {
        stroke: text,
        grid: { stroke: grid, width: 1 },
        ticks: { show: false },
        size: 28,
        values: (u, vals) => {
          const end = u.scales.x.max;
          return vals.map((v) => `${Math.round(v - end)}s`);
        },
      },
      { scale: "kg", stroke: text, grid: { stroke: grid, width: 1 }, ticks: { show: false }, size: 40 },
    ];
    if (bw > 0) {
      axes.push({
        scale: "kg",
        side: 1,
        stroke: text,
        grid: { show: false },
        ticks: { show: false },
        size: 44,
        values: (u, vals) => vals.map((v) => `${Math.round((v / bw) * 100)}%`),
      });
    }

    this.plot = new uPlot(
      {
        width: this.container.clientWidth,
        height: this.container.clientHeight,
        legend: { show: false },
        cursor: { show: false },
        scales: { x: { time: false }, kg: { auto: false } },
        axes,
        series: [{}, { scale: "kg", stroke: line, width: 2, points: { show: false } }],
        hooks: {
          drawClear: [(u) => this._drawTarget(u, band)],
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

  _drawTarget(u, color) {
    if (!this.target) return;
    const top = u.valToPos(this.target.max, "kg", true);
    const bottom = u.valToPos(this.target.min, "kg", true);
    const { ctx } = u;
    const { left, width } = u.bbox;
    ctx.save();
    ctx.fillStyle = color;
    ctx.fillRect(left, top, width, bottom - top);
    ctx.restore();
  }

  _resize() {
    if (this.plot) this.plot.setSize({ width: this.container.clientWidth, height: this.container.clientHeight });
  }
}
