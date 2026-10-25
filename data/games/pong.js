// Pong, portrait: your paddle at the bottom, the computer's at the top. The paddle follows
// your pull (0 kg = left edge, full range = right edge). Field units: 100 wide, `h` high,
// y down. stepPong() is pure game logic (no DOM), drawPong() paints a state on a canvas.
// The difficulty (PONG_LEVELS) sets the ball speeds and how well the computer plays.

import { clamp, roundRect, smoothToward, substeps } from "./common.js";

export const PONG = {
  w: 100,
  paddleW: 24,
  paddleH: 3,
  paddleGap: 6, // paddle centre from the end line
  ballR: 2,
  maxAngle: (60 * Math.PI) / 180, // bounce angle at the paddle's edge
  winScore: 7,
  serveDelayS: 1,
  playerTauS: 0.05, // light smoothing of the force
  maxStepS: 1 / 240,
};

// Ball speeds in units/s: each point played adds serveStep to the serve, each paddle hit
// multiplies by speedUp, up to maxSpeed. The fastest ball stays reachable: straight down a
// short field (~100 units) 190 u/s leaves ~0.5 s, enough for a quick pull after ~0.3 s of
// reaction and Bluetooth lag (the force arrives in ~50 ms batches, smoothed by playerTauS).
// The computer: cpuSpeed (paddle speed), cpuReactAt (starts moving once the ball coming
// back is above this share of the field; 1 = as soon as you hit it), cpuError (most random
// aim error for a 100 u/s ball, as a share of the paddle width; it grows with the speed, so
// long rallies make the computer miss) and cpuEdge (how far off centre, as a share of the
// half paddle, it tries to hit to send the ball away from you). Easy is the first version.
export const PONG_LEVELS = {
  easy: { serveSpeed: 50, serveStep: 2, speedUp: 1.05, maxSpeed: 125, cpuSpeed: 55, cpuReactAt: 0.5, cpuError: 0.65, cpuEdge: 0 },
  normal: { serveSpeed: 70, serveStep: 2, speedUp: 1.08, maxSpeed: 170, cpuSpeed: 85, cpuReactAt: 0.9, cpuError: 0.3, cpuEdge: 0.6 },
  hard: { serveSpeed: 80, serveStep: 3, speedUp: 1.1, maxSpeed: 190, cpuSpeed: 120, cpuReactAt: 1, cpuError: 0.15, cpuEdge: 0.9 },
};
export const LEVEL_IDS = Object.keys(PONG_LEVELS);

const paddleY = (s, who) => (who === "player" ? s.h - PONG.paddleGap : PONG.paddleGap);
// Paddle centre for a level 0..1.
export const levelToPaddleX = (level) => PONG.paddleW / 2 + clamp(level, 0, 1) * (PONG.w - PONG.paddleW);

export function newPong({ h = 150, random = Math.random, level = "normal" } = {}) {
  const s = {
    w: PONG.w,
    h,
    random,
    level: PONG_LEVELS[level] ? level : "normal",
    player: { x: PONG.w / 2, score: 0 },
    cpu: { x: PONG.w / 2, score: 0, aim: 0 },
    ball: { x: PONG.w / 2, y: h / 2, vx: 0, vy: 0 },
    phase: "serve", // serve | play | over
    serveIn: PONG.serveDelayS,
    serveTo: "player",
    hits: 0,
  };
  return s;
}

const cfg = (s) => PONG_LEVELS[s.level];

function serve(s) {
  const points = s.player.score + s.cpu.score;
  const speed = cfg(s).serveSpeed + cfg(s).serveStep * points;
  const angle = (s.random() - 0.5) * (Math.PI / 4); // ±22.5°
  const dir = s.serveTo === "player" ? 1 : -1;
  s.ball = { x: s.w / 2, y: s.h / 2, vx: speed * Math.sin(angle), vy: dir * speed * Math.cos(angle) };
  s.phase = "play";
  if (dir < 0) planCpu(s);
}

// Where the ball will cross height `y`, bouncing off the side walls.
export function predictX(ball, y, w, r = PONG.ballR) {
  if (ball.vy === 0) return ball.x;
  const t = (y - ball.y) / ball.vy;
  if (t < 0) return ball.x;
  const span = w - 2 * r;
  let x = ball.x - r + ball.vx * t;
  // Unfold the reflections: a triangle wave over [0, span].
  x = ((x % (2 * span)) + 2 * span) % (2 * span);
  if (x > span) x = 2 * span - x;
  return x + r;
}

