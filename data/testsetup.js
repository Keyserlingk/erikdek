// Tests tab: the list of tests and the setup screen (hand, hold, grip) before a test.

import { formatDuration } from "./format.js";
import { startRun } from "./runner.js";
import { TagSelect, grips, holdTypes } from "./tags.js";
import { KINDS, TEST_IDS } from "./tests.js";
import { show } from "./trainscreens.js";
import { $, button, create } from "./ui.js";
import { totalDurationS } from "./workout.js";

const SETUP_KEY = "erkdek.testSetup";

const el = {
  tests: $("testList"),
  title: $("setupTitle"),
  description: $("setupDescription"),
  hands: document.querySelectorAll("#setupHand button"),
  cancel: $("setupCancel"),
  start: $("setupStart"),
};

let setup = null; // test being set up: { kind, hand }
let selects = null; // TagSelects: hold, grip

function renderTests() {
  el.tests.replaceChildren(
    ...TEST_IDS.map((id) => {
      const kind = KINDS[id];
      return create("div", { className: "card routine" }, [
        create("div", { className: "routine-head" }, [
          create("h2", { textContent: kind.name }),
          create("span", { className: "muted", textContent: formatDuration(totalDurationS(kind.routine)) }),
        ]),
        create("p", { className: "muted", textContent: kind.description }),
        button("primary", "Start test", () => openSetup(id)),
      ]);
    }),
  );
}

function loadSetupDefaults(kind) {
  try {
    return JSON.parse(localStorage.getItem(SETUP_KEY))?.[kind] || {};
  } catch {
    return {};
  }
}

function saveSetupDefaults(kind, values) {
  try {
    const all = JSON.parse(localStorage.getItem(SETUP_KEY)) || {};
    all[kind] = values;
    localStorage.setItem(SETUP_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable: setup just isn't remembered
  }
}

function setHand(hand) {
  setup.hand = hand;
  for (const b of el.hands) b.classList.toggle("active", b.dataset.hand === hand);
}

function openSetup(kind) {
  const defaults = loadSetupDefaults(kind);
  setup = { kind };
  el.title.textContent = KINDS[kind].name;
  el.description.textContent = KINDS[kind].description;
  setHand(defaults.hand || "both");
  selects.hold.value = defaults.holdType || "";
  selects.grip.value = defaults.grip || "";
  show("setup");
}

function startTest() {
  const values = { hand: setup.hand, holdType: selects.hold.value, grip: selects.grip.value };
  saveSetupDefaults(setup.kind, values);
  const routine = {
    ...KINDS[setup.kind].routine,
    name: KINDS[setup.kind].name,
    holdType: values.holdType,
    grip: values.grip,
    target: { type: "none", value: 0 },
  };
  startRun(setup.kind, routine, values.hand);
}

export function initTestSetup() {
  selects = {
    hold: new TagSelect($("setupHold"), holdTypes, "Hold", "e.g. 18 mm edge"),
    grip: new TagSelect($("setupGrip"), grips, "Grip", "e.g. Four-finger open"),
  };
  for (const b of el.hands) b.addEventListener("click", () => setHand(b.dataset.hand));
  el.cancel.addEventListener("click", () => show("tests"));
  el.start.addEventListener("click", startTest);
  renderTests();
}
