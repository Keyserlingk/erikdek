// Pong for 3 or 4 players, each on their own phone and sensor. Square field, 100 × 100
// units, y down. Sides: 0 = bottom, 1 = right, 2 = top, 3 = left (counter-clockwise as
// seen on screen). Each player owns a side; a side nobody plays, or whose player is out,
// is a wall. The host runs stepPong4() with everyone's levels and sends pong4Snapshot();
// the other phones apply it and coast between snapshots. drawPong4() turns the field so
// the viewer's side is at the bottom.
//
// Each side has its own frame: `a` runs along the side from that player's left to their
// right (as they see it, with their side at the bottom of their screen) and `d` is the
// depth into the field from the side's edge. The physics of paddles and walls is written
// once in that frame. Square blocks fill the corners (PONG4.corner): the paddles stop at
// them, so the ball can't slip out between two paddles' reach.

import { clamp, roundRect, smoothToward, substeps } from "./common.js";
import { PONG_LEVELS } from "./pong.js";

export const PONG4 = {
  size: 100,
  corner: 12, // corner block size
  paddleW: 22,
  paddleH: 3,
  paddleGap: 6, // paddle centre from the edge
  wall: 1.5, // thickness of a wall side
  ballR: 2,
  maxAngle: (60 * Math.PI) / 180, // bounce angle at the paddle's edge
  lives: 5,
  startDelayS: 3,
  serveDelayS: 2,
  playerTauS: 0.05,
  maxStepS: 1 / 240,
};

const N = PONG4.size;
const MID = N / 2;
// Unit vectors per side: along (the player's left → right) and inward (into the field).
const FRAMES = [
  { along: [1, 0], inward: [0, -1] }, // bottom
  { along: [0, -1], inward: [-1, 0] }, // right
  { along: [-1, 0], inward: [0, 1] }, // top
  { along: [0, 1], inward: [1, 0] }, // left
];

// Field point → side frame {a, d}, and back.
export function toLocal(side, x, y) {
  const { along, inward } = FRAMES[side];
  const u = x - MID;
  const v = y - MID;
  return { a: MID + u * along[0] + v * along[1], d: MID + u * inward[0] + v * inward[1] };
}
export function fromLocal(side, a, d) {
  const { along, inward } = FRAMES[side];
  return { x: MID + (a - MID) * along[0] + (d - MID) * inward[0], y: MID + (a - MID) * along[1] + (d - MID) * inward[1] };
}
const velToLocal = (side, vx, vy) => {
  const { along, inward } = FRAMES[side];
  return { va: vx * along[0] + vy * along[1], vd: vx * inward[0] + vy * inward[1] };
};
const velFromLocal = (side, va, vd) => {
  const { along, inward } = FRAMES[side];
  return { vx: va * along[0] + vd * inward[0], vy: va * along[1] + vd * inward[1] };
};

// Paddle centre along its side for a level 0..1: between the corner blocks.
const minA = PONG4.corner + PONG4.paddleW / 2;
const maxA = N - PONG4.corner - PONG4.paddleW / 2;
export const levelToAlong = (level) => minA + clamp(level, 0, 1) * (maxA - minA);
// The paddle centre in field coordinates: level 0 is the player's own left end.
export const levelToSide = (side, level) => fromLocal(side, levelToAlong(level), PONG4.paddleGap);

export function newPong4({ sides = [0, 1, 2, 3], level = "normal", random = Math.random } = {}) {
  return {
    random,
    level: PONG_LEVELS[level] ? level : "normal",
    // Indexed by side; null = nobody plays there (a wall). lives 0 = out (a wall too).
    players: [0, 1, 2, 3].map((side) => (sides.includes(side) ? { a: MID, lives: PONG4.lives } : null)),
    ball: { x: MID, y: MID, vx: 0, vy: 0 },
    phase: "serve", // serve | play | over
    serveIn: PONG4.startDelayS,
    misses: 0,
    hits: 0,
    out: [], // sides in the order they went out
    winner: null,
  };
}

const cfg = (s) => PONG_LEVELS[s.level];
const isIn = (s, side) => (s.players[side]?.lives ?? 0) > 0;
export const pong4Alive = (s) => [0, 1, 2, 3].filter((side) => isIn(s, side));
// Places for the end screen, first to last: the winner, then the others from the last out.
export const pong4Ranking = (s) => [...pong4Alive(s), ...[...s.out].reverse()];

