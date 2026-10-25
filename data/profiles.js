// Profiles: several people on one phone, kept apart locally. Each profile has its own
// sessions and settings (bodyweight, thresholds); routines, tests, workouts, holds and
// grips, the calibration and the display settings are shared. Stored in db "kv" →
// "profiles" as { list: [{ id, name, guest?, friend?, shareId? }], active }. Friend
// profiles hold results shared from someone else's phone (share.js): read-only, never
// the active profile. "Guest" is for a friend on this phone:
// its data can be cleared in one go. No DOM access, so it runs under node --test too.

import { db } from "./db.js";

export const DEFAULT_PROFILE = "me";
export const GUEST_PROFILE = "guest";
const DEFAULTS = {
  list: [
    { id: DEFAULT_PROFILE, name: "Me" },
    { id: GUEST_PROFILE, name: "Guest", guest: true },
  ],
  active: DEFAULT_PROFILE,
};
export const MAX_PROFILES = 10;
export const MAX_PROFILE_NAME = 20;

let idCounter = 0;
function newProfileId() {
  idCounter = (idCounter + 1) % 1296;
  return `p${Date.now().toString(36)}${idCounter.toString(36)}`;
}

class ProfileStore extends EventTarget {
  constructor() {
    super();
    this.data = structuredClone(DEFAULTS);
  }

  get list() {
    return this.data.list;
  }

  // The people using this phone (not the friends whose results were imported).
  get local() {
    return this.data.list.filter((p) => !p.friend);
  }

  get activeId() {
    return this.data.active;
  }

  get active() {
    return this.find(this.data.active);
  }

  find(id) {
    return this.data.list.find((p) => p.id === id) || null;
  }

  async load() {
    const stored = await db.get("kv", "profiles");
    this.data = stored?.list?.length ? stored : structuredClone(DEFAULTS);
    if (!this.find(this.data.active)) this.data.active = DEFAULT_PROFILE;
    this.dispatchEvent(new Event("change"));
  }

  // Returns an error message, or null when the name can be used (for profile `id`).
  validateName(name, id = null) {
    const n = (name || "").trim();
    if (!n) return "Enter a name.";
    if (n.length > MAX_PROFILE_NAME) return `Name is too long (max ${MAX_PROFILE_NAME} characters).`;
    if (this.list.some((p) => p.id !== id && p.name.toLowerCase() === n.toLowerCase())) return `"${n}" already exists.`;
    return null;
  }

  async add(name) {
    const error = this.validateName(name);
    if (error) throw new Error(error);
    if (this.local.length >= MAX_PROFILES) throw new Error(`At most ${MAX_PROFILES} profiles.`);
    const profile = { id: newProfileId(), name: name.trim() };
    await this._put({ ...this.data, list: [...this.list, profile] });
    return profile;
  }

  async rename(id, name) {
    const error = this.validateName(name, id);
    if (error) throw new Error(error);
    await this._put({ ...this.data, list: this.list.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)) });
  }

  // Removes the profile from the list (its sessions and settings are removed by the caller).
  async remove(id) {
    if (id === DEFAULT_PROFILE || id === GUEST_PROFILE) throw new Error("This profile can't be deleted.");
    if (id === this.activeId) throw new Error("Switch to another profile first.");
    await this._put({ ...this.data, list: this.list.filter((p) => p.id !== id) });
  }

  async setActive(id) {
    if (!this.find(id) || this.find(id).friend) throw new Error("Unknown profile.");
    await this._put({ ...this.data, active: id });
  }

  // A stable random id for sharing this profile's results: the friend's phone files
  // every share from it under the same friend profile.
  async shareIdOf(id) {
    const p = this.find(id);
    if (p.shareId) return p.shareId;
    const shareId = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => (b % 36).toString(36)).join("");
    await this._put({ ...this.data, list: this.list.map((x) => (x.id === id ? { ...x, shareId } : x)) });
    return shareId;
  }

  // The friend profile for a share (created on the first import, renamed if the friend
  // renamed themselves). Returns its id.
  async upsertFriend(shareId, name) {
    const id = `f${shareId}`;
    const existing = this.find(id);
    const taken = (n) => this.list.some((p) => p.id !== id && p.name.toLowerCase() === n.toLowerCase());
    const base = name.trim().slice(0, MAX_PROFILE_NAME) || "Friend";
    let unique = base;
    for (let i = 2; taken(unique); i++) unique = `${base.slice(0, MAX_PROFILE_NAME - 3)} ${i}`;
    if (existing && existing.name === unique) return id;
    const friend = { id, name: unique, friend: true };
    const list = existing ? this.list.map((p) => (p.id === id ? { ...p, name: unique } : p)) : [...this.list, friend];
    await this._put({ ...this.data, list });
    return id;
  }

  // Adds profiles from a backup that this phone doesn't have yet (by id).
  async merge(list) {
    const known = new Set(this.list.map((p) => p.id));
    const added = list.filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && !known.has(p.id));
    if (added.length) await this._put({ ...this.data, list: [...this.list, ...added] });
  }

  async _put(data) {
    await db.write([{ store: "kv", key: "profiles", value: data }]);
    this.data = data;
    this.dispatchEvent(new Event("change"));
  }
}

export const profiles = new ProfileStore();

// The profile a stored session belongs to.
export const profileOf = (session) => session.profile ?? DEFAULT_PROFILE;
