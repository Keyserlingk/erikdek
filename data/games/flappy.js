// Flappy: a side-scroller where the bird's height follows your pull (0 kg = bottom, full
// range = top) through a spring, so it moves like a mass rather than jumping. Pipes come
// with gaps at varying heights, so you must hold specific loads; touching a pipe ends the
// round. Field units: 100 high, `w` wide (the canvas' aspect), y down. stepFlappy() is pure
// game logic (no DOM), drawFlappy() paints a state on a canvas.

import { clamp, roundRect, seededRandom, springStep, substeps } from "./common.js";

export const FLAPPY = {
  h: 100,
  birdX: 24,
  birdR: 3.2,
  pipeW: 13,
  spacing: 50, // from one pipe to the next
  firstPipeS: 2.5, // time to get going before the first pipe arrives
  startSpeed: 22, // units/s, +speedStep per pipe passed, up to maxSpeed
  speedStep: 0.5,
  maxSpeed: 36,
  startGap: 40, // gap height, -gapStep per pipe passed, down to minGap
  gapStep: 0.8,
  minGap: 24,
  startJump: 35, // most the gap centre moves from one pipe to the next, growing to maxJump
  jumpStep: 2,
  maxJump: 70,
  omega: 9, // spring stiffness (rad/s): settles in about half a second
  maxStepS: 1 / 240,
};

// Bird centre for a level 0..1, and back.
export const levelToY = (level, h = FLAPPY.h) => h - FLAPPY.birdR - clamp(level, 0, 1) * (h - 2 * FLAPPY.birdR);
export const yToLevel = (y, h = FLAPPY.h) => clamp((h - FLAPPY.birdR - y) / (h - 2 * FLAPPY.birdR), 0, 1);

// The levels (low, high) that keep the whole bird inside a pipe's gap.
export function gapLevels(pipe, h = FLAPPY.h) {
  const r = FLAPPY.birdR;
  return [yToLevel(pipe.gapY + pipe.gap / 2 - r, h), yToLevel(pipe.gapY - pipe.gap / 2 + r, h)];
}

export function newFlappy({ w = 60, seed = Date.now() } = {}) {
  return {
    w,
    h: FLAPPY.h,
    random: seededRandom(seed),
    bird: { y: levelToY(0), v: 0 },
    pipes: [],
    nextPipeX: w + FLAPPY.firstPipeS * FLAPPY.startSpeed,
    lastGapY: FLAPPY.h / 2,
    speed: FLAPPY.startSpeed,
    gap: FLAPPY.startGap,
    jump: FLAPPY.startJump,
    score: 0,
    over: false,
    t: 0,
  };
}

function addPipe(s, x) {
  const half = s.gap / 2;
  // Anywhere from resting on the floor to near the top, but not too far from the last one.
  const lo = Math.max(half, s.lastGapY - s.jump);
  const hi = Math.min(s.h - half, s.lastGapY + s.jump);
  const gapY = lo + s.random() * (hi - lo);
  s.lastGapY = gapY;
  s.pipes.push({ x, gapY, gap: s.gap, passed: false });
}

// Circle (bird) against the two parts of a pipe.
export function hitsPipe(birdY, pipe, birdX = FLAPPY.birdX, r = FLAPPY.birdR, h = FLAPPY.h) {
  const nx = clamp(birdX, pipe.x, pipe.x + FLAPPY.pipeW);
  const top = pipe.gapY - pipe.gap / 2;
  const bottom = pipe.gapY + pipe.gap / 2;
  const hitsRect = (y0, y1) => {
    const ny = clamp(birdY, y0, y1);
    return (birdX - nx) ** 2 + (birdY - ny) ** 2 < r * r;
  };
  return (top > 0 && hitsRect(0, top)) || (bottom < h && hitsRect(bottom, h));
}