// From the centre towards a random side still in, up to ±22.5° off straight.
function serve(s) {
  const alive = pong4Alive(s);
  const to = alive[Math.floor(s.random() * alive.length)];
  const speed = cfg(s).serveSpeed + cfg(s).serveStep * s.misses;
  const angle = (s.random() - 0.5) * (Math.PI / 4);
  s.ball = { x: MID, y: MID, ...velFromLocal(to, speed * Math.sin(angle), -speed * Math.cos(angle)) };
  s.phase = "play";
}

// Corner blocks as boxes; the ball is pushed out along the shallower overlap and that
// velocity component flips (so speeds along x and y only change at paddles).
const BLOCKS = [
  [0, 0],
  [N - PONG4.corner, 0],
  [0, N - PONG4.corner],
  [N - PONG4.corner, N - PONG4.corner],
];
function hitBlocks(b) {
  const r = PONG4.ballR;
  const C = PONG4.corner;
  let hit = false;
  for (const [bx, by] of BLOCKS) {
    const qx = clamp(b.x, bx, bx + C);
    const qy = clamp(b.y, by, by + C);
    const dx = b.x - qx;
    const dy = b.y - qy;
    if (dx * dx + dy * dy >= r * r) continue;
    // Inside the box or on a face: leave by the nearer face.
    const ox = dx !== 0 ? Math.sign(dx) : b.x < bx + C / 2 ? -1 : 1;
    const oy = dy !== 0 ? Math.sign(dy) : b.y < by + C / 2 ? -1 : 1;
    const penX = ox < 0 ? b.x + r - bx : bx + C - (b.x - r);
    const penY = oy < 0 ? b.y + r - by : by + C - (b.y - r);
    if (penX < penY) {
      b.x = ox < 0 ? bx - r : bx + C + r;
      if (b.vx * ox < 0) b.vx = -b.vx;
    } else {
      b.y = oy < 0 ? by - r : by + C + r;
      if (b.vy * oy < 0) b.vy = -b.vy;
    }
    hit = true;
  }
  return hit;
}

// Wall sides: bounce at the edge. Returns true if it bounced.
function hitWall(b, side) {
  const r = PONG4.ballR;
  const p = toLocal(side, b.x, b.y);
  const v = velToLocal(side, b.vx, b.vy);
  const face = PONG4.wall + r;
  if (p.d >= face || v.vd >= 0) return false;
  Object.assign(b, fromLocal(side, p.a, 2 * face - p.d), velFromLocal(side, v.va, -v.vd));
  return true;
}

// Bounces the ball off the side's paddle if it crossed its face this step; the further
// from the centre it hits, the steeper it leaves (towards that player's right for the right
// end of their paddle).
function hitPaddle(s, side, prev) {
  const b = s.ball;
  const v = velToLocal(side, b.vx, b.vy);
  if (v.vd >= 0) return false;
  const face = PONG4.paddleGap + PONG4.paddleH / 2 + PONG4.ballR;
  const p = toLocal(side, b.x, b.y);
  const was = toLocal(side, prev.x, prev.y);
  const reach = PONG4.paddleW / 2 + PONG4.ballR;
  const off = p.a - s.players[side].a;
  if (!(was.d >= face && p.d <= face) || Math.abs(off) > reach) return false;
  const angle = clamp(off / reach, -1, 1) * PONG4.maxAngle;
  const speed = Math.min(cfg(s).maxSpeed, Math.hypot(b.vx, b.vy) * cfg(s).speedUp);
  Object.assign(b, fromLocal(side, p.a, face), velFromLocal(side, speed * Math.sin(angle), speed * Math.cos(angle)));
  s.hits++;
  return true;
}

function movePaddles(s, dt, levels) {
  for (let side = 0; side < 4; side++) {
    const lv = levels?.[side];
    if (s.players[side] && lv != null) s.players[side].a = smoothToward(s.players[side].a, levelToAlong(lv), dt, PONG4.playerTauS);
  }
}

