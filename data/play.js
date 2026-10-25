// Play tab: mini games steered by your pull (games/*.js). The home screen lists the games
// with their best score and full range (the force that maps to the top or right edge; Tug
// of war has a scale and your max pull instead);
// a game runs on a canvas with Pause and Quit. Without a sensor, press and drag on the
// game instead. With a friend (playduel.js) the host's Play starts the game on both phones;
// each game's `duel` part says what goes between them (see the messages in playduel.js).
// Two-phone games don't pause and don't count towards the solo results.
// Games are steered by the sensor only; pressing and dragging on the game works in
// debug builds and the desktop browser (TOUCH), for trying things without a sensor.

import { tone, unlockAudio } from "./audio.js";
import { device } from "./device.js";
import { clamp, forceToLevel, mirrorEvent } from "./games/common.js";
import { drawFlappy, flappyDuelResult, flappyRanking, newFlappy, stepFlappy } from "./games/flappy.js";
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
import { applyPong4Snapshot, coastPong4, drawPong4, newPong4, pong4Ranking, pong4Snapshot, stepPong4 } from "./games/pong4.js";
import {
  SCALES,
  SCALE_IDS,
  TUG,
  TUG_LEVELS,
  cpuOpponent,
  drawTug,
  mirrorTug,
  newTug,
  stepTug,
  teamLevel,
  toScale,
  tugSnapshot,
} from "./games/tug.js";
import { HOST_ID, duel, duelCard, sendHi } from "./playduel.js";
import { buildInfo } from "./platform.js";
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
  hint: $("playHint"),
};

const TOUCH = buildInfo().variant !== "release";

