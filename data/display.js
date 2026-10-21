// Display preferences, kept per phone: where the force number is shown (behind the graph
// or above it, on Live and the run screen) and how strong it is behind the graph.
// Applied as body[data-number-layout] and the CSS variable --chart-number-opacity.

const KEY = "erkdek.display";
const DEFAULTS = { numberLayout: "graph", numberOpacity: 0.16 };
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
  document.body.dataset.numberLayout = prefs.numberLayout === "above" ? "above" : "graph";
  document.documentElement.style.setProperty("--chart-number-opacity", String(opacity));
}
