// Shared bits of the Play games: force → position mapping, smoothing, a seeded random
// generator and a drawing helper. No DOM access, so it runs under node --test too.

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// Pulling force as a level from 0 (no load) to 1 (full range or more).
export function forceToLevel(kg, fullKg) {
  if (!(fullKg > 0) || !Number.isFinite(kg)) return 0;
  return clamp(kg / fullKg, 0, 1);
}

// Exponential smoothing towards `target` with time constant `tauS`, frame-rate independent.
export function smoothToward(value, target, dt, tauS) {
  if (tauS <= 0) return target;
  return value + (target - value) * (1 - Math.exp(-dt / tauS));
}

// One step of a critically damped spring: follows the target like a mass on a spring,
// without overshoot. `omega` (rad/s) sets how quickly it settles (~4/omega seconds).
export function springStep(pos, vel, target, dt, omega) {
  const acc = omega * omega * (target - pos) - 2 * omega * vel;
  const v = vel + acc * dt;
  return { pos: pos + v * dt, vel: v };
}

// Small seeded generator (mulberry32): the same seed gives the same course, which is what
// a shared-seed multiplayer round would need.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Runs `step(dt)` in fixed slices so fast balls don't skip through paddles on slow frames.
export function substeps(dt, maxStep, step) {
  const n = Math.max(1, Math.ceil(dt / maxStep));
  for (let i = 0; i < n; i++) step(dt / n);
}

// A filled rounded rectangle.
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
  ctx.fill();
}
