// Tests tab: your saved tests and the protocols to make them from. A test is a routine
// with a fixed protocol (protocols.js): set up once (name, hold, grip, hands), then run
// the same way every time, so History compares like with like.

import { BUILTIN_TESTS, routines } from "./routines.js";
import { routineCard } from "./routinelist.js";
import { $, create } from "./ui.js";

const el = { list: $("testList") };

export function renderTests() {
  const mine = routines.tests;
  el.list.replaceChildren(
    ...(mine.length ? [create("h2", { className: "section", textContent: "My tests" }), ...mine.map(routineCard)] : []),
    create("h2", { className: "section", textContent: "Protocols" }),
    create("p", {
      className: "muted",
      textContent: mine.length
        ? "Copy a protocol to set up another test."
        : "Copy a protocol to set up your test once: name, hold, grip and hands. The timing is fixed, so your results compare over time.",
    }),
    ...BUILTIN_TESTS.map(routineCard),
  );
}

export function initTestList() {
  routines.addEventListener("change", renderTests);
  renderTests();
}
