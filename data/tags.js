// Holds and grips: a standard list in the web app plus the user's own entries, stored on
// the device (GET/PUT /api/holdtypes, /api/grips). Also the dropdown and the Settings
// manager used for both.

export const MAX_TAG_LENGTH = 30;
const NEW_VALUE = "__new__";

class TagList extends EventTarget {
  constructor(url, builtins) {
    super();
    this.url = url;
    this.builtins = builtins;
    this.custom = [];
  }

  get all() {
    return [...this.builtins, ...this.custom];
  }

  // Returns an error message, or null when name can be added.
  validate(name) {
    if (!name) return "Enter a name.";
    if (name.length > MAX_TAG_LENGTH) return `Max ${MAX_TAG_LENGTH} characters.`;
    if (this.all.some((h) => h.toLowerCase() === name.toLowerCase())) return `"${name}" already exists.`;
    return null;
  }

  async load() {
    const res = await fetch(this.url);
    if (!res.ok) throw new Error(`Loading ${this.url} failed (${res.status})`);
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
    const res = await fetch(this.url, {
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

// What you hang on.
export const holdTypes = new TagList("/api/holdtypes", [
  "20 mm edge",
  "15 mm edge",
  "10 mm edge",
  "8 mm edge",
  "6 mm edge",
  "Pinch",
  "Sloper",
  "Pocket",
  "Jug",
]);

// How the hand/fingers hold it.
export const grips = new TagList("/api/grips", [
  "Open hand",
  "Half crimp",
  "Full crimp",
  "Three-finger drag",
  "Front two",
  "Middle two",
  "Back two",
  "Mono",
]);

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// Dropdown with "Not specified", the standard entries, the user's own, and "+ Add new…".
export class TagSelect {
  constructor(container, store, label, placeholder) {
    this.store = store;
    this.selected = "";
    this.select = el("select");
    this.input = el("input", { type: "text", maxLength: MAX_TAG_LENGTH, placeholder });
    this.input.setAttribute("aria-label", `New ${label.toLowerCase()}`);
    this.addButton = el("button", { type: "button", className: "secondary compact", textContent: "Add" });
    this.error = el("div", { className: "error", hidden: true });
    this.newRow = el("div", { hidden: true }, [el("div", { className: "field" }, [this.input, this.addButton]), this.error]);
    container.replaceChildren(
      el("label", { className: "field stacked" }, [el("span", { textContent: label }), this.select]),
      this.newRow,
    );

    this.select.addEventListener("change", () => {
      if (this.select.value === NEW_VALUE) {
        this._showNew(true);
      } else {
        this.selected = this.select.value;
        this._showNew(false);
      }
    });
    this.addButton.addEventListener("click", () => this._add());
    this.input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") this._add();
    });
    store.addEventListener("change", () => this._render());
    this._render();
  }

  get value() {
    return this.selected;
  }

  set value(v) {
    this.selected = v || "";
    this._showNew(false);
    this._render();
  }

  _render() {
    const option = (value, label) => el("option", { value, textContent: label });
    const standard = el("optgroup", { label: "Standard" }, this.store.builtins.map((h) => option(h, h)));
    // Keep a value selectable even if it was removed from the list.
    const custom = [...this.store.custom];
    if (this.selected && !this.store.all.includes(this.selected)) custom.push(this.selected);
    this.select.replaceChildren(option("", "Not specified"), standard);
    if (custom.length) this.select.append(el("optgroup", { label: "Your own" }, custom.map((h) => option(h, h))));
    this.select.append(option(NEW_VALUE, "+ Add new…"));
    this.select.value = this.selected;
  }

  _showNew(visible) {
    this.newRow.hidden = !visible;
    this.error.hidden = true;
    this.input.value = "";
    if (visible) this.input.focus();
  }

  async _add() {
    const name = this.input.value.trim();
    try {
      await this.store.add(name);
      this.value = name;
    } catch (err) {
      this.error.textContent = err.message;
      this.error.hidden = false;
    }
  }
}

// Settings card listing the user's own entries with Delete, plus an add field.
export function initTagManager(container, store, title, description, placeholder) {
  const list = el("ul", { className: "item-list" });
  const input = el("input", { type: "text", maxLength: MAX_TAG_LENGTH, placeholder });
  input.setAttribute("aria-label", title);
  const addButton = el("button", { type: "button", className: "secondary compact", textContent: "Add" });
  const error = el("div", { className: "error", hidden: true });
  container.replaceChildren(
    el("h2", { textContent: title }),
    el("p", { className: "muted", textContent: description }),
    list,
    el("div", { className: "field" }, [input, addButton]),
    error,
  );

  const showError = (text) => {
    error.textContent = text;
    error.hidden = !text;
  };
  const render = () => {
    const items = store.custom.map((name) => {
      const remove = el("button", { type: "button", className: "link danger", textContent: "Delete" });
      remove.addEventListener("click", () => store.remove(name).catch((e) => showError(e.message)));
      return el("li", {}, [el("span", { textContent: name }), remove]);
    });
    if (!items.length) items.push(el("li", { className: "muted", textContent: "None yet." }));
    list.replaceChildren(...items);
  };
  const add = async () => {
    try {
      await store.add(input.value.trim());
      input.value = "";
      showError("");
    } catch (e) {
      showError(e.message);
    }
  };

  store.addEventListener("change", render);
  addButton.addEventListener("click", add);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") add();
  });
  render();
}
