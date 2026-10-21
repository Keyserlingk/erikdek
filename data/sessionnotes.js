// Notes and tags for a session: a short note and tags such as "Good skin" or "Gym",
// picked from suggestions and your own. Edited on the summary before saving and in
// History afterwards; History can filter by tag.

import { MAX_NOTE_LENGTH, MAX_SESSION_TAG_LENGTH, MAX_TAGS, sessions } from "./sessions.js";

// Offered on every session; tags used before are added to them.
export const SUGGESTED_TAGS = ["Good skin", "Bad skin", "Slept well", "Slept badly", "Tired", "Strong", "Home", "Gym"];

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// Every tag on offer: the suggestions, then tags used on any session.
function allTags(current) {
  const used = sessions.all.flatMap((s) => s.tags ?? []);
  return [...new Set([...SUGGESTED_TAGS, ...used, ...current])];
}

// A "Notes" card for `s` ({ note, tags }). onChange({ note, tags }) runs after each change:
// a tag toggled or added, or the note edited (when the field loses focus).
export function notesCard(s, onChange) {
  const state = { note: s.note ?? "", tags: [...(s.tags ?? [])] };
  const chips = el("div", { className: "tag-chips" });
  const note = el("textarea", { rows: 2, maxLength: MAX_NOTE_LENGTH, value: state.note, placeholder: "How did it go? Skin, sleep, conditions…" });
  note.setAttribute("aria-label", "Notes");
  const newTag = el("input", { type: "text", maxLength: MAX_SESSION_TAG_LENGTH, placeholder: "New tag" });
  newTag.setAttribute("aria-label", "New tag");
  const message = el("p", { className: "message error-text" });

  const changed = () => {
    message.textContent = "";
    Promise.resolve(onChange({ note: state.note, tags: [...state.tags] })).catch((e) => {
      message.textContent = e.message;
    });
  };

  function renderChips() {
    chips.replaceChildren(
      ...allTags(state.tags).map((tag) => {
        const on = state.tags.includes(tag);
        const b = el("button", { type: "button", className: `tag-chip${on ? " active" : ""}`, textContent: tag });
        b.setAttribute("aria-pressed", String(on));
        b.addEventListener("click", () => {
          if (on) state.tags = state.tags.filter((t) => t !== tag);
          else if (state.tags.length < MAX_TAGS) state.tags = [...state.tags, tag];
          else return (message.textContent = `At most ${MAX_TAGS} tags.`);
          renderChips();
          changed();
        });
        return b;
      }),
    );
  }

  const add = () => {
    const tag = newTag.value.trim();
    if (!tag) return;
    newTag.value = "";
    if (state.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
    if (state.tags.length >= MAX_TAGS) return (message.textContent = `At most ${MAX_TAGS} tags.`);
    state.tags = [...state.tags, tag];
    renderChips();
    changed();
  };
  const addButton = el("button", { type: "button", className: "secondary", textContent: "Add" });
  addButton.addEventListener("click", add);
  newTag.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") add();
  });
  note.addEventListener("change", () => {
    state.note = note.value.trim();
    changed();
  });

  renderChips();
  return el("div", { className: "card notes-card" }, [
    el("h2", { textContent: "Notes" }),
    chips,
    el("div", { className: "field" }, [newTag, addButton]),
    note,
    message,
  ]);
}
