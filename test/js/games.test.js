import assert from "node:assert/strict";
import { test } from "node:test";

import { forceToLevel, seededRandom, smoothToward, springStep } from "../../data/games/common.js";
import { FLAPPY, gapLevels, hitsPipe, levelToY, newFlappy, nextPipe, stepFlappy, yToLevel } from "../../data/games/flappy.js";
import {
  defaultPlayData,
  fullRangeKg,
  loadPlayData,
  playKey,
  recordFlappy,
  recordPong,
  removePlayData,
  savePlayData,
  stepRange,
} from "../../data/games/playdata.js";
import { PONG, levelToPaddleX, newPong, predictX, stepPong } from "../../data/games/pong.js";

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

// Runs `seconds` of game time in 60 Hz frames; `level` may be a function of the state.
function run(step, s, seconds, level) {
  const events = [];
  for (let i = 0; i < Math.round(seconds * 60); i++) events.push(...step(s, 1 / 60, typeof level === "function" ? level(s) : level));
  return events;
}

test("force maps to a level between 0 and 1", () => {
  assert.equal(forceToLevel(0, 20), 0);
  assert.equal(forceToLevel(10, 20), 0.5);
  assert.equal(forceToLevel(35, 20), 1);
  assert.equal(forceToLevel(-0.3, 20), 0); // tare drift
  assert.equal(forceToLevel(5, 0), 0);
  assert.equal(forceToLevel(NaN, 20), 0);
});

test("smoothing and the spring approach the target without overshoot", () => {
  let v = 0;
  for (let i = 0; i < 6; i++) v = smoothToward(v, 1, 0.05, 0.05);
  assert.ok(v > 0.99 && v < 1);
  assert.equal(smoothToward(0, 1, 0.01, 0), 1);

  let p = { pos: 0, vel: 0 };
  let max = 0;
  for (let i = 0; i < 240; i++) {
    p = springStep(p.pos, p.vel, 10, 1 / 240, 9);
    max = Math.max(max, p.pos);
  }
  assert.ok(Math.abs(p.pos - 10) < 0.05, `settled at ${p.pos}`);
  assert.ok(max <= 10.0001, `overshoot ${max}`);
});

test("seeded random repeats for the same seed", () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  const xs = Array.from({ length: 5 }, () => a());
  assert.deepEqual(xs, Array.from({ length: 5 }, () => b()));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(xs, Array.from({ length: 5 }, seededRandom(43)));
});

test("pong: paddle follows the level from left edge to right edge", () => {
  assert.equal(levelToPaddleX(0), PONG.paddleW / 2);
  assert.equal(levelToPaddleX(1), PONG.w - PONG.paddleW / 2);
  const s = newPong({ random: seededRandom(1) });
  run(stepPong, s, 0.5, 1);
  assert.ok(Math.abs(s.player.x - levelToPaddleX(1)) < 0.1);
});

test("pong: predictX unfolds wall bounces", () => {
  const r = PONG.ballR;
  // Straight up: same x.
  assert.equal(predictX({ x: 30, y: 100, vx: 0, vy: -50 }, 10, 100), 30);
  // 45° to the right from x=90: hits the right wall (x = 98) after 8, comes back.
  const x = predictX({ x: 90, y: 100, vx: 50, vy: -50 }, 80, 100);
  assert.ok(Math.abs(x - (100 - r - (20 - (100 - r - 90)))) < 1e-9, `x=${x}`);
});

test("pong: a missed ball scores for the computer, a returned one bounces back", () => {
  const s = newPong({ random: seededRandom(3) });
  s.phase = "play";
  s.ball = { x: 10, y: s.h - 20, vx: 0, vy: 60 };
  const events = run(stepPong, s, 1, 1); // paddle far right
  assert.ok(events.includes("miss"));
  assert.equal(s.cpu.score, 1);
  assert.equal(s.phase, "serve");
  assert.equal(s.serveTo, "player"); // towards whoever lost the point

  const t = newPong({ random: seededRandom(3) });
  t.player.x = levelToPaddleX(0.5);
  t.phase = "play";
  t.ball = { x: 50 + PONG.paddleW / 4, y: t.h - 20, vx: 0, vy: 60 };
  const hit = run(stepPong, t, 0.3, 0.5);
  assert.ok(hit.includes("hit"));
  assert.ok(t.ball.vy < 0, "bounced up");
  assert.ok(t.ball.vx > 0, "right of centre goes right");
  assert.ok(Math.hypot(t.ball.vx, t.ball.vy) > 60, "speeds up");
});

