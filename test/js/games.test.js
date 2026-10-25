import assert from "node:assert/strict";
import { test } from "node:test";

import { forceToLevel, mirrorEvent, seededRandom, smoothToward, springStep } from "../../data/games/common.js";
import { FLAPPY, flappyDuelResult, gapLevels, hitsPipe, levelToY, newFlappy, nextPipe, stepFlappy, yToLevel } from "../../data/games/flappy.js";
import {
  defaultPlayData,
  fullRangeKg,
  loadPlayData,
  playKey,
  bestMaxPullKg,
  recordFlappy,
  recordPong,
  recordTug,
  removePlayData,
  savePlayData,
  stepRange,
  tugMaxKg,
  tugScale,
} from "../../data/games/playdata.js";
import { LEVEL_IDS, PONG, PONG_LEVELS, coastPong, levelToPaddleX, mirrorPong, newPong, pongSnapshot, predictX, stepPong } from "../../data/games/pong.js";
import {
  PONG4,
  applyPong4Snapshot,
  coastPong4,
  fromLocal,
  levelToAlong,
  levelToSide,
  newPong4,
  pong4Alive,
  pong4Ranking,
  pong4Snapshot,
  stepPong4,
  toLocal,
} from "../../data/games/pong4.js";
import { SCALES, TUG, TUG_LEVELS, knotSpeed, mirrorTug, newTug, seededCpu, stepTug, toScale, tugSnapshot } from "../../data/games/tug.js";

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

test("pong: every hit speeds the ball up, up to the cap; the game ends at the win score", () => {
  for (const level of LEVEL_IDS) {
    const c = PONG_LEVELS[level];
    const s = newPong({ random: seededRandom(5), level });
    // A perfect player: always under the ball.
    const follow = (st) => (st.phase === "play" && st.ball.vy > 0 ? (st.ball.x - PONG.paddleW / 2) / (PONG.w - PONG.paddleW) : 0.5);
    let maxSpeed = 0;
    let speedUps = 0;
    for (let i = 0; i < 60 * 600 && s.phase !== "over"; i++) {
      const before = Math.hypot(s.ball.vx, s.ball.vy);
      const events = stepPong(s, 1 / 60, follow(s));
      const after = Math.hypot(s.ball.vx, s.ball.vy);
      if (events.includes("hit") && !events.includes("point") && !events.includes("miss")) {
        const want = Math.min(c.maxSpeed, before * c.speedUp);
        assert.ok(Math.abs(after - want) < 1e-6, `${level}: ${before} → ${after}`);
        if (after > before) speedUps++;
      }
      maxSpeed = Math.max(maxSpeed, after);
    }
    assert.equal(s.phase, "over", level);
    assert.equal(Math.max(s.player.score, s.cpu.score), PONG.winScore);
    assert.ok(speedUps > 10, `${level}: ${speedUps} speed-ups`);
    assert.ok(Math.abs(maxSpeed - c.maxSpeed) < 1e-6, `${level}: long rallies reach the cap (${maxSpeed})`);
  }
  // Harder is faster from the first serve on.
  const [easy, normal, hard] = ["easy", "normal", "hard"].map((l) => PONG_LEVELS[l]);
  assert.ok(easy.serveSpeed < normal.serveSpeed && normal.serveSpeed < hard.serveSpeed);
  assert.ok(easy.speedUp < normal.speedUp && normal.speedUp <= hard.speedUp && normal.speedUp >= 1.08);
  assert.ok(easy.maxSpeed < normal.maxSpeed && normal.maxSpeed < hard.maxSpeed);
});

// A climber steering by force: sees where the ball goes `reactS` after it turns their way
// (reaction plus Bluetooth lag), the force follows with time constant `tauS` and reaches the
// app in 20 Hz batches, and each return is off by a normal error (`errorU` at 100 u/s,
// growing with the ball speed).
function climber({ reactS, tauS, errorU }, random) {
  const faceY = (s) => s.h - PONG.paddleGap - PONG.paddleH / 2 - PONG.ballR;
  let t = 0;
  let since = 0;
  let towards = false;
  let error = 0;
  let level = 0.5;
  let sent = 0.5;
  let sendAt = 0;
  return (s) => {
    t += 1 / 60;
    const now = s.phase === "play" && s.ball.vy > 0;
    if (now && !towards) {
      since = t;
      const gauss = Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
      error = gauss * errorU * (0.5 + Math.hypot(s.ball.vx, s.ball.vy) / 200);
    }
    towards = now;
    let target = 0.5; // back to the middle while the computer plays
    if (towards && t - since < reactS) target = level;
    else if (towards) target = (predictX(s.ball, faceY(s), s.w) + error - PONG.paddleW / 2) / (PONG.w - PONG.paddleW);
    level = smoothToward(level, Math.min(1, Math.max(0, target)), 1 / 60, tauS);
    if (t >= sendAt) [sent, sendAt] = [level, t + 0.05];
    return sent;
  };
}