// The line the ball's centre is on when it touches a paddle.
const face = (s, who) =>
  who === "player" ? paddleY(s, who) - PONG.paddleH / 2 - PONG.ballR : paddleY(s, who) + PONG.paddleH / 2 + PONG.ballR;

// The ball's velocity after it hits a paddle at `offset` (-1 left edge .. 1 right edge).
function bounce(speed, offset, up) {
  const angle = offset * PONG.maxAngle;
  return { vx: speed * Math.sin(angle), vy: (up ? -1 : 1) * speed * Math.cos(angle) };
}

// When the ball heads its way the computer picks where on its paddle to take it: the
// offset (up to cpuEdge, as far as the walls let the paddle go) that lands the return
// furthest from your paddle, plus a random error that grows with the ball speed and
// sometimes makes it miss. `aim` is where the paddle goes relative to the ball.
function planCpu(s) {
  const c = cfg(s);
  const b = s.ball;
  const reach = PONG.paddleW / 2 + PONG.ballR;
  const at = { x: predictX(b, face(s, "cpu"), s.w), y: face(s, "cpu") };
  const speed = Math.min(c.maxSpeed, Math.hypot(b.vx, b.vy) * c.speedUp);
  let aim = 0;
  let bestGap = -1;
  for (let i = -4; i <= 4; i++) {
    // To hit with its right part the paddle goes left of the ball, and the other way round.
    const x = clamp(at.x - (i / 4) * c.cpuEdge * reach, PONG.paddleW / 2, s.w - PONG.paddleW / 2);
    const out = bounce(speed, (at.x - x) / reach, false);
    const gap = Math.abs(predictX({ ...at, ...out }, face(s, "player"), s.w) - s.player.x);
    if (gap > bestGap + 1e-9) [aim, bestGap] = [x - at.x, gap];
  }
  s.cpu.aim = aim + (s.random() * 2 - 1) * c.cpuError * PONG.paddleW * (Math.hypot(b.vx, b.vy) / 100);
}

function moveCpu(s, dt) {
  const b = s.ball;
  let target = s.w / 2;
  if (s.phase === "play" && b.vy < 0 && b.y < s.h * cfg(s).cpuReactAt) {
    target = predictX(b, face(s, "cpu"), s.w) + s.cpu.aim;
  }
  const maxMove = cfg(s).cpuSpeed * dt;
  s.cpu.x = clamp(s.cpu.x + clamp(target - s.cpu.x, -maxMove, maxMove), PONG.paddleW / 2, s.w - PONG.paddleW / 2);
}

// Bounces the ball off a paddle it is crossing; the further from the centre it hits, the
// steeper it leaves.
function hitPaddle(s, who, prevY) {
  const b = s.ball;
  const p = s[who];
  const towards = who === "player" ? b.vy > 0 : b.vy < 0;
  if (!towards) return false;
  const y = face(s, who);
  const crossed = who === "player" ? prevY <= y && b.y >= y : prevY >= y && b.y <= y;
  const reach = PONG.paddleW / 2 + PONG.ballR;
  if (!crossed || Math.abs(b.x - p.x) > reach) return false;
  const offset = clamp((b.x - p.x) / reach, -1, 1);
  const speed = Math.min(cfg(s).maxSpeed, Math.hypot(b.vx, b.vy) * cfg(s).speedUp);
  Object.assign(b, bounce(speed, offset, who === "player"), { y });
  s.hits++;
  if (who === "player") planCpu(s);
  return true;
}

