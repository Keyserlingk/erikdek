// Play settings and best scores, per profile, kept on this phone (localStorage
// "erkdek.play:<profile id>"). Small and not worth a backup. The storage is passed in, so
// this runs under node --test too.

import { clamp } from "./common.js";
import { LEVEL_IDS } from "./pong.js";
import { SCALE_IDS } from "./tug.js";

export const playKey = (profileId) => `erkdek.play:${profileId}`;

// Full range: the force that moves you to the top (Flappy) or the right edge (Pong), in kg
// or as a share of bodyweight.
export const RANGE_KG = { min: 2, max: 200, step: 1 };
export const RANGE_PCT = { min: 5, max: 150, step: 5 };
const DEFAULT_RANGE = { unit: "kg", kg: 20, pct: 30 };

export const GAME_IDS = ["pong", "flappy"]; // the games with a full range

// Your max pull for Tug of war when there is no Max pull test, in kg.
export const MAX_KG = { min: 5, max: 250, step: 1, start: 30 };

// pong: the difficulty and, per difficulty, games won and played and the best win margin
// as { you, cpu }; flappy: best = most pipes passed; tug: the scale, the computer's
// strength (level), your max pull typed in (used without a Max pull test) and, per
// strength, games won and played and the fastest round you won (s).
const pongResults = () => ({ best: null, wins: 0, played: 0 });
const tugResults = () => ({ fastestS: null, wins: 0, played: 0 });
export function defaultPlayData() {
  return {
    pong: { range: { ...DEFAULT_RANGE }, level: "normal", results: Object.fromEntries(LEVEL_IDS.map((l) => [l, pongResults()])) },
    flappy: { range: { ...DEFAULT_RANGE }, best: 0, played: 0 },
    tug: { scale: "kg", level: "normal", maxKg: MAX_KG.start, results: Object.fromEntries(LEVEL_IDS.map((l) => [l, tugResults()])) },
  };
}

const count = (n) => (Number.isInteger(n) && n >= 0 ? n : 0);

function validRange(r) {
  const d = DEFAULT_RANGE;
  if (!r || typeof r !== "object") return { ...d };
  return {
    unit: r.unit === "bw" ? "bw" : "kg",
    kg: Number.isFinite(r.kg) ? clamp(r.kg, RANGE_KG.min, RANGE_KG.max) : d.kg,
    pct: Number.isFinite(r.pct) ? clamp(r.pct, RANGE_PCT.min, RANGE_PCT.max) : d.pct,
  };
}

export function loadPlayData(storage, profileId) {
  const data = defaultPlayData();
  let stored = null;
  try {
    stored = JSON.parse(storage.getItem(playKey(profileId)));
  } catch {
    // start fresh
  }
  if (!stored || typeof stored !== "object") return data;
  for (const id of GAME_IDS) data[id].range = validRange(stored[id]?.range);
  const pong = stored.pong || {};
  if (LEVEL_IDS.includes(pong.level)) data.pong.level = pong.level;
  for (const l of LEVEL_IDS) {
    const r = pong.results?.[l];
    if (!r || typeof r !== "object") continue;
    const d = data.pong.results[l];
    d.played = count(r.played);
    d.wins = Math.min(count(r.wins), d.played);
    if (Number.isInteger(r.best?.you) && Number.isInteger(r.best?.cpu)) d.best = { you: r.best.you, cpu: r.best.cpu };
  }
  const tug = stored.tug || {};
  if (SCALE_IDS.includes(tug.scale)) data.tug.scale = tug.scale;
  if (LEVEL_IDS.includes(tug.level)) data.tug.level = tug.level;
  if (Number.isFinite(tug.maxKg)) data.tug.maxKg = clamp(Math.round(tug.maxKg), MAX_KG.min, MAX_KG.max);
  for (const l of LEVEL_IDS) {
    const r = tug.results?.[l];
    if (!r || typeof r !== "object") continue;
    const d = data.tug.results[l];
    d.played = count(r.played);
    d.wins = Math.min(count(r.wins), d.played);
    if (Number.isFinite(r.fastestS) && r.fastestS > 0) d.fastestS = r.fastestS;
  }
  data.flappy.played = count(stored.flappy?.played);
  data.flappy.best = count(stored.flappy?.best);
  return data;
}

export function savePlayData(storage, profileId, data) {
  try {
    storage.setItem(playKey(profileId), JSON.stringify(data));
  } catch {
    // not remembered
  }
}

export function removePlayData(storage, profileId) {
  try {
    storage.removeItem(playKey(profileId));
  } catch {
    // nothing stored
  }
}

// The full range in kg for the current bodyweight (0 = not set: falls back to kg).
export function fullRangeKg(range, bodyweightKg) {
  if (range.unit === "bw" && bodyweightKg > 0) return Math.max(RANGE_KG.min, (bodyweightKg * range.pct) / 100);
  return range.kg;
}

// One step up (+1) or down (-1) in the range's unit.
export function stepRange(range, dir) {
  const r = { ...range };
  if (r.unit === "bw") r.pct = clamp(r.pct + dir * RANGE_PCT.step, RANGE_PCT.min, RANGE_PCT.max);
  else r.kg = clamp(Math.round(r.kg) + dir * RANGE_KG.step, RANGE_KG.min, RANGE_KG.max);
  return r;
}

// Records a finished Pong game at a difficulty; true when it is a new best (a bigger
// winning margin).
export function recordPong(data, level, you, cpu) {
  const g = data.pong.results[level];
  g.played++;
  if (you <= cpu) return false;
  g.wins++;
  const better = !g.best || you - cpu > g.best.you - g.best.cpu;
  if (better) g.best = { you, cpu };
  return better;
}

// Records a finished Tug of war game at a strength; true when `fastestS` (your quickest
// round win in it, or null) is a new best.
export function recordTug(data, level, won, fastestS) {
  const g = data.tug.results[level];
  g.played++;
  if (won) g.wins++;
  if (fastestS == null || (g.fastestS != null && fastestS >= g.fastestS)) return false;
  g.fastestS = fastestS;
  return true;
}

// The best peak of the Max pull tests in `entries` (a session index), or null.
export function bestMaxPullKg(entries) {
  let best = null;
  for (const e of entries) {
    const kg = e?.type === "maxPull" ? e.summary?.peakKg : null;
    if (Number.isFinite(kg) && kg > 0 && (best == null || kg > best)) best = kg;
  }
  return best;
}

// The max pull the game uses: the best Max pull test, else the one typed in.
export const tugMaxKg = (tug, entries) => bestMaxPullKg(entries) ?? tug.maxKg;

// The scale the game is played on: % BW needs a bodyweight (else kg).
export const tugScale = (tug, bodyweightKg) => (tug.scale === "bw" && !(bodyweightKg > 0) ? "kg" : tug.scale);

// Records a finished Flappy round; true when it is a new best.
export function recordFlappy(data, score) {
  const g = data.flappy;
  g.played++;
  if (score <= g.best) return false;
  g.best = score;
  return true;
}
