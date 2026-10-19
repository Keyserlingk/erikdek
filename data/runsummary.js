// Summary of a finished routine or test: shown before the session is saved or discarded.

import { downloadCsv, downloadJson } from "./download.js";
import { curveCsv, fileDate, hasCurveData, repsCsv } from "./export.js";
import { sessions } from "./sessions.js";
import { renderSession } from "./sessionview.js";
import { summarizeTraining } from "./tests.js";
import { homeOf, show, showNotice } from "./trainscreens.js";
import { $, create } from "./ui.js";

const el = {
  view: $("sumView"),
  sets: $("sumSets"),
  setRows: $("sumSetRows"),
  error: $("sumError"),
  discard: $("sumDiscard"),
  save: $("sumSave"),
  rawCsv: $("sumRawCsv"),
  repsCsv: $("sumRepsCsv"),
  json: $("sumJson"),
};

let result = null; // finished, unsaved session
let resultRaw = null; // its full-rate curve and per-sample phase (not saved with the session)
let summaryChart = null;

export const hasResult = () => result !== null;

export function showResult(session, raw) {
  result = session;
  resultRaw = raw;
  if (summaryChart) summaryChart.destroy();
  el.error.hidden = true;
  el.save.disabled = false;
  // Without the sensor there is no force to download.
  el.rawCsv.hidden = !hasCurveData(raw);
  el.repsCsv.hidden = !session.reps.length;
  show("summary");
  summaryChart = renderSession(el.view, result);
  renderSetEditor();
}

// Routines without the sensor: effort and weight per set can be filled in or corrected
// before saving (the last set is always logged here).
function renderSetEditor() {
  const sets = result?.sets;
  el.sets.hidden = !sets?.length;
  if (!sets?.length) return;
  const r = result.routine;
  const usesWeight = r.addedWeightKg !== null && r.addedWeightKg !== undefined;
  const refresh = () => {
    result.summary = summarizeTraining(result.reps, result.sets, r);
    renderSession(el.view, result);
  };
  el.setRows.replaceChildren(
    ...sets.map((log) => {
      const select = create("select", {}, [
        create("option", { value: "", textContent: "Effort –" }),
        ...Array.from({ length: 10 }, (_, i) => create("option", { value: String(i + 1), textContent: `Effort ${i + 1}` })),
      ]);
      select.value = log.rpe ?? "";
      select.addEventListener("change", () => {
        log.rpe = select.value ? Number(select.value) : null;
        refresh();
      });
      const cells = [create("strong", { textContent: `Set ${log.set}` }), select];
      if (usesWeight) {
        const input = create("input", { type: "number", step: "0.5", inputMode: "decimal", value: log.addedWeightKg ?? "" });
        input.setAttribute("aria-label", `Added weight in set ${log.set} (kg)`);
        input.addEventListener("change", () => {
          const v = parseFloat(input.value);
          log.addedWeightKg = Number.isFinite(v) ? v : null;
          refresh();
        });
        cells.push(input);
      }
      return create("div", { className: "set-row" }, cells);
    }),
  );
}

async function saveResult() {
  el.save.disabled = true;
  try {
    await sessions.save(result);
    const home = homeOf(result.type);
    result = null;
    resultRaw = null;
    show(home);
    showNotice(home, "Saved to history.");
  } catch (err) {
    el.error.textContent = err.message;
    el.error.hidden = false;
    el.save.disabled = false;
  }
}

function discardResult() {
  if (!confirm("Discard this session? It will not be saved.")) return;
  const home = homeOf(result.type);
  result = null;
  resultRaw = null;
  show(home);
}

export function initSummary() {
  el.save.addEventListener("click", saveResult);
  el.rawCsv.addEventListener("click", () =>
    downloadCsv(`erkdek-${result.type}-${fileDate(new Date(result.startedAt))}-${result.id}-raw.csv`, curveCsv(resultRaw, resultRaw.phases)),
  );
  el.repsCsv.addEventListener("click", () =>
    downloadCsv(`erkdek-${result.type}-${fileDate(new Date(result.startedAt))}-${result.id}-reps.csv`, repsCsv(result)),
  );
  el.json.addEventListener("click", () =>
    downloadJson(`erkdek-${result.type}-${fileDate(new Date(result.startedAt))}-${result.id}.json`, result),
  );
  el.discard.addEventListener("click", discardResult);
}
