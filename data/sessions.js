// Saved sessions on the device. The index (one summary per session, no curves) is kept
// in memory; full sessions are fetched on demand. Fires "change" when the index changes.

class SessionStore extends EventTarget {
  constructor() {
    super();
    this.index = [];
  }

  async load() {
    const res = await fetch("/api/sessions");
    if (!res.ok) throw new Error(`Loading history failed (${res.status})`);
    const text = await res.text();
    this.index = text
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
    this.dispatchEvent(new Event("change"));
  }

  async get(id) {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`Loading session failed (${res.status})`);
    return res.json();
  }

  async save(session) {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 507) throw new Error("The device storage is full. Delete old sessions in History.");
    if (!res.ok) throw new Error(body.error || `Saving failed (${res.status})`);
    this.index.push(body);
    this.dispatchEvent(new Event("change"));
  }

  async remove(id) {
    const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Deleting failed (${res.status})`);
    this.index = this.index.filter((s) => s.id !== id);
    this.dispatchEvent(new Event("change"));
  }

  async storage() {
    const res = await fetch("/api/storage");
    if (!res.ok) throw new Error(`Loading storage info failed (${res.status})`);
    return res.json();
  }
}

export const sessions = new SessionStore();

export function newSessionId() {
  return `s${Date.now().toString(36)}`;
}
