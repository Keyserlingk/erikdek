import assert from "node:assert/strict";
import { test } from "node:test";

// Node 18 has no CustomEvent (browsers and Node 19+ do).
globalThis.CustomEvent ??= class extends Event {
  constructor(type, init) {
    super(type, init);
    this.detail = init?.detail;
  }
};

import { CODE_LETTERS, MAX_PLAYERS, createGuestLink, createHostRoom, newCode, normalizeCode } from "../../data/net.js";

// Manual clock: timers run only when the test advances time.
function fakeClock() {
  let t = 0;
  let next = 1;
  const timers = new Map();
  const add = (fn, ms, interval) => {
    const id = next++;
    timers.set(id, { at: t + ms, fn, ms, interval });
    return id;
  };
  return {
    now: () => t,
    setTimeout: (fn, ms = 0) => add(fn, ms, false),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearTimeout: (id) => timers.delete(id),
    clearInterval: (id) => timers.delete(id),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers].filter(([, x]) => x.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, x] = due;
        t = x.at;
        if (x.interval) x.at += x.ms;
        else timers.delete(id);
        x.fn();
        net.flush();
      }
      t = end;
    },
  };
}

// Stand-in for Trystero: rooms with the same code see each other; messages queue
// until flushed. Peers can drop out (onPeerLeave) and come back.
let net;
function fakeNet() {
  const rooms = [];
  const queue = [];
  let ids = 0;
  const peersOf = (room) => rooms.filter((r) => r !== room && r.code === room.code && r.online);
  const self = {
    rooms,
    joinRoom(config, code) {
      const room = {
        id: `p${++ids}`,
        code,
        config,
        online: true,
        left: false,
        handler: null,
        sent: [],
        makeAction(ns, { onMessage }) {
          room.handler = onMessage;
          return {
            send(data, opts) {
              room.sent.push(data);
              if (room.muted || !room.online) return Promise.resolve();
              const targets = peersOf(room).filter((r) => !opts?.target || r.id === opts.target);
              for (const r of targets) queue.push(() => r.online && r.handler?.(structuredClone(data), { peerId: room.id }));
              return Promise.resolve();
            },
          };
        },
        ping: () => Promise.resolve(12),
        leave() {
          room.left = true;
          self.drop(room);
          return Promise.resolve();
        },
      };
      rooms.push(room);
      self.arrive(room);
      return room;
    },
    arrive(room) {
      room.online = true;
      for (const other of peersOf(room)) {
        queue.push(() => other.onPeerJoin?.(room.id));
        queue.push(() => room.onPeerJoin?.(other.id));
      }
    },
    drop(room) {
      if (!room.online) return;
      for (const other of peersOf(room)) queue.push(() => other.onPeerLeave?.(room.id));
      room.online = false;
    },
    flush() {
      while (queue.length) queue.shift()();
    },
  };
  return self;
}

// Records every event of a link or room: x.of("status") -> the details in order.
function logged(target, types) {
  const log = [];
  for (const type of types) target.addEventListener(type, (e) => log.push([type, e.detail]));
  target.log = log;
  target.of = (type) => log.filter(([t]) => t === type).map(([, d]) => d);
  return target;
}
const LINK_EVENTS = ["open", "message", "close", "status", "error"];

function setup() {
  net = fakeNet();
  const clock = fakeClock();
  // the host's links are logged from the start, by guest name: room.to.Bo
  const host = (name, opts = {}) => {
    const room = logged(createHostRoom({ code: "ACDE", name, joinRoom: net.joinRoom, clock, ...opts }), ["peer", "status", "error", "close"]);
    room.to = {};
    room.addEventListener("peer", (e) => { room.to[e.detail.peerName] = logged(e.detail, LINK_EVENTS); });
    return room;
  };
  const guest = (name, code = "ACDE") => logged(createGuestLink({ code, name, joinRoom: net.joinRoom, clock }), LINK_EVENTS);
  return { clock, host, guest };
}

test("codes: 4 easy letters, input normalised", () => {
  for (let i = 0; i < 200; i++) assert.match(newCode(), /^[ACDEFGHJKMNPQRTUVWXY]{4}$/);
  assert.equal(newCode(() => 0), "AAAA");
  assert.equal(newCode(() => 0.9999), "YYYY");
  for (const bad of "OIL0158BSZ") assert.ok(!CODE_LETTERS.includes(bad));
  assert.equal(normalizeCode(" ac de "), "ACDE");
  assert.equal(normalizeCode("kq-xy"), "KQXY");
  assert.equal(normalizeCode("ACD"), null);
  assert.equal(normalizeCode("ACDEF"), null);
  assert.equal(normalizeCode("ACDO"), null);
  assert.equal(normalizeCode(null), null);
});

