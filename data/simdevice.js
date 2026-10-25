// Simulated sensor for development without hardware. Behaves like the firmware: raw
// HX711 counts with noise and drift, auto-tare on start, calibration with a known
// weight, 80 Hz samples sent in batches, status once a second and tare/calibration
// events. The simulated cell is ~12 % off the default factor, so calibrating matters.
//
// SimSensor is the pure core (stepped per sample, testable under node --test);
// SimulatedTransport runs it on a timer and speaks the transport interface
// ("state"/"message" events, connect(), send()).

import { PROTOCOL_VERSION } from "./bleprotocol.js";

export const SAMPLE_RATE_HZ = 80;
const PUSH_INTERVAL_MS = 50;
const STATUS_INTERVAL_MS = 1000;
const TARE_SAMPLES = 40; // 0.5 s, same as firmware
const CALIBRATION_SAMPLES = 80; // 1 s, same as firmware
const MIN_CALIBRATION_COUNTS = 5000;
export const DEFAULT_COUNTS_PER_KG = 14300;
const TRUE_COUNTS_PER_KG = 16000;
const RAW_ZERO = 52000; // raw reading with no load
const NOISE_COUNTS = 900; // ~0.06 kg
const CALIBRATION_KEY = "erkdek.simCalibration";
// Simulated battery, so the app's battery display can be tried (the real sensor has
// no battery reading yet): starts full and drains slowly.
const BATTERY_FULL_V = 4.15;
const BATTERY_DRAIN_V_PER_H = 0.1;
// A calibration is refused when its readings spread more than this (firmware: calibration.h).
const MOVING_RMS_KG = 0.15;
const MOVING_RMS_SHARE = 0.005;

// kg -> whole grams as sent by the sensor (null = not measured).
const grams = (kg) => (Number.isFinite(kg) ? Math.round(kg * 1000) / 1000 : null);

