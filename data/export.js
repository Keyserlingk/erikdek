// CSV/JSON export and backup format. No DOM access, so it runs under node --test too.

export const BACKUP_FORMAT = "erkdek-backup";
// Backups made before the rename to Erkdek.
const OLD_BACKUP_FORMATS = ["tindek-backup"];
export const BACKUP_VERSION = 1;

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

// One row per session with all scalar summary metrics as columns.
export function historyCsv(index) {
  const sorted = [...index].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const metricKeys = [
    ...new Set(sorted.flatMap((s) => Object.entries(s.summary || {}).filter(([, v]) => !Array.isArray(v)).map(([k]) => k))),
  ].sort();
  const head = ["date", "type", "name", "hold", "grip", "hand", "bodyweight_kg", "duration_s", "stopped", ...metricKeys];
  const rows = sorted.map((s) => [
    s.startedAt,
    s.type,
    s.name,
    s.holdType,
    s.grip,
    s.hand,
    s.bodyweightKg || "",
    s.durationS,
    s.stopped ? "yes" : "",
    ...metricKeys.map((k) => round(s.summary?.[k], 3) ?? ""),
  ]);
  return toCsv([head, ...rows]);
}

export function buildBackup({ settings, calibration, routines, holdTypes, grips, sessions, exportedAt = new Date() }) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    settings,
    calibration,
    routines,
    holdTypes,
    grips,
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
  if (!data || (data.format !== BACKUP_FORMAT && !OLD_BACKUP_FORMATS.includes(data.format))) {
    throw new Error("This is not an Erkdek backup file.");
  }
  if (data.version > BACKUP_VERSION) throw new Error("This backup was made by a newer version of the app.");
  const arrays = ["routines", "holdTypes", "grips", "sessions"];
  for (const key of arrays) {
    if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error(`Backup is damaged (${key}).`);
  }
  return {
    exportedAt: data.exportedAt,
    settings: data.settings && typeof data.settings === "object" ? data.settings : null,
    calibration: data.calibration && typeof data.calibration.cpk === "number" ? data.calibration : null,
    routines: data.routines || [],
    holdTypes: (data.holdTypes || []).filter((h) => typeof h === "string"),
    grips: (data.grips || []).filter((g) => typeof g === "string"),
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
