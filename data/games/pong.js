// Pong, portrait: your paddle at the bottom, the computer's at the top. The paddle follows
// your pull (0 kg = left edge, full range = right edge). Field units: 100 wide, `h` high,
// y down. stepPong() is pure game logic (no DOM), drawPong() paints a state on a canvas.

import { clamp, roundRect, smoothToward, substeps } from "./common.js";

export const PONG = {
  w: 100,
  paddleW: 24,
  paddleH: 3,
  paddleGap: 6, // paddle centre from the end line
  ballR: 2,
  serveSpeed: 50, // units/s; each point played adds serveStep
  serveStep: 2,
  speedUp: 1.05, // per paddle hit
  maxSpeed: 125,
  maxAngle: (60 * Math.PI) / 180, // bounce angle at the paddle's edge
  winScore: 7,
  serveDelayS: 1,
  playerTauS: 0.05, // light smoothing of the force
  cpuSpeed: 55, // the computer's paddle speed: fast balls at steep angles beat it
  cpuReactAt: 0.5, // the computer starts moving when the ball crosses this share of the field
  cpuError: 0.65, // aim error, as a share of the paddle width (over ~0.58 it misses)
  maxStepS: 1 / 240,
};

const paddleY = (s, who) => (who === "player" ? s.h - PONG.paddleGap : PONG.paddleGap);
// Paddle centre for a level 0..1.
export const levelToPaddleX = (level) => PONG.paddleW / 2 + clamp(level, 0, 1) * (PONG.w - PONG.paddleW);

export function newPong({ h = 150, random = Math.random } = {}) {
  const s = {
    w: PONG.w,
    h,
    random,
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

function serve(s) {
  const points = s.player.score + s.cpu.score;
  const speed = PONG.serveSpeed + PONG.serveStep * points;
  const angle = (s.random() - 0.5) * (Math.PI / 4); // ±22.5°
  const dir = s.serveTo === "player" ? 1 : -1;
  s.ball = { x: s.w / 2, y: s.h / 2, vx: speed * Math.sin(angle), vy: dir * speed * Math.cos(angle) };
  s.phase = "play";
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

function moveCpu(s, dt) {
  const b = s.ball;
  let target = s.w / 2;
  if (s.phase === "play" && b.vy < 0 && b.y < s.h * PONG.cpuReactAt) {
    target = predictX(b, paddleY(s, "cpu") + PONG.paddleH / 2 + PONG.ballR, s.w) + s.cpu.aim;
  }
  const maxMove = PONG.cpuSpeed * dt;
  s.cpu.x = clamp(s.cpu.x + clamp(target - s.cpu.x, -maxMove, maxMove), PONG.paddleW / 2, s.w - PONG.paddleW / 2);
}

// Bounces the ball off a paddle it is crossing; the further from the centre it hits, the
// steeper it leaves.
function hitPaddle(s, who, prevY) {
  const b = s.ball;
  const p = s[who];
  const py = paddleY(s, who);
  const towards = who === "player" ? b.vy > 0 : b.vy < 0;
  if (!towards) return false;
  const face = who === "player" ? py - PONG.paddleH / 2 - PONG.ballR : py + PONG.paddleH / 2 + PONG.ballR;
  const crossed = who === "player" ? prevY <= face && b.y >= face : prevY >= face && b.y <= face;
  const reach = PONG.paddleW / 2 + PONG.ballR;
  if (!crossed || Math.abs(b.x - p.x) > reach) return false;
  const offset = clamp((b.x - p.x) / reach, -1, 1);
  const speed = Math.min(PONG.maxSpeed, Math.hypot(b.vx, b.vy) * PONG.speedUp);
  const angle = offset * PONG.maxAngle;
  b.vx = speed * Math.sin(angle);
  b.vy = (who === "player" ? -1 : 1) * speed * Math.cos(angle);
  b.y = face;
  s.hits++;
  // A fresh aim error each time the player returns the ball: sometimes the computer is off.
  if (who === "player") s.cpu.aim = (s.random() * 2 - 1) * PONG.cpuError * PONG.paddleW;
  return true;
}

function stepOnce(s, dt, level, events) {
  s.player.x = smoothToward(s.player.x, levelToPaddleX(level), dt, PONG.playerTauS);
  moveCpu(s, dt);
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

// Advances the game by dt seconds with the player's level (0..1). Returns the events of
// this step: "wall", "hit", "point" (you scored), "miss", "won", "lost".
export function stepPong(s, dt, level) {
  const events = [];
  substeps(dt, PONG.maxStepS, (d) => stepOnce(s, d, level, events));
  return events;
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
