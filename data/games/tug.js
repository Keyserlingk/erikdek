// Tug of war, portrait: a rope from the opponent (top) to you (bottom) with a knot in the
// middle. Each side pulls on its own sensor; the knot moves towards whoever pulls harder,
// the faster the bigger the difference. Reaching your end wins the round; a round lasts at
// most TUG.roundS, then the side the knot is on wins it. First to TUG.winRounds rounds.
//
// Both pulls are compared on one scale chosen per game (SCALES): kg, % of bodyweight or %
// of each player's own max pull. Each player's force is put on that scale with their own
// bodyweight / max (toScale) before it reaches the game, so stepTug() only sees two
// comparable numbers. stepTug() is pure (no DOM, no clock); drawTug() paints a state.
//
// The opponent is a source of levels on the same scale: cpuOpponent() now. For multiplayer
// the host phone runs stepTug() with its own level and the latest level received from the
// other phone (~30/s, 50–150 ms old; a short delay only shifts the fight a little since the
// knot moves slowly) and sends the knot position, phase and rounds back ~30 times a second.
// The guest only draws what the host sends (with `you` mirrored: x → -x), so there is one
// knot and one winner. The guest's level is normalised on the guest's phone (its own
// bodyweight / max), so the host never needs the guest's numbers.

import { clamp, roundRect, seededRandom, smoothToward } from "./common.js";

export const TUG = {
  roundS: 30, // most a round lasts; then the knot's side wins it
  winRounds: 2, // best of 3
  countdownS: 3, // "3, 2, 1, pull" before each round
  breakS: 5, // rest between rounds, with the round's result
  drawZone: 0.03, // knot this close to the middle at the time limit: the round is replayed
  maxSpeed: 0.6, // rope halves per second at (or above) a full-span difference
  power: 1.2, // > 1: small differences move it a bit less than in proportion
  tauS: 0.12, // light smoothing of both pulls
};

// The scales a game can be played on. `span`: the difference that moves the knot at full
// speed; about 15 kg for a 75 kg climber with a 60 kg max on every scale.
export const SCALES = {
  kg: { name: "kg", unit: "kg", span: 15 },
  bw: { name: "% BW", unit: "% BW", span: 20 },
  max: { name: "% max", unit: "% max", span: 25 },
};
export const SCALE_IDS = Object.keys(SCALES);

// The computer's strength as a share of your max pull.
export const TUG_LEVELS = { easy: 0.3, normal: 0.45, hard: 0.6 };

// A force in kg on a scale; null when the scale needs a bodyweight or max that isn't known.
export function toScale(kg, scale, { bodyweightKg, maxKg } = {}) {
  const f = Math.max(0, Number.isFinite(kg) ? kg : 0);
  if (scale === "bw") return bodyweightKg > 0 ? (100 * f) / bodyweightKg : null;
  if (scale === "max") return maxKg > 0 ? (100 * f) / maxKg : null;
  return f;
}

// Knot speed (rope halves per second, + = towards you) for your level minus theirs.
export function knotSpeed(diff, scale) {
  const span = SCALES[scale]?.span ?? SCALES.kg.span;
  const share = Math.min(1, Math.abs(diff) / span);
  return Math.sign(diff) * TUG.maxSpeed * share ** TUG.power;
}

// x: the knot, -1 = their end (top), +1 = yours (bottom).
export function newTug({ scale = "kg" } = {}) {
  return {
    scale: SCALES[scale] ? scale : "kg",
    x: 0,
    phase: "ready", // ready (countdown) | pull | break (between rounds) | over
    t: TUG.countdownS, // countdown, time left in the round, or rest left
    roundS: 0, // time pulled in this round
    round: 1,
    you: { level: 0, rounds: 0 },
    them: { level: 0, rounds: 0 },
    last: null, // the last round: { winner: "you" | "them" | null (replayed), s }
    fastestWinS: null, // your quickest round win in this game
  };
}

function endRound(s, winner, events) {
  s.last = { winner, s: s.roundS };
  if (!winner) {
    events.push("draw");
  } else {
    s[winner].rounds++;
    if (winner === "you") s.fastestWinS = s.fastestWinS == null ? s.roundS : Math.min(s.fastestWinS, s.roundS);
    events.push(winner === "you" ? "roundWon" : "roundLost");
    if (s[winner].rounds >= TUG.winRounds) {
      s.phase = "over";
      events.push(winner === "you" ? "won" : "lost");
      return;
    }
    s.round++;
  }
  s.phase = "break";
  s.t = TUG.breakS;
}

