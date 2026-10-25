// Online play by game code: two phones find each other through public Nostr relays
// (Trystero; only the handshake goes there, encrypted with the code) and then talk
// directly over WebRTC with public STUN. No login, no server of our own, no TURN relay,
// so very strict networks (some mobile carriers, guest Wi-Fi) may not connect.
//
// A connection to one other player: an EventTarget with events
//   "open"    detail: { peerName }      the other player is connected (after a hello exchange)
//   "message" detail: <object>          a message from the other player (JSON-serialisable objects)
//   "close"                              the other player left or the connection dropped for good
//   "status"  detail: "waiting" | "connecting" | "open" | "reconnecting" | "closed"
//   "error"   detail: <short plain-English text>, always followed by "close"
// methods: send(obj), ping() -> Promise<ms>, close(); property: open (boolean), peerName,
// role ("host" | "guest").
// The same shape is used by the same-Wi-Fi connection (netqr.js), so games take either.

const APP_ID = "erkdek-play-v1";
const PROTOCOL = 1; // in the hello: both phones must speak the same message format
// Letters that can't be mixed up when read aloud or typed (no O/0, I/1/L, B/8, S/5, Z/2)
export const CODE_LETTERS = "ACDEFGHJKMNPQRTUVWXY";
export const CODE_LENGTH = 4;

const JOIN_TIMEOUT_MS = 20000; // a guest gives up when no host answers
const RELAY_CHECK_MS = 10000; // no relay reachable by then -> say so
const RECONNECT_MS = 10000; // a lost player gets this long to come back
const KEEPALIVE_MS = 2000; // sent when nothing else went out for this long
const SILENT_MS = 6000; // nothing heard for this long = connection lost
const PING_TIMEOUT_MS = 5000;

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

export function hostGame({ name }) {
  const code = newCode();
  return { code, link: createLink({ code, role: "host", name }) };
}

export function joinGame(code, { name }) {
  const c = normalizeCode(code);
  if (!c) throw new RangeError(`Not a game code: ${code}`);
  return createLink({ code: c, role: "guest", name });
}

// Loaded on first use: the vendored file only exists after `npm run vendor`.
const trystero = () => import("./vendor/trystero.js");

