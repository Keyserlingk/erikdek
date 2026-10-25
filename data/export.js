// CSV/JSON export and backup format. No DOM access, so it runs under node --test too.

export const BACKUP_FORMAT = "erkdek-backup";
// Version 2: profiles, and settings per profile ({ profileId: values }).
export const BACKUP_VERSION = 2;

export function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

const round = (v, digits) => (typeof v === "number" ? Number(v.toFixed(digits)) : v);

// Raw force curve ({ hz, kg }) as CSV. With `phases` (one entry per sample:
// {type, set, rep}) the rows also say which part of the workout each sample belongs to.
export function curveCsv(curve, phases = null) {
  const head = phases ? ["time_s", "force_kg", "phase", "set", "rep"] : ["time_s", "force_kg"];
  const rows = curve.kg.map((kg, i) => {
    const row = [round(i / curve.hz, 4), round(kg, 3)];
    if (phases) {
      const p = phases[i];
      row.push(p?.type ?? "", p?.set ?? "", p?.rep ?? "");
    }
    return row;
  });
  return toCsv([head, ...rows]);
}

// Stored curve (segments where force was above ~1 kg) as CSV; only stored samples.
export function storedCurveCsv(curve) {
  const segments = curve.segments ?? [{ t: 0, kg: curve.kg }];
  const rows = segments.flatMap((seg) => seg.kg.map((kg, i) => [round(seg.t + i / curve.hz, 4), round(kg, 3)]));
  return toCsv([["time_s", "force_kg"], ...rows]);
}

// Whether a curve (raw { kg } or stored { segments }) has any samples: runs without the
// sensor have none.
export function hasCurveData(curve) {
  if (!curve) return false;
  const segments = curve.segments ?? [{ kg: curve.kg ?? [] }];
  return segments.some((seg) => seg.kg.length > 0);
}

const snakeCase = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

// One row per rep: set, rep, hand and the rep's results (duration, or force and hold
// with the sensor), plus effort and added weight of its set when they were logged.
export function repsCsv(session) {
  const reps = session.reps || [];
  const keys = [...new Set(reps.flatMap((r) => Object.keys(r)))].filter((k) => !["set", "rep", "hand"].includes(k));
  const sets = session.sets;
  const head = ["set", "rep", "hand", ...keys.map(snakeCase), ...(sets ? ["effort", "added_weight_kg"] : [])];
  const value = (v) => (typeof v === "boolean" ? (v ? "yes" : "no") : round(v, 3));
  const rows = reps.map((r) => {
    const row = [r.set, r.rep, r.hand, ...keys.map((k) => value(r[k]))];
    if (sets) {
      const log = sets.find((x) => x.set === r.set);
      row.push(log?.rpe ?? "", log?.addedWeightKg ?? "");
    }
    return row;
  });
  return toCsv([head, ...rows]);
}

// One row per session with all scalar summary metrics as columns, then tags and note.
export function historyCsv(index) {
  const sorted = [...index].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const metricKeys = [
    ...new Set(
      sorted.flatMap((s) =>
        Object.entries(s.summary || {})
          .filter(([, v]) => v === null || typeof v !== "object") // not per-hand or per-attempt lists
          .map(([k]) => k),
      ),
    ),
  ].sort();
  const head = ["date", "type", "name", "hangboard", "hold", "grip", "hand", "bodyweight_kg", "duration_s", "stopped", ...metricKeys, "tags", "note"];
  const rows = sorted.map((s) => [
    s.startedAt,
    s.type,
    s.name,
    s.board ?? "",
    s.holdType,
    s.grip,
    s.hand,
    s.bodyweightKg || "",
    s.durationS,
    s.stopped ? "yes" : "",
    ...metricKeys.map((k) => round(s.summary?.[k], 3) ?? ""),
    (s.tags ?? []).join("; "),
    s.note ?? "",
  ]);
  return toCsv([head, ...rows]);
}

export function buildBackup({
  profiles = [],
  settings,
  calibration,
  routines,
  workouts,
  holdTypes,
  grips,
  hangboards = [],
  sessions,
  exportedAt = new Date(),
}) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    profiles,
    settings,
    calibration,
    routines,
    workouts,
    holdTypes,
    grips,
    hangboards,
    sessions,
  };
}

// Parses and checks a backup file. Throws an Error with a readable message.
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This is not a valid backup file (not JSON).");
  }
  if (!data || data.format !== BACKUP_FORMAT) throw new Error("This is not an Erkdek backup file.");
  if (data.version > BACKUP_VERSION) throw new Error("This backup was made by a newer version of the app.");
  const arrays = ["profiles", "routines", "workouts", "holdTypes", "grips", "hangboards", "sessions"];
  for (const key of arrays) {
    if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error(`Backup is damaged (${key}).`);
  }
  return {
    exportedAt: data.exportedAt,
    profiles: (data.profiles || []).filter((p) => p && typeof p.id === "string" && typeof p.name === "string"),
    // { profileId: values }; only entries that are objects.
    settings:
      data.settings && typeof data.settings === "object"
        ? Object.fromEntries(Object.entries(data.settings).filter(([, v]) => v && typeof v === "object"))
        : null,
    calibration: data.calibration && typeof data.calibration.cpk === "number" ? data.calibration : null,
    routines: data.routines || [],
    workouts: (data.workouts || []).filter((w) => w && typeof w.id === "string"),
    holdTypes: (data.holdTypes || []).filter((h) => typeof h === "string"),
    grips: (data.grips || []).filter((g) => typeof g === "string"),
    hangboards: (data.hangboards || []).filter((b) => typeof b === "string"),
    sessions: (data.sessions || []).filter((s) => s && typeof s.id === "string"),
  };
}

// Merges backup items into current ones: items from the backup replace current items
// with the same key, everything else is kept.
export function mergeBy(current, incoming, key) {
  const map = new Map(current.map((item) => [key(item), item]));
  for (const item of incoming) map.set(key(item), item);
  return [...map.values()];
}

export function fileDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
