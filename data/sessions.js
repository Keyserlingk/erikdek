// Saved sessions, stored in the app: the full session in db "sessions" and the same
// without reps and curve in "sessionIndex". The index is kept in memory for History;
// full sessions are read on demand. Fires "change" when the index changes.

import { db } from "./db.js";

const DETAIL_ONLY = ["reps", "curve"];
const SESSION_ID = /^[a-z0-9]{1,16}$/;

export function indexEntry(session) {
  return Object.fromEntries(Object.entries(session).filter(([key]) => !DETAIL_ONLY.includes(key)));
}

class SessionStore extends EventTarget {
  constructor() {
    super();
    this.index = [];
  }

  async load() {
    this.index = await db.getAll("sessionIndex");
    this.dispatchEvent(new Event("change"));
  }

  async get(id) {
    const session = await db.get("sessions", id);
    if (!session) throw new Error("This session no longer exists.");
    return session;
  }

  async save(session) {
    if (typeof session?.id !== "string" || !SESSION_ID.test(session.id)) throw new Error("Invalid session id.");
    if (await db.get("sessionIndex", session.id)) throw new Error("This session is already saved.");
    const entry = indexEntry(session);
    await db.write([
      { store: "sessions", key: session.id, value: session },
      { store: "sessionIndex", key: session.id, value: entry },
    ]);
    this.index.push(entry);
    this.dispatchEvent(new Event("change"));
  }

  async remove(id) {
    await db.write([
      { store: "sessions", key: id, value: undefined },
      { store: "sessionIndex", key: id, value: undefined },
    ]);
    this.index = this.index.filter((s) => s.id !== id);
    this.dispatchEvent(new Event("change"));
  }

  // Bytes the app's data takes (as JSON), plus the browser's own estimate when available.
  async storage() {
    const size = (v) => (v === undefined ? 0 : new Blob([JSON.stringify(v)]).size);
    const sessionsBytes = (await db.getAll("sessions")).reduce((sum, s) => sum + size(s), 0);
    let listsBytes = 0;
    for (const key of ["settings", "routines", "workouts", "holdtypes", "grips"]) listsBytes += size(await db.get("kv", key));
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
