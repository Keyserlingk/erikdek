// Copies the Capacitor runtime and plugins' ES module builds into data/vendor/capacitor
// so the app can import them without a bundler. While copying, extension-less
// relative imports get ".js" and "@capacitor/core" points at the copied core.
// Run with: npm run vendor (also part of tools/build_android.sh). Output is git-ignored.

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "data", "vendor", "capacitor");

const PACKAGES = {
  core: "node_modules/@capacitor/core/dist",
  "bluetooth-le": "node_modules/@capacitor-community/bluetooth-le/dist/esm",
  "keep-awake": "node_modules/@capacitor-community/keep-awake/dist/esm",
};

function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsFiles(path);
    return name.endsWith(".js") ? [path] : [];
  });
}

rmSync(out, { recursive: true, force: true });
for (const [name, src] of Object.entries(PACKAGES)) {
  const dest = join(out, name);
  mkdirSync(dest, { recursive: true });
  // ES modules only (no CommonJS builds, no core's script-tag bundle)
  const wanted = (p) => p.endsWith(".js") && !p.endsWith(".cjs.js") && !p.endsWith("capacitor.js");
  cpSync(join(root, src), dest, { recursive: true, filter: (p) => statSync(p).isDirectory() || wanted(p) });
}

const corePath = join(out, "core", "index.js");
for (const file of jsFiles(out)) {
  const toCore = relative(dirname(file), corePath).replace(/^(?!\.)/, "./");
  const code = readFileSync(file, "utf8")
    // from './x' / import('./x') without an extension -> './x.js'
    .replace(/((?:from|import\()\s*)(['"])(\.{1,2}\/[^'"]+?)(?<!\.js)\2/g, "$1$2$3.js$2")
    .replace(/(['"])@capacitor\/core\1/g, `$1${toCore}$1`);
  writeFileSync(file, code);
}
console.log(`vendor: Capacitor modules copied to ${relative(root, out)}`);
