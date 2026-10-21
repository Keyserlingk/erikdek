// Local storage for the app's data: IndexedDB in the browser / Android app, an
// in-memory map under node --test. Stores:
//   kv            settings and lists (routines, workouts, holds, grips) by key
//   sessions      full sessions (summary, reps, curve) by id
//   sessionIndex  the same sessions without reps and curve, for History lists

const DB_NAME = "erkdek";
const DB_VERSION = 1;
export const STORES = ["kv", "sessions", "sessionIndex"];

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

class IdbBackend {
  constructor() {
    this.dbPromise = null;
  }

  open() {
    if (!this.dbPromise) {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        for (const name of STORES) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      };
      this.dbPromise = request(req);
      // Ask the browser not to evict the data under storage pressure (no-op where unsupported).
      navigator.storage?.persist?.().catch(() => {});
    }
    return this.dbPromise;
  }

  async get(store, key) {
    const db = await this.open();
    return request(db.transaction(store).objectStore(store).get(key));
  }

  async getAll(store) {
    const db = await this.open();
    return request(db.transaction(store).objectStore(store).getAll());
  }

  // Applies [{ store, key, value }] (value undefined = delete) in one transaction.
  async write(ops) {
    if (!ops.length) return; // IndexedDB rejects a transaction without stores
    const db = await this.open();
    const tx = db.transaction([...new Set(ops.map((op) => op.store))], "readwrite");
    for (const { store, key, value } of ops) {
      if (value === undefined) tx.objectStore(store).delete(key);
      else tx.objectStore(store).put(value, key);
    }
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Saving failed"));
    });
  }
}

export class MemoryBackend {
  constructor() {
    this.data = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  }

  async get(store, key) {
    return structuredClone(this.data[store].get(key));
  }

  async getAll(store) {
    return [...this.data[store].values()].map((v) => structuredClone(v));
  }

  async write(ops) {
    for (const { store, key, value } of ops) {
      if (value === undefined) this.data[store].delete(key);
      else this.data[store].set(key, structuredClone(value));
    }
  }
}

// The backend all stores use. Tests swap it with useBackend(new MemoryBackend()).
export let db = typeof indexedDB !== "undefined" ? new IdbBackend() : new MemoryBackend();

export function useBackend(backend) {
  db = backend;
}

// Shared by the list stores: a JSON array under one key in "kv".
export async function loadList(key) {
  return (await db.get("kv", key)) ?? [];
}

export async function saveList(key, list, maxItems) {
  if (!Array.isArray(list)) throw new Error("Expected a list.");
  if (list.length > maxItems) throw new Error(`Too many items (max ${maxItems}).`);
  await db.write([{ store: "kv", key, value: list }]);
  return structuredClone(list);
}
