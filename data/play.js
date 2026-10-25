// Play tab: mini games steered by your pull (games/*.js). The home screen lists the games
// with their best score and full range (the force that maps to the top or right edge);
// a game runs on a canvas with Pause and Quit. Without a sensor, press and drag on the
// game instead.

import { tone, unlockAudio } from "./audio.js";
import { device } from "./device.js";
import { clamp, forceToLevel } from "./games/common.js";
import { drawFlappy, newFlappy, stepFlappy } from "./games/flappy.js";
import { fullRangeKg, loadPlayData, recordFlappy, recordPong, savePlayData, stepRange } from "./games/playdata.js";
import { PONG, drawPong, newPong, stepPong } from "./games/pong.js";
import { profiles } from "./profiles.js";
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
    create: (w, h) => newPong({ h: clamp((PONG.w * h) / w, 120, 200) }),
    step: stepPong,
    draw: drawPong,
    isOver: (s) => s.phase === "over",
    scoreText: (s) => `You ${s.player.score} – ${s.cpu.score} CPU`,
    bestText: (d) =>
      d.played ? `${d.wins} of ${d.played} won` + (d.best ? ` · best ${d.best.you}–${d.best.cpu}` : "") : "Not played yet",
    // Touch: the paddle follows your finger across, and stays when you let go.
    touchLevel: (fx) => (fx * PONG.w - PONG.paddleW / 2) / (PONG.w - PONG.paddleW),
    holdTouch: true,
    record(data, s) {
      const { score: you } = s.player;
      const { score: cpu } = s.cpu;
      const newBest = recordPong(data, you, cpu);
      return {
        title: you > cpu ? "You won!" : "Computer wins",
        text: `${you} – ${cpu}` + (newBest ? " · new best" : ""),
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
        rangeRow(id),
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
  for (const ev of run.game.step(run.s, dt, currentLevel())) {
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
  run = {
    id,
    game,
    s: game.create(el.stage.clientWidth, el.stage.clientHeight),
    profileId: profiles.activeId, // scores go to the profile the game started with
    fullKg: fullRangeKg(data[id].range, settings.values.bodyweightKg),
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
  const { title, text } = run.game.record(data, run.s);
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
  renderHome();
}
