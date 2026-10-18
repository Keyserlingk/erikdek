// Beeps via Web Audio (works over plain HTTP). unlock() must be called from a tap.

let ctx = null;

export function unlockAudio() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    ctx = new Ctx();
  }
  if (ctx.state === "suspended") ctx.resume();
}

function tone(freqHz, durS, startDelayS = 0, volume = 0.3) {
  if (!ctx) return;
  const t0 = ctx.currentTime + startDelayS;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freqHz;
  // Short ramps avoid clicks.
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
  gain.gain.setValueAtTime(volume, t0 + durS - 0.02);
  gain.gain.linearRampToValueAtTime(0, t0 + durS);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + durS);
}

export const beep = {
  countdown: () => tone(880, 0.12),
  work: () => tone(1320, 0.45),
  rest: () => tone(520, 0.35),
  finished: () => {
    tone(880, 0.15, 0);
    tone(1100, 0.15, 0.2);
    tone(1320, 0.4, 0.4);
  },
};
