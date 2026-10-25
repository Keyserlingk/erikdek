// Online play by game code: phones find each other through public Nostr relays
// (Trystero; only the handshake goes there, encrypted with the code) and then talk
// directly over WebRTC with public STUN. No login, no server of our own, no TURN relay,
// so very strict networks (some mobile carriers, guest Wi-Fi) may not connect.
//
// The host opens a room for up to MAX_PLAYERS phones (a star: every guest talks only to
// the host). hostGame() -> { code, room }; room is an EventTarget with events
//   "peer"   detail: <link>              a new guest is connected (after a hello exchange)
//   "status" detail: "waiting" | "open" | "closed"   (open = at least one guest)
//   "error"  detail: <short plain-English text>, room-level only, always followed by "close"
//   "close"                              the room is closed
// methods: close() (says bye to everyone); properties: links (the guests' links, also
// while reconnecting), status, code, maxPlayers.
//
// A link is the connection to one other player: an EventTarget with events
//   "open"    detail: { peerName }      the other player is connected (guest side only;
//                                        the host gets its links already open via "peer")
//   "message" detail: <object>          a message from the other player (JSON-serialisable objects)
//   "close"                              the other player left or the connection dropped for good
//   "status"  detail: "waiting" | "connecting" | "open" | "reconnecting" | "closed"
//   "error"   detail: <short plain-English text>, always followed by "close"
// methods: send(obj) -> bool, ping() -> Promise<ms>, close(); properties: open (boolean),
// status, peerName, role ("host" | "guest", this side's role), code.
// The same link shape is used by the same-Wi-Fi connection (netqr.js), so games take either.

const APP_ID = "erkdek-play-v1";
const PROTOCOL = 2; // in the hello: both phones must speak the same message format
// Letters that can't be mixed up when read aloud or typed (no O/0, I/1/L, B/8, S/5, Z/2)
export const CODE_LETTERS = "ACDEFGHJKMNPQRTUVWXY";
export const CODE_LENGTH = 4;
export const MAX_PLAYERS = 6; // host included

const JOIN_TIMEOUT_MS = 20000; // a guest gives up when no host answers
const RELAY_CHECK_MS = 10000; // no relay reachable by then -> say so
const RECONNECT_MS = 10000; // a lost player gets this long to come back
const KEEPALIVE_MS = 2000; // sent when nothing else went out for this long
const SILENT_MS = 6000; // nothing heard for this long = connection lost
const PING_TIMEOUT_MS = 5000;
const LEAVE_DELAY_MS = 300; // a moment for a "bye" to leave before the connections close

export function newCode(random = Math.random) {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_LETTERS[Math.floor(random() * CODE_LETTERS.length)];
  return code;
}

// User input -> code, or null if it can't be one. Ignores case, spaces and dashes.
export function normalizeCode(input) {
  const code = String(input ?? "").toUpperCase().replace(/[\s-]/g, "");
  if (code.length !== CODE_LENGTH) return null;
  return [...code].every((c) => CODE_LETTERS.includes(c)) ? code : null;
}

export function hostGame({ name, maxPlayers = MAX_PLAYERS }) {
  const code = newCode();
  return { code, room: createHostRoom({ code, name, maxPlayers }) };
}

export function joinGame(code, { name }) {
  const c = normalizeCode(code);
  if (!c) throw new RangeError(`Not a game code: ${code}`);
  return createGuestLink({ code: c, name });
}

// Loaded on first use: the vendored file only exists after `npm run vendor`.
const trystero = () => import("./vendor/trystero.js");

const peerNameOf = (hello) => String(hello.name ?? "").slice(0, 40) || "Other player";
const helloFrame = (role, name) => ({ k: "hello", v: PROTOCOL, role, name: String(name ?? "") });

function timerSet(clock) {
  const timers = {};
  const clear = (t) => t && (t.interval ? clock.clearInterval(t.id) : clock.clearTimeout(t.id));
  const stop = (key) => {
    clear(timers[key]);
    delete timers[key];
  };
  return {
    stop,
    stopAll: () => Object.keys(timers).forEach(stop),
    after(key, ms, fn) {
      stop(key);
      timers[key] = { id: clock.setTimeout(() => { delete timers[key]; fn(); }, ms) };
    },
    every(key, ms, fn) {
      stop(key);
      timers[key] = { id: clock.setInterval(fn, ms), interval: true };
    },
  };
}

