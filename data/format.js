export function formatKg(kg, digits = 1) {
  const s = kg.toFixed(digits);
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s;
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