function stepOnce(s, dt, levels, events) {
  movePaddles(s, dt, levels);
  if (s.phase === "serve") {
    s.serveIn -= dt;
    if (s.serveIn <= 0) serve(s);
    return;
  }
  if (s.phase !== "play") return;
  const b = s.ball;
  const prev = { x: b.x, y: b.y };
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  let wall = hitBlocks(b);
  for (let side = 0; side < 4; side++) {
    if (isIn(s, side)) {
      if (hitPaddle(s, side, prev)) events.push({ type: "hit", side });
    } else if (hitWall(b, side)) wall = true;
  }
  if (wall) events.push({ type: "wall" });
  const missed = [0, 1, 2, 3].find((side) => isIn(s, side) && toLocal(side, b.x, b.y).d < -PONG4.ballR);
  if (missed == null) return;
  const p = s.players[missed];
  p.lives--;
  s.misses++;
  events.push({ type: "miss", side: missed });
  s.ball = { x: MID, y: MID, vx: 0, vy: 0 };
  if (p.lives === 0) {
    s.out.push(missed);
    events.push({ type: "out", side: missed });
    const alive = pong4Alive(s);
    if (alive.length <= 1) {
      s.phase = "over";
      s.winner = alive[0] ?? null;
      events.push({ type: "won", side: s.winner });
      return;
    }
  }
  s.phase = "serve";
  s.serveIn = PONG4.serveDelayS;
}

// Advances the game by dt seconds. `levels` = { [side]: 0..1 } (an array works too); a
// side without a level keeps its paddle where it is. Returns this step's events, plain
// objects so they can go over the network as JSON:
//   { type: "hit", side }  the ball bounced off that side's paddle
//   { type: "wall" }       off a wall side or a corner block
//   { type: "miss", side } that side missed and lost a life
//   { type: "out", side }  ... and has no lives left (its side is a wall from now on)
//   { type: "won", side }  last one in; phase is "over" (side null if nobody is left)
export function stepPong4(s, dt, levels = {}) {
  const events = [];
  substeps(dt, PONG4.maxStepS, (d) => stepOnce(s, d, levels, events));
  return events;
}

// What the host sends ~30 times a second. `alive` is derivable from the lives but saves
// the receivers the work.
export function pong4Snapshot(s) {
  return {
    players: s.players.map((p) => p && { a: p.a, lives: p.lives }),
    ball: { ...s.ball },
    phase: s.phase,
    serveIn: s.serveIn,
    out: [...s.out],
    winner: s.winner,
    alive: pong4Alive(s),
  };
}

// On the other phones: take the host's state, but keep this phone's own paddle (it moves
// with the local force in coastPong4, without the network lag).
export function applyPong4Snapshot(s, snap, ownSide = null) {
  s.players = snap.players.map((p, side) => {
    if (!p) return null;
    const keep = side === ownSide && s.players[side];
    return { a: keep ? s.players[side].a : p.a, lives: p.lives };
  });
  s.ball = { ...snap.ball };
  s.phase = snap.phase;
  s.serveIn = snap.serveIn;
  s.out = [...snap.out];
  s.winner = snap.winner;
  return s;
}

// Between snapshots: moves this phone's paddle with its own level and the ball on, bouncing
// off the corner blocks and wall sides only (paddle hits and misses are the host's call;
// at a side still in the ball waits at the edge).
export function coastPong4(s, dt, ownSide, ownLevel) {
  if (ownSide != null && ownLevel != null) movePaddles(s, dt, { [ownSide]: ownLevel });
  if (s.phase === "serve") s.serveIn = Math.max(0, s.serveIn - dt);
  if (s.phase !== "play") return;
  substeps(dt, PONG4.maxStepS, (d) => {
    const b = s.ball;
    b.x += b.vx * d;
    b.y += b.vy * d;
    hitBlocks(b);
    for (let side = 0; side < 4; side++) {
      if (!isIn(s, side)) hitWall(b, side);
      else {
        const p = toLocal(side, b.x, b.y);
        if (p.d < -PONG4.ballR) Object.assign(b, fromLocal(side, p.a, -PONG4.ballR));
      }
    }
  });
}

// Colours for the other players, the same side → same colour on every phone (your own
// paddle is always the accent). Readable on light and dark backgrounds.
const OTHER_COLORS = (c) => [c.ok, c.bad, "#e08a00", "#9b5de5"];

