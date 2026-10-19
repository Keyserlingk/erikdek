// Copies the Capacitor runtime and plugins' ES module builds into data/vendor/capacitor
// so the app can import them without a bundler. While copying, extension-less
// relative imports get ".js" and package imports (@capacitor/core, @capacitor/synapse)
// point at the copied files.
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
  filesystem: "node_modules/@capacitor/filesystem/dist/esm",
  share: "node_modules/@capacitor/share/dist/esm",
};
// Single-file packages: copied as <name>/index.js.
const SINGLE_FILES = {
  synapse: "node_modules/@capacitor/synapse/dist/synapse.mjs",
};
// Package imports rewritten to the copies.
const IMPORTS = {
  "@capacitor/core": "core/index.js",
  "@capacitor/synapse": "synapse/index.js",
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

for (const [name, src] of Object.entries(SINGLE_FILES)) {
  mkdirSync(join(out, name), { recursive: true });
  cpSync(join(root, src), join(out, name, "index.js"));
}

for (const file of jsFiles(out)) {
  let code = readFileSync(file, "utf8")
    // from './x' / import('./x') without an extension -> './x.js'
    .replace(/((?:from|import\()\s*)(['"])(\.{1,2}\/[^'"]+?)(?<!\.js)\2/g, "$1$2$3.js$2");
  for (const [pkg, target] of Object.entries(IMPORTS)) {
    const to = relative(dirname(file), join(out, target)).replace(/^(?!\.)/, "./");
    code = code.replaceAll(`'${pkg}'`, `'${to}'`).replaceAll(`"${pkg}"`, `"${to}"`);
  }
  writeFileSync(file, code);
}
console.log(`vendor: Capacitor modules copied to ${relative(root, out)}`);