// Normal distribution from a uniform random source (Box–Muller).
function gauss(random, sd) {
  const u = 1 - random();
  const v = random();
  return sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

class Averager {
  constructor() {
    this.reset(0);
  }

  reset(target) {
    this.target = target;
    this.values = [];
  }

  // True when this sample completes the average.
  add(raw) {
    if (this.values.length >= this.target) return false;
    this.values.push(raw);
    return this.values.length === this.target;
  }

  average() {
    return Math.trunc(this.values.reduce((a, b) => a + b, 0) / this.values.length);
  }

  // { rms, pp }: spread of the readings in counts.
  spread() {
    const n = this.values.length;
    const mean = this.values.reduce((a, b) => a + b, 0) / n;
    const rms = Math.sqrt(this.values.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
    return { rms, pp: Math.max(...this.values) - Math.min(...this.values) };
  }

  // { rmsKg, ppKg }: the spread converted with countsPerKg.
  noise(countsPerKg) {
    const { rms, pp } = this.spread();
    const cpk = Math.abs(countsPerKg);
    return { rmsKg: rms / cpk, ppKg: pp / cpk };
  }
}

// Scenarios: what is hanging on the simulated cell.
//   workout  random hangs and pulls (rest, ramp, hold with tremor and fatigue, release)
//   idle     nothing
//   weight   a known weight, swinging a bit after it is hung
//   pull     a climber pulling: quick ramp up, slight fatigue and tremor
export class SimSensor {
  constructor({ random = Math.random, calibration = null } = {}) {
    this.random = random;
    this.t = 0; // seconds since start
    this.drift = 0;
    this.offset = 0;
    this.countsPerKg = calibration?.countsPerKg ?? DEFAULT_COUNTS_PER_KG;
    this.calibrated = calibration?.calibrated ?? false;
    this.tared = false;
    this.tareNoise = null; // { rms, pp } of the last tare in counts
    this.calKg = 0;
    this.tareAvg = new Averager();
    this.calAvg = new Averager();
    this.scenario = "workout";
    this.weightKg = 20;
    this.scenarioStart = 0;
    this.nextPhase(0);
    this.tareAvg.reset(TARE_SAMPLES); // auto-tare on start, like the firmware
  }

  nextPhase(start) {
    const r = this.random;
    this.phase = { start, restS: 3 + 3 * r(), holdS: 4 + 4 * r(), targetKg: 15 + 25 * r(), spike: r() < 0.25 };
  }

  setScenario(scenario, kg) {
    this.scenario = scenario;
    if (typeof kg === "number") this.weightKg = kg;
    this.scenarioStart = this.t;
    this.nextPhase(this.t);
  }

  workoutForce(t) {
    const p = this.phase;
    let dt = t - p.start;
    if (dt < p.restS) return 0;
    dt -= p.restS;
    const ramp = p.spike ? 0.12 : 0.35;
    if (dt < ramp) return p.targetKg * (p.spike ? 1.4 : 1) * (dt / ramp);
    dt -= ramp;
    if (dt < p.holdS) {
      const fatigue = 1 - (0.08 * dt) / p.holdS;
      const tremor = 0.6 * Math.sin(2 * Math.PI * 7 * t) + 0.4 * Math.sin(2 * Math.PI * 1.3 * t);
      const overshoot = p.spike ? 0.4 * p.targetKg * Math.exp(-dt * 8) : 0;
      return p.targetKg * fatigue + tremor + overshoot;
    }
    dt -= p.holdS;
    if (dt < 0.2) return p.targetKg * (1 - dt / 0.2);
    this.nextPhase(t);
    return 0;
  }

  force(t) {
    const dt = t - this.scenarioStart;
    switch (this.scenario) {
      case "idle":
        return 0;
      case "pull": {
        const ramp = Math.min(1, dt / 0.25);
        return this.weightKg * ramp * (1 - 0.01 * dt) + 0.3 * Math.sin(2 * Math.PI * 6 * t) * ramp;
      }
      case "weight":
        return this.weightKg + 0.25 * this.weightKg * Math.exp(-dt * 1.5) * Math.sin(2 * Math.PI * 1.8 * dt);
      default:
        return this.workoutForce(t);
    }
  }

  // One sample: returns { kg, events } where events are messages like {t:"tared"}.
  step() {
    this.t += 1 / SAMPLE_RATE_HZ;
    this.drift += gauss(this.random, 8);
    const raw = Math.trunc(RAW_ZERO + this.drift + this.force(this.t) * TRUE_COUNTS_PER_KG + gauss(this.random, NOISE_COUNTS));
    const events = [];
    if (this.tareAvg.add(raw)) {
      this.offset = this.tareAvg.average();
      this.tareNoise = this.tareAvg.spread(); // counts; converted with the current factor
      this.tared = true;
      events.push({ t: "tared" });
    }
    if (this.calAvg.add(raw)) events.push(this.finishCalibration());
    return { kg: Math.round(((raw - this.offset) / this.countsPerKg) * 1000) / 1000, events };
  }

  finishCalibration() {
    const delta = this.calAvg.average() - this.offset;
    const ok = this.calKg > 0 && Math.abs(delta) >= MIN_CALIBRATION_COUNTS;
    const noiseKg = grams(this.calAvg.noise(ok ? delta / this.calKg : this.countsPerKg).rmsKg);
    if (!(this.calKg > 0)) return { t: "calError", reason: "badWeight", noiseKg };
    if (!ok) return { t: "calError", reason: "tooSmall", noiseKg };
    if (noiseKg > Math.max(MOVING_RMS_KG, this.calKg * MOVING_RMS_SHARE)) return { t: "calError", reason: "moving", noiseKg };
    this.countsPerKg = delta / this.calKg;
    this.calibrated = true;
    return this.calibratedEvent(noiseKg);
  }

  calibratedEvent(noiseKg = null) {
    return { t: "calibrated", calibrated: this.calibrated, cpk: this.countsPerKg, noiseKg };
  }

  // Commands from the app; returns events to send right away.
  handle(msg) {
    switch (msg.cmd) {
      case "tare":
        this.tareAvg.reset(TARE_SAMPLES);
        return [];
      case "calibrate":
        this.calKg = Number(msg.kg) || 0;
        this.calAvg.reset(CALIBRATION_SAMPLES);
        return [];
      case "calReset":
        this.countsPerKg = DEFAULT_COUNTS_PER_KG;
        this.calibrated = false;
        return [this.calibratedEvent()];
      case "setCalibration":
        if (!Number.isFinite(msg.cpk) || Math.abs(msg.cpk) < 100) return [];
        this.countsPerKg = msg.cpk;
        this.calibrated = true;
        return [this.calibratedEvent()];
      case "mock": // simulator only: switch what is hanging on the cell
        this.setScenario(msg.scenario || "workout", msg.kg);
        return [];
      default:
        return [];
    }
  }
}

export class SimulatedTransport extends EventTarget {
  constructor() {
    super();
    this.state = "closed";
    this.sensor = null;
    this.timers = [];
  }

  connect() {
    this.setState("connecting");
    // A short delay, like finding and connecting to a real sensor.
    setTimeout(() => this.start(), 300);
  }

  start() {
    this.sensor = new SimSensor({ calibration: loadCalibration() });
    this.startedAt = performance.now();
    this.produced = 0;
    this.setState("open");
    this.emit(this.status());
    this.timers = [
      setInterval(() => this.produce(), PUSH_INTERVAL_MS),
      setInterval(() => this.emit(this.status()), STATUS_INTERVAL_MS),
    ];
  }

  // Generates the samples due since the last call, so the rate stays 80 Hz even when
  // timers are late (background tabs).
  produce() {
    const now = performance.now();
    const due = Math.floor(((now - this.startedAt) / 1000) * SAMPLE_RATE_HZ) - this.produced;
    if (due <= 0) return;
    const kg = [];
    for (let i = 0; i < due; i++) {
      const sample = this.sensor.step();
      kg.push(sample.kg);
      for (const ev of sample.events) this.emitEvent(ev);
    }
    const first = this.produced;
    this.produced += due;
    const ms = (n) => Math.round((n * 1000) / SAMPLE_RATE_HZ);
    this.emit({ t: "samples", ts: ms(first), te: ms(this.produced - 1), kg });
  }

  status() {
    const s = this.sensor;
    return {
      t: "status",
      rate: SAMPLE_RATE_HZ,
      tared: s.tared,
      calibrated: s.calibrated,
      tareNoiseKg: grams(s.tareNoise?.rms / Math.abs(s.countsPerKg)),
      tareNoisePpKg: grams(s.tareNoise?.pp / Math.abs(s.countsPerKg)),
      batteryV: Math.round((BATTERY_FULL_V - (BATTERY_DRAIN_V_PER_H * s.t) / 3600) * 1000) / 1000,
      cpk: s.countsPerKg,
      uptime: Math.round(s.t * 1000),
      mock: true,
      protocol: PROTOCOL_VERSION,
      adc: "hx711", // like the HX711 board: rate set in hardware, setRate ignored
      adcRate: 0,
      fw: "simulated",
      scenario: s.scenario,
    };
  }

  // Pretends to update the firmware (for trying Settings → Sensor without hardware):
  // progress over 2 s, then a restart (the connection drops and comes back).
  async updateFirmware(image, { onProgress = () => {}, signal = null } = {}) {
    if (this.state !== "open") throw new Error("The sensor isn't connected.");
    for (let i = 1; i <= 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (signal?.aborted) throw new Error("Update cancelled. The sensor keeps its current firmware.");
      onProgress(i / 20);
    }
    for (const timer of this.timers) clearInterval(timer);
    this.setState("closed");
    setTimeout(() => this.connect(), 1000);
  }

  send(obj) {
    if (this.state !== "open") return false;
    for (const ev of this.sensor.handle(obj)) this.emitEvent(ev);
    if (obj.cmd === "mock") this.emit(this.status());
    return true;
  }

  // Calibration changes are kept per browser, like the sensor's own storage.
  emitEvent(ev) {
    if (ev.t === "calibrated") saveCalibration({ countsPerKg: ev.cpk, calibrated: ev.calibrated });
    this.emit(ev);
    if (ev.t === "tared") this.emit(this.status()); // like the firmware: new tare noise
  }

  emit(msg) {
    this.dispatchEvent(new CustomEvent("message", { detail: msg }));
  }

  setState(state) {
    this.state = state;
    this.dispatchEvent(new CustomEvent("state", { detail: state }));
  }
}

function loadCalibration() {
  try {
    return JSON.parse(localStorage.getItem(CALIBRATION_KEY));
  } catch {
    return null;
  }
}

function saveCalibration(cal) {
  try {
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify(cal));
  } catch {
    // not remembered
  }
}
