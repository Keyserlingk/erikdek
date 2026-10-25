// Train tab: the routine editor (new routine, edit, copy of a template).

import { downloadJson } from "./download.js";
import { PROTOCOLS, applyProtocol } from "./protocols.js";
import { BUILTIN_ROUTINES, ROUTINE_TYPES, buildRoutineFile, newRoutineId, routines, validateRoutine } from "./routines.js";
import { routineDuration, routineFileName } from "./routinetext.js";
import { TagSelect, grips, hangboards, holdTypes } from "./tags.js";
import { mountEditor, show } from "./trainscreens.js";
import { $, create } from "./ui.js";

const el = {
  screen: $("trainEdit"),
  title: $("editTitle"),
  name: $("editName"),
  protocol: $("editProtocol"),
  typeRow: $("editTypeRow"),
  perSetRow: $("editPerSetRow"),
  timing: $("editTiming"),
  sets: $("editSets"),
  reps: $("editReps"),
  workS: $("editWork"),
  restS: $("editRest"),
  setRestS: $("editSetRest"),
  prepS: $("editPrep"),
  hands: $("editHands"),
  startHandRow: $("editStartHandRow"),
  startHand: $("editStartHand"),
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

// Tests (routines with a protocol) are edited in the Tests tab, routines in Train.
const isTest = () => Boolean(editing?.test);
const home = () => (isTest() ? "tests" : "list");

// One text field per set when "Different instruction per set" is on; texts are kept
// while the number of sets changes.
let editSetTexts = [];

export function openEditor(r) {
  const isNew = !r || r.builtin;
  editing = r
    ? structuredClone({ ...r, id: r.builtin ? newRoutineId() : r.id, builtin: false })
    : { ...structuredClone(BUILTIN_ROUTINES[0]), id: newRoutineId(), name: "", builtin: false };
  if (r && r.builtin) editing.name = `${r.name} (copy)`;
  mountEditor(isTest() ? "tests" : "train");

  const noun = isTest() ? "test" : "routine";
  el.title.textContent = isNew ? `New ${noun}` : `Edit ${noun}`;
  el.download.textContent = `Download ${noun}`;
  el.remove.textContent = `Delete ${noun}`;
  // A test: name, instruction, hold, grip and the hands its protocol allows; its timing
  // is fixed. The fields for that are hidden.
  const protocol = PROTOCOLS[editing.test];
  el.protocol.hidden = !protocol;
  if (protocol) el.protocol.textContent = `${protocol.name}: ${protocol.description} The timing is fixed so your results compare over time.`;
  for (const node of [el.typeRow, el.typeHint, el.perSetRow, el.timing]) node.hidden = Boolean(protocol);
  el.instruction.placeholder = protocol ? "e.g. Feet on the floor, arms straight, pull up the edge" : "e.g. 1-3-5-7 ladders on medium rungs";
  for (const option of el.hands.options) option.hidden = option.disabled = protocol ? !protocol.hands.includes(option.value) : false;
  el.name.value = editing.name;
  selects.hold.value = editing.holdType || "";
  selects.grip.value = editing.grip || "";
  selects.board.value = editing.board || "";
  el.startHand.value = editing.startHand || "right";
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
  if (isTest()) {
    return applyProtocol({
      id: editing.id,
      test: editing.test,
      name: el.name.value.trim(),
      instruction: el.instruction.value.trim(),
      holdType: selects.hold.value,
      grip: selects.grip.value,
      board: selects.board.value,
      hands: el.hands.value,
      startHand: el.startHand.value,
    });
  }
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
    board: selects.board.value,
    hands: el.hands.value,
    startHand: el.startHand.value,
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
      const input = create("input", { type: "text", maxLength: 100, value: editSetTexts[i] || "", placeholder: el.instruction.value || "e.g. 1-4-7" });
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
  selfpaced: "Each rep lasts until you tap Done (e.g. a campus ladder), then the rest counts down. No sensor needed.",
};

function updateEditorDerived() {
  // Which hand goes first only matters when both hands take turns.
  el.startHandRow.hidden = el.hands.value !== "alternate" && el.hands.value !== "each";
  if (isTest()) {
    for (const node of [el.targetBlock, el.targetRow, el.weightBlock, el.setInstructions]) node.hidden = true;
    const r = readEditor();
    el.duration.textContent = validateRoutine(r) ? "" : `Total time ${routineDuration(r)}`;
    return;
  }
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
    onSaved(r); // goes back to the list it came from
  } catch (err) {
    el.error.textContent = err.message;
    el.error.hidden = false;
  }
}

async function deleteEditing() {
  if (!confirm(`Delete "${editing.name}"?`)) return;
  try {
    await routines.remove(editing.id);
    show(home());
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

// saved(routine): called after a routine or test is saved; shows where to go next.
export function initRoutineEditor({ saved }) {
  onSaved = saved;
  selects = {
    hold: new TagSelect($("editHold"), holdTypes, "Hold", "e.g. 18 mm edge"),
    grip: new TagSelect($("editGrip"), grips, "Grip", "e.g. Four-finger open"),
    board: new TagSelect($("editBoard"), hangboards, "Hangboard", "e.g. Beastmaker 2000"),
  };
  el.perSet.addEventListener("change", () => {
    renderSetInstructions();
    updateEditorDerived();
  });
  el.sets.addEventListener("input", renderSetInstructions);
  el.instruction.addEventListener("input", renderSetInstructions);
  el.cancel.addEventListener("click", () => show(home()));
  el.save.addEventListener("click", saveEditor);
  el.remove.addEventListener("click", deleteEditing);
  el.download.addEventListener("click", downloadEditing);
  for (const input of el.screen.querySelectorAll("input, select, textarea")) {
    input.addEventListener("input", updateEditorDerived);
  }
}