// The connection logic; joinRoom/relaySockets/clock are injectable for tests.
export function createLink({ code, role, name, joinRoom, relaySockets, clock = globalThis }) {
  const link = new EventTarget();
  let room = null;
  let action = null;
  let peerId = null; // the other player's Trystero id once hellos are exchanged
  let status = null;
  let closed = false;
  let everOpen = false;
  let peerTrouble = false; // Trystero saw a peer but couldn't connect to it
  let lastHeard = 0;
  let lastSent = 0;
  const timers = {};

  const emit = (type, detail) => link.dispatchEvent(new CustomEvent(type, { detail }));
  const setStatus = (s) => {
    if (s === status) return;
    status = s;
    emit("status", s);
  };
  const stop = (key) => {
    clearTimer(timers[key]);
    delete timers[key];
  };
  const clearTimer = (t) => t && (t.interval ? clock.clearInterval(t.id) : clock.clearTimeout(t.id));
  const after = (key, ms, fn) => {
    stop(key);
    timers[key] = { id: clock.setTimeout(() => { delete timers[key]; fn(); }, ms) };
  };
  const every = (key, ms, fn) => {
    stop(key);
    timers[key] = { id: clock.setInterval(fn, ms), interval: true };
  };
  const now = () => (clock.now ? clock.now() : performance.now());

  const raw = (frame, target) => {
    if (!action) return;
    lastSent = now();
    action.send(frame, target ? { target } : undefined).catch(() => {});
  };

  function fail(text) {
    if (closed) return;
    emit("error", text);
    shutdown();
  }

  function shutdown() {
    if (closed) return;
    closed = true;
    for (const key of Object.keys(timers)) stop(key);
    setStatus("closed");
    emit("close");
    const r = room;
    room = action = null;
    // a moment for a "bye" to leave before the connections close
    if (r) clock.setTimeout(() => r.leave().catch(() => {}), 300);
  }

  function lost() {
    if (closed || status !== "open") return;
    setStatus("reconnecting");
    after("reconnect", RECONNECT_MS, shutdown);
  }

  function opened(id, hello) {
    peerId = id;
    link.peerName = String(hello.name ?? "").slice(0, 40) || "Other player";
    lastHeard = now();
    stop("join");
    stop("reconnect");
    setStatus("open");
    if (!everOpen) {
      everOpen = true;
      emit("open", { peerName: link.peerName });
    }
    every("keepalive", KEEPALIVE_MS / 2, () => {
      if (status === "open" && now() - lastHeard > SILENT_MS) lost();
      if (now() - lastSent >= KEEPALIVE_MS) raw({ k: "ka" }, peerId);
    });
  }

  // The other player slot is free while we have nobody, or while our player is gone
  // (a reloaded app comes back with a new id).
  const slotFree = () => peerId === null || status === "reconnecting";

  function onFrame(frame, from) {
    if (closed || !frame || typeof frame !== "object") return;
    if (frame.k === "hello") {
      if (frame.v !== PROTOCOL) {
        if (from === peerId || slotFree()) fail("The other phone has a different app version. Update both.");
        return;
      }
      const partnerRole = role === "host" ? "guest" : "host";
      if (frame.role !== partnerRole) return; // another guest seen by a guest: not our business
      if (from === peerId || slotFree()) {
        if (from !== peerId) raw(hello(), from); // a new id hasn't had our hello yet
        opened(from, frame);
      } else if (role === "host") raw({ k: "full" }, from);
      return;
    }
    if (frame.k === "full") {
      if (role === "guest" && peerId === null) fail("This game already has two players.");
      return;
    }
    if (from !== peerId) return;
    lastHeard = now();
    if (status === "reconnecting" && frame.k !== "bye") {
      stop("reconnect");
      setStatus("open");
    }
    if (frame.k === "msg") emit("message", frame.d);
    else if (frame.k === "bye") shutdown();
  }

  const hello = () => ({ k: "hello", v: PROTOCOL, role, name: String(name ?? "") });

  async function start() {
    if (clock.navigator?.onLine === false) return fail("No internet connection.");
    setStatus(role === "host" ? "waiting" : "connecting");
    try {
      if (!joinRoom) ({ joinRoom, getRelaySockets: relaySockets } = await trystero());
    } catch {
      return fail("Online play isn't available in this version of the app.");
    }
    if (closed) return;
    // trickleIce: send connection routes as they are found, so a slow STUN server
    // doesn't hold up the connection.
    room = joinRoom({ appId: APP_ID, password: code, trickleIce: true }, code, {
      // Per peer (also a refused third player), so never fatal on its own.
      onJoinError: () => { peerTrouble = true; },
    });
    // One action carries everything: {k: "hello"|"full"|"msg"|"ka"|"bye", ...}
    action = room.makeAction("m", { onMessage: (data, ctx) => onFrame(data, ctx.peerId) });
    room.onPeerJoin = (id) => {
      // a third player gets no hello; the host answers its hello with "full"
      if (!closed && (id === peerId || slotFree())) raw(hello(), id);
    };
    room.onPeerLeave = (id) => {
      if (id === peerId) lost();
    };
    if (role === "guest") after("join", JOIN_TIMEOUT_MS, () => fail(peerTrouble
      ? "Found the game but couldn't reach the other phone. The network may block it; try the same Wi-Fi."
      : "No game found with this code."));
    if (relaySockets) after("relays", RELAY_CHECK_MS, () => {
      const open = Object.values(relaySockets()).some((s) => s.readyState === 1);
      if (!open && !everOpen) fail("Can't reach the internet servers that connect players. Check the connection.");
    });
  }

  link.peerName = null;
  link.role = role;
  link.code = code;
  Object.defineProperty(link, "open", { get: () => status === "open" });
  Object.defineProperty(link, "status", { get: () => status });
  link.send = (obj) => {
    if (status !== "open") return false;
    raw({ k: "msg", d: obj }, peerId);
    return true;
  };
  link.ping = () => {
    if (status !== "open" || !room) return Promise.reject(new Error("Not connected"));
    return new Promise((resolve, reject) => {
      const t = clock.setTimeout(() => reject(new Error("No answer")), PING_TIMEOUT_MS);
      room.ping(peerId).then(
        (ms) => { clock.clearTimeout(t); resolve(ms); },
        (e) => { clock.clearTimeout(t); reject(e); });
    });
  };
  link.close = () => {
    if (closed) return;
    if (peerId) raw({ k: "bye" }, peerId);
    shutdown();
  };

  // Started on the next tick so the caller can add listeners first.
  clock.setTimeout(start, 0);
  return link;
}
