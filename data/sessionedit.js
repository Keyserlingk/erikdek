// Editing a saved session in History: its details (name, date and time, hangboard,
// hold, grip, hand, bodyweight) and which reps count. Excluded reps stay in the session
// (they can be included again) and the results are recomputed without them.

import { MAX_BODYWEIGHT_KG, MIN_BODYWEIGHT_KG } from "./settingsstore.js";
import { TagSelect, grips, hangboards, holdTypes } from "./tags.js";
import { HANDS, recomputeSummary } from "./tests.js";
import { formatKg } from "./format.js";

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const field = (label, input) => el("label", { className: "field stacked" }, [el("span", { textContent: label }), input]);

// <input type="datetime-local"> value for an ISO time, in local time.
function localInput(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function repLabel(r, i) {
  const hand = r.hand === "left" ? " L" : r.hand === "right" ? " R" : "";
  const parts = [`${r.set ?? i + 1}.${r.rep ?? 1}${hand}`];
  if (typeof r.peakKg === "number") parts.push(`peak ${formatKg(r.peakKg)} kg`);
  if (typeof r.holdPct === "number") parts.push(`hold ${Math.round(r.holdPct)} %`);
  if (typeof r.durationS === "number") parts.push(`${r.durationS} s`);
  return parts.join(" · ");
}

// The edit form for session s (full). save(edited) stores it; cancel() closes it.
export function editCard(s, { save, cancel }) {
  const name = el("input", { type: "text", maxLength: 40, value: s.name || "" });
  const when = el("input", { type: "datetime-local", value: localInput(s.startedAt) });
  const hand = el("select", {}, Object.entries(HANDS).map(([v, label]) => el("option", { value: v, textContent: label })));
  hand.value = s.hand || "both";
  const bodyweight = el("input", {
    type: "number",
    min: MIN_BODYWEIGHT_KG,
    max: MAX_BODYWEIGHT_KG,
    step: 0.1,
    inputMode: "decimal",
    value: s.bodyweightFixed ? s.bodyweightKg : "",
    placeholder: "From the bodyweight log",
  });
  const boxes = {};
  const selects = {};
  for (const [key, store, label] of [
    ["board", hangboards, "Hangboard"],
    ["holdType", holdTypes, "Hold"],
    ["grip", grips, "Grip"],
  ]) {
    boxes[key] = el("div");
    selects[key] = new TagSelect(boxes[key], store, label, "");
    selects[key].value = s[key] || "";
  }
  const repChecks = (s.reps ?? []).map((r, i) => {
    const box = el("input", { type: "checkbox", checked: !r.excluded });
    return { box, row: el("label", { className: "check rep-check" }, [box, repLabel(r, i)]) };
  });
  const error = el("div", { className: "error", hidden: true });
  const saveButton = el("button", { type: "button", className: "primary", textContent: "Save" });
  const cancelButton = el("button", { type: "button", className: "secondary", textContent: "Cancel" });
  cancelButton.addEventListener("click", cancel);
  saveButton.addEventListener("click", async () => {
    const bw = bodyweight.value.trim() === "" ? null : parseFloat(bodyweight.value);
    const fail = (text) => {
      error.textContent = text;
      error.hidden = false;
    };
    if (!name.value.trim()) return fail("Give it a name.");
    if (!when.value) return fail("Choose the date and time.");
    if (bw !== null && !(bw >= MIN_BODYWEIGHT_KG && bw <= MAX_BODYWEIGHT_KG)) {
      return fail(`Bodyweight must be between ${MIN_BODYWEIGHT_KG} and ${MAX_BODYWEIGHT_KG} kg.`);
    }
    const reps = (s.reps ?? []).map((r, i) => {
      const { excluded, ...rest } = r;
      return repChecks[i].box.checked ? rest : { ...rest, excluded: true };
    });
    if (reps.length && reps.every((r) => r.excluded)) return fail("Keep at least one rep.");
    const edited = {
      ...s,
      name: name.value.trim(),
      startedAt: new Date(when.value).toISOString(),
      hand: hand.value,
      board: selects.board.value,
      holdType: selects.holdType.value,
      grip: selects.grip.value,
      reps,
    };
    if (bw !== null) Object.assign(edited, { bodyweightKg: bw, bodyweightFixed: true });
    else delete edited.bodyweightFixed;
    edited.summary = recomputeSummary(edited);
    saveButton.disabled = true;
    try {
      await save(edited);
    } catch (e) {
      saveButton.disabled = false;
      fail(e.message);
    }
  });

  return el("div", { className: "card edit-session" }, [
    el("h2", { textContent: "Edit session" }),
    field("Name", name),
    field("Date and time", when),
    boxes.board,
    boxes.holdType,
    boxes.grip,
    field("Hand", hand),
    field("Bodyweight (kg, for % of bodyweight)", bodyweight),
    ...(repChecks.length
      ? [
          el("h2", { className: "spaced", textContent: "Reps that count" }),
          el("p", { className: "muted", textContent: "Untick a rep that went wrong (a slip, a jerk): results are recomputed without it." }),
          ...repChecks.map((c) => c.row),
        ]
      : []),
    error,
    el("div", { className: "actions" }, [cancelButton, saveButton]),
  ]);
}
