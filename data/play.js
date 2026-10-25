// Play tab: mini games steered by your pull (games/*.js). The home screen lists the games
// with their best score and full range (the force that maps to the top or right edge; Tug
// of war has a scale and your max pull instead);
// a game runs on a canvas with Pause and Quit. Without a sensor, press and drag on the
// game instead.

import { tone, unlockAudio } from "./audio.js";
import { device } from "./device.js";
import { clamp, forceToLevel } from "./games/common.js";
import { drawFlappy, newFlappy, stepFlappy } from "./games/flappy.js";
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
import { LEVEL_IDS, PONG, drawPong, newPong, stepPong } from "./games/pong.js";
import { SCALES, SCALE_IDS, TUG, TUG_LEVELS, cpuOpponent, drawTug, newTug, stepTug, toScale } from "./games/tug.js";
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
    step: stepPong,
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
  },
  flappy: {
    name: "Flappy",
    about: "The bird's height follows your pull: no load is the bottom, full range the top. Hold the load that fits each gap.",
    create: (w, h) => newFlappy({ w: (100 * w) / h }),
    step: stepFlappy,
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
  const scale = tugScale(d, bw);
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
  el.cards.replaceChildren(
    ...Object.entries(GAMES).map(([id, g]) =>
      create("div", { className: "card play-card" }, [
        create("div", { className: "routine-head" }, [
          create("h2", { textContent: g.name }),
          create("span", { className: "muted", textContent: g.bestText(data[id]) }),
        ]),
        create("p", { className: "muted", textContent: g.about }),
        ...(g.levels ? [levelRow(id, g.levels)] : []),
        ...(g.rows ? g.rows(id) : [rangeRow(id)]),
        create("div", { className: "actions" }, [button("primary", "Play", () => start(id))]),
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
  run.game.draw(ctx, run.s, colors, view.w, view.h, { fullKg: run.fullKg, level: currentLevel() });
}

function renderBar() {
  el.score.textContent = run.game.scoreText(run.s);
  el.kg.textContent = sensorLive() && !input.touching ? `${Math.max(0, input.kg).toFixed(1)} kg` : "Touch";
  el.pause.textContent = run.paused ? "Resume" : "Pause";
  el.pause.disabled = run.ended;
}

function frame(t) {
  run.raf = 0;
  if (run.paused || run.ended) return;
  const dt = run.last ? Math.min(0.05, (t - run.last) / 1000) : 0;
  run.last = t;
  for (const ev of run.game.step(run.s, dt, run.game.usesKg ? currentKg() : currentLevel(), run)) {
    const sound = run.game.sounds[ev];
    if (sound) tone(sound[0], sound[1]);
  }
  draw();
  renderBar();
  if (run.game.isOver(run.s)) finish();
  else run.raf = requestAnimationFrame(frame);
}

function showOverlay(title, text, actions) {
  el.overlayTitle.textContent = title;
  el.overlayText.textContent = text;
  el.overlayActions.replaceChildren(...actions);
  el.overlay.hidden = false;
}

function start(id) {
  unlockAudio(); // from the Play tap
  loadData();
  el.home.hidden = true;
  el.game.hidden = false;
  readColors();
  window.scrollTo(0, 0);
  fitStage();
  const game = GAMES[id];
  // Per-game extras (Tug of war: scale, opponent); fullKg = the force of a full touch.
  const extra = game.prepare ? game.prepare(data[id]) : { fullKg: fullRangeKg(data[id].range, settings.values.bodyweightKg) };
  run = {
    ...extra,
    id,
    game,
    s: game.create(el.stage.clientWidth, el.stage.clientHeight, data[id], extra),
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
  if (!run || run.paused || run.ended) return;
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
  data = loadPlayData(storage(), run.profileId);
  const { title, text } = run.game.record(data, run.s, run);
  saveData(run.profileId);
  renderBar();
  const id = run.id;
  showOverlay(title, text, [button("secondary", "Back", quit), button("primary", "Play again", () => start(id))]);
}

function quit() {
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
  renderHome();
}
