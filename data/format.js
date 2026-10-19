export function formatKg(kg, digits = 1) {
  const s = kg.toFixed(digits);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
}

export function formatBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;
}

// Stopwatch: 7.4 -> "0:07", 83 -> "1:23"
export function formatClock(totalS) {
  const s = Math.floor(totalS);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// 45 -> "45 s", 180 -> "3 min", 1337 -> "22 min 17 s"
export function formatDuration(totalS) {
  const s = Math.round(totalS);
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${min} min ${rest} s` : `${min} min`;
}

// Rolling window of recent samples, used for stability checks.
export class SampleWindow {
  constructor(size) {
    this.size = size;
    this.values = [];
  }

  push(values) {
    this.values.push(...values);
    if (this.values.length > this.size) this.values.splice(0, this.values.length - this.size);
  }

  clear() {
    this.values = [];
  }

  get full() {
    return this.values.length >= this.size;
  }

  mean() {
    return this.values.reduce((a, b) => a + b, 0) / (this.values.length || 1);
  }

  stdDev() {
    const m = this.mean();
    const v = this.values.reduce((a, b) => a + (b - m) ** 2, 0) / (this.values.length || 1);
    return Math.sqrt(v);
  }
}