const PRECISE = { reactS: 0.25, tauS: 0.1, errorU: 4 };
const DECENT = { reactS: 0.3, tauS: 0.15, errorU: 6 };
const SLOPPY = { reactS: 0.4, tauS: 0.25, errorU: 9 };

function wins(level, player, games = 20) {
  let won = 0;
  for (let seed = 1; seed <= games; seed++) {
    const s = newPong({ h: 140, random: seededRandom(seed), level });
    run(stepPong, s, 900, climber(player, seededRandom(seed + 1000)));
    assert.equal(s.phase, "over");
    if (s.player.score > s.cpu.score) won++;
  }
  return won;
}

test("pong: Normal is beatable with a good pull, Hard is harder, Easy is easy", () => {
  const precise = wins("normal", PRECISE);
  assert.ok(precise >= 18, `a precise player wins most Normal games (${precise}/20)`);
  const sloppy = wins("normal", SLOPPY);
  assert.ok(sloppy <= 4, `a sloppy player loses most Normal games (${sloppy}/20)`);
  const decentNormal = wins("normal", DECENT);
  const decentHard = wins("hard", DECENT);
  assert.ok(decentNormal >= 12, `a decent player mostly wins on Normal (${decentNormal}/20)`);
  assert.ok(decentHard <= decentNormal - 6, `Hard beats a decent player more often (${decentHard} vs ${decentNormal}/20)`);
  assert.ok(wins("hard", PRECISE) >= 12, "a precise player can still win on Hard");
  const sloppyEasy = wins("easy", SLOPPY);
  assert.ok(sloppyEasy >= sloppy + 5, `Easy forgives a sloppy player (${sloppyEasy}/20)`);
});

test("pong: the computer returns slow balls and aims them away from you", () => {
  for (const level of LEVEL_IDS) {
    const s = newPong({ random: () => 0.5, level }); // no aim error
    s.phase = "play";
    s.ball = { x: 50, y: 60, vx: 0, vy: -40 };
    const events = run(stepPong, s, 2, 0.5);
    assert.ok(events.includes("hit"), level);
    assert.equal(s.player.score, 0);
  }
  // You return a ball straight up from the left edge: Normal and Hard take it with the
  // paddle edge so it comes back at an angle, Easy sends it straight back.
  for (const [level, angled] of [
    ["easy", false],
    ["normal", true],
    ["hard", true],
  ]) {
    const s = newPong({ random: () => 0.5, level });
    const x = levelToPaddleX(0);
    s.phase = "play";
    s.player.x = x;
    s.ball = { x, y: s.h - 20, vx: 0, vy: 80 };
    let hits = 0;
    for (let i = 0; i < 180 && hits < 2; i++) hits += stepPong(s, 1 / 60, 0).filter((e) => e === "hit").length;
    assert.equal(hits, 2, level);
    assert.ok(s.ball.vy > 0, level);
    const share = Math.abs(s.ball.vx) / Math.hypot(s.ball.vx, s.ball.vy);
    if (angled) assert.ok(share > 0.4, `${level}: angled (${share})`);
    else assert.ok(share < 1e-9, `${level}: straight back (${share})`);
  }
});