function stepOnce(s, dt, level, theirLevel, events) {
  s.player.x = smoothToward(s.player.x, levelToPaddleX(level), dt, PONG.playerTauS);
  if (theirLevel == null) moveCpu(s, dt);
  else s.cpu.x = smoothToward(s.cpu.x, levelToPaddleX(theirLevel), dt, PONG.playerTauS);
  if (s.phase === "serve") {
    s.serveIn -= dt;
    if (s.serveIn <= 0) serve(s);
    return;
  }
  if (s.phase !== "play") return;
  const b = s.ball;
  const prevY = b.y;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  const r = PONG.ballR;
  if (b.x < r || b.x > s.w - r) {
    b.x = b.x < r ? 2 * r - b.x : 2 * (s.w - r) - b.x;
    b.vx = -b.vx;
    events.push("wall");
  }
  if (hitPaddle(s, "player", prevY) || hitPaddle(s, "cpu", prevY)) events.push("hit");
  const out = b.y - r > s.h ? "cpu" : b.y + r < 0 ? "player" : null;
  if (!out) return;
  s[out].score++;
  events.push(out === "player" ? "point" : "miss");
  if (s[out].score >= PONG.winScore) {
    s.phase = "over";
    events.push(out === "player" ? "won" : "lost");
    return;
  }
  s.phase = "serve";
  s.serveIn = PONG.serveDelayS;
  s.serveTo = out === "player" ? "cpu" : "player"; // towards whoever lost the point
  s.ball = { x: s.w / 2, y: s.h / 2, vx: 0, vy: 0 };
}

// Advances the game by dt seconds with the player's level (0..1); `theirLevel` moves the
// top paddle for a second player (else the computer plays it). Returns the events of
// this step: "wall", "hit", "point" (you scored), "miss", "won", "lost".
export function stepPong(s, dt, level, theirLevel = null) {
  const events = [];
  substeps(dt, PONG.maxStepS, (d) => stepOnce(s, d, level, theirLevel, events));
  return events;
}

// Two phones: the host runs the game (the guest's level moves the top paddle) and sends
// pongSnapshot() ~30 times a second. The guest turns the field round (mirrorPong: its
// paddle at the bottom; left and right stay, so 0 kg is the left edge on both phones)
// and moves the ball on between snapshots (coastPong) so it doesn't stutter.
export function pongSnapshot(s) {
  const { player, cpu, ball, phase } = s;
  return { player: { x: player.x, score: player.score }, cpu: { x: cpu.x, score: cpu.score }, ball: { ...ball }, phase };
}

export function mirrorPong(snap, h) {
  const b = snap.ball;
  return {
    ...snap,
    player: { ...snap.cpu },
    cpu: { ...snap.player },
    ball: { x: b.x, y: h - b.y, vx: b.vx, vy: -b.vy },
  };
}

export function coastPong(s, dt, level) {
  s.player.x = smoothToward(s.player.x, levelToPaddleX(level), dt, PONG.playerTauS);
  if (s.phase !== "play") return;
  const b = s.ball;
  const r = PONG.ballR;
  b.x += b.vx * dt;
  b.y = clamp(b.y + b.vy * dt, -r, s.h + r);
  if (b.x < r || b.x > s.w - r) {
    b.x = b.x < r ? 2 * r - b.x : 2 * (s.w - r) - b.x;
    b.vx = -b.vx;
  }
}

// Paints the field. `c` holds theme colours ({bg, text, muted, accent, border}); the field
// is fitted into the canvas (css px w × h) and centred.
export function drawPong(ctx, s, c, cssW, cssH) {
  const scale = Math.min(cssW / s.w, cssH / s.h);
  const ox = (cssW - s.w * scale) / 2;
  const oy = (cssH - s.h * scale) / 2;
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, s.w, s.h);
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 1 / scale;
  ctx.strokeRect(0, 0, s.w, s.h);

  // Centre line and the scores, faint behind the play.
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(0, s.h / 2);
  ctx.lineTo(s.w, s.h / 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = c.border;
  ctx.font = `700 22px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(s.cpu.score), s.w / 2, s.h / 4);
  ctx.fillText(String(s.player.score), s.w / 2, (s.h * 3) / 4);

  const paddle = (who, color) => {
    ctx.fillStyle = color;
    roundRect(ctx, s[who].x - PONG.paddleW / 2, paddleY(s, who) - PONG.paddleH / 2, PONG.paddleW, PONG.paddleH, PONG.paddleH / 2);
  };
  paddle("cpu", c.muted);
  paddle("player", c.accent);
  if (s.phase === "play") {
    ctx.fillStyle = c.text;
    ctx.beginPath();
    ctx.arc(s.ball.x, s.ball.y, PONG.ballR, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}
