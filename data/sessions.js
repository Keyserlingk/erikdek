// Saved sessions, stored in the app: the full session in db "sessions" and the same
// without reps and curve in "sessionIndex". The index is kept in memory for History;
// full sessions are read on demand. Each session belongs to a profile: `index` holds the
// active profile's sessions only, `all` everyone's (backup). Fires "change" when the
// index changes, also when another profile becomes active.

import { db } from "./db.js";
import { profileOf, profiles } from "./profiles.js";

const DETAIL_ONLY = ["reps", "curve", "repCurves"];
const SESSION_ID = /^[a-z0-9]{1,16}$/;

export const MAX_NOTE_LENGTH = 500;
export const MAX_TAGS = 10;
export const MAX_SESSION_TAG_LENGTH = 30;

// A session's note and tags: { note: string, tags: [string] }. Error message or null.
export function validateNotes({ note, tags }) {
  if (typeof note !== "string" || note.length > MAX_NOTE_LENGTH) return `Notes can be at most ${MAX_NOTE_LENGTH} characters.`;
  if (!Array.isArray(tags) || tags.length > MAX_TAGS) return `At most ${MAX_TAGS} tags.`;
  if (tags.some((t) => typeof t !== "string" || !t.trim() || t.length > MAX_SESSION_TAG_LENGTH)) {
    return `Tags can be at most ${MAX_SESSION_TAG_LENGTH} characters.`;
  }
  return null;
}

export function indexEntry(session) {
  return Object.fromEntries(Object.entries(session).filter(([key]) => !DETAIL_ONLY.includes(key)));
}

class SessionStore extends EventTarget {
  constructor() {
    super();
    this.all = [];
    profiles.addEventListener("change", () => this.dispatchEvent(new Event("change")));
  }

  // The active profile's sessions.
  get index() {
    return this.all.filter((s) => profileOf(s) === profiles.activeId);
  }

  async load() {
    this.all = await db.getAll("sessionIndex");
    this.dispatchEvent(new Event("change"));
  }

  async get(id) {
    const session = await db.get("sessions", id);
    if (!session) throw new Error("This session no longer exists.");
    return session;
  }

  // A new session goes to the active profile; a restored one keeps its profile.
  async save(newSession) {
    const session = { profile: profiles.activeId, ...newSession };
    if (typeof session?.id !== "string" || !SESSION_ID.test(session.id)) throw new Error("Invalid session id.");
    if (await db.get("sessionIndex", session.id)) throw new Error("This session is already saved.");
    const entry = indexEntry(session);
    await db.write([
      { store: "sessions", key: session.id, value: session },
      { store: "sessionIndex", key: session.id, value: entry },
    ]);
    this.all.push(entry);
    this.dispatchEvent(new Event("change"));
  }

  // Changes a saved session's note and tags (in History).
  async update(id, { note, tags }) {
    const error = validateNotes({ note, tags });
    if (error) throw new Error(error);
    const session = { ...(await this.get(id)), note, tags };
    const entry = indexEntry(session);
    await db.write([
      { store: "sessions", key: id, value: session },
      { store: "sessionIndex", key: id, value: entry },
    ]);
    this.all = this.all.map((s) => (s.id === id ? entry : s));
    this.dispatchEvent(new Event("change"));
  }

  async remove(id) {
    return this.removeMany([id]);
  }

  // Deletes several sessions in one write.
  async removeMany(ids) {
    const gone = new Set(ids);
    await db.write(
      ids.flatMap((id) => [
        { store: "sessions", key: id, value: undefined },
        { store: "sessionIndex", key: id, value: undefined },
      ]),
    );
    this.all = this.all.filter((s) => !gone.has(s.id));
    this.dispatchEvent(new Event("change"));
  }

  // Deletes all sessions of a profile (deleting it, or clearing the guest's data).
  async removeProfile(profileId) {
    await this.removeMany(this.all.filter((s) => profileOf(s) === profileId).map((s) => s.id));
  }

  // Bytes the app's data takes (as JSON), plus the browser's own estimate when available.
  // sessionsBytes: the active profile's sessions, or everyone's with { all: true }.
  async storage({ all = false } = {}) {
    const size = (v) => (v === undefined ? 0 : new Blob([JSON.stringify(v)]).size);
    const mine = (s) => all || profileOf(s) === profiles.activeId;
    const sessionsBytes = (await db.getAll("sessions")).filter(mine).reduce((sum, s) => sum + size(s), 0);
    // Settings (per profile), profiles and lists: everything in "kv".
    const listsBytes = (await db.getAll("kv")).reduce((sum, v) => sum + size(v), 0);
    const estimate = (await globalThis.navigator?.storage?.estimate?.().catch(() => null)) ?? null;
    return {
      sessionsBytes,
      listsBytes,
      usedBytes: estimate?.usage ?? null,
      quotaBytes: estimate?.quota ?? null,
    };
  }
}

export const sessions = new SessionStore();

export function newSessionId() {
  return `s${Date.now().toString(36)}`;
}