test("pong: the computer plays sooner on harder levels", () => {
  // Ball just hit by you, heading up: Hard moves at once, Easy waits for its own half.
  const moved = (level) => {
    const s = newPong({ random: () => 0.5, level });
    s.phase = "play";
    s.ball = { x: 80, y: s.h * 0.8, vx: 0, vy: -60 };
    stepPong(s, 0.1, 0.5);
    return s.cpu.x - PONG.w / 2;
  };
  assert.equal(moved("easy"), 0);
  assert.ok(moved("hard") > moved("normal") && moved("normal") > 0);
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
  assert.equal(d.pong.level, "normal");
  assert.equal(recordPong(d, "normal", 3, 7), false);
  assert.equal(recordPong(d, "normal", 7, 5), true);
  assert.equal(recordPong(d, "normal", 7, 6), false);
  assert.equal(recordPong(d, "normal", 7, 1), true);
  assert.equal(recordPong(d, "hard", 7, 6), true, "each difficulty has its own best");
  d.pong.level = "hard";
  d.flappy.range = { unit: "bw", kg: 20, pct: 40 };
  savePlayData(st, "me", d);

  const back = loadPlayData(st, "me");
  assert.equal(back.flappy.best, 4);
  assert.equal(back.flappy.played, 2);
  assert.deepEqual(back.pong.results.normal, { best: { you: 7, cpu: 1 }, wins: 3, played: 4 });
  assert.deepEqual(back.pong.results.hard, { best: { you: 7, cpu: 6 }, wins: 1, played: 1 });
  assert.deepEqual(back.pong.results.easy, { best: null, wins: 0, played: 0 });
  assert.equal(back.pong.level, "hard");
  assert.equal(back.flappy.range.unit, "bw");
  assert.deepEqual(loadPlayData(st, "guest"), defaultPlayData(), "other profiles are separate");

  removePlayData(st, "me");
  assert.deepEqual(loadPlayData(st, "me"), defaultPlayData());

  st.setItem(playKey("x"), "{not json");
  assert.deepEqual(loadPlayData(st, "x"), defaultPlayData());
  st.setItem(
    playKey("x"),
    JSON.stringify({
      pong: { range: { unit: "lbs", kg: 999, pct: -1 }, level: "insane", results: { easy: { wins: -2, played: 3 }, hard: { wins: 5, played: 2 } } },
      flappy: { best: "lots" },
    }),
  );
  const fixed = loadPlayData(st, "x");
  assert.deepEqual(fixed.pong.range, { unit: "kg", kg: 200, pct: 5 });
  assert.equal(fixed.pong.level, "normal");
  assert.deepEqual(fixed.pong.results.easy, { best: null, wins: 0, played: 3 });
  assert.equal(fixed.pong.results.hard.wins, 2, "no more wins than games");
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

test("tug: forces are put on the chosen scale", () => {
  const me = { bodyweightKg: 80, maxKg: 50 };
  assert.equal(toScale(20, "kg", me), 20);
  assert.equal(toScale(20, "bw", me), 25);
  assert.equal(toScale(20, "max", me), 40);
  assert.equal(toScale(-1, "kg", me), 0, "tare drift");
  assert.equal(toScale(20, "bw", { maxKg: 50 }), null, "no bodyweight");
  assert.equal(toScale(20, "max", { bodyweightKg: 80 }), null, "no max");
  // A light climber pulling less kg can still pull harder on % BW.
  const light = toScale(30, "bw", { bodyweightKg: 55 });
  const heavy = toScale(36, "bw", { bodyweightKg: 85 });
  assert.ok(light > heavy, `${light} vs ${heavy}`);
  // % max: each player against their own max.
  assert.ok(toScale(30, "max", { maxKg: 40 }) > toScale(40, "max", { maxKg: 70 }));

  assert.equal(tugScale({ scale: "bw" }, 0), "kg");
  assert.equal(tugScale({ scale: "bw" }, 70), "bw");
  assert.equal(tugScale({ scale: "max" }, 0), "max");
});

test("tug: the knot moves towards the harder pull, faster for bigger differences, capped", () => {
  assert.equal(knotSpeed(0, "kg"), 0);
  assert.ok(knotSpeed(3, "kg") > 0 && knotSpeed(-3, "kg") < 0);
  assert.equal(knotSpeed(-3, "kg"), -knotSpeed(3, "kg"));
  const speeds = [1, 2, 5, 10, 15].map((d) => knotSpeed(d, "kg"));
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] > speeds[i - 1]);
  assert.ok(speeds[1] / speeds[0] > 2, "slightly progressive");
  assert.equal(knotSpeed(15, "kg"), TUG.maxSpeed);
  assert.equal(knotSpeed(100, "kg"), TUG.maxSpeed, "capped");
  assert.equal(knotSpeed(SCALES.max.span, "max"), TUG.maxSpeed);

  // In the game, after the countdown.
  const s = newTug({ scale: "kg" });
  const events = run((st, dt, l) => stepTug(st, dt, l, 20), s, TUG.countdownS + 0.1, 30);
  assert.equal(events.filter((e) => e === "count").length, 2);
  assert.ok(events.includes("go"));
  assert.equal(s.phase, "pull");
  const x0 = s.x;
  run((st, dt, l) => stepTug(st, dt, l, 20), s, 1, 25);
  assert.ok(s.x > x0, "towards you");
  const x1 = s.x;
  run((st, dt, l) => stepTug(st, dt, l, 30), s, 1, 25);
  assert.ok(s.x < x1, "back towards them");
});

