// Play settings and best scores, per profile, kept on this phone (localStorage
// "erkdek.play:<profile id>"). Small and not worth a backup. The storage is passed in, so
// this runs under node --test too.

import { clamp } from "./common.js";

export const playKey = (profileId) => `erkdek.play:${profileId}`;

// Full range: the force that moves you to the top (Flappy) or the right edge (Pong), in kg
// or as a share of bodyweight.
export const RANGE_KG = { min: 2, max: 200, step: 1 };
export const RANGE_PCT = { min: 5, max: 150, step: 5 };
const DEFAULT_RANGE = { unit: "kg", kg: 20, pct: 30 };

export const GAME_IDS = ["pong", "flappy"];

// pong: best = the best win margin as { you, cpu }; flappy: best = most pipes passed.
export function defaultPlayData() {
  return {
    pong: { range: { ...DEFAULT_RANGE }, best: null, wins: 0, played: 0 },
    flappy: { range: { ...DEFAULT_RANGE }, best: 0, played: 0 },
  };
}

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
  for (const id of GAME_IDS) {
    const g = stored[id];
    if (!g || typeof g !== "object") continue;
    data[id].range = validRange(g.range);
    data[id].played = Number.isInteger(g.played) && g.played >= 0 ? g.played : 0;
  }
  const pong = stored.pong || {};
  if (Number.isInteger(pong.wins) && pong.wins >= 0) data.pong.wins = pong.wins;
  if (Number.isInteger(pong.best?.you) && Number.isInteger(pong.best?.cpu)) data.pong.best = { you: pong.best.you, cpu: pong.best.cpu };
  if (Number.isInteger(stored.flappy?.best) && stored.flappy.best >= 0) data.flappy.best = stored.flappy.best;
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

// Records a finished Pong game; true when it is a new best (a bigger winning margin).
export function recordPong(data, you, cpu) {
  const g = data.pong;
  g.played++;
  if (you <= cpu) return false;
  g.wins++;
  const better = !g.best || you - cpu > g.best.you - g.best.cpu;
  if (better) g.best = { you, cpu };
  return better;
}

// Records a finished Flappy round; true when it is a new best.
export function recordFlappy(data, score) {
  const g = data.flappy;
  g.played++;
  if (score <= g.best) return false;
  g.best = score;
  return true;
}
