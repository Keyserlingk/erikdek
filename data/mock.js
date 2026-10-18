import { device } from "./device.js";

// Simulator controls, only shown when connected to tools/mock_server.py.
const el = {
  badge: document.getElementById("mock"),
  panel: document.getElementById("mockPanel"),
  kg: document.getElementById("mockKg"),
  buttons: document.querySelectorAll("#mockPanel [data-scenario]"),
  follow: document.getElementById("mockFollow"),
};

// "Pull during each hang": pull the simulated weight while a workout/test is in a
// hang phase and let go otherwise, like a real climber following the timer.
function followPhase(type) {
  if (!device.status?.mock || !el.follow.checked) return;
  if (type === "work") device.send("mock", { scenario: "pull", kg: parseFloat(el.kg.value) || 20 });
  else device.send("mock", { scenario: "idle" });
}

function render() {
  const st = device.status;
  el.badge.hidden = !st || !st.mock;
  if (el.badge.hidden) el.panel.hidden = true;
  for (const b of el.buttons) b.classList.toggle("active", st && b.dataset.scenario === st.scenario);
}

export function initMock() {
  device.on("status", render);
  device.on("connection", render);
  window.addEventListener("tindek:phase", (ev) => followPhase(ev.detail.type));
  el.badge.addEventListener("click", () => {
    el.panel.hidden = !el.panel.hidden;
  });
  for (const b of el.buttons) {
    b.addEventListener("click", () => {
      const args = { scenario: b.dataset.scenario };
      if (args.scenario === "weight") args.kg = parseFloat(el.kg.value) || 20;
      device.send("mock", args);
    });
  }
}
