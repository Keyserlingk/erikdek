// Play tab: mini games steered by your pull (games/*.js). The home screen lists the games
// with their best score and full range (the force that maps to the top or right edge; Tug
// of war has a scale and your max pull instead);
// a game runs on a canvas with Pause and Quit. Without a sensor, press and drag on the
// game instead. With a friend (playduel.js) the host's Play starts the game on both phones;
// each game's `duel` part says what goes between them (see the messages in playduel.js).
// Two-phone games don't pause and don't count towards the solo results.

import { tone, unlockAudio } from "./audio.js";
import { device } from "./device.js";
import { clamp, forceToLevel, mirrorEvent } from "./games/common.js";
import { drawFlappy, flappyDuelResult, newFlappy, stepFlappy } from "./games/flappy.js";
import {
  MAX_KG,
  bestMaxPullKg,
  fullRangeKg,
  loadPlayData,
  recordFlappy,
  recordPong,
  recordTug,
  savePlayData,
  stepRange,
  tugMaxKg,
  tugScale,
} from "./games/playdata.js";
import { LEVEL_IDS, PONG, coastPong, drawPong, mirrorPong, newPong, pongSnapshot, stepPong } from "./games/pong.js";
import { SCALES, SCALE_IDS, TUG, TUG_LEVELS, cpuOpponent, drawTug, mirrorTug, newTug, stepTug, toScale, tugSnapshot } from "./games/tug.js";
import { duel, duelCard } from "./playduel.js";
import { profiles } from "./profiles.js";
import { sessions } from "./sessions.js";
import { settings } from "./settingsstore.js";
import { $, button, create } from "./ui.js";
import { allowScreenOff, keepScreenOn } from "./wakelock.js";

const el = {
  home: $("playHome"),
  cards: $("playCards"),
  game: $("playGame"),
  score: $("playScore"),
  kg: $("playKg"),
  pause: $("playPause"),
  quit: $("playQuit"),
  stage: $("playStage"),
  canvas: $("playCanvas"),
  overlay: $("playOverlay"),
  overlayTitle: $("playOverlayTitle"),
  overlayText: $("playOverlayText"),
  overlayActions: $("playOverlayActions"),
};

