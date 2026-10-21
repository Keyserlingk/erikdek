// Display preferences, kept per phone: the theme (system, light or dark), and the large
// force number in the graph (Live and the run screen): behind the curve and grid or in
// front of them, and how strong it is. Applied as html[data-theme] (also set before the
// first paint by index.html), body[data-number-layer] and --chart-number-opacity.
// Charts redraw on the "erkdek:theme" window event.

const KEY = "erkdek.display";
const DEFAULTS = { theme: "system", numberLayer: "behind", numberOpacity: 0.16 };
const systemDark = matchMedia("(prefers-color-scheme: dark)");
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

function applyTheme() {
  const dark = prefs.theme === "dark" || (prefs.theme !== "light" && systemDark.matches);
  const theme = dark ? "dark" : "light";
  if (document.documentElement.dataset.theme === theme) return;
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event("erkdek:theme"));
}

systemDark.addEventListener("change", applyTheme); // matters when following the system

export function applyDisplay() {
  applyTheme();
  const [min, max] = OPACITY_RANGE;
  const opacity = Math.min(max, Math.max(min, Number(prefs.numberOpacity) || DEFAULTS.numberOpacity));
  document.body.dataset.numberLayer = prefs.numberLayer === "front" ? "front" : "behind";
  document.documentElement.style.setProperty("--chart-number-opacity", String(opacity));
}
