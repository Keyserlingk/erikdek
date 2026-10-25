// Play with friends: the card on the Play home screen that connects this phone to friends'
// phones – by game code over the internet (net.js, up to MAX_PLAYERS), or one friend on
// the same Wi-Fi without internet by scanning each other's QR codes (netqr.js) – and the
// connection the multiplayer games run on. A star: the host talks to every guest, guests
// only to the host. The host picks the game, its settings and who plays; guests follow.
//
// Messages (all { t, ... }):
//   hi      guest → host  { bodyweight, sensor }: what the games need from each player;
//                         again when the sensor comes or goes
//   roster  host → guest  { players: [{ id, name, bodyweight, sensor }], you }: everyone
//                         in the lobby, host first; `you` is the guest's own id
//   start   host → all    { game, opts }: start this game (opts.ids: who plays)
//   tick    both ways     { d, ev } ~30/s during a game: the game's payload + events
//   leave   both ways     guest: I left the game; host: the game is over for everyone

import { MAX_PLAYERS, hostGame, joinGame, normalizeCode } from "./net.js";
import { checkCode, hostOffline, joinOffline } from "./netqr.js";
import { profiles } from "./profiles.js";
import { qrElement, scanQr } from "./qr.js";
import { button, create } from "./ui.js";

export const HOST_ID = "host";

// The connection: phase off | hosting (code shown, nobody yet) | joining | qrHost |
// qrGuest | open (connected). Events: "change" (redraw the card, the roster changed),
// "message" (detail: { from, msg }), "left" (detail: id – a guest's connection ended;
// host only), "lost" (this phone's connection to the game ended).
export const duel = Object.assign(new EventTarget(), {
  phase: "off",
  role: null, // "host" | "guest"
  code: null,
  qr: null, // the QR code text this phone shows (same Wi-Fi)
  acceptAnswer: null, // host on the same Wi-Fi: takes the friend's scanned code
  room: null, // host by game code
  link: null, // guest: the link to the host; host on the same Wi-Fi: the one guest's
  peers: new Map(), // host: id -> { link, name, hi, pingMs }
  players: [], // everyone in the lobby, host first: { id, name, bodyweight, sensor, pingMs? }
  myId: null,
  pingMs: null, // guest: to the host
  error: "",
  me: () => ({}), // play.js: this phone's { bodyweight, sensor }
  // Guest: to the host. Host: to every guest.
  send(msg) {
    if (this.role === "guest") return this.phase === "open" && this.link.send(msg);
    for (const p of this.peers.values()) p.link.send(msg);
    return this.peers.size > 0;
  },
  sendTo(id, msg) {
    return this.peers.get(id)?.link.send(msg) ?? false;
  },
  nameOf(id) {
    return this.players.find((p) => p.id === id)?.name ?? "Someone";
  },
});

let joinInput = ""; // the code being typed
let showJoin = false;
let showWifi = false; // the same-Wi-Fi choices instead of host / join by code
let pinger = 0;
let nextId = 0;

const changed = () => duel.dispatchEvent(new Event("change"));
const emit = (from, msg) => duel.dispatchEvent(new CustomEvent("message", { detail: { from, msg } }));

// ---- Host ----

// The roster from the host's side, sent to every guest with their own id.
function updateRoster() {
  duel.players = [
    { id: HOST_ID, name: profiles.active.name, ...duel.me() },
    ...[...duel.peers].map(([id, p]) => ({ id, name: p.name, bodyweight: false, sensor: false, ...p.hi, pingMs: p.pingMs })),
  ];
  for (const [id, p] of duel.peers) p.link.send({ t: "roster", players: duel.players, you: id });
  duel.phase = duel.peers.size ? "open" : duel.qr ? "qrHost" : "hosting";
  changed();
}