test("host and guest exchange hellos, then messages flow both ways", async () => {
  const { clock, host, guest } = setup();
  const room = host("Ana");
  const bo = guest("Bo");
  clock.advance(1);
  assert.equal(net.rooms[0].config.password, "ACDE");
  assert.equal(net.rooms[0].config.appId, "erkdek-play-v1");
  assert.deepEqual(room.of("status"), ["waiting", "open"]);
  assert.deepEqual(bo.of("status"), ["connecting", "open"]);
  assert.deepEqual(bo.of("open"), [{ peerName: "Ana" }]);
  const toBo = room.to.Bo;
  assert.deepEqual(room.links, [toBo]);
  assert.ok(toBo.open && bo.open);
  assert.equal(toBo.role, "host");
  assert.equal(bo.role, "guest");
  assert.equal(toBo.code, "ACDE");
  assert.equal(room.code, "ACDE");
  assert.equal(room.maxPlayers, MAX_PLAYERS);
  assert.deepEqual(toBo.of("open"), []); // the room's "peer" says it instead

  assert.equal(toBo.send({ kg: 12.5 }), true);
  bo.send({ kg: 3 });
  net.flush();
  assert.deepEqual(bo.of("message"), [{ kg: 12.5 }]);
  assert.deepEqual(toBo.of("message"), [{ kg: 3 }]);
  assert.equal(await bo.ping(), 12);
  assert.equal(await toBo.ping(), 12);
});

test("several guests: each has its own link, messages go only where sent", () => {
  const { clock, host, guest } = setup();
  const room = host("Ana");
  const g = ["Bo", "Cy", "Di"].map((n) => guest(n));
  clock.advance(1);
  assert.deepEqual(room.of("peer").map((l) => l.peerName), ["Bo", "Cy", "Di"]);
  assert.deepEqual(room.of("status"), ["waiting", "open"]);
  for (const x of g) assert.deepEqual(x.of("open"), [{ peerName: "Ana" }]);

  room.to.Cy.send({ to: "Cy" });
  g[0].send({ from: "Bo" });
  g[2].send({ from: "Di" });
  net.flush();
  assert.deepEqual(g[0].of("message"), []);
  assert.deepEqual(g[1].of("message"), [{ to: "Cy" }]);
  assert.deepEqual(g[2].of("message"), []);
  assert.deepEqual(room.to.Bo.of("message"), [{ from: "Bo" }]);
  assert.deepEqual(room.to.Cy.of("message"), []);
  assert.deepEqual(room.to.Di.of("message"), [{ from: "Di" }]);
});

test("the room takes five guests; a sixth is refused, the others stay connected", () => {
  const { clock, host, guest } = setup();
  const room = host("Ana");
  const g = ["Bo", "Cy", "Di", "Ed", "Fa"].map((n) => guest(n));
  clock.advance(1);
  assert.equal(room.links.length, 5);
  const sixth = guest("Gu");
  clock.advance(1);
  assert.deepEqual(sixth.of("error"), ["This game is full (6 players)."]);
  assert.deepEqual(sixth.of("status"), ["connecting", "closed"]);
  assert.equal(sixth.of("close").length, 1);
  assert.equal(sixth.of("open").length, 0);
  assert.equal(room.links.length, 5);
  assert.ok(g.every((x) => x.open));
  room.to.Fa.send({ n: 1 });
  net.flush();
  assert.deepEqual(g[4].of("message"), [{ n: 1 }]);
});

test("a smaller room says its own size", () => {
  const { clock, host, guest } = setup();
  host("Ana", { maxPlayers: 2 });
  const bo = guest("Bo");
  clock.advance(1);
  const cy = guest("Cy");
  clock.advance(1);
  assert.ok(bo.open);
  assert.deepEqual(cy.of("error"), ["This game is full (2 players)."]);
});

