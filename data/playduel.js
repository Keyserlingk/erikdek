// Play with a friend: the card on the Play home screen that connects this phone to a
// friend's – by game code over the internet (net.js), or on the same Wi-Fi without
// internet by scanning each other's QR codes (netqr.js) – and the connection the
// two-phone games run on. The host picks the game and its settings; the guest follows.
//
// Messages between the phones (all { t, ... }):
//   hi     { bodyweight, maxKg }   once connected: what the scales need from each player
//   start  { game, opts }          host → guest: start this game with these settings
//   tick   { d, ev }               ~30/s during a game: the game's own payload + events
//   leave                          back to the lobby (quit, or the end screen's Back)

import { hostGame, joinGame, normalizeCode } from "./net.js";
import { checkCode, hostOffline, joinOffline } from "./netqr.js";
import { profiles } from "./profiles.js";
import { qrElement, scanQr } from "./qr.js";
import { button, create } from "./ui.js";

// The connection: phase off | hosting | joining | qrHost | qrGuest | open. Events: "change" (redraw the
// card), "message" (detail: a message from the friend), "lost" (the connection ended).
export const duel = Object.assign(new EventTarget(), {
  phase: "off",
  role: null, // "host" | "guest"
  code: null,
  qr: null, // the QR code text this phone shows (same Wi-Fi)
  acceptAnswer: null, // host on the same Wi-Fi: takes the friend's scanned code
  link: null,
  peerName: "",
  peer: null, // the friend's "hi"
  pingMs: null,
  error: "",
  me: () => ({}), // play.js: this phone's "hi"
  send(msg) {
    return this.phase === "open" && this.link.send(msg);
  },
});

let joinInput = ""; // the code being typed
let showJoin = false;
let showWifi = false; // the same-Wi-Fi choices instead of host / join by code
let pinger = 0;

const changed = () => duel.dispatchEvent(new Event("change"));

function attach(link) {
  duel.link = link;
  link.addEventListener("open", ({ detail }) => {
    duel.phase = "open";
    duel.peerName = detail.peerName;
    duel.error = "";
    link.send({ t: "hi", ...duel.me() });
    measurePing();
    pinger = setInterval(measurePing, 5000);
    changed();
  });
  link.addEventListener("message", ({ detail }) => {
    if (detail?.t === "hi") {
      duel.peer = detail;
      changed();
    }
    duel.dispatchEvent(new CustomEvent("message", { detail }));
  });
  link.addEventListener("status", changed);
  link.addEventListener("error", ({ detail }) => {
    duel.error = detail;
  });
  link.addEventListener("close", () => {
    if (duel.link !== link) return;
    const wasOpen = duel.phase === "open";
    reset();
    if (wasOpen && !duel.error) duel.error = "The connection ended.";
    duel.dispatchEvent(new Event("lost"));
    changed();
  });
}

function measurePing() {
  duel.link
    ?.ping()
    .then((ms) => {
      duel.pingMs = ms;
      changed();
    })
    .catch(() => {});
}

function reset() {
  clearInterval(pinger);
  Object.assign(duel, { phase: "off", role: null, code: null, qr: null, acceptAnswer: null, link: null, peerName: "", peer: null, pingMs: null });
}

function host() {
  duel.error = "";
  const { code, link } = hostGame({ name: profiles.active.name });
  Object.assign(duel, { phase: "hosting", role: "host", code });
  attach(link);
  changed();
}

function join() {
  const code = normalizeCode(joinInput);
  if (!code) {
    duel.error = "A game code is 4 letters.";
    changed();
    return;
  }
  duel.error = "";
  Object.assign(duel, { phase: "joining", role: "guest", code });
  attach(joinGame(code, { name: profiles.active.name }));
  changed();
}

const notCancel = (e) => e?.name !== "AbortError";

// Same Wi-Fi, host: show our code, then scan the friend's reply.
async function hostWifi() {
  duel.error = "";
  try {
    const { offer, link, acceptAnswer } = await hostOffline({ name: profiles.active.name });
    Object.assign(duel, { phase: "qrHost", role: "host", qr: offer, acceptAnswer });
    attach(link);
  } catch (e) {
    duel.error = e.message;
  }
  changed();
}

async function scanAnswer() {
  try {
    const text = await scanQr({ title: "Scan the code on your friend's phone", check: (t) => checkCode(t, "answer") });
    duel.error = "";
    await duel.acceptAnswer(text);
  } catch (e) {
    if (notCancel(e)) duel.error = e.message;
  }
  changed();
}

// Same Wi-Fi, guest: scan the host's code, then show ours for the host to scan.
async function joinWifi() {
  duel.error = "";
  try {
    const text = await scanQr({ title: "Scan the code on the host's phone", check: (t) => checkCode(t, "offer") });
    const { answer, link } = await joinOffline(text, { name: profiles.active.name });
    Object.assign(duel, { phase: "qrGuest", role: "guest", qr: answer });
    attach(link);
  } catch (e) {
    if (notCancel(e)) duel.error = e.message;
  }
  changed();
}

