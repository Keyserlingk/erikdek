// Saves text as a file on the phone/computer (works over plain HTTP).
export function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(filename, text) {
  download(filename, text, "text/csv");
}

export function downloadJson(filename, obj) {
  download(filename, JSON.stringify(obj, null, 2), "application/json");
}