test("a guest leaving closes only its link and frees the slot", () => {
  const { clock, host, guest } = setup();
  const room = host("Ana", { maxPlayers: 3 });
  const bo = guest("Bo");
  const cy = guest("Cy");
  clock.advance(1);
  bo.close();
  net.flush();
  assert.deepEqual(room.to.Bo.of("status"), ["closed"]); // already open when handed over
  assert.equal(room.to.Bo.of("close").length, 1);
  assert.deepEqual(room.links, [room.to.Cy]);
  assert.ok(cy.open && room.to.Cy.open);
  assert.deepEqual(room.of("status"), ["waiting", "open"]);
  room.to.Cy.send({ still: true });
  net.flush();
  assert.deepEqual(cy.of("message"), [{ still: true }]);

  const di = guest("Di"); // takes Bo's slot
  clock.advance(1);
  assert.ok(di.open);
  assert.equal(room.links.length, 2);

  cy.close();
  di.close();
  net.flush();
  assert.deepEqual(room.of("status"), ["waiting", "open", "waiting"]);
  assert.equal(room.of("close").length, 0);
});

test("a guest gone for good closes its link; the others stay", () => {
  const { clock, host, guest } = setup();
  const room = host("Ana");
  guest("Bo");
  const cy = guest("Cy");
  clock.advance(1);
  net.drop(net.rooms[1]); // Bo
  net.flush();
  assert.equal(room.to.Bo.status, "reconnecting");
  assert.equal(room.to.Bo.send({ x: 1 }), false);
  assert.equal(room.links.length, 2); // still holds its slot
  clock.advance(10001);
  assert.deepEqual(room.to.Bo.of("status"), ["reconnecting", "closed"]);
  assert.equal(room.to.Bo.of("close").length, 1);
  assert.deepEqual(room.links, [room.to.Cy]);
  assert.ok(cy.open && room.to.Cy.open);
  assert.equal(room.status, "open");
});

test("room.close() says bye to everyone and leaves", () => {
  const { clock, host, guest } = setup();
  const room = host("Ana");
  const g = ["Bo", "Cy", "Di"].map((n) => guest(n));
  clock.advance(1);
  const links = room.links;
  room.close();
  net.flush();
  assert.deepEqual(room.of("status"), ["waiting", "open", "closed"]);
  assert.equal(room.of("close").length, 1);
  assert.deepEqual(room.links, []);
  for (const l of links) assert.deepEqual(l.of("status"), ["closed"]);
  for (const x of g) {
    assert.deepEqual(x.of("status"), ["connecting", "open", "closed"]);
    assert.equal(x.of("close").length, 1);
    assert.equal(x.of("error").length, 0);
  }
  clock.advance(1000);
  assert.ok(net.rooms.every((r) => r.left));
});

test("guest without a host times out", () => {
  const { clock, guest } = setup();
  const bo = guest("Bo", "KQXY");
  clock.advance(19000);
  assert.equal(bo.of("error").length, 0);
  clock.advance(2000);
  assert.match(bo.of("error")[0], /No game found/);
  assert.deepEqual(bo.of("status"), ["connecting", "closed"]);
  assert.ok(net.rooms[0].left);
});

test("trouble reaching a found peer gives a better timeout message", () => {
  const { clock } = setup();
  net.joinRoom = ((join) => (config, code, callbacks) => {
    clock.setTimeout(() => callbacks.onJoinError({ error: "could not connect" }), 3000);
    return join(config, code);
  })(net.joinRoom);
  const room = createHostRoom({ code: "ACDE", name: "Ana", joinRoom: net.joinRoom, clock });
  const bo = createGuestLink({ code: "KQXY", name: "Bo", joinRoom: net.joinRoom, clock });
  const errors = [];
  for (const l of [room, bo]) l.addEventListener("error", (e) => errors.push(e.detail));
  clock.advance(21000);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /couldn't reach the other phone/);
  assert.equal(room.status, "waiting");
});

test("a host keeps waiting", () => {
  const { clock, host } = setup();
  const room = host("Ana");
  clock.advance(120000);
  assert.deepEqual(room.of("status"), ["waiting"]);
});

test("a dropped guest is waited for and can come back", () => {
  const { clock, host, guest } = setup();
  const room = host("Ana");
  const bo = guest("Bo");
  const cy = guest("Cy");
  clock.advance(1);
  const boRoom = net.rooms[1];
  net.drop(boRoom);
  net.flush();
  assert.equal(room.to.Bo.status, "reconnecting");
  assert.equal(room.to.Cy.status, "open");
  clock.advance(5000);
  net.arrive(boRoom);
  net.flush();
  assert.deepEqual(room.to.Bo.of("status"), ["reconnecting", "open"]);
  assert.equal(bo.status, "open");
  assert.equal(bo.of("open").length, 1); // "open" event only once
  assert.equal(room.of("peer").length, 2); // no new "peer" either
  assert.ok(cy.open);
});