const GAMES = {
  pong: {
    name: "Pong",
    about: "Pull to move your paddle: no load is the left edge, full range the right. First to 7 wins.",
    create: (w, h, d) => newPong({ h: clamp((PONG.w * h) / w, 120, 200), level: d.level }),
    step: (s, dt, level) => stepPong(s, dt, level), // the computer plays the top paddle
    draw: drawPong,
    isOver: (s) => s.phase === "over",
    scoreText: (s) => `You ${s.player.score} – ${s.cpu.score} CPU`,
    // Results of the chosen difficulty.
    bestText: ({ results, level }) => {
      const r = results[level];
      return r.played ? `${r.wins} of ${r.played} won` + (r.best ? ` · best ${r.best.you}–${r.best.cpu}` : "") : "Not played yet";
    },
    levels: { easy: "Easy", normal: "Normal", hard: "Hard" },
    // Touch: the paddle follows your finger across, and stays when you let go.
    touchLevel: (fx) => (fx * PONG.w - PONG.paddleW / 2) / (PONG.w - PONG.paddleW),
    holdTouch: true,
    record(data, s) {
      const { score: you } = s.player;
      const { score: cpu } = s.cpu;
      const newBest = recordPong(data, s.level, you, cpu);
      return {
        title: you > cpu ? "You won!" : "Computer wins",
        text: `${you} – ${cpu} · ${this.levels[s.level]}` + (newBest ? " · new best" : ""),
      };
    },
    sounds: { hit: [660, 0.05], wall: [440, 0.03], point: [880, 0.15], miss: [220, 0.25] },
    // The host runs the ball; the guest's paddle is the top one on the host's phone.
    duel: {
      opts: (d, w, h) => ({ level: d.level, h: clamp((PONG.w * h) / w, 120, 200) }),
      create: (o) => newPong({ h: o.h, level: o.level }),
      step(s, dt, level, r) {
        r.net.mine = level;
        if (r.net.role === "host") return stepPong(s, dt, level, r.net.theirs ?? 0.5);
        coastPong(s, dt, level);
        return [];
      },
      outgoing: (s, r) => (r.net.role === "host" ? { snap: pongSnapshot(s) } : { v: r.net.mine }),
      incoming(s, d, ev, r) {
        if (r.net.role === "host") {
          r.net.theirs = d.v;
          return [];
        }
        const m = mirrorPong(d.snap, s.h);
        Object.assign(s, m, { player: { ...m.player, x: s.player.x } }); // own paddle stays as you pull
        return ev.map(mirrorEvent);
      },
      isOver: (s) => s.phase === "over",
      scoreText: (s, r) => `You ${s.player.score} – ${s.cpu.score} ${r.net.peerName}`,
      result: (s, r) => ({
        won: s.player.score > s.cpu.score,
        text: `${s.player.score} – ${s.cpu.score} · ${GAMES.pong.levels[r.opts.level]}`,
      }),
    },
  },
  flappy: {
    name: "Flappy",
    about: "The bird's height follows your pull: no load is the bottom, full range the top. Hold the load that fits each gap.",
    create: (w, h) => newFlappy({ w: (100 * w) / h }),
    step: (s, dt, level) => stepFlappy(s, dt, level),
    draw: drawFlappy,
    isOver: (s) => s.over,
    scoreText: (s) => `Score ${s.score}`,
    bestText: (d) => (d.played ? `Best ${d.best}` : "Not played yet"),
    // Touch: the bird follows your finger up and down, and drops when you let go.
    touchLevel: (fx, fy) => 1 - fy,
    holdTouch: false,
    record(data, s) {
      const newBest = recordFlappy(data, s.score);
      return { title: "Crashed", text: `${s.score} pipe${s.score === 1 ? "" : "s"}` + (newBest ? " · new best" : "") };
    },
    sounds: { pass: [880, 0.06], crash: [180, 0.3] },
    // Both fly the same course on their own phone; the friend's bird is drawn faintly.
    duel: {
      opts: () => ({ seed: Math.floor(Math.random() * 2 ** 31), w: 80 }), // 80: wider than a phone held upright
      create: (o) => newFlappy({ w: o.w, seed: o.seed }),
      step: (s, dt, level) => stepFlappy(s, dt, level),
      outgoing: (s) => ({ y: s.bird.y, score: s.score, over: s.over, t: s.t }),
      incoming(s, d, ev, r) {
        r.net.them = d;
        return [];
      },
      isOver: (s, r) => s.over && Boolean(r.net.them?.over),
      scoreText: (s, r) => `You ${s.score} · ${r.net.peerName} ${r.net.them?.score ?? 0}` + (s.over && !r.net.them?.over ? " · still flying" : ""),
      drawOpts: (r) => ({ ghost: r.net.them }),
      result(s, r) {
        const them = r.net.them;
        const outcome = flappyDuelResult({ score: s.score, t: s.t }, them);
        return { won: outcome === "won", draw: outcome === "draw", text: `${s.score} – ${them.score} pipes` };
      },
    },
  },
  tug: {
    name: "Tug of war",
    about: `Pull harder than the computer to drag the flag to your end; the bigger the difference, the faster it moves. Rounds last up to ${TUG.roundS} s, best of 3.`,
    // Both pulls go on the chosen scale with your bodyweight and max. The opponent is
    // anything with next(state, dt) → its level on that scale: the computer here; in
    // multiplayer the host would plug in the other phone's latest level instead (normalised
    // on that phone) and send the knot back (see games/tug.js).
    prepare(d) {
      const bodyweightKg = settings.values.bodyweightKg;
      const maxKg = tugMaxKg(d, sessions.index);
      const scale = tugScale(d, bodyweightKg);
      const toLevel = (kg) => toScale(kg, scale, { bodyweightKg, maxKg }) ?? 0;
      const opponent = cpuOpponent({ strengthKg: TUG_LEVELS[d.level] * maxKg, toLevel });
      return { fullKg: maxKg, scale, level: d.level, toLevel, opponent };
    },
    create: (w, h, d, r) => newTug({ scale: r.scale }),
    usesKg: true,
    step: (s, dt, kg, r) => stepTug(s, dt, r.toLevel(kg), r.opponent.next(s, dt)),
    draw: drawTug,
    isOver: (s) => s.phase === "over",
    scoreText: (s) => `You ${s.you.rounds} – ${s.them.rounds} CPU`,
    bestText: ({ results, level }) => {
      const r = results[level];
      return r.played ? `${r.wins} of ${r.played} won` + (r.fastestS ? ` · fastest round ${r.fastestS.toFixed(1)} s` : "") : "Not played yet";
    },
    levels: { easy: "Easy", normal: "Normal", hard: "Hard" },
    rows: (id) => [scaleRow(id), maxRow(id)],
    // Touch: the lower your finger, the harder you pull (bottom = your max).
    touchLevel: (fx, fy) => fy,
    holdTouch: false,
    record(data, s, r) {
      const won = s.you.rounds > s.them.rounds;
      const newBest = recordTug(data, r.level, won, s.fastestWinS);
      return {
        title: won ? "You won!" : "Computer wins",
        text: `${s.you.rounds} – ${s.them.rounds} · ${this.levels[r.level]}` + (newBest ? ` · fastest round ${s.fastestWinS.toFixed(1)} s` : ""),
      };
    },
    sounds: { count: [440, 0.08], go: [880, 0.2], roundWon: [880, 0.15], roundLost: [220, 0.25], draw: [440, 0.15] },
    // The host runs the knot with both levels, each put on the scale on its own phone
    // (own bodyweight and max), and sends the state; the guest shows it from its end.
    duel: {
      // % BW needs both bodyweights (else kg).
      opts: (d) => ({ scale: tugScale(d, duel.phase !== "open" || duel.peer?.bodyweight ? settings.values.bodyweightKg : 0) }),
      prepare(o) {
        const bodyweightKg = settings.values.bodyweightKg;
        const maxKg = tugMaxKg(data.tug, sessions.index);
        return { fullKg: maxKg, toLevel: (kg) => toScale(kg, o.scale, { bodyweightKg, maxKg }) ?? 0 };
      },
      create: (o) => newTug({ scale: o.scale }),
      usesKg: true,
      step(s, dt, kg, r) {
        r.net.mine = r.toLevel(kg);
        return r.net.role === "host" ? stepTug(s, dt, r.net.mine, r.net.theirs ?? 0) : [];
      },
      outgoing: (s, r) => (r.net.role === "host" ? { snap: tugSnapshot(s) } : { v: r.net.mine }),
      incoming(s, d, ev, r) {
        if (r.net.role === "host") {
          r.net.theirs = d.v;
          return [];
        }
        Object.assign(s, mirrorTug(d.snap));
        return ev.map(mirrorEvent);
      },
      isOver: (s) => s.phase === "over",
      scoreText: (s, r) => `You ${s.you.rounds} – ${s.them.rounds} ${r.net.peerName}`,
      drawOpts: (r) => ({ names: { you: "You", them: r.net.peerName } }),
      result: (s, r) => ({ won: s.you.rounds > s.them.rounds, text: `${s.you.rounds} – ${s.them.rounds} · ${SCALES[r.opts.scale].name}` }),
    },
  },
};