test("tug: reaching your end wins the round; two rounds win the game", () => {
  const s = newTug();
  const events = run((st, dt, l) => stepTug(st, dt, l, 10), s, 60, 30);
  assert.equal(s.phase, "over");
  assert.equal(s.you.rounds, TUG.winRounds);
  assert.equal(s.them.rounds, 0);
  assert.equal(events.filter((e) => e === "roundWon").length, 2);
  assert.ok(events.includes("won"));
  // 20 kg more than the opponent: full speed, so the end in about 1/maxSpeed s.
  assert.ok(Math.abs(s.fastestWinS - 1 / TUG.maxSpeed) < 0.2, `${s.fastestWinS}`);
  const x = s.x;
  assert.deepEqual(stepTug(s, 1, 0, 50), [], "nothing moves after the end");
  assert.equal(s.x, x);

  const t = newTug();
  const lost = run((st, dt, l) => stepTug(st, dt, l, 30), t, 60, 0);
  assert.ok(lost.includes("lost") && t.them.rounds === 2 && t.fastestWinS === null);
});

test("tug: at the time limit the knot's side wins; dead even is replayed", () => {
  const s = newTug();
  run((st, dt) => stepTug(st, dt, 20.4, 20), s, TUG.countdownS + 0.05, 0);
  // A small lead: too slow to reach the end in time.
  const events = run((st, dt) => stepTug(st, dt, 20.4, 20), s, TUG.roundS, 0);
  assert.ok(events.includes("roundWon"), events.join());
  assert.ok(s.last.winner === "you" && Math.abs(s.last.s - TUG.roundS) < 0.05);
  assert.equal(s.phase, "break");

  const even = newTug();
  const ev = run((st, dt) => stepTug(st, dt, 20, 20), even, TUG.countdownS + TUG.roundS + 0.1, 0);
  assert.ok(ev.includes("draw"));
  assert.equal(even.you.rounds + even.them.rounds, 0);
  assert.equal(even.round, 1, "the same round again");
  run((st, dt) => stepTug(st, dt, 0, 0), even, TUG.breakS, 0);
  assert.equal(even.phase, "ready");
  assert.equal(even.x, 0);
});

// A whole game against the computer at `level` with your max at 50 kg, pulling `share` of
// it steadily. Returns true when you win.
function playCpu(level, share, seed, scale = "max") {
  const me = { bodyweightKg: 70, maxKg: 50 };
  const toLevel = (kg) => toScale(kg, scale, me);
  const cpu = seededCpu({ strengthKg: TUG_LEVELS[level] * me.maxKg, toLevel }, seed);
  const s = newTug({ scale });
  for (let i = 0; i < 60 * 300 && s.phase !== "over"; i++) {
    const theirs = cpu.next(s, 1 / 60);
    stepTug(s, 1 / 60, toLevel(s.phase === "pull" ? share * me.maxKg : 0), theirs);
  }
  assert.equal(s.phase, "over");
  return s.you.rounds > s.them.rounds;
}

const winsCpu = (level, share, scale) => Array.from({ length: 20 }, (_, i) => playCpu(level, share, i + 1, scale)).filter(Boolean).length;

test("tug: the computer is beatable by a strong steady pull and beats a weak one", () => {
  for (const scale of ["kg", "bw", "max"]) {
    assert.equal(winsCpu("normal", 0.6, scale), 20, `strong beats Normal (${scale})`);
    assert.equal(winsCpu("normal", 0.3, scale), 0, `weak loses to Normal (${scale})`);
  }
  assert.ok(winsCpu("easy", 0.35) >= 18, "Easy: a light pull wins");
  assert.ok(winsCpu("hard", 0.45) <= 2, "Hard: Normal's strength isn't enough");
  assert.ok(winsCpu("hard", 0.75) >= 18, "Hard: a strong pull wins");
  // Close to its strength it's a real fight: some won, some lost.
  const close = winsCpu("normal", 0.42);
  assert.ok(close >= 3 && close <= 17, `close fight (${close}/20)`);
});