test("pong: ball speed is capped and the game ends at the win score", () => {
  const s = newPong({ random: seededRandom(5) });
  // A perfect player: always under the ball.
  const follow = (st) => (st.phase === "play" && st.ball.vy > 0 ? (st.ball.x - PONG.paddleW / 2) / (PONG.w - PONG.paddleW) : 0.5);
  let maxSpeed = 0;
  for (let i = 0; i < 60 * 600 && s.phase !== "over"; i++) {
    stepPong(s, 1 / 60, follow(s));
    maxSpeed = Math.max(maxSpeed, Math.hypot(s.ball.vx, s.ball.vy));
  }
  assert.equal(s.phase, "over");
  assert.equal(Math.max(s.player.score, s.cpu.score), PONG.winScore);
  assert.ok(maxSpeed <= PONG.maxSpeed + 1e-9);
});

test("pong: the computer is beatable but returns easy balls", () => {
  let wins = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const s = newPong({ random: seededRandom(seed) });
    const follow = (st) => (st.phase === "play" && st.ball.vy > 0 ? (st.ball.x - PONG.paddleW / 2) / (PONG.w - PONG.paddleW) : 0.5);
    run(stepPong, s, 600, follow);
    if (s.player.score > s.cpu.score) wins++;
  }
  assert.ok(wins >= 8, `a precise player wins most games (${wins}/10)`);

  // A slow ball straight at the computer's paddle comes back.
  const s = newPong({ random: () => 0.5 });
  s.phase = "play";
  s.ball = { x: 50, y: 60, vx: 0, vy: -40 };
  const events = run(stepPong, s, 2, 0.5);
  assert.ok(events.includes("hit"));
  assert.equal(s.player.score, 0);
});

test("flappy: level maps to height and back", () => {
  assert.equal(levelToY(0), FLAPPY.h - FLAPPY.birdR);
  assert.ok(Math.abs(levelToY(1) - FLAPPY.birdR) < 1e-9);
  assert.ok(Math.abs(yToLevel(levelToY(0.3)) - 0.3) < 1e-9);
  const [lo, hi] = gapLevels({ gapY: 50, gap: 30 });
  assert.ok(lo < 0.5 && hi > 0.5 && hi - lo < 0.3);
});

test("flappy: the bird follows the level smoothly", () => {
  const s = newFlappy({ w: 70, seed: 1 });
  stepFlappy(s, 0.05, 1);
  assert.ok(s.bird.y < levelToY(0) && s.bird.y > levelToY(0.5), "moving, not jumping");
  run(stepFlappy, s, 1, 0.5);
  assert.ok(Math.abs(s.bird.y - levelToY(0.5)) < 0.5);
});

test("flappy: pipe collisions", () => {
  const pipe = { x: FLAPPY.birdX - 2, gapY: 50, gap: 30 };
  assert.equal(hitsPipe(50, pipe), false);
  assert.equal(hitsPipe(30, pipe), true); // top part
  assert.equal(hitsPipe(72, pipe), true); // bottom part
  assert.equal(hitsPipe(30, { ...pipe, x: FLAPPY.birdX + 10 }), false); // not there yet
  // A gap down to the floor has no bottom part.
  assert.equal(hitsPipe(FLAPPY.h - FLAPPY.birdR, { ...pipe, gapY: FLAPPY.h - 15 }), false);
});