let data = null; // play data of the active profile (games/playdata.js)
let run = null; // { id, game, s, profileId, fullKg, paused, ended, raf, last }
let colors = null;
const input = { kg: 0, kgAt: 0, touching: false, touchLevel: 0 };
const view = { w: 0, h: 0, dpr: 1 };
const MIN_STAGE_PX = 280;

const storage = () => {
  try {
    return localStorage;
  } catch {
    return { getItem: () => null, setItem() {}, removeItem() {} };
  }
};

function loadData() {
  data = loadPlayData(storage(), profiles.activeId);
}

function saveData(profileId = profiles.activeId) {
  savePlayData(storage(), profileId, data);
}

// ---- Home screen ----

function rangeRow(id) {
  const range = data[id].range;
  const bw = settings.values.bodyweightKg;
  const fullKg = fullRangeKg(range, bw);
  const change = (next) => {
    data[id].range = next;
    saveData();
    renderHome();
  };
  const unitButton = (unit, text) => {
    const b = button(range.unit === unit ? "active" : "", text, () => change({ ...range, unit }));
    if (unit === "bw" && !(bw > 0)) {
      b.disabled = true;
      b.title = "Set your bodyweight in Settings first";
    }
    return b;
  };
  const value = range.unit === "bw" && bw > 0 ? `${range.pct} % BW` : `${range.kg} kg`;
  return create("div", { className: "play-range" }, [
    create("span", { className: "muted", textContent: "Full range" }),
    button("pill-button step", "−", () => change(stepRange(range, -1))),
    create("strong", { className: "play-range-value", textContent: value }),
    button("pill-button step", "+", () => change(stepRange(range, 1))),
    create("div", { className: "segmented" }, [unitButton("kg", "kg"), unitButton("bw", "% BW")]),
    ...(range.unit === "bw" && bw > 0
      ? [create("span", { className: "muted play-range-kg", textContent: `= ${fullKg.toFixed(1)} kg at ${bw} kg` })]
      : []),
  ]);
}