const GAMES = {
  pong: {
    name: "Pong",
    about: "Pull to move your paddle: no load is the left edge, full range the right. First to 7 wins. With 3–4 friends: a square field, a side each and 5 lives; the last one in wins.",
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
    // The host runs the ball. Two players: the guest's paddle is the top one on the host's
    // phone. Three or four: Pong on a square, a side each (games/pong4.js), lives instead
    // of points; every phone turns the field so its own side is at the bottom.
    duel: {
      players: [2, 4],
      opts: (d, w, h) => ({ level: d.level, h: clamp((PONG.w * h) / w, 120, 200) }),
      arrange: (ids) => (ids.length > 2 ? { sides: Object.fromEntries(ids.map((id, i) => [id, [0, 2, 1, 3][i]])) } : {}),
      create: (o) => (o.sides ? newPong4({ sides: Object.values(o.sides), level: o.level }) : newPong({ h: o.h, level: o.level })),
      step(s, dt, level, r) {
        r.net.mine = level;
        const sides = r.opts.sides;
        if (sides) {
          if (r.net.role !== "host") {
            coastPong4(s, dt, sides[r.net.myId], level);
            return [];
          }
          const levels = { [sides[r.net.myId]]: level };
          for (const id of r.net.ids) if (id !== r.net.myId && r.net.inputs[id]) levels[sides[id]] = r.net.inputs[id].v;
          return stepPong4(s, dt, levels);
        }
        if (r.net.role === "host") return stepPong(s, dt, level, r.net.inputs[opponent(r)]?.v ?? 0.5);
        coastPong(s, dt, level);
        return [];
      },
      outgoing(s, r) {
        if (r.net.role !== "host") return { v: r.net.mine };
        return { snap: r.opts.sides ? pong4Snapshot(s) : pongSnapshot(s) };
      },
      incoming(s, from, d, ev, r) {
        if (r.net.role === "host") {
          r.net.inputs[from] = d;
          return [];
        }
        if (r.opts.sides) {
          applyPong4Snapshot(s, d.snap, r.opts.sides[r.net.myId]); // own paddle stays as you pull
          return ev;
        }
        const m = mirrorPong(d.snap, s.h);
        Object.assign(s, m, { player: { ...m.player, x: s.player.x } });
        return ev.map(mirrorEvent);
      },
      // Pong on a square sends events as { type, side }: the sounds are from this side.
      sound(ev, r) {
        if (typeof ev === "string") return ev;
        const mine = ev.side === r.opts.sides[r.net.myId];
        if (ev.type === "miss") return mine ? "miss" : "point";
        if (ev.type === "won") return mine ? "point" : "miss";
        return ev.type === "out" ? null : ev.type;
      },
      // One against one: the other leaving ends it. On a square their paddle just stops.
      left: (s, id, r) => (r.opts.sides ? null : `${nameIn(r, id)} left the game.`),
      isOver: (s) => s.phase === "over",
      scoreText(s, r) {
        if (!r.opts.sides) return `You ${s.player.score} – ${s.cpu.score} ${nameIn(r, opponent(r))}`;
        const lives = (id) => s.players[r.opts.sides[id]]?.lives ?? 0;
        return r.net.ids.map((id) => `${id === r.net.myId ? "You" : nameIn(r, id)} ${lives(id)}`).join(" · ");
      },
      draw(ctx, s, c, w, h, opts, r) {
        if (!r.opts.sides) return drawPong(ctx, s, c, w, h, opts);
        const names = Object.fromEntries(r.net.ids.map((id) => [r.opts.sides[id], id === r.net.myId ? "You" : nameIn(r, id)]));
        drawPong4(ctx, s, c, w, h, { view: r.opts.sides[r.net.myId], names });
      },
      result(s, r) {
        if (!r.opts.sides) {
          return {
            title: s.player.score > s.cpu.score ? "You won!" : `${nameIn(r, opponent(r))} wins`,
            text: `${s.player.score} – ${s.cpu.score} · ${GAMES.pong.levels[r.opts.level]}`,
          };
        }
        const bySide = Object.fromEntries(r.net.ids.map((id) => [r.opts.sides[id], id]));
        const ranked = pong4Ranking(s).map((side) => bySide[side]).filter(Boolean);
        return {
          title: ranked[0] === r.net.myId ? "You won!" : `${nameIn(r, ranked[0])} wins`,
          text: ranked.map((id, i) => `${i + 1}. ${id === r.net.myId ? "You" : nameIn(r, id)}`).join(" · ") + ` · ${GAMES.pong.levels[r.opts.level]}`,
        };
      },
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
    // Everyone flies the same course on their own phone; the others' birds are drawn
    // faintly. Each phone sends its bird to the host, the host sends everyone's.
    duel: {
      players: [2, 6],
      opts: () => ({ seed: Math.floor(Math.random() * 2 ** 31), w: 80 }), // 80: wider than a phone held upright
      create: (o) => newFlappy({ w: o.w, seed: o.seed }),
      step: (s, dt, level) => stepFlappy(s, dt, level),
      outgoing(s, r) {
        const mine = { y: s.bird.y, score: s.score, over: s.over, t: s.t };
        return r.net.role === "host" ? { birds: { ...r.net.birds, [r.net.myId]: mine } } : mine;
      },
      incoming(s, from, d, ev, r) {
        if (r.net.role === "host") r.net.birds[from] = d;
        else r.net.birds = d.birds ?? {};
        return [];
      },
      // A bird whose player left counts as crashed where it was.
      left(s, id, r) {
        r.net.birds[id] = { y: 0, score: 0, t: 0, ...r.net.birds[id], over: true };
        return null;
      },
      othersOf: (r) => r.net.ids.filter((id) => id !== r.net.myId).map((id) => ({ id, ...(r.net.birds[id] ?? { score: 0, t: 0 }) })),
      isOver: (s, r) => s.over && GAMES.flappy.duel.othersOf(r).every((b) => b.over),
      scoreText(s, r) {
        const best = GAMES.flappy.duel.othersOf(r).sort((a, b) => b.score - a.score)[0];
        const flying = GAMES.flappy.duel.othersOf(r).filter((b) => !b.over).length;
        return `You ${s.score}` + (best ? ` · ${nameIn(r, best.id)} ${best.score}` : "") + (s.over && flying ? ` · ${flying} still flying` : "");
      },
      drawOpts: (r) => ({
        ghosts: GAMES.flappy.duel
          .othersOf(r)
          .filter((b) => Number.isFinite(b.y))
          .map((b) => ({ y: b.y, over: b.over, name: nameIn(r, b.id) })),
      }),
      result(s, r) {
        const ranked = flappyRanking([{ id: r.net.myId, score: s.score, t: s.t }, ...GAMES.flappy.duel.othersOf(r)]);
        const place = ranked.findIndex((b) => b.id === r.net.myId) + 1;
        const tie = ranked.length > 1 && flappyDuelResult(ranked[0], ranked[1]) === "draw";
        const title = place === 1 ? (tie ? "Draw" : "You won!") : `${nameIn(r, ranked[0].id)} wins`;
        const text = ranked.map((b, i) => `${i + 1}. ${b.id === r.net.myId ? "You" : nameIn(r, b.id)} ${b.score}`).join(" · ");
        return { title, text };
      },
    },
  },
  tug: {
    name: "Tug of war",
    about: `Pull harder than the computer to drag the flag to your end; the bigger the difference, the faster it moves. Rounds last up to ${TUG.roundS} s, best of 3. With friends: two teams, each team's pulls added up (kg) or averaged (% BW, % max).`,
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
    // Two teams (one each with two players). Every phone puts its own pull on the scale
    // (own bodyweight and max) and sends it to the host; the host adds them up per team
    // (teamLevel), runs the knot and sends the state; the other team sees it turned round.
    // Everyone needs a sensor: a finger on the screen is no match for a pull.
    duel: {
      players: [2, 6],
      teams: true,
      needsSensor: true,
      // % BW needs everyone's bodyweight (else kg).
      opts: (d) => ({ scale: tugScale(d, everyoneHasBodyweight() ? settings.values.bodyweightKg : 0) }),
      prepare(o) {
        const bodyweightKg = settings.values.bodyweightKg;
        const maxKg = tugMaxKg(data.tug, sessions.index);
        return { fullKg: maxKg, toLevel: (kg) => toScale(kg, o.scale, { bodyweightKg, maxKg }) ?? 0 };
      },
      create: (o) => newTug({ scale: o.scale }),
      usesKg: true,
      step(s, dt, kg, r) {
        r.net.mine = r.toLevel(kg);
        if (r.net.role !== "host") return [];
        const levelOf = (id) => (id === r.net.myId ? r.net.mine : r.net.inputs[id]?.v ?? 0);
        const team = (t) => teamLevel(r.net.ids.filter((id) => r.opts.teams[id] === t && !r.net.gone.has(id)).map(levelOf), r.opts.scale);
        const mine = r.opts.teams[r.net.myId];
        return stepTug(s, dt, team(mine), team(mine === "A" ? "B" : "A"));
      },
      outgoing: (s, r) => (r.net.role === "host" ? { snap: tugSnapshot(s) } : { v: r.net.mine }),
      incoming(s, from, d, ev, r) {
        if (r.net.role === "host") {
          r.net.inputs[from] = d;
          return [];
        }
        // The host's state is from the host's team: the other team sees it turned round.
        const same = r.opts.teams[r.net.myId] === r.opts.teams[HOST_ID];
        Object.assign(s, same ? d.snap : mirrorTug(d.snap));
        return same ? ev : ev.map(mirrorEvent);
      },
      left: () => null, // the team pulls on without them
      isOver: (s) => s.phase === "over",
      teamNames(r) {
        const mine = r.opts.teams[r.net.myId];
        const names = (t) => r.net.ids.filter((id) => r.opts.teams[id] === t).map((id) => (id === r.net.myId ? "You" : nameIn(r, id)));
        return { you: names(mine).join(" + "), them: names(mine === "A" ? "B" : "A").join(" + ") };
      },
      scoreText(s, r) {
        const { them } = GAMES.tug.duel.teamNames(r);
        return `You ${s.you.rounds} – ${s.them.rounds} ${them}`;
      },
      drawOpts: (r) => ({ names: GAMES.tug.duel.teamNames(r) }),
      result(s, r) {
        const { them } = GAMES.tug.duel.teamNames(r);
        const won = s.you.rounds > s.them.rounds;
        const teamGame = r.net.ids.length > 2;
        return {
          title: won ? (teamGame ? "Your team won!" : "You won!") : `${them} win${teamGame ? "" : "s"}`,
          text: `${s.you.rounds} – ${s.them.rounds} · ${SCALES[r.opts.scale].name}`,
        };
      },
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
    } else if (sc === "bw" && !everyoneHasBodyweight()) {
      b.disabled = true;
      b.title = "Not everyone has a bodyweight set";
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
  const names = (ids) => ids.map((pid) => duel.nameOf(pid)).join(", ");
  el.hint.textContent = TOUCH ? "No sensor? Press and drag on the game (debug builds only)." : "";
  el.cards.replaceChildren(
    duelCard(),
    ...(withFriend && duel.role === "guest" && watching
      ? [create("p", { className: "muted", textContent: `Playing now: ${GAMES[watching.game].name} (${names(watching.ids)}). You're in the next one if ${duel.nameOf(HOST_ID)} picks you.` })]
      : []),
    ...games.map(([id, g]) =>
      create("div", { className: "card play-card" }, [
        create("div", { className: "routine-head" }, [
          create("h2", { textContent: g.name }),
          create("span", { className: "muted", textContent: g.bestText(data[id]) }),
        ]),
        create("p", { className: "muted", textContent: g.about }),
        ...(g.levels ? [levelRow(id, g.levels)] : []),
        ...(g.rows ? g.rows(id) : [rangeRow(id)]),
        ...(withFriend ? duelPlayRow(id, g) : soloPlayRow(id)),
      ]),
    ),
  );
}

// Play: needs the sensor (outside debug builds).
function soloPlayRow(id) {
  const play = button("primary", "Play", () => start(id));
  const missing = !TOUCH && !device.connected;
  play.disabled = missing;
  return [
    ...(missing ? [create("p", { className: "muted", textContent: "Connect your sensor to play (Live tab)." })] : []),
    create("div", { className: "actions" }, [play]),
  ];
}

// ---- With friends: who plays ----

// Per game, who plays: { [playerId]: true | false } or, for team games, "A" | "B" | "out".
// The host always plays. New players join in while there's room (team games: the
// smaller team).
const lineups = {};

function lineupOf(id, g) {
  const [, max] = g.duel.players;
  const old = lineups[id] ?? {};
  const next = {};
  for (const p of duel.players) {
    if (p.id in old) next[p.id] = old[p.id];
    else if (g.duel.teams) {
      const count = (t) => Object.values(next).filter((v) => v === t).length;
      next[p.id] = count("A") + count("B") >= max ? "out" : count("A") <= count("B") ? "A" : "B";
    } else next[p.id] = Object.values(next).filter(Boolean).length < max;
  }
  return (lineups[id] = next);
}

const playing = (lineup) => Object.keys(lineup).filter((pid) => lineup[pid] === true || lineup[pid] === "A" || lineup[pid] === "B");

// Tap a player: in ↔ out; team games: team 1 → team 2 → sits out (the host: 1 ↔ 2).
function toggleLineup(id, g, pid) {
  const l = lineupOf(id, g);
  if (g.duel.teams) {
    const order = pid === HOST_ID ? ["A", "B"] : ["A", "B", "out"];
    l[pid] = order[(order.indexOf(l[pid]) + 1) % order.length];
  } else if (pid !== HOST_ID) l[pid] = !l[pid];
  renderHome();
}

function lineupChips(id, g, pids) {
  return create(
    "div",
    { className: "rep-chips" },
    pids.map((pid) => {
      const p = duel.players.find((x) => x.id === pid);
      const on = lineupOf(id, g)[pid] !== false && lineupOf(id, g)[pid] !== "out";
      const b = button(`rep-chip${on ? " active" : ""}`, p.id === HOST_ID ? `${p.name} (you)` : p.name, () => toggleLineup(id, g, pid));
      b.setAttribute("aria-pressed", String(on));
      return b;
    }),
  );
}

// The host's lineup and Play button for a game with friends; says what is missing.
function duelPlayRow(id, g) {
  const [min, max] = g.duel.players;
  const lineup = lineupOf(id, g);
  const ids = playing(lineup);
  const rows = [];
  if (g.duel.teams) {
    const team = (t) => Object.keys(lineup).filter((pid) => lineup[pid] === t);
    rows.push(
      create("div", { className: "duel-team" }, [create("span", { className: "muted", textContent: "Team 1" }), lineupChips(id, g, team("A"))]),
      create("div", { className: "duel-team" }, [create("span", { className: "muted", textContent: "Team 2" }), lineupChips(id, g, team("B"))]),
    );
    if (team("out").length) {
      rows.push(create("div", { className: "duel-team" }, [create("span", { className: "muted", textContent: "Sit out" }), lineupChips(id, g, team("out"))]));
    }
    rows.push(create("p", { className: "muted play-range-kg", textContent: "Tap a name to move it to the other team." }));
  } else if (duel.players.length > 2) {
    rows.push(
      create("div", { className: "duel-team" }, [
        create("span", { className: "muted", textContent: max < duel.players.length ? `Who plays (up to ${max})` : "Who plays" }),
        lineupChips(id, g, duel.players.map((p) => p.id)),
      ]),
    );
  }
  let missing = "";
  if (ids.length < min) missing = `Pick at least ${min} players.`;
  else if (ids.length > max) missing = `At most ${max} players in ${g.name}.`;
  else if (g.duel.teams && (!ids.some((pid) => lineup[pid] === "A") || !ids.some((pid) => lineup[pid] === "B"))) missing = "Each team needs a player.";
  else if (g.duel.needsSensor || !TOUCH) {
    const without = duel.players.filter((p) => ids.includes(p.id) && !(p.id === HOST_ID ? device.connected : p.sensor));
    if (without.length) {
      const names = without.map((p) => (p.id === HOST_ID ? "you" : p.name));
      missing = `Needs a sensor on every phone: ${names.join(", ")} ${without.length === 1 && names[0] !== "you" ? "has" : "have"} none connected.`;
    }
  }
  const others = ids.filter((pid) => pid !== HOST_ID);
  const label = others.length === 1 ? `Play with ${duel.nameOf(others[0])}` : `Play (${ids.length} players)`;
  const play = button("primary", label, () => hostDuel(id));
  play.disabled = Boolean(missing);
  return [
    ...rows,
    ...(missing ? [create("p", { className: "muted", textContent: missing })] : []),
    create("div", { className: "actions" }, [play]),
  ];
}

const everyoneHasBodyweight = () => duel.phase !== "open" || duel.players.every((p) => (p.id === duel.myId ? settings.values.bodyweightKg > 0 : p.bodyweight));
const nameIn = (r, id) => r.net.names[id] ?? "Someone";
const opponent = (r) => r.net.ids.find((id) => id !== r.net.myId);

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
  const touchAllowed = TOUCH && !(run.net && run.game.duel.needsSensor);
  if (input.touching && touchAllowed) return clamp(input.touchLevel, 0, 1) * run.fullKg;
  return sensorLive() ? Math.max(0, input.kg) : 0;
}

function draw() {
  if (!run || !view.w) return;
  const ctx = el.canvas.getContext("2d");
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  const extra = run.net && run.game.duel.drawOpts ? run.game.duel.drawOpts(run) : {};
  const opts = { fullKg: run.fullKg, level: currentLevel(), ...extra };
  if (run.net && run.game.duel.draw) run.game.duel.draw(ctx, run.s, colors, view.w, view.h, opts, run);
  else run.game.draw(ctx, run.s, colors, view.w, view.h, opts);
}

function renderBar() {
  el.score.textContent = run.net ? run.game.duel.scoreText(run.s, run) : run.game.scoreText(run.s);
  el.pause.hidden = Boolean(run.net);
  const sensorOnly = !TOUCH || (run.net && run.game.duel.needsSensor);
  if (sensorOnly) el.kg.textContent = sensorLive() ? `${Math.max(0, input.kg).toFixed(1)} kg` : "No sensor";
  else el.kg.textContent = sensorLive() && !input.touching ? `${Math.max(0, input.kg).toFixed(1)} kg` : "Touch";
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
  for (const raw of events) {
    const ev = run.net && run.game.duel.sound ? run.game.duel.sound(raw, run) : raw;
    const sound = run.game.sounds[ev];
    if (sound) tone(sound[0], sound[1]);
  }
}

const isOver = () => (run.net ? run.game.duel.isOver(run.s, run) : run.game.isOver(run.s));

// ---- With friends ----

const TICK_MS = 33; // ~30 messages a second each way
let watching = null; // a guest not in the host's game: { game, ids }

function sendTick(t = performance.now()) {
  duel.send({ t: "tick", d: run.game.duel.outgoing(run.s, run), ev: run.net.events });
  run.net.events = [];
  run.net.sentAt = t;
}

// Host: start game `id` on everyone's phone with this phone's settings and lineup.
function hostDuel(id) {
  loadData();
  showGame();
  const g = GAMES[id];
  const lineup = lineupOf(id, g);
  const ids = playing(lineup);
  const opts = {
    ...g.duel.opts(data[id], el.stage.clientWidth, el.stage.clientHeight),
    ids,
    ...(g.duel.teams ? { teams: Object.fromEntries(ids.map((pid) => [pid, lineup[pid]])) } : {}),
    ...(g.duel.arrange ? g.duel.arrange(ids) : {}),
  };
  duel.send({ t: "start", game: id, opts });
  start(id, opts);
}

function onDuelMessage({ detail: { from, msg } }) {
  if (msg.t === "start" && duel.role === "guest" && GAMES[msg.game]) {
    if (!msg.opts.ids.includes(duel.myId)) {
      watching = { game: msg.game, ids: msg.opts.ids };
      if (!run) renderHome();
      return;
    }
    watching = null;
    if (location.hash !== "#play") location.hash = "#play";
    start(msg.game, msg.opts);
  } else if (msg.t === "tick" && run?.net && !run.ended && run.net.ids.includes(from)) {
    sounds(run.game.duel.incoming(run.s, from, msg.d, msg.ev ?? [], run));
  } else if (msg.t === "leave") {
    if (duel.role === "host") playerLeft(from);
    else {
      // The host ended the game for everyone.
      watching = null;
      if (!run?.net) renderHome();
      else if (run.ended) quit();
      else stopDuel(`${duel.nameOf(HOST_ID)} ended the game.`);
    }
  }
}

// Host: a player left the game or lost the connection. Some games go on without them.
function playerLeft(id) {
  if (!run?.net || run.ended || !run.net.ids.includes(id) || run.net.gone.has(id)) return;
  run.net.gone.add(id);
  const text = run.game.duel.left(run.s, id, run);
  if (!text) return;
  duel.send({ t: "leave" });
  stopDuel(text);
}

// The game can't go on (a player left, or the connection ended).
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
    net: opts && {
      role: duel.role,
      myId: duel.myId,
      ids: opts.ids,
      names: Object.fromEntries(duel.players.map((p) => [p.id, p.name])),
      inputs: {}, // host: each guest's latest payload
      birds: {}, // Flappy: everyone's bird
      gone: new Set(), // players who left
      mine: 0,
      events: [],
      sentAt: 0,
    },
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
    const { title, text } = run.game.duel.result(run.s, run);
    renderBar();
    const id = run.id;
    const again = duel.role === "host" ? [button("primary", "Play again", () => hostDuel(id))] : [];
    const more = duel.role === "guest" ? ` · ${duel.nameOf(HOST_ID)} can start another game` : "";
    showOverlay(title, text + more, [button("secondary", "Back", quit), ...again]);
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

// Android's Back in Play: pauses a game, then quits it (a game with a friend after
// asking). True when Back was used up here.
export function playBack() {
  if (!run) return false;
  if (run.net && !run.ended) {
    if (confirm("Leave the game?")) quit();
  } else playHome();
  return true;
}

// Play tab tapped again: pause a running game, else back to the games.
export function playHome() {
  if (run && !run.paused && !run.ended) pause();
  else if (run) quit();
  window.scrollTo(0, 0);
}

function onPointer(ev) {
  if (!run || !TOUCH) return;
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
  duel.me = () => ({ bodyweight: settings.values.bodyweightKg > 0, sensor: device.connected });
  device.on("connection", () => {
    sendHi();
    if (!run) renderHome();
  });
  duel.addEventListener("change", () => !run && renderHome());
  // Pings: just the friends card, so a tap on a game card isn't lost to a redraw.
  duel.addEventListener("ping", () => {
    if (run) return;
    const old = el.cards.querySelector(".duel-card");
    if (old) old.replaceWith(duelCard());
  });
  duel.addEventListener("message", onDuelMessage);
  duel.addEventListener("left", ({ detail: id }) => playerLeft(id));
  duel.addEventListener("lost", () => {
    watching = null;
    if (run?.net && !run.ended) stopDuel(duel.error || "The connection ended.");
  });
  renderHome();
}