test("tug: the computer ramps up, surges, sags and tires", () => {
  const cpu = seededCpu({ strengthKg: 20 }, 5);
  const s = newTug();
  s.phase = "pull";
  const kgs = [];
  for (let i = 0; i < 60 * 60; i++) kgs.push(cpu.next(s, 1 / 60));
  assert.ok(kgs[6] < 10, `ramps up (${kgs[6]})`);
  const first = kgs.slice(60, 60 * 10);
  const last = kgs.slice(60 * 50);
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(Math.max(...first) > 20 * 1.2, "surges");
  assert.ok(Math.min(...first) < 20 * 0.92, "sags");
  assert.ok(mean(last) < mean(first) * 0.9, `tires (${mean(first)} → ${mean(last)})`);
  // Rest: lets go between rounds, and a longer rest gives more back.
  const tiredAfterRest = (restS) => {
    const c = seededCpu({ strengthKg: 20 }, 5);
    const t = { ...newTug(), phase: "pull" };
    for (let i = 0; i < 60 * 60; i++) c.next(t, 1 / 60);
    t.phase = "break";
    for (let i = 0; i < 60 * restS; i++) c.next(t, 1 / 60);
    assert.ok(c.kg < 0.5, "lets go between rounds");
    t.phase = "pull";
    const after = [];
    for (let i = 0; i < 60 * 5; i++) after.push(c.next(t, 1 / 60));
    return mean(after.slice(60));
  };
  assert.ok(tiredAfterRest(30) > tiredAfterRest(5) * 1.05, "rested");
  // Digs in when about to lose.
  const a = seededCpu({ strengthKg: 20 }, 9);
  const b = seededCpu({ strengthKg: 20 }, 9);
  const near = { ...newTug(), phase: "pull", x: 0.9 };
  const safe = { ...newTug(), phase: "pull", x: 0 };
  let ka = 0;
  let kb = 0;
  for (let i = 0; i < 60 * 3; i++) [ka, kb] = [a.next(near, 1 / 60), b.next(safe, 1 / 60)];
  assert.ok(ka > kb * 1.08, `${ka} vs ${kb}`);
});

test("play data: tug settings and results", () => {
  const st = new MemoryStorage();
  const d = loadPlayData(st, "me");
  assert.deepEqual(d.tug.results.normal, { fastestS: null, wins: 0, played: 0 });
  assert.equal(recordTug(d, "normal", false, null), false);
  assert.equal(recordTug(d, "normal", true, 8.5), true);
  assert.equal(recordTug(d, "normal", true, 9), false);
  assert.equal(recordTug(d, "normal", false, 6), true, "a round won in a lost game counts");
  d.tug.scale = "max";
  d.tug.level = "hard";
  d.tug.maxKg = 44;
  savePlayData(st, "me", d);
  const back = loadPlayData(st, "me");
  assert.deepEqual(back.tug.results.normal, { fastestS: 6, wins: 2, played: 4 });
  assert.equal(back.tug.scale, "max");
  assert.equal(back.tug.level, "hard");
  assert.equal(back.tug.maxKg, 44);

  st.setItem(playKey("x"), JSON.stringify({ tug: { scale: "lbs", level: "x", maxKg: 9999, results: { easy: { wins: 4, played: 2, fastestS: -1 } } } }));
  const fixed = loadPlayData(st, "x");
  assert.equal(fixed.tug.scale, "kg");
  assert.equal(fixed.tug.level, "normal");
  assert.equal(fixed.tug.maxKg, 250);
  assert.deepEqual(fixed.tug.results.easy, { fastestS: null, wins: 2, played: 2 });

  // Max pull: the best Max pull test, else the typed-in value.
  const index = [
    { type: "maxPull", summary: { peakKg: 41.2 } },
    { type: "maxPull", summary: { peakKg: 47.5 } },
    { type: "hangboard", summary: { peakKg: 90 } },
  ];
  assert.equal(bestMaxPullKg(index), 47.5);
  assert.equal(bestMaxPullKg([]), null);
  assert.equal(tugMaxKg({ maxKg: 30 }, index), 47.5);
  assert.equal(tugMaxKg({ maxKg: 30 }, index.slice(2)), 30);
});