// Difficulty (Pong): how fast the ball gets and how well the computer plays.
function levelRow(id, names) {
  const pick = (level) => {
    data[id].level = level;
    saveData();
    renderHome();
  };
  return create("div", { className: "play-range" }, [
    create("span", { className: "muted", textContent: "Difficulty" }),
    create(
      "div",
      { className: "segmented" },
      LEVEL_IDS.map((l) => button(data[id].level === l ? "active" : "", names[l], () => pick(l))),
    ),
  ]);
}

// Tug of war: what counts as pulling harder.
function scaleRow(id) {
  const d = data[id];
  const bw = settings.values.bodyweightKg;
  const scale = GAMES.tug.duel.opts(d).scale;
  const pick = (next) => {
    d.scale = next;
    saveData();
    renderHome();
  };
  const buttons = SCALE_IDS.map((sc) => {
    const b = button(scale === sc ? "active" : "", SCALES[sc].name, () => pick(sc));
    if (sc === "bw" && !(bw > 0)) {
      b.disabled = true;
      b.title = "Set your bodyweight in Settings first";
    } else if (sc === "bw" && duel.phase === "open" && duel.peer && !duel.peer.bodyweight) {
      b.disabled = true;
      b.title = `${duel.peerName} has no bodyweight set`;
    }
    return b;
  });
  const what = { kg: "Pulls compared in kg.", bw: `Pulls compared as % of bodyweight (${bw} kg).`, max: "Pulls compared as % of each player's max pull." };
  return create("div", { className: "play-range" }, [
    create("span", { className: "muted", textContent: "Scale" }),
    create("div", { className: "segmented" }, buttons),
    create("span", { className: "muted play-range-kg", textContent: what[scale] }),
  ]);
}

// Tug of war: your max pull sets the computer's strength (and the % max scale). From your
// best Max pull test, else typed in here.
function maxRow(id) {
  const d = data[id];
  const tested = bestMaxPullKg(sessions.index);
  const maxKg = tugMaxKg(d, sessions.index);
  const cpuKg = TUG_LEVELS[d.level] * maxKg;
  const cpuText = `The computer pulls about ${Math.round(TUG_LEVELS[d.level] * 100)} % of it (${cpuKg.toFixed(0)} kg), in waves.`;
  if (tested != null) {
    return create("div", { className: "play-range" }, [
      create("span", { className: "muted", textContent: "Your max" }),
      create("strong", { className: "play-range-value", textContent: `${maxKg.toFixed(1)} kg` }),
      create("span", { className: "muted", textContent: "from Max pull test" }),
      create("span", { className: "muted play-range-kg", textContent: cpuText }),
    ]);
  }
  const change = (dir) => {
    d.maxKg = clamp(d.maxKg + dir * MAX_KG.step, MAX_KG.min, MAX_KG.max);
    saveData();
    renderHome();
  };
  return create("div", { className: "play-range" }, [
    create("span", { className: "muted", textContent: "Your max" }),
    button("pill-button step", "−", () => change(-1)),
    create("strong", { className: "play-range-value", textContent: `${d.maxKg} kg` }),
    button("pill-button step", "+", () => change(1)),
    create("span", { className: "muted play-range-kg", textContent: `No Max pull test yet: set your best pull here. ${cpuText}` }),
  ]);
}

