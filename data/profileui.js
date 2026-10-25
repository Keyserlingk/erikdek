// Profiles in the UI: the name in the header opens a menu to switch profile, and
// Settings → Profiles adds, renames and deletes them (Guest: clear its data).
// Switching waits while a run or an unsaved summary is open, so a session can't end up
// with the wrong person.

import { removePlayData } from "./games/playdata.js";
import { profiles, DEFAULT_PROFILE, GUEST_PROFILE } from "./profiles.js";
import { sessions } from "./sessions.js";
import { settings } from "./settingsstore.js";
import { $, button, create } from "./ui.js";

const el = {
  button: $("profileButton"),
  name: $("profileName"),
  menu: $("profileMenu"),
  list: $("profileList"),
  addName: $("profileAddName"),
  add: $("profileAdd"),
  message: $("profileMessage"),
};

let isBusy = () => false;

function showMessage(text, isError = false) {
  el.message.textContent = text;
  el.message.classList.toggle("error-text", isError);
}

async function switchTo(id) {
  if (id === profiles.activeId) return true;
  if (isBusy()) {
    alert("Finish the run and save or discard it first, then switch profile.");
    return false;
  }
  await profiles.setActive(id);
  return true;
}

function renderHeader() {
  const active = profiles.active;
  el.name.textContent = active.name;
  el.button.dataset.guest = String(Boolean(active.guest));
  el.menu.replaceChildren(
    ...profiles.list.map((p) => {
      const b = button(p.id === profiles.activeId ? "active" : "", p.name, async () => {
        if (await switchTo(p.id)) closeMenu();
      });
      b.setAttribute("aria-pressed", String(p.id === profiles.activeId));
      return b;
    }),
    create("a", { href: "#settings", className: "manage", textContent: "Manage profiles…", onclick: closeMenu }),
  );
}

function closeMenu() {
  el.menu.hidden = true;
  el.button.setAttribute("aria-expanded", "false");
}

function renderSettings() {
  el.list.replaceChildren(
    ...profiles.list.map((p) => {
      const active = p.id === profiles.activeId;
      const actions = [];
      if (!active) actions.push(button("pill-button", "Use", () => switchTo(p.id)));
      actions.push(button("pill-button", "Rename", () => rename(p)));
      if (p.guest) actions.push(button("pill-button danger", "Clear data", () => clearGuest(p)));
      else if (p.id !== DEFAULT_PROFILE && !active) actions.push(button("pill-button danger", "Delete", () => remove(p)));
      const n = sessions.all.filter((s) => (s.profile ?? DEFAULT_PROFILE) === p.id).length;
      return create("li", { className: active ? "active" : "" }, [
        create("span", { className: "profile-info" }, [
          create("strong", { textContent: p.name }),
          create("span", { className: "muted", textContent: `${active ? "In use · " : ""}${n} session${n === 1 ? "" : "s"}` }),
        ]),
        create("span", { className: "profile-actions" }, actions),
      ]);
    }),
  );
}

async function rename(p) {
  const name = prompt("New name", p.name);
  if (name === null) return;
  try {
    await profiles.rename(p.id, name);
    showMessage("");
  } catch (e) {
    showMessage(e.message, true);
  }
}

// Deletes the profile with its sessions and settings.
async function remove(p) {
  if (!confirm(`Delete the profile "${p.name}" with all its sessions? This cannot be undone.`)) return;
  try {
    await sessions.removeProfile(p.id);
    await settings.removeFor(p.id);
    removePlayData(localStorage, p.id);
    await profiles.remove(p.id);
    showMessage(`Deleted "${p.name}".`);
  } catch (e) {
    showMessage(e.message, true);
  }
}

async function clearGuest(p) {
  if (!confirm(`Delete all of ${p.name}'s sessions and settings? This cannot be undone.`)) return;
  try {
    await sessions.removeProfile(GUEST_PROFILE);
    await settings.removeFor(GUEST_PROFILE);
    removePlayData(localStorage, GUEST_PROFILE);
    showMessage(`${p.name}'s data cleared.`);
  } catch (e) {
    showMessage(e.message, true);
  }
}

async function add() {
  try {
    const p = await profiles.add(el.addName.value);
    el.addName.value = "";
    showMessage(`Added "${p.name}". Tap Use to switch to it.`);
  } catch (e) {
    showMessage(e.message, true);
  }
}

// busy(): true while switching profile isn't allowed (a run or an unsaved summary).
export function initProfiles({ busy }) {
  isBusy = busy;
  const render = () => {
    renderHeader();
    renderSettings();
  };
  profiles.addEventListener("change", render);
  sessions.addEventListener("change", renderSettings); // session counts
  el.button.addEventListener("click", (ev) => {
    ev.stopPropagation();
    el.menu.hidden = !el.menu.hidden;
    el.button.setAttribute("aria-expanded", String(!el.menu.hidden));
  });
  document.addEventListener("click", (ev) => {
    if (!el.menu.hidden && !el.menu.contains(ev.target)) closeMenu();
  });
  el.add.addEventListener("click", add);
  el.addName.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") add();
  });
  render();
}
