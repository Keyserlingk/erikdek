// Settings → Backup: download everything as one JSON file, and restore from it.

import { device } from "./device.js";
import { downloadJson } from "./download.js";
import { buildBackup, fileDate, mergeBy, parseBackup } from "./export.js";
import { routines } from "./routines.js";
import { sessions } from "./sessions.js";
import { settings } from "./settingsstore.js";
import { formatDateTime } from "./sessionview.js";
import { grips, holdTypes } from "./tags.js";
import { workouts } from "./workouts.js";

const $ = (id) => document.getElementById(id);
const el = {
  download: $("backupDownload"),
  file: $("backupFile"),
  preview: $("restorePreview"),
  summary: $("restoreSummary"),
  options: {
    settings: $("restoreSettings"),
    routines: $("restoreRoutines"),
    sessions: $("restoreSessions"),
    calibration: $("restoreCalibration"),
  },
  restore: $("restoreRun"),
  cancel: $("restoreCancel"),
  message: $("backupMessage"),
};

let pending = null; // parsed backup waiting for confirmation

function showMessage(text, isError = false) {
  el.message.textContent = text;
  el.message.classList.toggle("error-text", isError);
}

function setBusy(busy) {
  el.download.disabled = busy;
  el.file.disabled = busy;
  el.restore.disabled = busy;
}

async function createBackup() {
  setBusy(true);
  try {
    await sessions.load();
    const full = [];
    for (const [i, s] of sessions.index.entries()) {
      showMessage(`Collecting sessions ${i + 1}/${sessions.index.length}…`);
      full.push(await sessions.get(s.id));
    }
    const st = device.status;
    const backup = buildBackup({
      settings: settings.values,
      calibration: st?.calibrated ? { cpk: st.cpk, calibrated: true } : null,
      routines: routines.custom,
      workouts: workouts.list,
      holdTypes: holdTypes.custom,
      grips: grips.custom,
      sessions: full,
    });
    await downloadJson(`erkdek-backup-${fileDate()}.json`, backup);
    showMessage(`Backup downloaded: ${full.length} sessions, ${routines.custom.length} routines.`);
  } catch (e) {
    showMessage(e.message, true);
  } finally {
    setBusy(false);
  }
}

async function openFile() {
  const file = el.file.files[0];
  el.file.value = "";
  if (!file) return;
  try {
    pending = parseBackup(await file.text());
  } catch (e) {
    pending = null;
    el.preview.hidden = true;
    showMessage(e.message, true);
    return;
  }
  const b = pending;
  const tags = b.holdTypes.length + b.grips.length;
  el.summary.textContent =
    `Backup from ${b.exportedAt ? formatDateTime(b.exportedAt) : "unknown date"}: ` +
    `${b.sessions.length} sessions, ${b.routines.length} routines, ${b.workouts.length} workouts, ${tags} own holds/grips` +
    `${b.calibration ? ", calibration" : ""}.`;
  el.options.settings.checked = !!b.settings;
  el.options.settings.disabled = !b.settings;
  el.options.routines.checked = true;
  el.options.sessions.checked = true;
  el.options.calibration.checked = false; // belongs to a specific load cell
  el.options.calibration.disabled = !b.calibration;
  el.preview.hidden = false;
  showMessage("");
}

async function restore() {
  const b = pending;
  const o = el.options;
  const done = [];
  setBusy(true);
  try {
    if (o.settings.checked && b.settings) {
      const { bodyweightKg, repThresholdKg, startOnForce } = b.settings;
      await settings.save({ bodyweightKg, repThresholdKg, ...(typeof startOnForce === "boolean" ? { startOnForce } : {}) });
      done.push("settings");
    }
    if (o.routines.checked) {
      await routines.replaceAll(mergeBy(routines.custom, b.routines, (r) => r.id));
      await workouts.replaceAll(mergeBy(workouts.list, b.workouts, (w) => w.id));
      await holdTypes.replaceAll(mergeBy(holdTypes.custom, b.holdTypes, (h) => h.toLowerCase()));
      await grips.replaceAll(mergeBy(grips.custom, b.grips, (g) => g.toLowerCase()));
      done.push(`${b.routines.length} routines, ${b.workouts.length} workouts`);
    }
    if (o.sessions.checked) {
      await sessions.load();
      const existing = new Set(sessions.index.map((s) => s.id));
      const missing = b.sessions.filter((s) => !existing.has(s.id));
      for (const [i, s] of missing.entries()) {
        showMessage(`Restoring sessions ${i + 1}/${missing.length}…`);
        await sessions.save(s);
      }
      done.push(`${missing.length} sessions (${b.sessions.length - missing.length} already there)`);
    }
    if (o.calibration.checked && b.calibration) {
      // Calibration lives on the sensor, so it needs a connection.
      if (device.send("setCalibration", { cpk: b.calibration.cpk })) done.push("calibration");
      else done.push("not the calibration (no device connected)");
    }
    pending = null;
    el.preview.hidden = true;
    showMessage(done.length ? `Restored ${done.join(", ")}.` : "Nothing selected to restore.");
  } catch (e) {
    showMessage(`Restore stopped: ${e.message}${done.length ? ` (done: ${done.join(", ")})` : ""}`, true);
  } finally {
    setBusy(false);
  }
}

export function initBackup() {
  el.download.addEventListener("click", createBackup);
  el.file.addEventListener("change", openFile);
  el.restore.addEventListener("click", restore);
  el.cancel.addEventListener("click", () => {
    pending = null;
    el.preview.hidden = true;
  });
  setBusy(false);
}