function renderHome() {
  loadData();
  const withFriend = duel.phase === "open";
  // A guest waits for the host to pick.
  const games = withFriend && duel.role === "guest" ? [] : Object.entries(GAMES);
  el.cards.replaceChildren(
    duelCard(),
    ...games.map(([id, g]) =>
      create("div", { className: "card play-card" }, [
        create("div", { className: "routine-head" }, [
          create("h2", { textContent: g.name }),
          create("span", { className: "muted", textContent: g.bestText(data[id]) }),
        ]),
        create("p", { className: "muted", textContent: g.about }),
        ...(g.levels ? [levelRow(id, g.levels)] : []),
        ...(g.rows ? g.rows(id) : [rangeRow(id)]),
        create("div", { className: "actions" }, [
          withFriend ? button("primary", `Play with ${duel.peerName}`, () => hostDuel(id)) : button("primary", "Play", () => start(id)),
        ]),
      ]),
    ),
  );
}

// ---- Running a game ----

function readColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  colors = {
    bg: v("--surface"),
    text: v("--text"),
    muted: v("--muted"),
    accent: v("--accent"),
    ok: v("--ok"),
    bad: v("--bad"),
    border: v("--border"),
  };
}

// The stage fills the screen down to the tabs, below whatever is above it (a sensor
// warning comes and goes).
function fitStage() {
  if (el.game.hidden) return;
  const top = el.stage.getBoundingClientRect().top + window.scrollY;
  const tabs = document.querySelector(".tabs").offsetHeight;
  el.stage.style.height = `${Math.max(MIN_STAGE_PX, window.innerHeight - top - tabs - 12)}px`;
}

// The canvas at the stage's size in device pixels, so it is sharp on high-DPI screens.
function resize() {
  view.w = el.stage.clientWidth;
  view.h = el.stage.clientHeight;
  view.dpr = window.devicePixelRatio || 1;
  el.canvas.width = Math.round(view.w * view.dpr);
  el.canvas.height = Math.round(view.h * view.dpr);
  draw();
}

// Sensor force when fresh samples come in, else touch.
function sensorLive() {
  return device.connected && performance.now() - input.kgAt < 500;
}

function currentLevel() {
  if (input.touching) return clamp(input.touchLevel, 0, 1);
  if (sensorLive()) return forceToLevel(input.kg, run.fullKg);
  return run.game.holdTouch ? clamp(input.touchLevel, 0, 1) : 0;
}

// The force in kg (Tug of war: no cap at the full range); touch is a share of fullKg.
function currentKg() {
  if (input.touching) return clamp(input.touchLevel, 0, 1) * run.fullKg;
  return sensorLive() ? Math.max(0, input.kg) : 0;
}

function draw() {
  if (!run || !view.w) return;
  const ctx = el.canvas.getContext("2d");
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  const extra = run.net && run.game.duel.drawOpts ? run.game.duel.drawOpts(run) : {};
  run.game.draw(ctx, run.s, colors, view.w, view.h, { fullKg: run.fullKg, level: currentLevel(), ...extra });
}

function renderBar() {
  el.score.textContent = run.net ? run.game.duel.scoreText(run.s, run) : run.game.scoreText(run.s);
  el.pause.hidden = Boolean(run.net);
  el.kg.textContent = sensorLive() && !input.touching ? `${Math.max(0, input.kg).toFixed(1)} kg` : "Touch";
  el.pause.textContent = run.paused ? "Resume" : "Pause";
  el.pause.disabled = run.ended;
}