// The Trystero room, shared by all links of one side. One action carries everything:
// {k: "hello"|"full"|"msg"|"ka"|"bye", ...}
function createSession({ code, clock, joinRoom, relaySockets, fail, isClosed, connected, on }) {
  let room = null;
  let action = null;
  return {
    async start(begin, timers) {
      if (clock.navigator?.onLine === false) return fail("No internet connection.");
      begin();
      try {
        if (!joinRoom) ({ joinRoom, getRelaySockets: relaySockets } = await trystero());
      } catch {
        return fail("Online play isn't available in this version of the app.");
      }
      if (isClosed()) return;
      // trickleIce: send connection routes as they are found, so a slow STUN server
      // doesn't hold up the connection.
      room = joinRoom({ appId: APP_ID, password: code, trickleIce: true }, code, {
        // Per peer (also a refused player), so never fatal on its own.
        onJoinError: () => on.joinError?.(),
      });
      action = room.makeAction("m", {
        onMessage: (data, ctx) => {
          if (!isClosed() && data && typeof data === "object") on.frame(data, ctx.peerId);
        },
      });
      room.onPeerJoin = (id) => !isClosed() && on.peerJoin(id);
      room.onPeerLeave = (id) => !isClosed() && on.peerLeave(id);
      if (relaySockets) timers.after("relays", RELAY_CHECK_MS, () => {
        const open = Object.values(relaySockets()).some((s) => s.readyState === 1);
        if (!open && !connected()) fail("Can't reach the internet servers that connect players. Check the connection.");
      });
    },
    raw(frame, target) {
      action?.send(frame, target ? { target } : undefined).catch(() => {});
    },
    ping: (id) => (room ? room.ping(id) : Promise.reject(new Error("Not connected"))),
    get joined() { return !!room; },
    leave() {
      const r = room;
      room = action = null;
      if (r) clock.setTimeout(() => r.leave().catch(() => {}), LEAVE_DELAY_MS);
    },
  };
}

// One other player. The guest wraps one of these around its session; the host has one
// per guest. onOpen runs on the first open, onClose once when the link closes.
function createPeer({ role, code, clock, session, onOpen, onClose }) {
  const link = new EventTarget();
  const timers = timerSet(clock);
  let peerId = null; // the other player's Trystero id once hellos are exchanged
  let status = null;
  let closed = false;
  let everOpen = false;
  let lastHeard = 0;
  let lastSent = 0;

  const emit = (type, detail) => link.dispatchEvent(new CustomEvent(type, { detail }));
  const now = () => (clock.now ? clock.now() : performance.now());
  const setStatus = (s) => {
    if (s === status) return;
    status = s;
    emit("status", s);
  };
  const raw = (frame) => {
    lastSent = now();
    session.raw(frame, peerId);
  };

  function shutdown() {
    if (closed) return;
    closed = true;
    timers.stopAll();
    setStatus("closed");
    emit("close");
    onClose?.();
  }

  function lost() {
    if (closed || status !== "open") return;
    setStatus("reconnecting");
    timers.after("reconnect", RECONNECT_MS, shutdown);
  }

  function opened(id, hello) {
    peerId = id;
    link.peerName = peerNameOf(hello);
    lastHeard = now();
    timers.stop("join");
    timers.stop("reconnect");
    setStatus("open");
    if (!everOpen) {
      everOpen = true;
      onOpen?.();
    }
    timers.every("keepalive", KEEPALIVE_MS / 2, () => {
      if (status === "open" && now() - lastHeard > SILENT_MS) lost();
      if (now() - lastSent >= KEEPALIVE_MS) raw({ k: "ka" });
    });
  }

  // A frame from this player (hello and full are handled by the owner).
  function heard(frame) {
    if (closed) return;
    lastHeard = now();
    if (status === "reconnecting" && frame.k !== "bye") {
      timers.stop("reconnect");
      setStatus("open");
    }
    if (frame.k === "msg") emit("message", frame.d);
    else if (frame.k === "bye") shutdown();
  }

  link.peerName = null;
  link.role = role;
  link.code = code;
  Object.defineProperty(link, "open", { get: () => status === "open" });
  Object.defineProperty(link, "status", { get: () => status });
  link.send = (obj) => {
    if (status !== "open") return false;
    raw({ k: "msg", d: obj });
    return true;
  };
  link.ping = () => {
    if (status !== "open" || !session.joined) return Promise.reject(new Error("Not connected"));
    return new Promise((resolve, reject) => {
      const t = clock.setTimeout(() => reject(new Error("No answer")), PING_TIMEOUT_MS);
      session.ping(peerId).then(
        (ms) => { clock.clearTimeout(t); resolve(ms); },
        (e) => { clock.clearTimeout(t); reject(e); });
    });
  };
  link.close = () => {
    if (closed) return;
    if (peerId) raw({ k: "bye" });
    shutdown();
  };

  return {
    link, timers, emit, setStatus, opened, lost, heard,
    fail(text) {
      if (closed) return;
      emit("error", text);
      shutdown();
    },
    get peerId() { return peerId; },
    get status() { return status; },
    get closed() { return closed; },
    get everOpen() { return everOpen; },
  };
}

