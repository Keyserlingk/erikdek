// Display preferences, kept per phone, for the large force number in the graph (Live and
// the run screen): behind the curve and grid or in front of them, and how strong it is.
// Applied as body[data-number-layer] and the CSS variable --chart-number-opacity.

const KEY = "erkdek.display";
const DEFAULTS = { numberLayer: "behind", numberOpacity: 0.16 };
export const OPACITY_RANGE = [0.05, 1];

let prefs = load();

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function displayPrefs() {
  return { ...prefs };
}

export function setDisplayPrefs(changes) {
  prefs = { ...prefs, ...changes };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // not remembered
  }
  applyDisplay();
}

export function applyDisplay() {
  const [min, max] = OPACITY_RANGE;
  const opacity = Math.min(max, Math.max(min, Number(prefs.numberOpacity) || DEFAULTS.numberOpacity));
  document.body.dataset.numberLayer = prefs.numberLayer === "front" ? "front" : "behind";
  document.documentElement.style.setProperty("--chart-number-opacity", String(opacity));
}