test("flappy: holding the gap's load scores, holding still crashes; it gets harder", () => {
  // Steer into the middle of the next gap.
  const s = newFlappy({ w: 70, seed: 7 });
  const aim = (st) => {
    const p = nextPipe(st);
    return p ? yToLevel(p.gapY) : 0;
  };
  const events = run(stepFlappy, s, 40, aim);
  assert.equal(s.over, false);
  assert.ok(s.score >= 10, `score ${s.score}`);
  assert.equal(events.filter((e) => e === "pass").length, s.score);
  assert.ok(s.speed > FLAPPY.startSpeed && s.gap < FLAPPY.startGap);
  assert.ok(s.speed <= FLAPPY.maxSpeed && s.gap >= FLAPPY.minGap);

  // Pulling full force all the time hits a pipe sooner or later.
  const t = newFlappy({ w: 70, seed: 7 });
  const ev = run(stepFlappy, t, 60, 1);
  assert.ok(t.over && ev.includes("crash"));
  const score = t.score;
  run(stepFlappy, t, 1, 1);
  assert.equal(t.score, score, "nothing moves after the crash");
});

test("flappy: same seed, same course", () => {
  const a = newFlappy({ w: 70, seed: 9 });
  const b = newFlappy({ w: 70, seed: 9 });
  run(stepFlappy, a, 10, 0.5);
  run(stepFlappy, b, 10, 0.5);
  assert.deepEqual(
    a.pipes.map((p) => p.gapY),
    b.pipes.map((p) => p.gapY),
  );
  for (const p of a.pipes) assert.ok(p.gapY - p.gap / 2 >= -1e-9 && p.gapY + p.gap / 2 <= FLAPPY.h + 1e-9);
});

test("play data: per profile, validated, best scores", () => {
  const st = new MemoryStorage();
  assert.deepEqual(loadPlayData(st, "me"), defaultPlayData());

  const d = loadPlayData(st, "me");
  assert.equal(recordFlappy(d, 4), true);
  assert.equal(recordFlappy(d, 2), false);
  assert.equal(recordPong(d, 3, 7), false);
  assert.equal(recordPong(d, 7, 5), true);
  assert.equal(recordPong(d, 7, 6), false);
  assert.equal(recordPong(d, 7, 1), true);
  d.flappy.range = { unit: "bw", kg: 20, pct: 40 };
  savePlayData(st, "me", d);

  const back = loadPlayData(st, "me");
  assert.equal(back.flappy.best, 4);
  assert.equal(back.flappy.played, 2);
  assert.deepEqual(back.pong.best, { you: 7, cpu: 1 });
  assert.equal(back.pong.wins, 3);
  assert.equal(back.pong.played, 4);
  assert.equal(back.flappy.range.unit, "bw");
  assert.deepEqual(loadPlayData(st, "guest"), defaultPlayData(), "other profiles are separate");

  removePlayData(st, "me");
  assert.deepEqual(loadPlayData(st, "me"), defaultPlayData());

  st.setItem(playKey("x"), "{not json");
  assert.deepEqual(loadPlayData(st, "x"), defaultPlayData());
  st.setItem(playKey("x"), JSON.stringify({ pong: { range: { unit: "lbs", kg: 999, pct: -1 }, wins: -2 }, flappy: { best: "lots" } }));
  const fixed = loadPlayData(st, "x");
  assert.deepEqual(fixed.pong.range, { unit: "kg", kg: 200, pct: 5 });
  assert.equal(fixed.pong.wins, 0);
  assert.equal(fixed.flappy.best, 0);
});

test("play data: full range in kg or % of bodyweight", () => {
  assert.equal(fullRangeKg({ unit: "kg", kg: 20, pct: 30 }, 70), 20);
  assert.equal(fullRangeKg({ unit: "bw", kg: 20, pct: 30 }, 70), 21);
  assert.equal(fullRangeKg({ unit: "bw", kg: 20, pct: 30 }, 0), 20, "no bodyweight: kg");
  assert.deepEqual(stepRange({ unit: "kg", kg: 20, pct: 30 }, 1), { unit: "kg", kg: 21, pct: 30 });
  assert.deepEqual(stepRange({ unit: "bw", kg: 20, pct: 30 }, -1), { unit: "bw", kg: 20, pct: 25 });
  assert.equal(stepRange({ unit: "kg", kg: 2, pct: 30 }, -1).kg, 2);
  assert.equal(stepRange({ unit: "bw", kg: 2, pct: 150 }, 1).pct, 150);
});
