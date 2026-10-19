// Train tab: the routine editor (new routine, edit, copy of a template).

import { downloadJson } from "./download.js";
import { BUILTIN_ROUTINES, ROUTINE_TYPES, buildRoutineFile, newRoutineId, routines, validateRoutine } from "./routines.js";
import { routineDuration, routineFileName } from "./routinetext.js";
import { TagSelect, grips, holdTypes } from "./tags.js";
import { show } from "./trainscreens.js";
import { $, create } from "./ui.js";

const el = {
  screen: $("trainEdit"),
  title: $("editTitle"),
  name: $("editName"),
  sets: $("editSets"),
  reps: $("editReps"),
  workS: $("editWork"),
  restS: $("editRest"),
  setRestS: $("editSetRest"),
  prepS: $("editPrep"),
  hands: $("editHands"),
  type: $("editType"),
  typeHint: $("editTypeHint"),
  instruction: $("editInstruction"),
  perSet: $("editPerSet"),
  setInstructions: $("editSetInstructions"),
  weightBlock: $("editWeightBlock"),
  useWeight: $("editUseWeight"),
  weightRow: $("editWeightRow"),
  weight: $("editWeight"),
  workField: $("editWorkField"),
  workLabel: $("editWorkLabel"),
  targetBlock: $("editTargetBlock"),
  repsLabel: $("editRepsLabel"),
  restLabel: $("editRestLabel"),
  targetType: $("editTargetType"),
  targetValue: $("editTargetValue"),
  targetUnit: $("editTargetUnit"),
  targetRow: $("editTargetValueRow"),
  duration: $("editDuration"),
  error: $("editError"),
  cancel: $("editCancel"),
  save: $("editSave"),
  remove: $("editDelete"),
  download: $("editDownload"),
};

let editing = null; // routine being edited (copy)
let selects = null; // TagSelects: hold, grip
let onSaved = () => {};

// One text field per set when "Different instruction per set" is on; texts are kept
// while the number of sets changes.
let editSetTexts = [];

export function openEditor(r) {
  const isNew = !r || r.builtin;
  editing = r
    ? structuredClone({ ...r, id: r.builtin ? newRoutineId() : r.id, builtin: false })
    : { ...structuredClone(BUILTIN_ROUTINES[0]), id: newRoutineId(), name: "", builtin: false };
  if (r && r.builtin) editing.name = `${r.name} (copy)`;

  el.title.textContent = isNew ? "New routine" : "Edit routine";
  el.name.value = editing.name;
  selects.hold.value = editing.holdType || "";
  selects.grip.value = editing.grip || "";
  el.hands.value = editing.hands || "both";
  el.type.value = editing.type || "hangboard";
  el.instruction.value = editing.instruction || "";
  editSetTexts = [...(editing.setInstructions || [])];
  el.perSet.checked = editSetTexts.length > 0;
  el.useWeight.checked = editing.addedWeightKg !== null && editing.addedWeightKg !== undefined;
  el.weight.value = el.useWeight.checked ? editing.addedWeightKg : "";
  for (const key of ["sets", "reps", "workS", "restS", "setRestS", "prepS"]) el[key].value = editing[key];
  renderSetInstructions();
  el.targetType.value = editing.target.type;
  el.targetValue.value = editing.target.type === "none" ? "" : editing.target.value;
  el.remove.hidden = isNew;
  el.download.hidden = isNew;
  el.error.hidden = true;
  updateEditorDerived();
  show("edit");
}

function readEditor() {
  const int = (input) => (input.value.trim() === "" ? NaN : Number(input.value));
  const routineType = el.type.value;
  const sensor = ROUTINE_TYPES[routineType].sensor;
  const type = sensor ? el.targetType.value : "none";
  const sets = int(el.sets);
  return {
    id: editing.id,
    name: el.name.value.trim(),
    type: routineType,
    instruction: el.instruction.value.trim(),
    setInstructions: el.perSet.checked ? editSetTexts.slice(0, sets).map((t) => (t || "").trim()) : [],
    addedWeightKg: !sensor && el.useWeight.checked ? parseFloat(el.weight.value) : null,
    holdType: selects.hold.value,
    grip: selects.grip.value,
    hands: el.hands.value,
    sets,
    reps: int(el.reps),
    workS: routineType === "selfpaced" ? 0 : int(el.workS),
    restS: int(el.restS),
    setRestS: int(el.setRestS),
    prepS: int(el.prepS),
    target: { type, value: type === "none" ? 0 : parseFloat(el.targetValue.value) },
  };
}