// Advances the game by dt seconds with your level and theirs, both on the game's scale.
// Returns the events of this step: "count" (each countdown second), "go", "roundWon",
// "roundLost", "draw" (round replayed), "won", "lost".
export function stepTug(s, dt, yourLevel, theirLevel) {
  const events = [];
  if (s.phase === "over") return events;
  s.you.level = smoothToward(s.you.level, Math.max(0, yourLevel || 0), dt, TUG.tauS);
  s.them.level = smoothToward(s.them.level, Math.max(0, theirLevel || 0), dt, TUG.tauS);
  const before = s.t;
  s.t -= dt;
  if (s.phase === "break") {
    if (s.t <= 0) [s.phase, s.t, s.x] = ["ready", TUG.countdownS, 0];
    return events;
  }
  if (s.phase === "ready") {
    if (s.t <= 0) {
      [s.phase, s.t, s.roundS] = ["pull", TUG.roundS, 0];
      events.push("go");
    } else if (Math.ceil(s.t) < Math.ceil(before)) events.push("count");
    return events;
  }
  // Pulling.
  s.roundS += dt;
  s.x = clamp(s.x + knotSpeed(s.you.level - s.them.level, s.scale) * dt, -1, 1);
  if (s.x >= 1) endRound(s, "you", events);
  else if (s.x <= -1) endRound(s, "them", events);
  else if (s.t <= 0) endRound(s, Math.abs(s.x) < TUG.drawZone ? null : s.x > 0 ? "you" : "them", events);
  return events;
}

// The computer: pulls around `strengthKg` in waves. Each round it is in a slightly
// different form (±form), ramps up at the start, surges now and then (+surge for ~1 s),
// sags for a moment after each surge while it recovers, digs in when it is about to lose,
// wobbles and tires the longer it pulls (down to 1 - fatigue); the rests between rounds
// give part of that back. Its force goes through `toLevel` (kg → the game's scale) like
// yours, so it fits any scale. next(s, dt) is called once per frame before stepTug() and
// returns its level.
export const CPU = {
  rampTauS: 0.3,
  form: 0.12,
  surge: 0.35,
  surgeS: [0.8, 1.5],
  surgeEveryS: [3, 6],
  sag: 0.15,
  sagS: 1,
  digIn: 0.15, // extra at the very end of the rope (from half way to your end)
  wobble: 0.08,
  wobbleS: [0.3, 1.2],
  fatigue: 0.2,
  fatigueTauS: 30,
  recoverTauS: 10,
};

export function cpuOpponent({ strengthKg, toLevel = (kg) => kg, random = Math.random }) {
  const range = ([a, b]) => a + random() * (b - a);
  const c = { kg: 0, pulledS: 0, form: 1, surgeIn: range(CPU.surgeEveryS), surge: 0, sag: 0, wobble: 0, wobbleIn: 0, pulling: false };
  return {
    get kg() {
      return c.kg;
    },
    next(s, dt) {
      if (s.phase !== "pull") {
        c.pulling = false;
        c.pulledS *= Math.exp(-dt / CPU.recoverTauS);
        c.kg = smoothToward(c.kg, 0, dt, CPU.rampTauS);
        return toLevel(c.kg);
      }
      if (!c.pulling) [c.pulling, c.form] = [true, 1 + (random() * 2 - 1) * CPU.form];
      c.pulledS += dt;
      if (c.surge > 0) {
        c.surge -= dt;
        if (c.surge <= 0) c.sag = CPU.sagS;
      } else if (c.sag > 0) c.sag -= dt;
      else if ((c.surgeIn -= dt) <= 0) [c.surge, c.surgeIn] = [range(CPU.surgeS), range(CPU.surgeEveryS)];
      if ((c.wobbleIn -= dt) <= 0) [c.wobble, c.wobbleIn] = [(random() * 2 - 1) * CPU.wobble, range(CPU.wobbleS)];
      const tired = 1 - CPU.fatigue * (1 - Math.exp(-c.pulledS / CPU.fatigueTauS));
      const digIn = CPU.digIn * clamp((s.x - 0.5) / 0.5, 0, 1);
      const boost = (c.surge > 0 ? CPU.surge : 0) - (c.sag > 0 ? CPU.sag : 0) + digIn + c.wobble;
      c.kg = smoothToward(c.kg, strengthKg * c.form * tired * (1 + boost), dt, CPU.rampTauS);
      return toLevel(c.kg);
    },
  };
}

// Two phones: the host runs the game and sends tugSnapshot() ~30 times a second; the
// guest shows it from its side (mirrorTug: its own end at the bottom).
export function tugSnapshot(s) {
  const { x, phase, t, roundS, round, you, them, last } = s;
  return { x, phase, t, roundS, round, you: { ...you }, them: { ...them }, last };
}

export function mirrorTug(snap) {
  const swap = { you: "them", them: "you" };
  return {
    ...snap,
    x: -snap.x,
    you: { ...snap.them },
    them: { ...snap.you },
    last: snap.last && { ...snap.last, winner: swap[snap.last.winner] ?? null },
  };
}

// Same seed, same computer (tests).
export const seededCpu = (opts, seed) => cpuOpponent({ ...opts, random: seededRandom(seed) });

const fmt = (v) => (v >= 100 ? Math.round(v).toString() : v.toFixed(1));