function frame(t) {
  run.raf = 0;
  if (run.paused || run.ended) return;
  const dt = run.last ? Math.min(0.05, (t - run.last) / 1000) : 0;
  run.last = t;
  const input = run.game.usesKg ? currentKg() : currentLevel();
  const events = run.net ? run.game.duel.step(run.s, dt, input, run) : run.game.step(run.s, dt, input, run);
  sounds(events);
  if (run.net) {
    run.net.events.push(...events);
    if (t - run.net.sentAt >= TICK_MS) sendTick(t);
  }
  draw();
  renderBar();
  if (isOver()) finish();
  else run.raf = requestAnimationFrame(frame);
}

function sounds(events) {
  for (const ev of events) {
    const sound = run.game.sounds[ev];
    if (sound) tone(sound[0], sound[1]);
  }
}

const isOver = () => (run.net ? run.game.duel.isOver(run.s, run) : run.game.isOver(run.s));

// ---- With a friend ----

const TICK_MS = 33; // ~30 messages a second each way

function sendTick(t = performance.now()) {
  duel.send({ t: "tick", d: run.game.duel.outgoing(run.s, run), ev: run.net.events });
  run.net.events = [];
  run.net.sentAt = t;
}

// Host: start game `id` on both phones with this phone's settings.
function hostDuel(id) {
  loadData();
  showGame();
  const opts = GAMES[id].duel.opts(data[id], el.stage.clientWidth, el.stage.clientHeight);
  duel.send({ t: "start", game: id, opts });
  start(id, opts);
}

function onDuelMessage({ detail: msg }) {
  if (msg.t === "start" && duel.role === "guest" && GAMES[msg.game]) {
    if (location.hash !== "#play") location.hash = "#play";
    start(msg.game, msg.opts);
  } else if (msg.t === "tick" && run?.net && !run.ended) {
    sounds(run.game.duel.incoming(run.s, msg.d, msg.ev ?? [], run));
  } else if (msg.t === "leave" && run?.net) {
    if (run.ended) quit();
    else stopDuel(`${duel.peerName} left the game.`);
  }
}

// The game can't go on (the friend left, or the connection ended).
function stopDuel(text) {
  run.ended = true;
  cancelAnimationFrame(run.raf);
  allowScreenOff();
  renderBar();
  showOverlay("Game over", text, [button("primary", "Back", quit)]);
}

function showOverlay(title, text, actions) {
  el.overlayTitle.textContent = title;
  el.overlayText.textContent = text;
  el.overlayActions.replaceChildren(...actions);
  el.overlay.hidden = false;
}

function showGame() {
  el.home.hidden = true;
  el.game.hidden = false;
  readColors();
  window.scrollTo(0, 0);
  fitStage();
}

// `opts`: a game with a friend, with the host's settings.
function start(id, opts = null) {
  unlockAudio(); // from the Play tap
  loadData();
  if (run) cancelAnimationFrame(run.raf);
  showGame();
  const game = GAMES[id];
  const own = () => ({ fullKg: fullRangeKg(data[id].range, settings.values.bodyweightKg) });
  // Per-game extras (Tug of war: scale, opponent); fullKg = the force of a full touch.
  let extra;
  if (opts) extra = game.duel.prepare ? game.duel.prepare(opts) : own();
  else extra = game.prepare ? game.prepare(data[id]) : own();
  run = {
    ...extra,
    id,
    game,
    opts,
    net: opts && { role: duel.role, peerName: duel.peerName, theirs: null, them: null, mine: 0, events: [], sentAt: 0 },
    s: opts ? game.duel.create(opts) : game.create(el.stage.clientWidth, el.stage.clientHeight, data[id], extra),
    profileId: profiles.activeId, // scores go to the profile the game started with
    paused: false,
    ended: false,
    raf: 0,
    last: 0,
  };
  input.touchLevel = 0;
  el.overlay.hidden = true;
  resize();
  renderBar();
  resume();
}

