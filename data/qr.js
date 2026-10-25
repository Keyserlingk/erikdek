// QR codes: show one (qrElement) and scan one with the camera (scanQr).
// Encoder: qrcode-generator; decoder: the browser's BarcodeDetector where it exists
// (Chrome on Android/macOS), else jsQR on video frames, which works everywhere
// getUserMedia does, including Android's WebView (no BarcodeDetector there).
// Both libraries are copied into vendor/qr by tools/vendor.mjs.

import qrcode from "./vendor/qr/qrcode.js";
import { button, create } from "./ui.js";

const QUIET = 4; // modules of white border the QR spec asks for; scanners need it

/** An <svg> QR code of text: black modules on white in any theme (scanners expect dark
 *  on light), error correction M, sized by CSS (.qr-code) to scan from another phone. */
export function qrElement(text) {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount(), size = n + 2 * QUIET;
  let d = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", "qr-code");
  svg.setAttribute("role", "img");
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.innerHTML = `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/>`;
  return svg;
}

/** Full-screen camera view that resolves with the text of the first QR code it reads.
 *  check(text) may return a short message for a code that won't do: it is shown and
 *  scanning goes on. Cancel rejects with an Error named "AbortError". A text field
 *  takes a pasted code too (desktop testing, or no camera). */
export function scanQr({ title = "Scan the code on the other phone", check = () => "" } = {}) {
  return new Promise((resolve, reject) => {
    const video = create("video", { muted: true, playsInline: true, autoplay: true });
    const message = create("p", { className: "qr-scan-message", textContent: title });
    const paste = create("input", { type: "text", placeholder: "Or paste a code", autocomplete: "off", spellcheck: false });
    let stream = null, timer = 0, done = false, lastBad = "";

    function finish(err, text) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      overlay.remove();
      err ? reject(err) : resolve(text);
    }
    function found(text) {
      const problem = check(text);
      if (!problem) return finish(null, text);
      if (text !== lastBad) message.textContent = problem;
      lastBad = text;
    }
    const cancel = button("secondary", "Cancel", () => finish(Object.assign(new Error("Cancelled."), { name: "AbortError" })));
    const use = button("primary compact", "Use", () => paste.value.trim() && found(paste.value.trim()));
    paste.addEventListener("keydown", (e) => e.key === "Enter" && use.click());
    const overlay = create("div", { className: "qr-scan" }, [
      create("div", { className: "qr-scan-view" }, [video, create("div", { className: "qr-scan-frame" })]),
      create("div", { className: "qr-scan-panel" }, [message, create("div", { className: "qr-scan-paste" }, [paste, use]), cancel]),
    ]);
    document.body.append(overlay);

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      } catch {
        message.textContent = "No camera available. Paste the code instead.";
        return;
      }
      if (done) return stream.getTracks().forEach((t) => t.stop());
      video.srcObject = stream;
      const read = await reader();
      const loop = async () => {
        if (done) return;
        if (video.readyState >= 2) {
          try {
            const text = await read(video);
            if (text) found(text);
          } catch {}
        }
        if (!done) timer = setTimeout(loop, 120);
      };
      loop();
    })();
  });
}

// A function video -> Promise<text|null>: BarcodeDetector if it reads QR codes, else jsQR.
async function reader() {
  try {
    if ((await globalThis.BarcodeDetector?.getSupportedFormats())?.includes("qr_code")) {
      const detector = new BarcodeDetector({ formats: ["qr_code"] });
      return async (video) => (await detector.detect(video))[0]?.rawValue || null;
    }
  } catch {}
  const { default: jsQR } = await import("./vendor/qr/jsqr.js");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return async (video) => {
    // Downscaled frames: plenty for a QR filling part of the view, and much faster.
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" })?.data || null;
  };
}
