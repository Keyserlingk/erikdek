// One short beep on every phase change, via Web Audio (works over plain HTTP).
// unlockAudio() must be called from a tap. Muting is remembered per phone.

const MUTED_KEY = "erkdek.muted";
let ctx = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTED_KEY) === "1";
} catch {
  // not muted
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = value;
  try {
    localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
  } catch {
    // not remembered
  }
}

export function unlockAudio() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    ctx = new Ctx();
  }
  if (ctx.state === "suspended") ctx.resume();
}

export function beep() {
  if (!ctx || muted) return;
  const durS = 0.3;
  const volume = 0.3;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = 1000;
  // Short ramps avoid clicks.
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.setValueAtTime(volume, t0 + durS - 0.02);
  gain.gain.linearRampToValueAtTime(0, t0 + durS);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durS);
}