// ---- Two phones ----

test("duel: events are mirrored for the other phone", () => {
  assert.deepEqual(["hit", "point", "miss", "roundWon", "won", "count"].map(mirrorEvent), ["hit", "miss", "point", "roundLost", "lost", "count"]);
});

test("duel tug: the guest sees the host's game from its own end", () => {
  const s = newTug({ scale: "kg" });
  stepTug(s, 3.1, 0, 0); // countdown over
  for (let i = 0; i < 60; i++) stepTug(s, 0.05, 10, 30); // the guest (them) pulls harder
  assert.ok(s.x < -0.1);
  const g = mirrorTug(JSON.parse(JSON.stringify(tugSnapshot(s))));
  assert.equal(g.x, -s.x);
  assert.ok(g.you.level > g.them.level);
  for (let i = 0; i < 200 && s.phase === "pull"; i++) stepTug(s, 0.05, 0, 40);
  assert.equal(s.them.rounds, 1);
  const after = mirrorTug(tugSnapshot(s));
  assert.equal(after.you.rounds, 1);
  assert.equal(after.last.winner, "you");
});

test("duel pong: the guest's level moves the top paddle; the field is turned round for it", () => {
  const s = newPong({ h: 150, random: seededRandom(3) });
  for (let i = 0; i < 60; i++) stepPong(s, 1 / 60, 0.5, 1);
  assert.ok(s.cpu.x > PONG.w - PONG.paddleW / 2 - 1, "top paddle at the right edge");
  stepPong(s, 0.2, 0.5, 1); // served
  const g = mirrorPong(pongSnapshot(s), s.h);
  assert.equal(g.player.x, s.cpu.x);
  assert.equal(g.ball.y, s.h - s.ball.y);
  assert.equal(g.ball.vy, -s.ball.vy);
  const guest = { ...newPong({ h: 150 }), ...g };
  const y0 = guest.ball.y;
  coastPong(guest, 0.1, 0);
  assert.ok(Math.abs(guest.ball.y - (y0 + guest.ball.vy * 0.1)) < 1e-9);
});

test("duel flappy: same seed, same course; further wins", () => {
  const a = newFlappy({ w: 80, seed: 42 });
  const b = newFlappy({ w: 80, seed: 42 });
  for (let i = 0; i < 300; i++) {
    stepFlappy(a, 1 / 60, 0.5);
    stepFlappy(b, 1 / 50, 0.5);
    if (i % 5 === 0) stepFlappy(b, 1 / 300, 0.5);
  }
  assert.deepEqual(a.pipes.map((p) => p.gapY), b.pipes.map((p) => p.gapY));
  assert.equal(flappyDuelResult({ score: 5, t: 10 }, { score: 4, t: 20 }), "won");
  assert.equal(flappyDuelResult({ score: 5, t: 10 }, { score: 5, t: 12 }), "lost");
  assert.equal(flappyDuelResult({ score: 5, t: 10 }, { score: 5, t: 10.01 }), "draw");
});

// ---- Pong for 3-4 players ----

// A ball in play heading straight at `side`, `ahead` units before its edge, `a` along it.
function aimAt(s, side, a, ahead = 25, speed = 60) {
  s.phase = "play";
  const p = fromLocal(side, a, ahead);
  const v = fromLocal(side, PONG4.size / 2, PONG4.size / 2 - speed); // inward vector, flipped below
  s.ball = { x: p.x, y: p.y, vx: v.x - PONG4.size / 2, vy: v.y - PONG4.size / 2 };
}
const runPong4 = (s, seconds, levels) => run((st, dt, lv) => stepPong4(st, dt, lv), s, seconds, levels);