function stepOnce(s, dt, level, events) {
  if (s.over) return;
  s.t += dt;
  const b = springStep(s.bird.y, s.bird.v, levelToY(level, s.h), dt, FLAPPY.omega);
  // The floor and ceiling stop the bird (they don't end the round: letting go is allowed).
  const r = FLAPPY.birdR;
  s.bird.y = clamp(b.pos, r, s.h - r);
  s.bird.v = s.bird.y === b.pos ? b.vel : 0;

  const dx = s.speed * dt;
  for (const p of s.pipes) p.x -= dx;
  s.nextPipeX -= dx;
  while (s.nextPipeX < s.w + FLAPPY.pipeW) {
    addPipe(s, s.nextPipeX);
    s.nextPipeX += FLAPPY.spacing;
  }
  s.pipes = s.pipes.filter((p) => p.x + FLAPPY.pipeW > -2);

  for (const p of s.pipes) {
    if (hitsPipe(s.bird.y, p, FLAPPY.birdX, r, s.h)) {
      s.over = true;
      events.push("crash");
      return;
    }
    if (!p.passed && p.x + FLAPPY.pipeW < FLAPPY.birdX - r) {
      p.passed = true;
      s.score++;
      s.speed = Math.min(FLAPPY.maxSpeed, s.speed + FLAPPY.speedStep);
      s.gap = Math.max(FLAPPY.minGap, s.gap - FLAPPY.gapStep);
      s.jump = Math.min(FLAPPY.maxJump, s.jump + FLAPPY.jumpStep);
      events.push("pass");
    }
  }
}

// Advances the round by dt seconds with the player's level (0..1). Returns the events of
// this step: "pass" (a pipe passed), "crash" (round over).
export function stepFlappy(s, dt, level) {
  const events = [];
  substeps(dt, FLAPPY.maxStepS, (d) => stepOnce(s, d, level, events));
  return events;
}

// The next pipe the bird still has to pass, or null.
export const nextPipe = (s) => s.pipes.find((p) => !p.passed && p.x + FLAPPY.pipeW >= FLAPPY.birdX - FLAPPY.birdR) || null;

// Paints the field. `c` holds theme colours ({bg, muted, accent, ok, bad, border});
// `fullKg` labels the force scale on the right, where the band shows the load the next
// gap needs and the arrow shows your current level.
export function drawFlappy(ctx, s, c, cssW, cssH, { fullKg, level }) {
  const scale = cssH / s.h;
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.save();
  ctx.scale(scale, scale);
  const w = cssW / scale;
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, s.h);

  ctx.fillStyle = c.ok;
  for (const p of s.pipes) {
    const top = p.gapY - p.gap / 2;
    const bottom = p.gapY + p.gap / 2;
    if (top > 0) roundRect(ctx, p.x, -2, FLAPPY.pipeW, top + 2, 1.5);
    if (bottom < s.h) roundRect(ctx, p.x, bottom, FLAPPY.pipeW, s.h - bottom + 2, 1.5);
  }

  // Force scale: kg labels, the next gap's band and your level.
  const sx = w - 3;
  const levelY = (lv) => levelToY(lv, s.h);
  const next = nextPipe(s);
  if (next) {
    const [lo, hi] = gapLevels(next, s.h);
    ctx.fillStyle = c.ok;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(sx - 2.5, levelY(hi), 5, levelY(lo) - levelY(hi));
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 0.4;
  ctx.beginPath();
  ctx.moveTo(sx, levelY(0));
  ctx.lineTo(sx, levelY(1));
  ctx.stroke();
  ctx.fillStyle = c.muted;
  ctx.font = "2.8px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const lv of [0, 0.25, 0.5, 0.75, 1]) {
    const y = clamp(levelY(lv), 3, s.h - 3);
    ctx.fillText(`${Math.round(lv * fullKg)}`, sx - 3.5, y);
    ctx.fillRect(sx - 1.5, levelY(lv) - 0.2, 3, 0.4);
  }
  ctx.fillStyle = c.accent;
  ctx.beginPath();
  const ly = levelY(level);
  ctx.moveTo(sx - 2.5, ly);
  ctx.lineTo(sx + 2.5, ly - 2);
  ctx.lineTo(sx + 2.5, ly + 2);
  ctx.fill();

  // The bird: a ball with an eye, tilted by its speed.
  const r = FLAPPY.birdR;
  ctx.save();
  ctx.translate(FLAPPY.birdX, s.bird.y);
  ctx.rotate(clamp(s.bird.v / 150, -0.6, 0.6));
  ctx.fillStyle = s.over ? c.bad : c.accent;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = c.bg;
  ctx.beginPath();
  ctx.arc(r * 0.4, -r * 0.3, r * 0.3, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
  ctx.restore();
}
