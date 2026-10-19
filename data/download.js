// Saves text as a file. In a browser it downloads; in the Android app (whose WebView
// ignores downloads) the file is written to the app's cache and handed to Android's
// share sheet, from where it can be saved to Files/Drive or sent.

import { isNativeApp } from "./platform.js";

export async function download(filename, text, type) {
  if (isNativeApp()) {
    try {
      await shareFile(filename, text);
    } catch (err) {
      alert(`Couldn't save ${filename}: ${err?.message || err}`);
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function shareFile(filename, text) {
  const { Filesystem, Directory, Encoding } = await import("./vendor/capacitor/filesystem/index.js");
  const { Share } = await import("./vendor/capacitor/share/index.js");
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: text,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  });
  try {
    await Share.share({ title: filename, files: [uri], dialogTitle: "Save or send" });
  } catch (err) {
    // Closing the share sheet without choosing is not an error.
    if (!/cancel/i.test(err?.message ?? "")) throw err;
  }
}

export function downloadCsv(filename, text) {
  return download(filename, text, "text/csv");
}

export function downloadJson(filename, obj) {
  return download(filename, JSON.stringify(obj, null, 2), "application/json");
}
