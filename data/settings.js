import { device } from "./device.js";
import { formatBytes } from "./format.js";
import { sessions } from "./sessions.js";
import {
  MAX_BODYWEIGHT_KG,
  MAX_REP_THRESHOLD_KG,
  MIN_BODYWEIGHT_KG,
  MIN_REP_THRESHOLD_KG,
  settings,
} from "./settingsstore.js";
import { grips, holdTypes, initTagManager } from "./tags.js";

const el = {
  bodyweight: document.getElementById("setBodyweight"),
  repThreshold: document.getElementById("setRepThreshold"),
  save: document.getElementById("setSave"),
  message: document.getElementById("setMessage"),
};

// ---------------------------------------------------------------- About

const about = {
  web: document.getElementById("aboutWeb"),
  fw: document.getElementById("aboutFw"),
  sessions: document.getElementById("aboutSessions"),
  lists: document.getElementById("aboutLists"),
  used: document.getElementById("aboutUsed"),
  quota: document.getElementById("aboutQuota"),
};

// Refreshes versions and the storage breakdown; called when Settings is shown.
export async function showAbout() {
  about.fw.textContent = device.status?.fw || "–";
  try {
    const res = await fetch("/version.json");
    about.web.textContent = res.ok ? (await res.json()).version : "–";
  } catch {
    about.web.textContent = "–";
  }
  try {
    const st = await sessions.storage();
    about.sessions.textContent = `${formatBytes(st.sessionsBytes)} (${sessions.index.length})`;
    about.lists.textContent = formatBytes(st.listsBytes);
    // The browser's estimate for the whole app (data plus its own overhead).
    about.used.textContent = st.usedBytes === null ? "–" : formatBytes(st.usedBytes);
    about.quota.textContent = st.quotaBytes === null ? "–" : formatBytes(st.quotaBytes - (st.usedBytes ?? 0));
  } catch {
    for (const key of ["sessions", "lists", "used", "quota"]) about[key].textContent = "–";
  }
}

function showMessage(text, isError = false) {
  el.message.textContent = text;
  el.message.classList.toggle("error-text", isError);
}

export function initSettings() {
  settings.onChange((v) => {
    el.bodyweight.value = v.bodyweightKg > 0 ? v.bodyweightKg : "";
    el.repThreshold.value = v.repThresholdKg;
  });
  device.on("status", (st) => {
    about.fw.textContent = st.fw || "–";
  });
  settings.load().catch((e) => showMessage(e.message, true));

  initTagManager(
    document.getElementById("manageHolds"),
    holdTypes,
    "Your holds",
    "Added to the standard holds (edges, pinch, sloper…) when choosing a hold.",
    "e.g. 18 mm edge",
  );
  initTagManager(
    document.getElementById("manageGrips"),
    grips,
    "Your grips",
    "Added to the standard grips (open hand, half crimp…) when choosing a grip.",
    "e.g. Four-finger open",
  );

  el.save.addEventListener("click", async () => {
    const text = el.bodyweight.value.trim();
    const bw = text === "" ? 0 : parseFloat(text);
    if (bw !== 0 && !(bw >= MIN_BODYWEIGHT_KG && bw <= MAX_BODYWEIGHT_KG)) {
      showMessage(`Bodyweight must be between ${MIN_BODYWEIGHT_KG} and ${MAX_BODYWEIGHT_KG} kg.`, true);
      return;
    }
    const thr = parseFloat(el.repThreshold.value);
    if (!(thr >= MIN_REP_THRESHOLD_KG && thr <= MAX_REP_THRESHOLD_KG)) {
      showMessage(`Rep threshold must be between ${MIN_REP_THRESHOLD_KG} and ${MAX_REP_THRESHOLD_KG} kg.`, true);
      return;
    }
    try {
      await settings.save({ bodyweightKg: bw, repThresholdKg: thr });
      showMessage("Saved.");
    } catch (e) {
      showMessage(e.message, true);
    }
  });
}