test("a reloaded guest (new id, same name) takes over its slot", () => {
  const { clock, host, guest } = setup();
  const room = host("Ana", { maxPlayers: 3 });
  const bo = guest("Bo");
  guest("Cy");
  clock.advance(1);
  const toBo = room.to.Bo;
  net.drop(net.rooms[1]); // the app reloads: its old id is gone
  net.flush();
  bo.close();
  const stranger = guest("Ed"); // full while Bo may still come back
  clock.advance(1);
  assert.deepEqual(stranger.of("error"), ["This game is full (3 players)."]);
  clock.advance(3000);
  const bo2 = guest("Bo");
  clock.advance(1);
  assert.ok(bo2.open);
  assert.deepEqual(toBo.of("status"), ["reconnecting", "open"]);
  assert.equal(room.links.length, 2);
  assert.equal(room.of("peer").length, 2);
  toBo.send({ hi: 2 });
  net.flush();
  assert.deepEqual(bo2.of("message"), [{ hi: 2 }]);
});

test("silence counts as a lost connection; keep-alives prevent it", () => {
  const { clock, host, guest } = setup();
  const room = host("Ana");
  guest("Bo");
  clock.advance(1);
  clock.advance(30000); // idle but connected: keep-alives flow
  assert.equal(room.to.Bo.status, "open");
  assert.ok(net.rooms[0].sent.some((f) => f.k === "ka"));
  // the guest's frames stop arriving, but Trystero doesn't notice
  net.rooms[1].muted = true;
  clock.advance(8000);
  assert.equal(room.to.Bo.status, "reconnecting");
  net.rooms[1].muted = false;
  clock.advance(2000); // next keep-alive from the guest restores it
  assert.equal(room.to.Bo.status, "open");
});

test("a guest's close() says bye: the host's link closes at once", () => {
  const { clock, host, guest } = setup();
  const room = host("Ana");
  const bo = guest("Bo");
  clock.advance(1);
  bo.close();
  net.flush();
  assert.deepEqual(room.to.Bo.of("status"), ["closed"]);
  assert.deepEqual(room.of("status"), ["waiting", "open", "waiting"]);
  assert.deepEqual(bo.of("status"), ["connecting", "open", "closed"]);
  clock.advance(1000);
  assert.ok(net.rooms[1].left);
  assert.ok(!net.rooms[0].left);
});

test("a different app version is refused on both sides; the room stays", () => {
  const { clock, host, guest } = setup();
  const room = host("Ana");
  clock.advance(1);
  // an old guest gets our hello, so it can tell its user to update
  const old = net.joinRoom({}, "ACDE");
  const heard = [];
  old.makeAction("m", { onMessage: (d) => heard.push(d) }).send({ k: "hello", v: 1, role: "guest", name: "Old" }, { target: "p1" });
  net.flush();
  assert.deepEqual(heard.map((f) => [f.k, f.v]), [["hello", 2]]);
  assert.equal(room.of("error").length, 0);
  assert.deepEqual(room.links, []);
  assert.equal(room.status, "waiting");

  // an old host: our guest stops
  const bo = guest("Bo", "KQXY");
  clock.advance(1);
  const oldHost = net.joinRoom({}, "KQXY");
  oldHost.makeAction("m", { onMessage: () => {} }).send({ k: "hello", v: 1, role: "host", name: "Old" });
  net.flush();
  assert.match(bo.of("error")[0], /different app version/);
});

test("guests ignore each other's hellos", () => {
  const { clock, guest } = setup();
  const bo = guest("Bo");
  const cy = guest("Cy");
  clock.advance(1);
  assert.deepEqual(bo.of("status"), ["connecting"]);
  assert.deepEqual(cy.of("status"), ["connecting"]);
});

test("no relay reachable, or offline: said plainly", () => {
  const { clock } = setup();
  const errors = [];
  const sockets = { a: { readyState: 3 } };
  const room = createHostRoom({ code: "ACDE", name: "Ana", joinRoom: net.joinRoom, relaySockets: () => sockets, clock });
  const closes = [];
  room.addEventListener("error", (e) => errors.push(e.detail));
  room.addEventListener("close", () => closes.push(1));
  clock.advance(10001);
  assert.match(errors[0], /Can't reach the internet servers/);
  assert.equal(room.status, "closed");
  assert.equal(closes.length, 1);

  const offline = createGuestLink({ code: "ACDE", name: "Bo", joinRoom: net.joinRoom, clock: { ...clock, navigator: { onLine: false } } });
  offline.addEventListener("error", (e) => errors.push(e.detail));
  clock.advance(1);
  assert.equal(errors[1], "No internet connection.");
  assert.equal(offline.status, "closed");
});