test("pong4: level 0 is each player's own left end, 1 their right end", () => {
  const lo = levelToAlong(0);
  const hi = levelToAlong(1);
  assert.equal(lo, PONG4.corner + PONG4.paddleW / 2, "stops at the corner block");
  assert.equal(hi, PONG4.size - lo);
  const g = PONG4.paddleGap;
  // Bottom: left to right. Right side (seen from there): from the bottom up. Top: right
  // to left. Left side: from the top down.
  assert.deepEqual(levelToSide(0, 0), { x: lo, y: 100 - g });
  assert.deepEqual(levelToSide(0, 1), { x: hi, y: 100 - g });
  assert.deepEqual(levelToSide(1, 0), { x: 100 - g, y: hi });
  assert.deepEqual(levelToSide(1, 1), { x: 100 - g, y: lo });
  assert.deepEqual(levelToSide(2, 0), { x: hi, y: g });
  assert.deepEqual(levelToSide(2, 1), { x: lo, y: g });
  assert.deepEqual(levelToSide(3, 0), { x: g, y: lo });
  assert.deepEqual(levelToSide(3, 1), { x: g, y: hi });
  for (let side = 0; side < 4; side++) {
    const p = fromLocal(side, 30, 7);
    assert.deepEqual(toLocal(side, p.x, p.y), { a: 30, d: 7 });
  }
});

test("pong4: paddles follow their levels; a side without a level stays", () => {
  const s = newPong4({ random: seededRandom(1) });
  runPong4(s, 0.5, { 0: 0, 1: 1, 3: 0.5 });
  assert.ok(Math.abs(s.players[0].a - levelToAlong(0)) < 0.1);
  assert.ok(Math.abs(s.players[1].a - levelToAlong(1)) < 0.1);
  assert.equal(s.players[2].a, 50);
});

test("pong4: a paddle returns the ball on every side", () => {
  for (let side = 0; side < 4; side++) {
    const s = newPong4({ random: seededRandom(2) });
    s.players[side].a = levelToAlong(0.5);
    aimAt(s, side, 50 + PONG4.paddleW / 4);
    const events = runPong4(s, 0.3, { [side]: 0.5 });
    assert.ok(events.some((e) => e.type === "hit" && e.side === side), `side ${side}`);
    assert.ok(!events.some((e) => e.type === "miss"));
    const b = s.ball;
    const v = toLocal(side, 50 + b.vx, 50 + b.vy);
    assert.ok(v.d > 50, "heads back into the field");
    assert.ok(v.a > 50, "hit right of centre goes to that player's right");
    assert.ok(Math.hypot(b.vx, b.vy) > 60, "speeds up");
  }
});

test("pong4: a miss costs a life and serves again after a pause", () => {
  const s = newPong4({ random: seededRandom(3) });
  aimAt(s, 2, 20); // the paddle sits in the middle
  const events = runPong4(s, 1, {});
  assert.deepEqual(events.filter((e) => e.type !== "wall"), [{ type: "miss", side: 2 }]);
  assert.equal(s.players[2].lives, PONG4.lives - 1);
  assert.equal(s.phase, "serve");
  assert.deepEqual(s.ball, { x: 50, y: 50, vx: 0, vy: 0 });
  runPong4(s, PONG4.serveDelayS, {});
  assert.equal(s.phase, "play");
  assert.ok(Math.hypot(s.ball.vx, s.ball.vy) > PONG_LEVELS.normal.serveSpeed, "serves get faster");
});

test("pong4: corner blocks keep the ball in", () => {
  const s = newPong4({ random: seededRandom(4) });
  s.phase = "play";
  s.ball = { x: 6, y: 50, vx: 0, vy: 80 }; // down the left edge into the bottom-left block
  const events = runPong4(s, 0.5, {});
  assert.ok(events.some((e) => e.type === "wall"));
  assert.ok(s.ball.vy < 0, "bounced off the block");
  assert.ok(!events.some((e) => e.type === "miss"));
});

test("pong4: out at 0 lives, the side becomes a wall; the last one in wins", () => {
  const s = newPong4({ random: seededRandom(5) });
  s.players[1].lives = 1;
  aimAt(s, 1, 20);
  let events = runPong4(s, 1, {});
  assert.deepEqual(events.filter((e) => e.type !== "wall"), [{ type: "miss", side: 1 }, { type: "out", side: 1 }]);
  assert.deepEqual(pong4Alive(s), [0, 2, 3]);
  // Now the ball bounces off side 1.
  aimAt(s, 1, 20);
  events = runPong4(s, 0.5, {});
  assert.ok(events.some((e) => e.type === "wall"));
  assert.ok(!events.some((e) => e.type === "miss"));
  assert.ok(s.ball.vx < 0);

  s.players[3].lives = 1;
  aimAt(s, 3, 20);
  runPong4(s, 1, {});
  s.players[0].lives = 1;
  aimAt(s, 0, 20);
  events = runPong4(s, 1, {});
  assert.deepEqual(events.filter((e) => e.type !== "wall"), [{ type: "miss", side: 0 }, { type: "out", side: 0 }, { type: "won", side: 2 }]);
  assert.equal(s.phase, "over");
  assert.equal(s.winner, 2);
  assert.deepEqual(s.out, [1, 3, 0]);
  assert.deepEqual(pong4Ranking(s), [2, 0, 3, 1]);
  assert.deepEqual(runPong4(s, 1, {}), [], "nothing happens after the end");
});

