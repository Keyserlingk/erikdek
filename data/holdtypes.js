// Hold types for routines: a standard list in the web app plus the user's own,
// stored on the device (GET/PUT /api/holdtypes). Fires "change" after load/save.

export const BUILTIN_HOLD_TYPES = [
  "20 mm edge",
  "15 mm edge",
  "10 mm edge",
  "Open hand",
  "Half crimp",
  "Full crimp",
  "Three-finger drag",
  "Front two",
  "Middle two",
  "Back two",
  "Pinch",
  "Sloper",
  "Jug",
];

export const MAX_HOLD_TYPE_LENGTH = 30;

class HoldTypeStore extends EventTarget {
  constructor() {
    super();
    this.custom = [];
  }

  get all() {
    return [...BUILTIN_HOLD_TYPES, ...this.custom];
  }

  // Returns an error message, or null when name can be added.
  validate(name) {
    if (!name) return "Enter a name for the hold type.";
    if (name.length > MAX_HOLD_TYPE_LENGTH) return `Max ${MAX_HOLD_TYPE_LENGTH} characters.`;
    if (this.all.some((h) => h.toLowerCase() === name.toLowerCase())) return `"${name}" already exists.`;
    return null;
  }

  async load() {
    const res = await fetch("/api/holdtypes");
    if (!res.ok) throw new Error(`Loading hold types failed (${res.status})`);
    this.custom = await res.json();
    this.dispatchEvent(new Event("change"));
  }

  async add(name) {
    const error = this.validate(name);
    if (error) throw new Error(error);
    await this._put([...this.custom, name]);
  }

  async remove(name) {
    await this._put(this.custom.filter((h) => h !== name));
  }

  async _put(list) {
    const res = await fetch("/api/holdtypes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(list),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Saving failed (${res.status})`);
    this.custom = body;
    this.dispatchEvent(new Event("change"));
  }
}

export const holdTypes = new HoldTypeStore();