function addPeer(link) {
  const id = `g${++nextId}`;
  duel.peers.set(id, { link, name: link.peerName || "Friend", hi: null, pingMs: null });
  link.addEventListener("message", ({ detail: msg }) => {
    if (msg?.t === "hi") {
      duel.peers.get(id).hi = { bodyweight: Boolean(msg.bodyweight), sensor: Boolean(msg.sensor) };
      updateRoster();
    } else emit(id, msg);
  });
  link.addEventListener("status", changed);
  link.addEventListener("close", () => {
    if (!duel.peers.delete(id)) return;
    duel.dispatchEvent(new CustomEvent("left", { detail: id }));
    if (duel.link === link) {
      // the one same-Wi-Fi guest: nobody else can join
      lost("The connection ended.");
      return;
    }
    updateRoster();
  });
  updateRoster();
}

function host() {
  duel.error = "";
  const { code, room } = hostGame({ name: profiles.active.name });
  Object.assign(duel, { phase: "hosting", role: "host", code, room, myId: HOST_ID });
  room.addEventListener("peer", ({ detail: link }) => addPeer(link));
  room.addEventListener("status", changed);
  room.addEventListener("error", ({ detail }) => (duel.error = detail));
  room.addEventListener("close", () => duel.room === room && lost(duel.error || "The game was closed."));
  startPinging();
  updateRoster();
}