// Ends the connection (the friend sees "The connection ended").
export function leaveDuel() {
  const link = duel.link;
  reset();
  duel.error = "";
  link?.close();
  changed();
}

const statusText = {
  waiting: "Waiting for your friend…",
  connecting: "Connecting…",
  reconnecting: "Connection lost, trying again…",
};

// The card; once connected, the host starts a game with the game cards' Play buttons.
export function duelCard() {
  const p = duel.phase;
  const kids = [create("h2", { textContent: "Play with a friend" })];
  if (p === "off") {
    kids.push(create("p", { className: "muted", textContent: "Pull against a friend, each on your own phone and sensor. One hosts, the other joins with the code." }));
    if (showWifi) {
      kids.push(
        create("p", { className: "muted", textContent: "No internet needed: both phones on the same Wi-Fi scan each other's code. One shows a code first, the other scans it." }),
        create("div", { className: "actions" }, [button("primary", "Show my code", hostWifi), button("secondary", "Scan a code", joinWifi)]),
        create("div", { className: "actions" }, [button("link", "Use a game code instead", () => ((showWifi = false), (duel.error = ""), changed()))]),
      );
    } else if (showJoin) {
      const input = create("input", {
        type: "text",
        value: joinInput,
        maxLength: 6,
        placeholder: "Code",
        autocapitalize: "characters",
        autocomplete: "off",
        className: "duel-code-input",
        ariaLabel: "Game code",
      });
      input.addEventListener("input", () => (joinInput = input.value));
      input.addEventListener("keydown", (ev) => ev.key === "Enter" && join());
      kids.push(
        create("div", { className: "field" }, [input, button("primary", "Join", join)]),
        create("div", { className: "actions" }, [button("link", "Host instead", () => ((showJoin = false), changed()))]),
      );
      setTimeout(() => input.focus(), 0);
    } else {
      kids.push(
        create("div", { className: "actions" }, [
          button("primary", "Host a game", host),
          button("secondary", "Join a game", () => ((showJoin = true), (duel.error = ""), changed())),
        ]),
        create("div", { className: "actions" }, [button("link", "Same Wi-Fi, no internet?", () => ((showWifi = true), (duel.error = ""), changed()))]),
      );
    }
  } else if (p === "hosting") {
    kids.push(
      create("p", { className: "muted", textContent: "Your friend taps Join a game and types this code:" }),
      create("div", { className: "duel-code", textContent: duel.code }),
      create("p", { className: "muted", textContent: statusText[duel.link?.status] ?? "Waiting for your friend…" }),
      create("div", { className: "actions" }, [button("secondary", "Cancel", leaveDuel)]),
    );
  } else if (p === "qrHost") {
    const waiting = duel.link?.status === "connecting";
    kids.push(
      create("p", { className: "muted", textContent: "1. Your friend taps Scan a code and scans this:" }),
      qrElement(duel.qr),
      create("p", { className: "muted", textContent: "2. Then scan the code that appears on their phone." }),
      create("div", { className: "actions" }, [
        button("secondary", "Cancel", leaveDuel),
        ...(waiting ? [] : [button("primary", "Scan their code", scanAnswer)]),
      ]),
      ...(waiting ? [create("p", { className: "muted", textContent: "Connecting…" })] : []),
    );
  } else if (p === "qrGuest") {
    kids.push(
      create("p", { className: "muted", textContent: "Now the host scans this code:" }),
      qrElement(duel.qr),
      create("p", { className: "muted", textContent: "Waiting for the host to scan it…" }),
      create("div", { className: "actions" }, [button("secondary", "Cancel", leaveDuel)]),
    );
  } else if (p === "joining") {
    kids.push(
      create("p", { className: "muted", textContent: `${statusText[duel.link?.status] ?? "Connecting…"} (game ${duel.code})` }),
      create("div", { className: "actions" }, [button("secondary", "Cancel", leaveDuel)]),
    );
  } else {
    const lag = duel.pingMs == null ? "" : ` · ${Math.round(duel.pingMs)} ms`;
    const trouble = duel.link?.status === "reconnecting" ? " · connection lost, trying again…" : lag;
    kids.push(
      create("p", { className: "duel-peer" }, [create("strong", { textContent: `Connected to ${duel.peerName}` }), create("span", { className: "muted", textContent: trouble })]),
      create("p", {
        className: "muted",
        textContent: duel.role === "host" ? "Pick a game below: it starts on both phones." : `${duel.peerName} picks the game. Get your sensor ready.`,
      }),
      create("div", { className: "actions" }, [button("secondary", "Leave", leaveDuel)]),
    );
  }
  if (duel.error) kids.push(create("p", { className: "message error-text", textContent: duel.error }));
  return create("div", { className: "card play-card duel-card" }, kids);
}