// Paints the game. `c` holds theme colours ({bg, text, muted, accent, bad, border});
// `names`: { you, them } labels. Sizes in css px.
export function drawTug(ctx, s, c, w, h, { names = { you: "You", them: "CPU" } } = {}) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, w, h);
  const unit = SCALES[s.scale].unit;
  const pad = 14;
  const head = 64; // the pull bars at the top and bottom
  const ropeTop = head + 22;
  const ropeBottom = h - head - 22;
  const mid = (ropeTop + ropeBottom) / 2;
  const half = (ropeBottom - ropeTop) / 2;
  const cx = w / 2;
  const knotY = mid + s.x * half;

  // Both pulls on one axis, so the longer bar is the one winning.
  const barMax = Math.max(SCALES[s.scale].span * 2, s.you.level, s.them.level) * 1.1;
  const leading = s.you.level - s.them.level;
  const side = (who, y, color) => {
    const p = s[who];
    ctx.fillStyle = c.text;
    ctx.font = "600 15px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(names[who], pad, y);
    ctx.textAlign = "right";
    ctx.font = "700 17px system-ui, sans-serif";
    ctx.fillText(`${fmt(p.level)} ${unit}`, w - pad, y);
    // Round pips next to the name.
    ctx.font = "15px system-ui, sans-serif";
    const nameW = ctx.measureText(names[who]).width;
    for (let i = 0; i < TUG.winRounds; i++) {
      ctx.beginPath();
      ctx.arc(pad + nameW + 18 + i * 14, y, 4.5, 0, 2 * Math.PI);
      if (i < p.rounds) {
        ctx.fillStyle = color;
        ctx.fill();
      } else {
        ctx.strokeStyle = c.border;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
    const barY = y + 16;
    ctx.fillStyle = c.border;
    roundRect(ctx, pad, barY, w - 2 * pad, 10, 5);
    ctx.fillStyle = color;
    ctx.globalAlpha = (who === "you" ? leading : -leading) >= 0 ? 1 : 0.55;
    roundRect(ctx, pad, barY, ((w - 2 * pad) * clamp(p.level, 0, barMax)) / barMax, 10, 5);
    ctx.globalAlpha = 1;
  };
  side("them", 16, c.muted);
  side("you", h - head + 14, c.accent);

  // End zones: reaching one wins the round.
  const zone = (y, color) => {
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.18;
    ctx.fillRect(pad, y - 10, w - 2 * pad, 20);
    ctx.globalAlpha = 1;
    ctx.fillRect(pad, y - 1, w - 2 * pad, 2);
  };
  zone(ropeTop, c.muted);
  zone(ropeBottom, c.accent);
  ctx.strokeStyle = c.border;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pad, mid);
  ctx.lineTo(w - pad, mid);
  ctx.stroke();
  ctx.setLineDash([]);

  // The rope, with twists, past the ends; it slides with the knot.
  const ropeW = 9;
  ctx.fillStyle = c.muted;
  ctx.fillRect(cx - ropeW / 2, ropeTop - 20, ropeW, ropeBottom - ropeTop + 40);
  ctx.strokeStyle = c.bg;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = 0.5;
  const twist = 8;
  const off = (((s.x * half) % twist) + twist) % twist;
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - ropeW / 2, ropeTop - 20, ropeW, ropeBottom - ropeTop + 40);
  ctx.clip();
  for (let y = ropeTop - 20 - twist + off; y < ropeBottom + 20 + twist; y += twist) {
    ctx.beginPath();
    ctx.moveTo(cx - ropeW / 2, y);
    ctx.lineTo(cx + ropeW / 2, y + twist / 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // The knot with a flag.
  const flagColor = s.phase === "over" ? (s.you.rounds > s.them.rounds ? c.accent : c.muted) : c.bad;
  ctx.fillStyle = flagColor;
  ctx.beginPath();
  ctx.moveTo(cx + 6, knotY - 2);
  ctx.lineTo(cx + 34, knotY - 11);
  ctx.lineTo(cx + 6, knotY - 20);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(cx + 4, knotY - 22, 2.5, 22);
  ctx.beginPath();
  ctx.arc(cx, knotY, 9, 0, 2 * Math.PI);
  ctx.fill();

  // Big text on the left of the rope: countdown, round result, time left.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const tx = (cx - ropeW / 2 + pad) / 2;
  let big = "";
  let small = "";
  if (s.phase === "ready") {
    big = String(Math.ceil(s.t));
    small = `Round ${s.round}`;
  } else if (s.phase === "pull") {
    big = String(Math.ceil(s.t));
    small = s.roundS < 0.8 ? "Pull!" : "s left";
  } else if (s.phase === "break") {
    big = s.last.winner === "you" ? "Round won" : s.last.winner === "them" ? "Round lost" : "Even";
    small = s.last.winner ? `Rest ${Math.ceil(s.t)} s` : "Again";
  }
  if (big) {
    ctx.fillStyle = c.text;
    ctx.font = `700 ${big.length > 2 ? 22 : 40}px system-ui, sans-serif`;
    ctx.fillText(big, tx, mid - 12);
    ctx.fillStyle = c.muted;
    ctx.font = "14px system-ui, sans-serif";
    ctx.fillText(small, tx, mid + 18);
  }
}
