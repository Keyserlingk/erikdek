// Sharing results with a friend on another phone: chosen sessions go out as a small
// "erkdek-share" file through the share sheet; the friend imports it as a friend profile
// (profiles.js) that shows up under History → Compare people. Notes never leave the
// phone; curves and bodyweight only when chosen. Importing a newer share from the same
// person updates their sessions.

import { profileOf, profiles } from "./profiles.js";
import { sessions } from "./sessions.js";

export const SHARE_FORMAT = "erkdek-share";
export const SHARE_VERSION = 1;
const SHARE_ID = /^[a-z0-9]{4,15}$/;

// The file for `list` (full sessions, with the bodyweight of their day already
// resolved): from { shareId, name }; curves: include force curves (overlay in compare);
// bodyweight: include each session's bodyweight (needed for % of bodyweight).
export function buildShare({ from, list, curves = false, bodyweight = false, exportedAt = new Date() }) {
  const clean = list.map((s) => {
    const { note, profile, curve, repCurves, bodyweightKg, bodyweightFixed, ...rest } = s;
    return {
      ...rest,
      ...(curves && curve ? { curve } : {}),
      ...(curves && repCurves ? { repCurves } : {}),
      ...(bodyweight && bodyweightKg > 0 ? { bodyweightKg, bodyweightFixed: true } : { bodyweightKg: 0 }),
    };
  });
  return { format: SHARE_FORMAT, version: SHARE_VERSION, exportedAt: exportedAt.toISOString(), from, sessions: clean };
}

// Parses and checks a share file; throws a readable Error.
export function parseShare(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This is not a shared results file (not JSON).");
  }
  if (!data || data.format !== SHARE_FORMAT) throw new Error("This is not an Erkdek results file from a friend.");
  if (data.version > SHARE_VERSION) throw new Error("This file was made by a newer version of the app.");
  if (!data.from || !SHARE_ID.test(data.from.shareId ?? "") || typeof data.from.name !== "string") {
    throw new Error("The file doesn't say whose results these are.");
  }
  if (!Array.isArray(data.sessions)) throw new Error("The file is damaged (sessions).");
  return { from: data.from, exportedAt: data.exportedAt, sessions: data.sessions.filter((s) => s && typeof s.id === "string") };
}

// Files a parsed share under its friend profile: new sessions are added, ones shared
// before are replaced. A session id taken by someone else on this phone is skipped.
// -> { name, added, updated, skipped }
export async function importShare(share) {
  const friendId = await profiles.upsertFriend(share.from.shareId, share.from.name);
  const owner = new Map(sessions.all.map((s) => [s.id, profileOf(s)]));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const s of share.sessions) {
    const mine = { ...s, profile: friendId };
    if (!owner.has(s.id)) {
      await sessions.save(mine);
      added++;
    } else if (owner.get(s.id) === friendId) {
      await sessions.replace(mine);
      updated++;
    } else {
      skipped++;
    }
  }
  return { name: profiles.find(friendId).name, added, updated, skipped };
}