// Same Wi-Fi, host: show our code, then scan the friend's reply. One friend only.
async function hostWifi() {
  duel.error = "";
  try {
    const { offer, link, acceptAnswer } = await hostOffline({ name: profiles.active.name });
    Object.assign(duel, { phase: "qrHost", role: "host", qr: offer, acceptAnswer, link, myId: HOST_ID });
    link.addEventListener("open", () => addPeer(link));
    link.addEventListener("error", ({ detail }) => (duel.error = detail));
    link.addEventListener("close", () => duel.link === link && !duel.peers.size && lost(duel.error || "The connection ended."));
    startPinging();
    updateRoster();
  } catch (e) {
    duel.error = e.message;
    changed();
  }
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

// ---- Guest ----

function attachGuest(link) {
  duel.link = link;
  link.addEventListener("open", ({ detail }) => {
    duel.phase = "open";
    duel.players = [{ id: HOST_ID, name: detail.peerName }];
    duel.error = "";
    sendHi();
    startPinging();
    changed();
  });
  link.addEventListener("message", ({ detail: msg }) => {
    if (msg?.t === "roster") {
      duel.players = msg.players;
      duel.myId = msg.you;
      changed();
    } else emit(HOST_ID, msg);
  });
  link.addEventListener("status", changed);
  link.addEventListener("error", ({ detail }) => (duel.error = detail));
  link.addEventListener("close", () => {
    if (duel.link !== link) return;
    lost(duel.phase === "open" && !duel.error ? "The connection ended." : duel.error);
  });
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
  attachGuest(joinGame(code, { name: profiles.active.name }));
  changed();
}

// Same Wi-Fi, guest: scan the host's code, then show ours for the host to scan.
async function joinWifi() {
  duel.error = "";
  try {
    const text = await scanQr({ title: "Scan the code on the host's phone", check: (t) => checkCode(t, "offer") });
    const { answer, link } = await joinOffline(text, { name: profiles.active.name });
    Object.assign(duel, { phase: "qrGuest", role: "guest", qr: answer });
    attachGuest(link);
  } catch (e) {
    if (notCancel(e)) duel.error = e.message;
  }
  changed();
}

// ---- Both ----

// This phone's "hi" again (the sensor connected or disconnected).
export function sendHi() {
  if (duel.role === "guest") duel.link?.send({ t: "hi", ...duel.me() });
  else if (duel.role === "host") updateRoster();
}

function startPinging() {
  clearInterval(pinger);
  const ping = () => {
    if (duel.role === "guest") {
      duel.link?.ping().then((ms) => ((duel.pingMs = ms), changed())).catch(() => {});
      return;
    }
    for (const p of duel.peers.values()) {
      p.link.ping().then((ms) => {
        p.pingMs = ms;
        const player = duel.players.find((x) => duel.peers.get(x.id) === p);
        if (player) player.pingMs = ms;
        changed();
      }).catch(() => {});
    }
  };
  ping();
  pinger = setInterval(ping, 5000);
}

function reset() {
  clearInterval(pinger);
  duel.peers = new Map();
  Object.assign(duel, { phase: "off", role: null, code: null, qr: null, acceptAnswer: null, room: null, link: null, players: [], myId: null, pingMs: null });
}

function lost(text) {
  reset();
  duel.error = text || "";
  duel.dispatchEvent(new Event("lost"));
  changed();
}

const notCancel = (e) => e?.name !== "AbortError";

// Ends the connection (the others see "The connection ended").
export function leaveDuel() {
  const { room, link, peers } = duel;
  reset();
  duel.error = "";
  room?.close();
  for (const p of peers.values()) p.link.close();
  link?.close();
  changed();
}

const statusText = {
  waiting: "Waiting for your friends…",
  connecting: "Connecting…",
  reconnecting: "Connection lost, trying again…",
};

// "Erik · host", "Anna · 23 ms", "Bo · no sensor"
function rosterList() {
  return create(
    "ul",
    { className: "duel-roster" },
    duel.players.map((p) => {
      const notes = [];
      if (p.id === duel.myId) notes.push("you");
      else if (p.id === HOST_ID) notes.push("host");
      const ms = p.id === duel.myId ? null : duel.role === "guest" ? (p.id === HOST_ID ? duel.pingMs : null) : p.pingMs;
      if (ms != null) notes.push(`${Math.round(ms)} ms`);
      if (!p.sensor) notes.push("no sensor");
      if (duel.peers.get(p.id)?.link.status === "reconnecting") notes.push("connection lost…");
      return create("li", {}, [create("strong", { textContent: p.name }), create("span", { className: "muted", textContent: notes.join(" · ") })]);
    }),
  );
}

// The card; once connected, the host starts a game with the game cards' Play buttons.
export function duelCard() {
  const p = duel.phase;
  const kids = [create("h2", { textContent: "Play with friends" })];
  if (p === "off") {
    kids.push(
      create("p", {
        className: "muted",
        textContent: `Pull against friends, each on your own phone and sensor (up to ${MAX_PLAYERS}). One hosts, the others join with the code.`,
      }),
    );
    if (showWifi) {
      kids.push(
        create("p", {
          className: "muted",
          textContent: "No internet needed: both phones on the same Wi-Fi scan each other's code. One shows a code first, the other scans it. One friend only; for more, use a game code.",
        }),
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
      create("p", { className: "muted", textContent: "Your friends tap Join a game and type this code:" }),
      create("div", { className: "duel-code", textContent: duel.code }),
      create("p", { className: "muted", textContent: statusText[duel.room?.status] ?? "Waiting for your friends…" }),
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
    const trouble = duel.role === "guest" && duel.link?.status === "reconnecting";
    const roomLeft = duel.room && duel.players.length < MAX_PLAYERS;
    kids.push(
      create("p", { className: "muted", textContent: `Players (${duel.players.length})` }),
      rosterList(),
      ...(roomLeft ? [create("p", { className: "muted", textContent: `More can join with the code ${duel.code}.` })] : []),
      ...(trouble ? [create("p", { className: "muted", textContent: "Connection lost, trying again…" })] : []),
      create("p", {
        className: "muted",
        textContent:
          duel.role === "host" ? "Pick a game below: it starts on everyone's phone." : `${duel.nameOf(HOST_ID)} picks the game. Get your sensor ready.`,
      }),
      create("div", { className: "actions" }, [button("secondary", "Leave", leaveDuel)]),
    );
  }
  if (duel.error) kids.push(create("p", { className: "message error-text", textContent: duel.error }));
  return create("div", { className: "card play-card duel-card" }, kids);
}
