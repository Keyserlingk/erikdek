// Play with a friend: the card on the Play home screen that connects this phone to a
// friend's (by game code over the internet, net.js) and the connection the two-phone
// games run on. The host picks the game and its settings; the guest follows.
//
// Messages between the phones (all { t, ... }):
//   hi     { bodyweight, maxKg }   once connected: what the scales need from each player
//   start  { game, opts }          host → guest: start this game with these settings
//   tick   { d, ev }               ~30/s during a game: the game's own payload + events
//   leave                          back to the lobby (quit, or the end screen's Back)

import { hostGame, joinGame, normalizeCode } from "./net.js";
import { profiles } from "./profiles.js";
import { button, create } from "./ui.js";

// The connection: phase off | hosting | joining | open. Events: "change" (redraw the
// card), "message" (detail: a message from the friend), "lost" (the connection ended).
export const duel = Object.assign(new EventTarget(), {
  phase: "off",
  role: null, // "host" | "guest"
  code: null,
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
  Object.assign(duel, { phase: "off", role: null, code: null, link: null, peerName: "", peer: null, pingMs: null });
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
    if (showJoin) {
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
      );
    }
  } else if (p === "hosting") {
    kids.push(
      create("p", { className: "muted", textContent: "Your friend taps Join a game and types this code:" }),
      create("div", { className: "duel-code", textContent: duel.code }),
      create("p", { className: "muted", textContent: statusText[duel.link?.status] ?? "Waiting for your friend…" }),
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