// Paints the field turned so side `view` is at the bottom. `c` holds theme colours
// ({bg, text, muted, accent, ok, bad, border}, optional `players`: one colour per side);
// `names` = { [side]: name } (an array works too). The square is fitted into the canvas.
export function drawPong4(ctx, s, c, cssW, cssH, { view = 0, names = {} } = {}) {
  const scale = Math.min(cssW / N, cssH / N);
  const ox = (cssW - N * scale) / 2;
  const oy = (cssH - N * scale) / 2;
  // Field point → view point (the viewer's frame, drawn with y down).
  const V = (x, y) => {
    const p = toLocal(view, x, y);
    return { x: p.a, y: N - p.d };
  };
  // A rectangle given in side `side`'s frame, as a view rectangle.
  const rect = (side, a0, a1, d0, d1) => {
    const p = fromLocal(side, a0, d0);
    const q = fromLocal(side, a1, d1);
    const P = V(p.x, p.y);
    const Q = V(q.x, q.y);
    return [Math.min(P.x, Q.x), Math.min(P.y, Q.y), Math.abs(P.x - Q.x), Math.abs(P.y - Q.y)];
  };
  const colors = c.players ?? OTHER_COLORS(c);
  const colorOf = (side) => (side === view ? c.accent : colors[side % colors.length]);

  ctx.clearRect(0, 0, cssW, cssH);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(scale, scale);
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, N, N);
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 1 / scale;
  ctx.strokeRect(0, 0, N, N);

  // Big faint text in the middle: the serve countdown or the winner.
  ctx.fillStyle = c.border;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (s.phase === "serve" && s.serveIn > 0) {
    ctx.font = "700 22px system-ui, sans-serif";
    ctx.fillText(String(Math.ceil(s.serveIn)), MID, MID);
  } else if (s.phase === "over") {
    ctx.font = "700 11px system-ui, sans-serif";
    const text = s.winner == null ? "Game over" : s.winner === view ? "You win" : `${names[s.winner] ?? "Player"} wins`;
    ctx.fillText(text, MID, MID, N - 2 * PONG4.corner);
  }

  // Corner blocks.
  ctx.fillStyle = c.border;
  for (const [bx, by] of BLOCKS) {
    const P = V(bx, by);
    const Q = V(bx + PONG4.corner, by + PONG4.corner);
    ctx.fillRect(Math.min(P.x, Q.x), Math.min(P.y, Q.y), PONG4.corner, PONG4.corner);
  }

  for (let side = 0; side < 4; side++) {
    const p = s.players[side];
    if (!isIn(s, side)) {
      // A wall along the whole side.
      ctx.fillStyle = c.muted;
      ctx.fillRect(...rect(side, 0, N, 0, PONG4.wall));
    } else {
      ctx.fillStyle = colorOf(side);
      const [x, y, w, h] = rect(side, p.a - PONG4.paddleW / 2, p.a + PONG4.paddleW / 2, PONG4.paddleGap - PONG4.paddleH / 2, PONG4.paddleGap + PONG4.paddleH / 2);
      roundRect(ctx, x, y, w, h, PONG4.paddleH / 2);
    }
    if (p) drawLabel(ctx, c, V, side, view, names[side] ?? (side === view ? "You" : `Player ${side + 1}`), p.lives, colorOf(side));
  }

  if (s.phase === "play") {
    const b = V(s.ball.x, s.ball.y);
    ctx.fillStyle = c.text;
    ctx.beginPath();
    ctx.arc(b.x, b.y, PONG4.ballR, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}

// Name and a dot per life, small, just inside the side; an out player's name is faint.
function drawLabel(ctx, c, V, side, view, name, lives, color) {
  const depth = PONG4.paddleGap + 6;
  const f = fromLocal(side, MID, depth);
  const at = V(f.x, f.y);
  const pos = (side - view + 4) % 4; // 0 bottom, 1 right, 2 top, 3 left on this screen
  const align = pos === 1 ? "right" : pos === 3 ? "left" : "center";
  // Left and right labels sit above the middle, clear of the big text there.
  const nameY = pos === 0 ? at.y - 2.2 : pos === 2 ? at.y - 1 : at.y - 12;
  ctx.font = "600 3.6px system-ui, sans-serif";
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillStyle = lives > 0 ? color : c.muted;
  ctx.fillText(lives > 0 ? name : `${name} – out`, at.x, nameY, 34);
  if (lives <= 0) return;
  const r = 0.8;
  const gap = 2.6;
  const width = (PONG4.lives - 1) * gap;
  const x0 = align === "center" ? at.x - width / 2 : align === "left" ? at.x + r : at.x - r - width;
  for (let i = 0; i < PONG4.lives; i++) {
    ctx.beginPath();
    ctx.arc(x0 + i * gap, nameY + 3.6, r, 0, 2 * Math.PI);
    if (i < lives) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = c.border;
      ctx.lineWidth = 0.35;
      ctx.stroke();
    }
  }
}