test("pong4: with 3 players the free side is a wall; serves go to players only", () => {
  const s = newPong4({ sides: [0, 1, 2], random: seededRandom(6) });
  assert.equal(s.players[3], null);
  assert.deepEqual(pong4Alive(s), [0, 1, 2]);
  aimAt(s, 3, 20);
  const events = runPong4(s, 0.4, {});
  assert.ok(events.some((e) => e.type === "wall"));
  assert.ok(s.ball.vx > 0);
  for (let i = 0; i < 40; i++) {
    const t = newPong4({ sides: [0, 1, 2], random: seededRandom(100 + i) });
    runPong4(t, PONG4.startDelayS + 0.02, {});
    const { vx, vy } = t.ball;
    assert.ok(vx > 0 || Math.abs(vy) > Math.abs(vx), "never served at the wall");
  }
});

test("pong4: a snapshot goes through JSON and keeps the receiver's own paddle", () => {
  const s = newPong4({ random: seededRandom(7) });
  runPong4(s, PONG4.startDelayS + 0.3, { 0: 0.2, 1: 0.9, 2: 0.4, 3: 0.6 });
  s.players[2].lives = 2;
  const snap = JSON.parse(JSON.stringify(pong4Snapshot(s)));
  assert.deepEqual(snap.alive, [0, 1, 2, 3]);
  const r = applyPong4Snapshot(newPong4(), snap);
  assert.deepEqual(pong4Snapshot(r), pong4Snapshot(s));
  const g = newPong4();
  g.players[1].a = 33;
  applyPong4Snapshot(g, snap, 1);
  assert.equal(g.players[1].a, 33);
  assert.equal(g.players[2].lives, 2);
  assert.deepEqual(g.ball, s.ball);
  const three = JSON.parse(JSON.stringify(pong4Snapshot(newPong4({ sides: [0, 1, 3] }))));
  assert.equal(applyPong4Snapshot(newPong4(), three).players[2], null);
});

test("pong4: coasting moves the ball and the own paddle, bouncing off walls", () => {
  const g = newPong4({ sides: [0, 1, 2] });
  g.phase = "play";
  g.ball = { x: 30, y: 50, vx: -50, vy: 0 };
  coastPong4(g, 0.1, 0, 1);
  assert.ok(Math.abs(g.ball.x - 25) < 1e-9);
  assert.ok(g.players[0].a > 50, "own paddle moves at once");
  coastPong4(g, 0.6, 0, 1); // to the left wall (side 3) and back
  assert.ok(g.ball.vx > 0);
  assert.ok(g.ball.x > PONG4.wall + PONG4.ballR);
  // At a side still in it waits at the edge for the host.
  g.ball = { x: 50, y: 90, vx: 0, vy: 50 };
  coastPong4(g, 1, 0, 0.5);
  assert.equal(g.ball.y, 100 + PONG4.ballR);
});

test("pong4: same seed, same game", () => {
  const play = () => {
    const s = newPong4({ random: seededRandom(9), level: "hard" });
    const rnd = seededRandom(10);
    const levels = { 0: 0.5, 1: 0.5, 2: 0.5, 3: 0.5 };
    const log = [];
    for (let i = 0; i < 60 * 120 && s.phase !== "over"; i++) {
      if (i % 20 === 0) for (const k in levels) levels[k] = rnd();
      log.push(...stepPong4(s, 1 / 60, levels));
    }
    return { log, snap: pong4Snapshot(s) };
  };
  const a = play();
  assert.deepEqual(play(), a);
  assert.ok(a.log.filter((e) => e.type === "miss").length > 3, "the game moves on");
  assert.ok(a.log.every((e) => typeof e.type === "string"));
});