function resume() {
  if (!run || run.ended) return;
  run.paused = false;
  run.last = 0;
  el.overlay.hidden = true;
  keepScreenOn();
  renderBar();
  if (!run.raf) run.raf = requestAnimationFrame(frame);
}

function pause() {
  if (!run || run.paused || run.ended || run.net) return;
  run.paused = true;
  cancelAnimationFrame(run.raf);
  run.raf = 0;
  allowScreenOff();
  renderBar();
  showOverlay("Paused", run.game.scoreText(run.s), [button("secondary", "Quit", quit), button("primary", "Resume", resume)]);
}

function finish() {
  run.ended = true;
  allowScreenOff();
  if (run.net) {
    sendTick(); // the end reaches the friend too
    const r = run.game.duel.result(run.s, run);
    renderBar();
    const id = run.id;
    const again = duel.role === "host" ? [button("primary", "Play again", () => hostDuel(id))] : [];
    const title = r.draw ? "Draw" : r.won ? "You won!" : `${duel.peerName} wins`;
    const text = r.text + (duel.role === "guest" ? ` · ${duel.peerName} can start another game` : "");
    showOverlay(title, text, [button("secondary", "Back", quit), ...again]);
    return;
  }
  data = loadPlayData(storage(), run.profileId);
  const { title, text } = run.game.record(data, run.s, run);
  saveData(run.profileId);
  renderBar();
  const id = run.id;
  showOverlay(title, text, [button("secondary", "Back", quit), button("primary", "Play again", () => start(id))]);
}

function quit() {
  if (run?.net) duel.send({ t: "leave" });
  if (run) cancelAnimationFrame(run.raf);
  run = null;
  allowScreenOff();
  el.overlay.hidden = true;
  el.game.hidden = true;
  el.home.hidden = false;
  renderHome();
}

// Play tab tapped again: pause a running game, else back to the games.
export function playHome() {
  if (run && !run.paused && !run.ended) pause();
  else if (run) quit();
  window.scrollTo(0, 0);
}

function onPointer(ev) {
  if (!run) return;
  if (ev.type === "pointerdown") {
    input.touching = true;
    el.stage.setPointerCapture(ev.pointerId);
  }
  if (!input.touching) return;
  const rect = el.canvas.getBoundingClientRect();
  const fx = clamp((ev.clientX - rect.left) / rect.width, 0, 1);
  const fy = clamp((ev.clientY - rect.top) / rect.height, 0, 1);
  input.touchLevel = run.game.touchLevel(fx, fy);
  if (ev.type === "pointerup" || ev.type === "pointercancel") input.touching = false;
}

export function initPlay() {
  device.on("samples", (msg) => {
    if (!msg.kg?.length) return;
    input.kg = msg.kg[msg.kg.length - 1];
    input.kgAt = performance.now();
  });
  el.pause.addEventListener("click", () => (run?.paused ? resume() : pause()));
  el.quit.addEventListener("click", quit);
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) {
    el.stage.addEventListener(type, (ev) => {
      if (ev.target.closest("button")) return; // overlay buttons
      onPointer(ev);
    });
  }
  new ResizeObserver(() => run && resize()).observe(el.stage);
  window.addEventListener("resize", fitStage);
  device.on("status", fitStage); // after app.js has shown or hidden the warning
  window.addEventListener("erkdek:theme", () => {
    readColors();
    draw();
  });
  // Leaving the tab or the app pauses the game.
  window.addEventListener("hashchange", () => {
    if (location.hash === "#play") {
      if (!run) renderHome();
    } else pause();
  });
  document.addEventListener("visibilitychange", () => document.hidden && pause());
  profiles.addEventListener("change", () => !run && renderHome());
  settings.addEventListener("change", () => !run && renderHome());
  sessions.addEventListener("change", () => !run && renderHome()); // a new Max pull test
  duel.me = () => ({ bodyweight: settings.values.bodyweightKg > 0 });
  duel.addEventListener("change", () => !run && renderHome());
  duel.addEventListener("message", onDuelMessage);
  duel.addEventListener("lost", () => run?.net && !run.ended && stopDuel(duel.error || "The connection ended."));
  renderHome();
}