function renderSetInstructions() {
  const sets = Math.max(0, Math.min(20, Number(el.sets.value) || 0));
  el.setInstructions.hidden = !el.perSet.checked;
  if (!el.perSet.checked) return;
  el.setInstructions.replaceChildren(
    ...Array.from({ length: sets }, (_, i) => {
      const input = create("input", { type: "text", maxLength: 100, value: editSetTexts[i] || "", placeholder: el.instruction.value || "el.g. 1-4-7" });
      input.setAttribute("aria-label", `Instruction for set ${i + 1}`);
      input.addEventListener("input", () => {
        editSetTexts[i] = input.value;
        updateEditorDerived();
      });
      return create("label", { className: "field" }, [create("span", { textContent: `Set ${i + 1}` }), input]);
    }),
  );
}

const TYPE_HINTS = {
  hangboard: "Measures force with the sensor: hold %, target load and the force graph.",
  timed: "Work and rest by the clock. No sensor needed.",
  selfpaced: "Each rep lasts until you tap Done (el.g. a campus ladder), then the rest counts down. No sensor needed.",
};

function updateEditorDerived() {
  const routineType = el.type.value;
  const sensor = ROUTINE_TYPES[routineType].sensor;
  el.typeHint.textContent = TYPE_HINTS[routineType];
  el.targetBlock.hidden = !sensor;
  el.workField.hidden = routineType === "selfpaced";
  el.workLabel.textContent = sensor ? "Hang (s)" : "Work (s)";
  el.weightBlock.hidden = sensor;
  el.weightRow.hidden = !el.useWeight.checked;
  const type = sensor ? el.targetType.value : "none";
  el.targetRow.hidden = type === "none";
  const alternate = el.hands.value === "alternate";
  el.repsLabel.textContent = alternate ? "Reps per set (per hand)" : "Reps per set";
  el.restLabel.textContent = alternate ? "Change hand (s)" : "Rest (s)";
  el.targetUnit.textContent = type === "bw" ? "% BW" : "kg";
  const r = readEditor();
  el.duration.textContent = validateRoutine(r) ? "" : `Total time ${routineDuration(r)}`;
}

async function saveEditor() {
  const r = readEditor();
  const error = validateRoutine(r);
  el.error.textContent = error || "";
  el.error.hidden = !error;
  if (error) return;
  try {
    await routines.save(r);
    onSaved();
    show("list");
  } catch (err) {
    el.error.textContent = err.message;
    el.error.hidden = false;
  }
}

async function deleteEditing() {
  if (!confirm(`Delete "${editing.name}"?`)) return;
  try {
    await routines.remove(editing.id);
    show("list");
  } catch (err) {
    el.error.textContent = err.message;
    el.error.hidden = false;
  }
}

function downloadEditing() {
  const r = readEditor();
  const error = validateRoutine(r);
  if (error) {
    el.error.textContent = error;
    el.error.hidden = false;
    return;
  }
  downloadJson(routineFileName(r.name), buildRoutineFile([r]));
}

// saved: called after a routine is saved (before going back to the list).
export function initRoutineEditor({ saved }) {
  onSaved = saved;
  selects = {
    hold: new TagSelect($("editHold"), holdTypes, "Hold", "el.g. 18 mm edge"),
    grip: new TagSelect($("editGrip"), grips, "Grip", "el.g. Four-finger open"),
  };
  el.perSet.addEventListener("change", () => {
    renderSetInstructions();
    updateEditorDerived();
  });
  el.sets.addEventListener("input", renderSetInstructions);
  el.instruction.addEventListener("input", renderSetInstructions);
  el.cancel.addEventListener("click", () => show("list"));
  el.save.addEventListener("click", saveEditor);
  el.remove.addEventListener("click", deleteEditing);
  el.download.addEventListener("click", downloadEditing);
  for (const input of el.screen.querySelectorAll("input, select, textarea")) {
    input.addEventListener("input", updateEditorDerived);
  }
}