// The guest side: one link to the host. joinRoom/relaySockets/clock are injectable for tests.
export function createGuestLink({ code, name, joinRoom, relaySockets, clock = globalThis }) {
  let peerTrouble = false; // Trystero saw a peer but couldn't connect to it
  const session = createSession({
    code, clock, joinRoom, relaySockets,
    fail: (text) => peer.fail(text),
    isClosed: () => peer.closed,
    connected: () => peer.everOpen,
    on: { frame, peerJoin, peerLeave, joinError: () => { peerTrouble = true; } },
  });
  const peer = createPeer({
    role: "guest", code, clock, session,
    onOpen: () => peer.emit("open", { peerName: peer.link.peerName }),
    onClose: () => session.leave(),
  });
  const hello = () => helloFrame("guest", name);

  // The host slot is free while we have nobody, or while our host is gone (then a host
  // under a new id may take it).
  const slotFree = () => peer.peerId === null || peer.status === "reconnecting";

  function frame(f, from) {
    if (f.k === "hello") {
      if (f.role !== "host") return; // another guest in the room: not our business
      if (f.v !== PROTOCOL) {
        if (from === peer.peerId || slotFree()) peer.fail("The other phone has a different app version. Update both.");
        return;
      }
      if (from === peer.peerId || slotFree()) {
        if (from !== peer.peerId) session.raw(hello(), from); // a new id hasn't had our hello yet
        peer.opened(from, f);
      }
      return;
    }
    if (f.k === "full") {
      if (peer.peerId === null) peer.fail(`This game is full (${f.n ?? MAX_PLAYERS} players).`);
      return;
    }
    if (from === peer.peerId) peer.heard(f);
  }

  // We can't tell the host from other guests yet: everyone gets our hello, the host answers.
  function peerJoin(id) {
    if (id === peer.peerId || slotFree()) session.raw(hello(), id);
  }

  function peerLeave(id) {
    if (id === peer.peerId) peer.lost();
  }

  // Started on the next tick so the caller can add listeners first.
  clock.setTimeout(() => session.start(() => {
    peer.setStatus("connecting");
    peer.timers.after("join", JOIN_TIMEOUT_MS, () => peer.fail(peerTrouble
      ? "Found the game but couldn't reach the other phone. The network may block it; try the same Wi-Fi."
      : "No game found with this code."));
  }, peer.timers), 0);
  return peer.link;
}

// The host side: a room for up to maxPlayers - 1 guests. Injectable like createGuestLink.
export function createHostRoom({ code, name, maxPlayers = MAX_PLAYERS, joinRoom, relaySockets, clock = globalThis }) {
  const room = new EventTarget();
  const timers = timerSet(clock);
  const peers = []; // open or reconnecting guests
  let status = null;
  let closed = false;
  let everConnected = false;

  const emit = (type, detail) => room.dispatchEvent(new CustomEvent(type, { detail }));
  const setStatus = (s) => {
    if (s === status) return;
    status = s;
    emit("status", s);
  };
  const session = createSession({
    code, clock, joinRoom, relaySockets, fail,
    isClosed: () => closed,
    connected: () => everConnected,
    on: { frame, peerJoin: () => {}, peerLeave },
  });
  const hello = () => helloFrame("host", name);
  const find = (id) => peers.find((p) => p.peerId === id);

  function fail(text) {
    if (closed) return;
    emit("error", text);
    room.close();
  }

  // The host only answers a guest's hello (guests say hello to every peer they meet),
  // so no guest ever gets a hello from a host that then turns it away.
  function frame(f, from) {
    const known = find(from);
    if (f.k !== "hello") {
      known?.heard(f);
      return;
    }
    if (f.role !== "guest") return;
    if (f.v !== PROTOCOL) return session.raw(hello(), from); // our hello tells it to update
    // Known id (back after Trystero lost it for a moment), or a reloaded guest under a new
    // id taking over its old slot. Our hello brings its side back to "open" at once.
    const back = known ?? peers.find((p) => p.status === "reconnecting" && p.link.peerName === peerNameOf(f));
    if (back) {
      session.raw(hello(), from);
      return back.opened(from, f);
    }
    if (peers.length >= maxPlayers - 1) return session.raw({ k: "full", n: maxPlayers }, from);
    const peer = createPeer({
      role: "host", code, clock, session,
      onClose: () => {
        peers.splice(peers.indexOf(peer), 1); // the slot is free again
        if (!closed && !peers.length) setStatus("waiting");
      },
    });
    peers.push(peer);
    session.raw(hello(), from);
    peer.opened(from, f);
    everConnected = true;
    setStatus("open");
    emit("peer", peer.link);
  }

  function peerLeave(id) {
    find(id)?.lost();
  }

  room.code = code;
  room.maxPlayers = maxPlayers;
  Object.defineProperty(room, "links", { get: () => peers.map((p) => p.link) });
  Object.defineProperty(room, "status", { get: () => status });
  room.close = () => {
    if (closed) return;
    closed = true;
    for (const p of [...peers]) p.link.close(); // each says bye
    timers.stopAll();
    setStatus("closed");
    emit("close");
    session.leave();
  };

  // Started on the next tick so the caller can add listeners first.
  clock.setTimeout(() => session.start(() => setStatus("waiting"), timers), 0);
  return room;
}
